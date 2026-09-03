import { useCallback, useEffect, useRef, useState } from 'react'
import { executeFlightToolFromUnknown } from '../shared/executeFlightTool'
import { flightSimulator } from '../sim/flightSimulator'
import type { FlightState } from '../sim/types'
import { buildRadioCue, type RadioCue } from '../audio/radioCues'
import { queueEvaluationEvidence } from './evaluationArchive'
import { createFlightRunExport } from './runExport'
import {
  flightToolDefinitions,
  type FlightToolDefinition,
  type FlightToolName,
  type FlightToolResults,
} from '../shared/flightTools'

export type WebMcpStatus = 'registering' | 'ready' | 'unsupported' | 'error'
export type WebMcpRecordedResult = FlightToolResults[FlightToolName] | {
  readonly ok: false
  readonly summary: string
  readonly error: { readonly name: string; readonly message: string }
}

export interface WebMcpActivity {
  readonly id: number
  readonly tool: FlightToolName
  readonly title: string
  readonly status: 'running' | 'completed' | 'failed'
  readonly summary: string
  readonly startedAt: number
  readonly completedAt: number | null
  readonly latencyMs: number | null
  readonly scoreBefore: number
  readonly scoreAfter: number | null
  readonly rewardDelta: number | null
  readonly observation: FlightState
  readonly nextObservation: FlightState | null
  readonly result: WebMcpRecordedResult | null
  readonly arguments: Readonly<Record<string, unknown>>
  readonly radioCues: readonly RadioCue[]
  readonly traceStartId: number
}

interface BeginActivityOptions {
  readonly observation?: FlightState
  readonly startedAt?: number
}
type BeginActivity = (activity: Pick<WebMcpActivity, 'tool' | 'title' | 'arguments'>, options?: BeginActivityOptions) => number
type CompleteActivity = (id: number, result: WebMcpRecordedResult, failed?: boolean) => void

function createFlightTools(definitions: readonly FlightToolDefinition[], beginActivity: BeginActivity, completeActivity: CompleteActivity): WebMCP.ModelContextTool[] {
  return definitions.map((definition) => ({
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: { readOnlyHint: definition.readOnly },
    execute: async (input: Record<string, unknown>) => {
      const activity = { tool: definition.name, title: definition.title, arguments: input }
      const startedAt = Date.now()
      let activityId = definition.name === 'start_flight' ? null : beginActivity(activity, { startedAt })
      try {
        const result = await executeFlightToolFromUnknown(definition.name, input)
        activityId ??= beginActivity(activity, {
          observation: flightSimulator.getState(),
          startedAt,
        })
        completeActivity(activityId, result, !result.ok)
        return result
      } catch (error) {
        activityId ??= beginActivity(activity, { startedAt })
        const message = error instanceof Error ? error.message : 'Tool call failed'
        completeActivity(activityId, {
          ok: false,
          summary: message,
          error: { name: error instanceof Error ? error.name : 'Error', message },
        }, true)
        throw error
      }
    },
  }))
}

export function useWebMcp() {
  const [status, setStatus] = useState<WebMcpStatus>('registering')
  const [activities, setActivities] = useState<readonly WebMcpActivity[]>([])
  const activitiesRef = useRef<readonly WebMcpActivity[]>([])
  const nextActivityId = useRef(1)
  const clearActivities = useCallback(() => {
    nextActivityId.current = 1
    activitiesRef.current = []
    setActivities([])
  }, [])

  useEffect(() => {
    if (!document.modelContext) {
      setStatus('unsupported')
      return
    }
    const modelContext = document.modelContext
    const controller = new AbortController()
    const beginActivity: BeginActivity = (activity, options = {}) => {
      const observation = options.observation ?? flightSimulator.getState()
      const id = nextActivityId.current++
      const event = {
        ...activity,
        id,
        status: 'running' as const,
        summary: 'In progress',
        startedAt: options.startedAt ?? Date.now(),
        completedAt: null,
        latencyMs: null,
        scoreBefore: observation.checkride.score.total,
        scoreAfter: null,
        rewardDelta: null,
        observation,
        nextObservation: null,
        result: null,
        radioCues: Object.freeze([]),
        traceStartId: activity.tool === 'start_flight' ? 0 : (flightSimulator.getTrace().at(-1)?.id ?? 0),
      }
      const nextActivities = [...activitiesRef.current, event]
      activitiesRef.current = nextActivities
      setActivities(nextActivities)
      return id
    }
    const completeActivity: CompleteActivity = (id, result, failed = false) => {
      const nextObservation = flightSimulator.getState()
      const completedAt = Date.now()
      const nextActivities: readonly WebMcpActivity[] = activitiesRef.current.map((activity) => {
        if (activity.id !== id) return activity
        const radioCues = flightSimulator.getTrace()
          .filter((event) => event.id > activity.traceStartId)
          .map((event) => buildRadioCue(event, nextObservation))
          .filter((cue): cue is RadioCue => cue !== null)
        return {
          ...activity,
          status: failed ? 'failed' as const : 'completed' as const,
          summary: result.summary,
          completedAt,
          latencyMs: completedAt - activity.startedAt,
          scoreAfter: nextObservation.checkride.score.total,
          rewardDelta: nextObservation.checkride.score.total - activity.scoreBefore,
          nextObservation,
          result,
          radioCues: Object.freeze(radioCues),
        }
      })
      activitiesRef.current = nextActivities
      setActivities(nextActivities)
      void queueEvaluationEvidence(createFlightRunExport(
        nextActivities,
        nextObservation,
        flightSimulator.getMissionBrief(),
        flightSimulator.getTrace(),
      ))
    }

    async function registerTools() {
      try {
        await Promise.all(
          createFlightTools(flightToolDefinitions, beginActivity, completeActivity).map((tool) =>
            modelContext.registerTool(tool, { signal: controller.signal }),
          ),
        )
        if (!controller.signal.aborted) setStatus('ready')
      } catch (error) {
        if (!controller.signal.aborted) {
          controller.abort()
          setStatus('error')
          console.error('WebMCP registration failed', error)
        }
      }
    }

    void registerTools()
    return () => controller.abort()
  }, [])

  return { status, activities, clearActivities }
}
