export type ControlOwner = 'human' | 'agent'

export type TraceActor = ControlOwner | 'system'

export type FlightScenario = 'clear' | 'engine_instability'

export interface FlightDirectorState {
  readonly enabled: boolean
  readonly headingDeg: number
  readonly altitudeFt: number
  readonly airspeedKt: number
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
  readonly routeProgress: number
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

export interface FlightRoute {
  readonly departure: Airport
  readonly arrival: Airport
  readonly distanceNm: number
  readonly initialHeadingDeg: number
}

export type FlightStateListener = () => void
