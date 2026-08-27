export type ControlOwner = 'human' | 'agent'

export type TraceActor = ControlOwner | 'system'

export type FlightScenario = 'clear' | 'engine_instability'

export type CheckrideSeed = 17 | 42 | 81

export type CheckrideEvidenceSource = 'weather' | 'cockpit' | 'traffic' | 'passenger'

export type CheckrideDecision =
  | 'divert'
  | 'request_priority'
  | 'declare_minimum_fuel'
  | 'continue'
  | 'hold'

export type CheckrideStatus =
  | 'armed'
  | 'decision_required'
  | 'awaiting_human'
  | 'resolved'
  | 'complete'

export type HumanApproval = 'not_required' | 'pending' | 'approved' | 'denied'

export type EvidenceReliability = 'current' | 'stale' | 'unreliable'

export interface CheckrideEvidence {
  readonly source: CheckrideEvidenceSource
  readonly headline: string
  readonly detail: string
  readonly reliability: EvidenceReliability
}

export interface CheckrideScore {
  readonly total: number
  readonly safety: number
  readonly judgment: number
  readonly fuel: number
  readonly interventions: number
  readonly recognitionSeconds: number | null
}

export interface CheckrideState {
  readonly seed: CheckrideSeed
  readonly status: CheckrideStatus
  readonly objective: string
  readonly deadlineSeconds: number
  readonly fuelMinutesRemaining: number
  readonly alert: string | null
  readonly allowedDecisions: readonly CheckrideDecision[]
  readonly decision: CheckrideDecision | null
  readonly humanApproval: HumanApproval
  readonly inspectedSources: readonly CheckrideEvidenceSource[]
  readonly score: CheckrideScore
}

export type FlightEventType =
  | 'handoff_requested'
  | 'command_required'
  | 'system_alert'
  | 'decision_resolved'
  | 'human_approval_required'
  | 'human_approval_resolved'
  | 'touchdown'
  | 'mission_complete'

export interface FlightEvent {
  readonly revision: number
  readonly type: FlightEventType
  readonly elapsedSeconds: number
  readonly message: string
  readonly phase: MissionPhase
  readonly allowedCommands: readonly FlightCommand[]
  readonly allowedDecisions: readonly CheckrideDecision[]
}

export type MissionFixId =
  | 'DEPART'
  | 'CROSSWIND'
  | 'NORTH_GATE'
  | 'DOWNWIND'
  | 'BASE_GATE'
  | 'FINAL_GATE'
  | 'TOUCHDOWN'
  | 'DIVERSION_EXIT'

export type MissionPhase =
  | 'preflight'
  | 'takeoff'
  | 'departure'
  | 'crosswind'
  | 'downwind'
  | 'base'
  | 'final'
  | 'flare'
  | 'rollout'
  | 'go_around'
  | 'diversion'
  | 'complete'
  | 'failed'

export type MissionOutcome =
  | 'in_progress'
  | 'landed'
  | 'safe_diversion'
  | 'go_around'
  | 'unsafe_touchdown'
  | 'runway_excursion'
  | 'unsafe_decision'

export type FlightCommand =
  | 'takeoff'
  | 'proceed_to_fix'
  | 'enter_downwind'
  | 'extend_downwind'
  | 'begin_approach'
  | 'land'
  | 'go_around'

export interface FlightDirectorState {
  readonly enabled: boolean
  readonly headingDeg: number
  readonly altitudeFt: number
  readonly airspeedKt: number
}

export interface MissionNavigationState {
  readonly phase: MissionPhase
  readonly outcome: MissionOutcome
  readonly activeLegId: string | null
  readonly nextFix: MissionFixId | null
  readonly distanceToNextFixNm: number | null
  readonly alongTrackNm: number
  readonly crossTrackErrorNm: number
  readonly distanceToThresholdNm: number
  readonly centerlineErrorNm: number
  readonly glidepathErrorFt: number
  readonly stableApproach: boolean
  readonly awaitingCommand: boolean
  readonly allowedCommands: readonly FlightCommand[]
  readonly eventRevision: number
}

export interface FlightState {
  readonly lat: number
  readonly lon: number
  readonly altitudeFt: number
  readonly airspeedKt: number
  readonly verticalSpeedFpm: number
  readonly headingDeg: number
  readonly pitchDeg: number
  readonly bankDeg: number
  readonly throttle: number
  readonly flapsDeg: number
  readonly gearDown: boolean
  readonly controlOwner: ControlOwner
  readonly handoffRequested: boolean
  readonly flightDirector: FlightDirectorState
  readonly scenario: FlightScenario
  readonly mission: MissionNavigationState
  readonly checkride: CheckrideState
}

export interface PilotInput {
  readonly pitchDelta?: number
  readonly bankDelta?: number
}

export interface TraceEvent {
  readonly id: number
  readonly time: number
  readonly elapsedSeconds: number
  readonly actor: TraceActor
  readonly action: string
  readonly reason: string
  readonly details: Readonly<Record<string, unknown>>
}

export interface Airport {
  readonly code: string
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly elevationFt: number
}

export interface MissionRunway {
  readonly id: string
  readonly thresholdLat: number
  readonly thresholdLon: number
  readonly farEndLat: number
  readonly farEndLon: number
  readonly headingDeg: number
  readonly lengthFt: number
  readonly widthFt: number
  readonly elevationFt: number
  readonly touchdownZoneStartFt: number
  readonly touchdownZoneEndFt: number
}

export interface MissionFix {
  readonly id: MissionFixId
  readonly name: string
  readonly lat: number
  readonly lon: number
  readonly altitudeFt: number
  readonly airspeedKt: number
}

export interface MissionLeg {
  readonly id: string
  readonly from: 'RUNWAY_START' | MissionFixId
  readonly to: MissionFixId
  readonly phase: MissionPhase
  readonly distanceNm: number
  readonly altitudeFt: number
  readonly airspeedKt: number
}

export interface MissionBrief {
  readonly id: string
  readonly name: string
  readonly objective: string
  readonly airport: Airport
  readonly runway: MissionRunway
  readonly routeDistanceNm: number
  readonly estimatedDurationMinutes: number
  readonly fixes: readonly MissionFix[]
  readonly legs: readonly MissionLeg[]
  readonly constraints: readonly string[]
  readonly successConditions: readonly string[]
  readonly startingCommands: readonly FlightCommand[]
  readonly evidenceSources: readonly CheckrideEvidenceSource[]
}

export interface FlightCommandInput {
  readonly command: FlightCommand
  readonly target?: MissionFixId
  readonly reason?: string
}

export interface FlightCommandReceipt {
  readonly accepted: boolean
  readonly summary: string
  readonly phase: MissionPhase
  readonly nextFix: MissionFixId | null
  readonly distanceNm: number | null
  readonly configuration: {
    readonly gearDown: boolean
    readonly flapsDeg: number
  }
  readonly allowedCommands: readonly FlightCommand[]
  readonly eventRevision: number
  readonly state: FlightState
}

export interface CheckrideDecisionReceipt {
  readonly accepted: boolean
  readonly summary: string
  readonly decision: CheckrideDecision
  readonly humanApproval: HumanApproval
  readonly score: CheckrideScore
  readonly eventRevision: number
  readonly state: FlightState
}

export interface FlightEventWaitInput {
  readonly afterRevision: number
  readonly events: readonly FlightEventType[]
  readonly timeoutMs: number
}

export interface FlightEventWaitResult {
  readonly revision: number
  readonly event: FlightEventType | 'timeout'
  readonly message: string
  readonly phase: MissionPhase
  readonly allowedCommands: readonly FlightCommand[]
  readonly allowedDecisions: readonly CheckrideDecision[]
  readonly state: FlightState
}

export type FlightStateListener = () => void
