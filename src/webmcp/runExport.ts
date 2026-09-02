import { radioVoiceClipFor } from '../audio/radioVoicePack'
import type { FlightState, MissionBrief, TraceEvent } from '../sim/types'
import type { WebMcpActivity } from './useWebMcp'

export interface FlightRunExport {
  readonly schemaVersion: 'flightdeck-run-v2'
  readonly environmentVersion: 'flightdeck-webmcp-v5'
  readonly generatedAt: string
  readonly run: {
    readonly runId: string
    readonly buildId: string
    readonly profileId: string
    readonly seed: number
    readonly tickRateHz: 60
    readonly simulationRate: number
    readonly startedAt: string | null
    readonly completedAt: string | null
    readonly outcome: FlightState['mission']['outcome']
    readonly score: FlightState['checkride']['score']
  }
  readonly missionBrief: MissionBrief
  readonly calls: readonly {
    readonly id: number
    readonly tool: string
    readonly title: string
    readonly status: WebMcpActivity['status']
    readonly startedAt: string
    readonly completedAt: string | null
    readonly latencyMs: number | null
    readonly observation: FlightState
    readonly action: { readonly arguments: Readonly<Record<string, unknown>> }
    readonly result: Readonly<Record<string, unknown>> | null
    readonly rewardDelta: number | null
    readonly nextObservation: FlightState | null
    readonly done: boolean
    readonly radio: readonly {
      readonly id: string
      readonly kind: string
      readonly speaker: string
      readonly speakerLabel: string
      readonly priority: string
      readonly text: string
      readonly payloadRef: { readonly traceId: number; readonly action: string }
      readonly audioClip: string | null
    }[]
  }[]
  readonly trace: readonly TraceEvent[]
  readonly finalState: FlightState
}

const compactResult = (result: WebMcpActivity['result']): Readonly<Record<string, unknown>> | null => {
  if (result === null) return null
  const { state: _state, ...withoutState } = result as WebMcpActivity['result'] & { readonly state?: unknown }
  const details = 'details' in withoutState ? withoutState.details : null
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return Object.freeze(withoutState)
  const { state: _detailsState, ...compactDetails } = details as Readonly<Record<string, unknown>> & { readonly state?: unknown }
  return Object.freeze({ ...withoutState, details: Object.freeze(compactDetails) })
}

export function createFlightRunExport(
  activities: readonly WebMcpActivity[],
  finalState: FlightState,
  missionBrief: MissionBrief,
  trace: readonly TraceEvent[],
): FlightRunExport {
  const completed = activities.filter((activity) => activity.status !== 'running')
  const startedAt = completed[0]?.startedAt ?? null
  const completedAt = completed.at(-1)?.completedAt ?? null
  return Object.freeze({
    schemaVersion: 'flightdeck-run-v2',
    environmentVersion: 'flightdeck-webmcp-v5',
    generatedAt: new Date().toISOString(),
    run: Object.freeze({
      runId: finalState.checkride.runId,
      buildId: finalState.checkride.buildId,
      profileId: finalState.checkride.profileId,
      seed: finalState.checkride.seed,
      tickRateHz: 60,
      simulationRate: finalState.checkride.simulationRate,
      startedAt: startedAt === null ? null : new Date(startedAt).toISOString(),
      completedAt: completedAt === null ? null : new Date(completedAt).toISOString(),
      outcome: finalState.mission.outcome,
      score: finalState.checkride.score,
    }),
    missionBrief,
    calls: Object.freeze(completed.map((activity) => Object.freeze({
      id: activity.id,
      tool: activity.tool,
      title: activity.title,
      status: activity.status,
      startedAt: new Date(activity.startedAt).toISOString(),
      completedAt: activity.completedAt === null ? null : new Date(activity.completedAt).toISOString(),
      latencyMs: activity.latencyMs,
      observation: activity.observation,
      action: Object.freeze({ arguments: activity.arguments }),
      result: compactResult(activity.result),
      rewardDelta: activity.rewardDelta,
      nextObservation: activity.nextObservation,
      done: activity.nextObservation?.mission.outcome !== 'in_progress',
      radio: Object.freeze(activity.radioCues.map((cue) => Object.freeze({
        ...cue,
        audioClip: radioVoiceClipFor(cue)?.key ?? null,
      }))),
    }))),
    trace: Object.freeze([...trace]),
    finalState,
  })
}
