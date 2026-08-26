export type ControlOwner = 'human' | 'agent'

export type TraceActor = ControlOwner | 'system'

export type FlightScenario = 'clear' | 'engine_instability'

export type MissionFixId =
  | 'DEPART'
  | 'CROSSWIND'
  | 'NORTH_GATE'
  | 'DOWNWIND'
  | 'BASE_GATE'
  | 'FINAL_GATE'
  | 'TOUCHDOWN'

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
  | 'complete'
  | 'failed'

export type MissionOutcome =
  | 'in_progress'
  | 'landed'
  | 'go_around'
  | 'unsafe_touchdown'
  | 'runway_excursion'

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
  readonly flightDirector: FlightDirectorState
  readonly scenario: FlightScenario
  readonly mission: MissionNavigationState
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
  readonly state: FlightState
}

export type FlightStateListener = () => void
