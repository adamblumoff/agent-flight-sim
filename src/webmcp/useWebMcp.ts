import { useCallback, useEffect, useRef, useState } from 'react'
import { executeFlightToolFromUnknown } from '../shared/executeFlightTool'
import { flightSimulator } from '../sim/flightSimulator'
import type { FlightState } from '../sim/types'
import {
  flightToolDefinitions,
  type FlightToolName,
} from '../shared/flightTools'

export type WebMcpStatus = 'registering' | 'ready' | 'unsupported' | 'error'

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
  readonly result: { readonly ok: boolean; readonly summary: string } | null
  readonly arguments: Readonly<Record<string, unknown>>
}

type BeginActivity = (activity: Pick<WebMcpActivity, 'tool' | 'title' | 'arguments'>) => number
type CompleteActivity = (id: number, result: { readonly ok: boolean; readonly summary: string }, failed?: boolean) => void

function createFlightTools(beginActivity: BeginActivity, completeActivity: CompleteActivity): WebMCP.ModelContextTool[] {
  return flightToolDefinitions.map((definition) => ({
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: { readOnlyHint: definition.readOnly },
    execute: async (input: Record<string, unknown>) => {
      const activityId = beginActivity({ tool: definition.name, title: definition.title, arguments: input })
      try {
        const result = await executeFlightToolFromUnknown(definition.name, input)
        completeActivity(activityId, { ok: result.ok, summary: result.summary }, !result.ok)
        return result
      } catch (error) {
        completeActivity(activityId, { ok: false, summary: error instanceof Error ? error.message : 'Tool call failed' }, true)
        throw error
      }
    },
  }))
}

export function useWebMcp() {
  const [status, setStatus] = useState<WebMcpStatus>('registering')
  const [activities, setActivities] = useState<readonly WebMcpActivity[]>([])
  const nextActivityId = useRef(1)
  const clearActivities = useCallback(() => setActivities([]), [])

  useEffect(() => {
    if (!document.modelContext) {
      setStatus('unsupported')
      return
    }
    const modelContext = document.modelContext
    const controller = new AbortController()
    const beginActivity: BeginActivity = (activity) => {
      const observation = flightSimulator.getState()
      const id = nextActivityId.current++
      const event = {
        ...activity,
        id,
        status: 'running' as const,
        summary: 'In progress',
        startedAt: Date.now(),
        completedAt: null,
        latencyMs: null,
        scoreBefore: observation.checkride.score.total,
        scoreAfter: null,
        rewardDelta: null,
        observation,
        nextObservation: null,
        result: null,
      }
      setActivities((current) => activity.tool === 'start_flight' ? [event] : [...current, event])
      return id
    }
    const completeActivity: CompleteActivity = (id, result, failed = false) => {
      const nextObservation = flightSimulator.getState()
      const completedAt = Date.now()
      setActivities((current) => current.map((activity) => activity.id === id ? {
        ...activity,
        status: failed ? 'failed' : 'completed',
        summary: result.summary,
        completedAt,
        latencyMs: completedAt - activity.startedAt,
        scoreAfter: nextObservation.checkride.score.total,
        rewardDelta: nextObservation.checkride.score.total - activity.scoreBefore,
        nextObservation,
        result,
      } : activity))
    }

    async function registerTools() {
      try {
        await Promise.all(
          createFlightTools(beginActivity, completeActivity).map((tool) =>
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
