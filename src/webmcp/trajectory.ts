import type { FlightState } from '../sim/types'
import type { WebMcpActivity } from './useWebMcp'

export interface FlightTrajectory {
  readonly schemaVersion: 'flightdeck-trajectory-v1'
  readonly environmentVersion: 'flightdeck-webmcp-v1'
  readonly runId: string
  readonly seed: number
  readonly mode: FlightState['mode']
  readonly tickRateHz: 60
  readonly simulationRate: number
  readonly steps: readonly {
    readonly observation: FlightState
    readonly action: { readonly tool: string; readonly arguments: Readonly<Record<string, unknown>> }
    readonly result: { readonly ok: boolean; readonly summary: string }
    readonly rewardDelta: number
    readonly latencyMs: number
    readonly nextObservation: FlightState
    readonly done: boolean
  }[]
  readonly finalScore: number
  readonly outcome: FlightState['mission']['outcome']
}

export function createFlightTrajectory(activities: readonly WebMcpActivity[], finalState: FlightState): FlightTrajectory {
  const completed = activities.filter((activity) => activity.result && activity.nextObservation && activity.latencyMs !== null)
  return Object.freeze({
    schemaVersion: 'flightdeck-trajectory-v1',
    environmentVersion: 'flightdeck-webmcp-v1',
    runId: finalState.checkride.runId,
    seed: finalState.checkride.seed,
    mode: finalState.mode,
    tickRateHz: 60,
    simulationRate: finalState.checkride.simulationRate,
    steps: Object.freeze(completed.map((activity) => Object.freeze({
      observation: activity.observation,
      action: Object.freeze({ tool: activity.tool, arguments: activity.arguments }),
      result: activity.result!,
      rewardDelta: activity.rewardDelta ?? 0,
      latencyMs: activity.latencyMs!,
      nextObservation: activity.nextObservation!,
      done: activity.nextObservation!.mission.outcome !== 'in_progress',
    }))),
    finalScore: finalState.checkride.score.total,
    outcome: finalState.mission.outcome,
  })
}
