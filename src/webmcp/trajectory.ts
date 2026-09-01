import type { FlightState } from '../sim/types'
import { checkpointCaptureRadiusNm } from '../sim/checkpoints'
import type { WebMcpActivity } from './useWebMcp'

export const TRAJECTORY_OBSERVATION_SCHEMA = Object.freeze([
  'elapsedSeconds', 'lat', 'lon', 'altitudeFt', 'airspeedKt', 'verticalSpeedFpm', 'headingDeg', 'pitchDeg', 'bankDeg',
  'throttle', 'pitchIntent', 'bankIntent', 'flapsDeg', 'gearDown', 'fuelMinutesRemaining', 'controlOwner', 'agentMode', 'aircraftPhase',
  'groundSpeedKt', 'trackDeg', 'headwindKt', 'crosswindKt', 'angleOfAttackDeg', 'stalled',
  'impactSeverity', 'impactSinkRateFpm', 'impactOnRunway',
  'routePlan', 'routeDestination', 'routeRunway', 'activeWaypointIndex', 'activeWaypointId', 'activeWaypointKind',
  'activeWaypointAltitudeFt', 'activeWaypointAirspeedKt', 'activeWaypointCaptureRadiusNm', 'activeWaypointCaptureHeadingDeg',
  'atcStatus', 'atcRequestedPlan', 'clearanceId', 'clearancePlan', 'clearanceHeadingDeg', 'clearanceAltitudeFt', 'clearanceAirspeedKt',
  'visibilityMiles', 'ceilingFt', 'windDirectionDeg', 'windSpeedKt', 'engineHealth', 'maximumPower', 'passengerCondition',
  'trafficDelayMinutes', 'priorityAvailable', 'procedureStage', 'procedureGearDown', 'procedureFlapsDeg', 'procedureCompliant',
  'loadFactorG', 'jerkGPerSecond', 'passengerDistress', 'injuryProbability', 'passengerStatus', 'approvalStatus',
  'missionPhase', 'missionOutcome', 'nextFix', 'distanceToNextFixNm', 'bearingToNextFixDeg', 'closingRateKt', 'captureRadiusNm',
  'minimumTurnRadiusNm', 'routeStatus', 'distanceToThresholdNm', 'centerlineErrorNm', 'glidepathErrorFt', 'stableApproach', 'eventRevision',
  'checkrideStatus', 'decisionSecondsRemaining', 'checkrideFuelMinutesRemaining', 'alert', 'humanApproval', 'score', 'scoreDeductions', 'decision',
  'debriefStatus', 'debriefElapsedSeconds', 'debriefDecision', 'decisionReason', 'landing',
] as const)

export type TrajectoryObservation = readonly unknown[]

export interface FlightTrajectory {
  readonly schemaVersion: 'flightdeck-trajectory-v2'
  readonly environmentVersion: 'flightdeck-webmcp-v3'
  readonly buildId: string
  readonly profileId: string
  readonly runId: string
  readonly seed: number
  readonly tickRateHz: 60
  readonly simulationRate: number
  readonly observationSchema: typeof TRAJECTORY_OBSERVATION_SCHEMA
  readonly steps: readonly {
    readonly observation: TrajectoryObservation
    readonly action: { readonly tool: string; readonly arguments: Readonly<Record<string, unknown>> }
    readonly result: { readonly ok: boolean; readonly summary: string }
    readonly rewardDelta: number
    readonly latencyMs: number
    readonly nextObservation: TrajectoryObservation
    readonly done: boolean
  }[]
  readonly finalScore: number
  readonly outcome: FlightState['mission']['outcome']
}

function compactObservation(state: FlightState): TrajectoryObservation {
  const activeWaypoint = state.route.waypoints[state.route.activeWaypointIndex] ?? null
  const clearance = state.atc.clearance
  const impact = state.impact
  return Object.freeze([
    state.elapsedSeconds, state.lat, state.lon, state.altitudeFt, state.airspeedKt, state.verticalSpeedFpm,
    state.headingDeg, state.pitchDeg, state.bankDeg, state.throttle, state.controlInputs.pitchAxis, state.controlInputs.bankAxis,
    state.flapsDeg, state.gearDown,
    state.fuelMinutesRemaining, state.controlOwner, state.agentMode, state.aircraftPhase,
    state.motion.groundSpeedKt, state.motion.trackDeg, state.motion.headwindKt, state.motion.crosswindKt,
    state.motion.angleOfAttackDeg, state.motion.stalled,
    impact?.severity ?? null, impact?.sinkRateFpm ?? null, impact?.onRunway ?? null,
    state.route.plan, state.route.destination, state.route.runway, state.route.activeWaypointIndex,
    activeWaypoint?.id ?? null, activeWaypoint?.kind ?? null, activeWaypoint?.altitudeFt ?? null,
    activeWaypoint?.airspeedKt ?? null, activeWaypoint ? checkpointCaptureRadiusNm(activeWaypoint) : null,
    activeWaypoint?.captureHeadingDeg ?? null,
    state.atc.status, state.atc.requestedPlan, clearance?.id ?? null, clearance?.plan ?? null,
    clearance?.headingDeg ?? null, clearance?.altitudeFt ?? null, clearance?.airspeedKt ?? null,
    state.scenario.weather.visibilityMiles, state.scenario.weather.ceilingFt, state.scenario.weather.windDirectionDeg,
    state.scenario.weather.windSpeedKt, state.scenario.engine.health, state.scenario.engine.maximumPower,
    state.scenario.passenger.condition, state.scenario.traffic.delayMinutes, state.scenario.traffic.priorityAvailable,
    state.procedure.stage, state.procedure.gearDown, state.procedure.flapsDeg, state.procedure.compliant,
    state.passengerSafety.loadFactorG, state.passengerSafety.jerkGPerSecond, state.passengerSafety.distress,
    state.passengerSafety.injuryProbability, state.passengerSafety.status, state.approval.status,
    state.mission.phase, state.mission.outcome, state.mission.nextFix, state.mission.distanceToNextFixNm,
    state.mission.bearingToNextFixDeg, state.mission.closingRateKt, state.mission.captureRadiusNm,
    state.mission.minimumTurnRadiusNm, state.mission.routeStatus, state.mission.distanceToThresholdNm,
    state.mission.centerlineErrorNm, state.mission.glidepathErrorFt, state.mission.stableApproach, state.mission.eventRevision,
    state.checkride.status, state.checkride.decisionSecondsRemaining, state.checkride.fuelMinutesRemaining,
    state.checkride.alert, state.checkride.humanApproval, state.checkride.score.total, state.checkride.score.deductions,
    state.checkride.decision, state.debrief.status, state.debrief.elapsedSeconds, state.debrief.decision,
    state.debrief.decisionReason, state.debrief.landing,
  ])
}

export function createFlightTrajectory(activities: readonly WebMcpActivity[], finalState: FlightState): FlightTrajectory {
  const completed = activities.filter((activity) => activity.result && activity.nextObservation && activity.latencyMs !== null)
  return Object.freeze({
    schemaVersion: 'flightdeck-trajectory-v2',
    environmentVersion: 'flightdeck-webmcp-v3',
    buildId: finalState.checkride.buildId,
    profileId: finalState.checkride.profileId,
    runId: finalState.checkride.runId,
    seed: finalState.checkride.seed,
    tickRateHz: 60,
    simulationRate: finalState.checkride.simulationRate,
    observationSchema: TRAJECTORY_OBSERVATION_SCHEMA,
    steps: Object.freeze(completed.map((activity) => Object.freeze({
      observation: compactObservation(activity.observation),
      action: Object.freeze({ tool: activity.tool, arguments: activity.arguments }),
      result: activity.result!,
      rewardDelta: activity.rewardDelta ?? 0,
      latencyMs: activity.latencyMs!,
      nextObservation: compactObservation(activity.nextObservation!),
      done: activity.nextObservation!.mission.outcome !== 'in_progress',
    }))),
    finalScore: finalState.checkride.score.total,
    outcome: finalState.mission.outcome,
  })
}
