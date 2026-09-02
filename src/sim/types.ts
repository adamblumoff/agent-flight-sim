export type ControlOwner = 'human' | 'agent'
export type TraceActor = ControlOwner | 'system'
export type CheckrideSeed = 17 | 42 | 81
export type AgentMode = 'idle' | 'requested' | 'thinking' | 'flying' | 'complete'
export type EvidenceSource = 'weather' | 'cockpit' | 'traffic' | 'passenger'
export type EvidenceReliability = 'current' | 'stale' | 'unreliable'

export interface FlightEvidence { readonly source: EvidenceSource; readonly headline: string; readonly detail: string; readonly reliability: EvidenceReliability }
export type RoutePlan = 'unassigned' | 'continue_kmdw' | 'return_kstl'
export type DiversionPlan = Exclude<RoutePlan, 'unassigned'>
export interface FlightPlanProgram {
  readonly plan: DiversionPlan
  readonly rotateSpeedKt: number
  readonly climbPitchDeg: number
  readonly climbSpeedKt: number
  readonly cruiseAltitudeFt: number
  readonly cruiseSpeedKt: number
  readonly maxBankDeg: number
  readonly approachSpeedKt: number
  readonly landingFlapsDeg: 20 | 30
}
export interface AutopilotState {
  readonly engaged: boolean
  readonly program: FlightPlanProgram | null
  readonly programmedAtElapsedSeconds: number | null
}
export type MissionPhase = 'preflight' | 'takeoff' | 'planning' | 'enroute' | 'approach' | 'flare' | 'rollout' | 'complete' | 'failed'
export type MissionOutcome = 'in_progress' | 'landed' | 'unsafe_touchdown' | 'fuel_exhausted' | 'crashed' | 'timed_out'
export type AircraftPhase = 'takeoff_roll' | 'airborne' | 'landing_roll' | 'stopped' | 'crash_slide'

export interface MotionState {
  readonly longitudinalAccelerationKtPerSecond: number
  readonly verticalAccelerationFpmPerSecond: number
  readonly turnRateDegPerSecond: number
  readonly groundSpeedKt: number
  readonly trackDeg: number
  readonly headwindKt: number
  readonly crosswindKt: number
  readonly angleOfAttackDeg: number
  readonly stalled: boolean
  readonly turbulenceLevel: 'none' | 'light' | 'moderate'
}
export interface ImpactState { readonly revision: number; readonly severity: 'hard' | 'destructive'; readonly sinkRateFpm: number; readonly airspeedKt: number; readonly bankDeg: number; readonly pitchDeg: number; readonly onRunway: boolean; readonly rollDirection: -1 | 1 }
export type ConfigurationStage = 'takeoff' | 'positive_rate' | 'climb_cleanup' | 'base' | 'final' | 'landing' | 'complete'
export interface ConfigurationProcedure { readonly stage: ConfigurationStage; readonly gearDown: boolean; readonly flapsDeg: 0 | 10 | 20 | 30; readonly compliant: boolean; readonly instruction: string }
export type RouteWaypointKind = 'departure' | 'enroute' | 'base' | 'final' | 'touchdown'
export interface RouteWaypoint { readonly id: string; readonly name: string; readonly kind: RouteWaypointKind; readonly lat: number; readonly lon: number; readonly altitudeFt: number; readonly airspeedKt: number; readonly captureRadiusNm: number; readonly captureHeadingDeg?: number }
export interface RouteState { readonly plan: RoutePlan; readonly destination: 'KMDW' | 'KSTL' | null; readonly runway: '31C' | '30L' | null; readonly waypoints: readonly RouteWaypoint[]; readonly activeWaypointIndex: number; readonly completedWaypointIds: readonly string[]; readonly activeLegOrigin: { readonly lat: number; readonly lon: number }; readonly reason: string | null }

export interface AtcClearance {
  readonly id: string
  readonly plan: DiversionPlan
  readonly destination: 'KMDW' | 'KSTL'
  readonly runway: '31C' | '30L'
  readonly routing: 'direct' | 'vectors'
  readonly initialFix: string
  readonly headingDeg: number
  readonly altitudeFt: number
  readonly airspeedKt: number
  readonly approach: string
  readonly instruction: string
}
export interface AtcState {
  readonly status: 'none' | 'requested' | 'cleared' | 'accepted'
  readonly requestedPlan: DiversionPlan | null
  readonly requestReason: string | null
  readonly clearance: AtcClearance | null
}

export interface ScenarioConditions {
  readonly weather: { readonly visibilityMiles: number; readonly ceilingFt: number; readonly windDirectionDeg: number; readonly windSpeedKt: number; readonly summary: string }
  readonly engine: { readonly health: 'normal' | 'rough' | 'failing'; readonly maximumPower: number; readonly summary: string }
  readonly passenger: { readonly condition: 'stable' | 'urgent' | 'critical'; readonly summary: string }
  readonly traffic: { readonly delayMinutes: number; readonly priorityAvailable: boolean; readonly summary: string }
}

export interface PassengerSafetyState {
  readonly loadFactorG: number
  readonly jerkGPerSecond: number
  readonly distress: number
  readonly injuryProbability: number
  readonly status: 'comfortable' | 'uneasy' | 'distressed' | 'injured'
  readonly summary: string
}

export interface ScoreDeduction {
  readonly id: string
  readonly elapsedSeconds: number
  readonly points: number
  readonly reason: string
}

export interface ScoreState {
  readonly total: number
  readonly deductions: readonly ScoreDeduction[]
}

export interface LandingResult { readonly runway: string; readonly sinkRateFpm: number; readonly airspeedKt: number; readonly centerlineErrorFt: number; readonly touchdownDistanceFt: number; readonly bounces: number; readonly onRunway: boolean; readonly safe: boolean }
export interface DebriefEvent { readonly elapsedSeconds: number; readonly actor: TraceActor; readonly summary: string }
export interface DebriefState { readonly status: 'in_progress' | 'landed' | 'failed'; readonly elapsedSeconds: number; readonly decision: RoutePlan; readonly decisionReason: string | null; readonly events: readonly DebriefEvent[]; readonly landing: LandingResult | null }

export type FlightEventType = 'handoff_requested' | 'emergency_detected' | 'decision_timer_expired' | 'atc_clearance_received' | 'atc_clearance_accepted' | 'plan_updated' | 'route_progress_stalled' | 'checkpoint_reached' | 'comfort_limit_approaching' | 'passenger_safety_update' | 'stall_warning' | 'configuration_required' | 'configuration_confirmed' | 'go_around_required' | 'approach_stable' | 'touchdown' | 'mission_complete' | 'mission_failed'
export interface FlightEvent { readonly revision: number; readonly type: FlightEventType; readonly elapsedSeconds: number; readonly message: string; readonly phase: MissionPhase; readonly routePlan: RoutePlan }
export interface MissionNavigationState {
  readonly phase: MissionPhase
  readonly outcome: MissionOutcome
  readonly nextFix: string | null
  readonly distanceToNextFixNm: number | null
  readonly bearingToNextFixDeg: number | null
  /** Positive means turn right; negative means turn left. */
  readonly headingErrorToNextFixDeg: number | null
  /** Positive means climb; negative means descend. */
  readonly altitudeErrorToNextFixFt: number | null
  /** Positive means accelerate; negative means decelerate. */
  readonly airspeedErrorToNextFixKt: number | null
  readonly closingRateKt: number | null
  readonly captureRadiusNm: number | null
  readonly minimumTurnRadiusNm: number
  readonly routeStatus: 'idle' | 'tracking' | 'stalled'
  readonly distanceToThresholdNm: number
  readonly centerlineErrorNm: number
  readonly glidepathErrorFt: number
  readonly stableApproach: boolean
  readonly goAroundRequired: boolean
  readonly eventRevision: number
}

/** Temporary compact view for the old panel while it is replaced in parallel. */
export interface CheckrideState {
  readonly runId: string
  readonly seed: CheckrideSeed
  readonly buildId: string
  readonly profileId: string
  readonly status: 'armed' | 'decision_required' | 'awaiting_human' | 'resolved' | 'complete'
  readonly objective: string
  readonly deadlineSeconds: number
  readonly wallClockDeadlineSeconds: number
  readonly wallClockSecondsRemaining: number | null
  readonly simulationRate: number
  readonly decisionSecondsRemaining: number | null
  readonly emergencyStartedAtSeconds: number | null
  readonly decisionContextRead: boolean
  readonly fuelMinutesRemaining: number
  readonly alert: string | null
  readonly inspectedSources: readonly EvidenceSource[]
  readonly score: ScoreState
  readonly decision: RoutePlan | null
}

export interface FlightState {
  readonly lat: number; readonly lon: number; readonly altitudeFt: number; readonly airspeedKt: number; readonly verticalSpeedFpm: number; readonly headingDeg: number; readonly pitchDeg: number; readonly bankDeg: number; readonly throttle: number; readonly flapsDeg: number; readonly gearDown: boolean
  readonly controlInputs: PilotControls
  readonly elapsedSeconds: number; readonly fuelMinutesRemaining: number
  readonly controlOwner: ControlOwner; readonly handoffRequested: boolean; readonly agentMode: AgentMode
  readonly autopilot: AutopilotState
  readonly motion: MotionState
  readonly impact: ImpactState | null
  readonly aircraftPhase: AircraftPhase
  readonly route: RouteState; readonly atc: AtcState; readonly scenario: ScenarioConditions; readonly procedure: ConfigurationProcedure
  readonly passengerSafety: PassengerSafetyState
  readonly mission: MissionNavigationState; readonly checkride: CheckrideState; readonly debrief: DebriefState
}

export interface PilotControls { readonly pitchAxis: number; readonly bankAxis: number }
export interface TraceEvent { readonly id: number; readonly time: number; readonly elapsedSeconds: number; readonly actor: TraceActor; readonly action: string; readonly reason: string; readonly details: Readonly<Record<string, unknown>> }
export interface Airport { readonly code: 'KSTL' | 'KMDW'; readonly name: string; readonly lat: number; readonly lon: number; readonly elevationFt: number }
export interface MissionRunway { readonly id: string; readonly airport: Airport['code']; readonly thresholdLat: number; readonly thresholdLon: number; readonly farEndLat: number; readonly farEndLon: number; readonly headingDeg: number; readonly lengthFt: number; readonly widthFt: number; readonly elevationFt: number }
export interface MissionBrief {
  readonly id: string
  readonly name: string
  readonly objective: string
  readonly start: string
  readonly deadlineSeconds: number
  readonly airports: readonly Airport[]
  readonly runways: readonly MissionRunway[]
  readonly assignedRoute: { readonly plan: 'continue_kmdw'; readonly destination: 'KMDW'; readonly runway: '31C'; readonly altitudeFt: 3_000; readonly airspeedKt: 230 }
  readonly availablePlans: readonly RoutePlan[]
  readonly evidenceSources: readonly EvidenceSource[]
  readonly successConditions: readonly string[]
}

export interface DecisionRouteOption { readonly plan: Exclude<RoutePlan, 'unassigned'>; readonly destination: 'KMDW' | 'KSTL'; readonly runway: '31C' | '30L'; readonly distanceNm: number; readonly estimatedMinutes: number; readonly risk: 'low' | 'moderate' | 'high'; readonly summary: string; readonly recommended: boolean }
export interface EmergencyDecisionContext { readonly evidence: readonly FlightEvidence[]; readonly decisionSecondsRemaining: number | null; readonly fuelMinutesRemaining: number; readonly comfortLimits: { readonly maximumBankDeg: number; readonly warningLoadFactorG: number; readonly warningJerkGPerSecond: number }; readonly routeOptions: readonly DecisionRouteOption[] }
export interface AircraftConfigurationInput { readonly gearDown?: boolean; readonly flapsDeg?: 0 | 10 | 20 | 30; readonly reason?: string }
export interface FlightEventWaitInput { readonly afterRevision: number; readonly events: readonly FlightEventType[]; readonly timeoutMs: number }
export interface FlightEventWaitResult { readonly revision: number; readonly event: FlightEventType | 'timeout'; readonly message: string; readonly state: FlightState }
export interface ActionReceipt { readonly accepted: boolean; readonly summary: string; readonly eventRevision: number; readonly state: FlightState }
export type FlightStateListener = () => void
