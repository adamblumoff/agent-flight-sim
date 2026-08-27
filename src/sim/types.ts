export type ControlOwner = 'human' | 'agent'
export type TraceActor = ControlOwner | 'system'
export type CheckrideSeed = 17 | 42 | 81
export type AgentMode = 'idle' | 'requested' | 'thinking' | 'flying' | 'awaiting_approval' | 'complete'
export type EvidenceSource = 'weather' | 'cockpit' | 'traffic' | 'passenger'
export type EvidenceReliability = 'current' | 'stale' | 'unreliable'

export interface FlightEvidence { readonly source: EvidenceSource; readonly headline: string; readonly detail: string; readonly reliability: EvidenceReliability }
export type RoutePlan = 'unassigned' | 'return_kpwk'
export type VerticalMode = 'climb' | 'level' | 'descend' | 'approach'
export type MissionPhase = 'planning' | 'enroute' | 'approach' | 'flare' | 'rollout' | 'complete' | 'failed'
export type MissionOutcome = 'in_progress' | 'landed' | 'unsafe_touchdown' | 'fuel_exhausted' | 'crashed'

export interface AutopilotState { readonly enabled: boolean; readonly headingDeg: number; readonly altitudeFt: number; readonly airspeedKt: number; readonly verticalMode: VerticalMode }
export interface RouteWaypoint { readonly id: string; readonly name: string; readonly lat: number; readonly lon: number; readonly altitudeFt: number; readonly airspeedKt: number }
export interface RouteState { readonly plan: RoutePlan; readonly destination: 'KPWK' | null; readonly runway: '16' | null; readonly waypoints: readonly RouteWaypoint[]; readonly activeWaypointIndex: number; readonly reason: string | null }

export interface ScenarioConditions {
  readonly weather: { readonly visibilityMiles: number; readonly ceilingFt: number; readonly windDirectionDeg: number; readonly windSpeedKt: number; readonly summary: string }
  readonly engine: { readonly health: 'normal' | 'rough' | 'failing'; readonly maximumPower: number; readonly summary: string }
  readonly passenger: { readonly condition: 'stable' | 'urgent' | 'critical'; readonly summary: string }
  readonly traffic: { readonly delayMinutes: number; readonly priorityAvailable: boolean; readonly summary: string }
}

export type ApprovalStatus = 'none' | 'pending' | 'approved' | 'denied'
export interface HumanApprovalState { readonly status: ApprovalStatus; readonly question: string | null; readonly requestedAction: string | null }
export interface LandingResult { readonly runway: string; readonly sinkRateFpm: number; readonly airspeedKt: number; readonly centerlineErrorFt: number; readonly touchdownDistanceFt: number; readonly bounces: number; readonly onRunway: boolean; readonly safe: boolean }
export interface DebriefEvent { readonly elapsedSeconds: number; readonly actor: TraceActor; readonly summary: string }
export interface DebriefState { readonly status: 'in_progress' | 'landed' | 'failed'; readonly elapsedSeconds: number; readonly decision: RoutePlan; readonly decisionReason: string | null; readonly events: readonly DebriefEvent[]; readonly landing: LandingResult | null }

export type FlightEventType = 'handoff_requested' | 'emergency_detected' | 'plan_updated' | 'approval_required' | 'approval_resolved' | 'approach_stable' | 'touchdown' | 'mission_complete' | 'mission_failed'
export interface FlightEvent { readonly revision: number; readonly type: FlightEventType; readonly elapsedSeconds: number; readonly message: string; readonly phase: MissionPhase; readonly routePlan: RoutePlan }
export interface MissionNavigationState { readonly phase: MissionPhase; readonly outcome: MissionOutcome; readonly nextFix: string | null; readonly distanceToNextFixNm: number | null; readonly distanceToThresholdNm: number; readonly centerlineErrorNm: number; readonly glidepathErrorFt: number; readonly stableApproach: boolean; readonly eventRevision: number }

/** Temporary compact view for the old panel while it is replaced in parallel. */
export interface CheckrideState {
  readonly seed: CheckrideSeed
  readonly status: 'armed' | 'decision_required' | 'awaiting_human' | 'resolved' | 'complete'
  readonly objective: string
  readonly deadlineSeconds: number
  readonly fuelMinutesRemaining: number
  readonly alert: string | null
  readonly humanApproval: 'not_required' | 'pending' | 'approved' | 'denied'
  readonly inspectedSources: readonly EvidenceSource[]
  readonly score: { readonly total: number }
  readonly decision: RoutePlan | null
}

export interface FlightState {
  readonly lat: number; readonly lon: number; readonly altitudeFt: number; readonly airspeedKt: number; readonly verticalSpeedFpm: number; readonly headingDeg: number; readonly pitchDeg: number; readonly bankDeg: number; readonly throttle: number; readonly flapsDeg: number; readonly gearDown: boolean
  readonly elapsedSeconds: number; readonly fuelMinutesRemaining: number
  readonly controlOwner: ControlOwner; readonly handoffRequested: boolean; readonly agentMode: AgentMode
  readonly autopilot: AutopilotState
  readonly route: RouteState; readonly scenario: ScenarioConditions
  readonly approval: HumanApprovalState; readonly mission: MissionNavigationState; readonly checkride: CheckrideState; readonly debrief: DebriefState
}

export interface PilotInput { readonly pitchDelta?: number; readonly bankDelta?: number }
export interface TraceEvent { readonly id: number; readonly time: number; readonly elapsedSeconds: number; readonly actor: TraceActor; readonly action: string; readonly reason: string; readonly details: Readonly<Record<string, unknown>> }
export interface Airport { readonly code: 'KPWK'; readonly name: string; readonly lat: number; readonly lon: number; readonly elevationFt: number }
export interface MissionRunway { readonly id: string; readonly airport: Airport['code']; readonly thresholdLat: number; readonly thresholdLon: number; readonly farEndLat: number; readonly farEndLon: number; readonly headingDeg: number; readonly lengthFt: number; readonly widthFt: number; readonly elevationFt: number }
export interface MissionBrief { readonly id: string; readonly name: string; readonly objective: string; readonly start: string; readonly deadlineSeconds: number; readonly airports: readonly Airport[]; readonly runways: readonly MissionRunway[]; readonly availablePlans: readonly RoutePlan[]; readonly evidenceSources: readonly EvidenceSource[]; readonly successConditions: readonly string[] }

export interface AutopilotTargetsInput { readonly headingDeg?: number; readonly altitudeFt?: number; readonly airspeedKt?: number; readonly verticalMode?: VerticalMode; readonly reason?: string }
export interface AircraftConfigurationInput { readonly gearDown?: boolean; readonly flapsDeg?: 0 | 10 | 20 | 30; readonly reason?: string }
export interface FlightEventWaitInput { readonly afterRevision: number; readonly events: readonly FlightEventType[]; readonly timeoutMs: number }
export interface FlightEventWaitResult { readonly revision: number; readonly event: FlightEventType | 'timeout'; readonly message: string; readonly state: FlightState }
export interface ActionReceipt { readonly accepted: boolean; readonly summary: string; readonly eventRevision: number; readonly state: FlightState }
export type FlightStateListener = () => void
