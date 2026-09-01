import type { FlightControlInput } from '../sim/flightCommands.ts'
import type {
  ActiveLegRebuildStrategy, CheckrideSeed, ConfigurationProcedure, ControlOwner, DiversionPlan,
  EmergencyDecisionContext, EvidenceSource, FlightEventType, FlightEvidence, FlightState, MissionBrief,
  MissionPhase, RoutePlan,
} from '../sim/types.ts'

type JsonSchema = Readonly<Record<string, unknown>>
export type ToolReceiptTone = 'neutral' | 'success' | 'warning' | 'critical' | 'automation'
export type AgentFlightState = Omit<FlightState, 'checkride'> & {
  readonly checkride: Omit<FlightState['checkride'], 'seed'>
}

export interface FlightToolGuidance {
  readonly phase: MissionPhase
  readonly objective: string
  readonly procedure: ConfigurationProcedure
  readonly hazards: readonly string[]
  readonly availableActions: readonly FlightToolName[]
  readonly eventRevision: number
  readonly decisionSecondsRemaining: number | null
}

export interface FlightToolReceipt<T> {
  readonly ok: true
  readonly summary: string
  readonly tone: ToolReceiptTone
  readonly guidance: FlightToolGuidance
  readonly details: T
}

export const checkrideSeeds = [17, 42, 81] as const satisfies readonly CheckrideSeed[]
export const evidenceSources = ['weather', 'cockpit', 'traffic', 'passenger'] as const satisfies readonly EvidenceSource[]
export const routePlans = ['continue_kmdw', 'return_kstl'] as const satisfies readonly RoutePlan[]
export const flightEventValues = ['handoff_requested', 'emergency_detected', 'decision_timer_expired', 'atc_clearance_received', 'atc_clearance_accepted', 'plan_updated', 'route_progress_stalled', 'checkpoint_reached', 'comfort_limit_approaching', 'passenger_safety_update', 'configuration_required', 'configuration_confirmed', 'approval_required', 'approval_resolved', 'approach_stable', 'touchdown', 'mission_complete', 'mission_failed'] as const satisfies readonly FlightEventType[]

export interface FlightToolArguments {
  start_flight: Record<string, never>
  get_mission_brief: Record<string, never>
  get_flight_state: Record<string, never>
  get_decision_context: Record<string, never>
  inspect_flight_evidence: { readonly source?: EvidenceSource }
  set_route: { readonly plan: 'continue_kmdw' | 'return_kstl'; readonly reason: string }
  request_diversion: { readonly plan: DiversionPlan; readonly reason: string }
  accept_clearance: { readonly clearance_id: string; readonly readback: string }
  set_flight_controls: FlightControlInput
  fly_control_window: FlightControlInput & {
    readonly pitchIntent: number
    readonly bankIntent: number
    readonly duration_ms?: number
    readonly sample_interval_ms?: number
  }
  rebuild_active_leg: { readonly strategy: ActiveLegRebuildStrategy; readonly reason: string }
  request_human_approval: { readonly question: string; readonly requested_action: string; readonly reason: string }
  wait_for_flight_event: { readonly after_revision?: number; readonly events?: readonly FlightEventType[]; readonly timeout_ms?: number }
  transfer_control: { readonly owner: ControlOwner; readonly reason?: string }
}

export interface FlightToolResults {
  start_flight: FlightToolReceipt<{ readonly runId: string; readonly state: AgentFlightState }>
  get_mission_brief: FlightToolReceipt<{ readonly brief: MissionBrief }>
  get_flight_state: FlightToolReceipt<{ readonly state: AgentFlightState; readonly units: Readonly<Record<string, string>> }>
  get_decision_context: FlightToolReceipt<{ readonly available: boolean; readonly context: EmergencyDecisionContext | null }>
  inspect_flight_evidence: FlightToolReceipt<{ readonly evidence: FlightEvidence | readonly FlightEvidence[]; readonly inspectedSources: readonly EvidenceSource[] }>
  set_route: FlightToolActionResult
  request_diversion: FlightToolActionResult
  accept_clearance: FlightToolActionResult
  set_flight_controls: FlightToolActionResult
  fly_control_window: FlightToolControlWindowResult
  rebuild_active_leg: FlightToolActionResult
  request_human_approval: FlightToolActionResult
  wait_for_flight_event: FlightToolWaitResult
  transfer_control: FlightToolReceipt<{ readonly controlOwner: ControlOwner; readonly state: AgentFlightState }>
}

export interface FlightToolActionResult {
  readonly accepted: boolean
  readonly ok: boolean
  readonly summary: string
  readonly eventRevision: number
  readonly state: AgentFlightState
  readonly tone: ToolReceiptTone
  readonly guidance: FlightToolGuidance
}

export interface FlightToolWaitResult {
  readonly revision: number
  readonly event: FlightEventType | 'timeout'
  readonly message: string
  readonly state: AgentFlightState
  readonly ok: true
  readonly summary: string
  readonly tone: ToolReceiptTone
  readonly guidance: FlightToolGuidance
}

export interface FlightTelemetrySample {
  readonly elapsedSeconds: number
  readonly airspeedKt: number
  readonly altitudeFt: number
  readonly verticalSpeedFpm: number
  readonly headingDeg: number
  readonly pitchDeg: number
  readonly bankDeg: number
  readonly throttle: number
  readonly pitchIntent: number
  readonly bankIntent: number
  readonly groundSpeedKt: number
  readonly angleOfAttackDeg: number
  readonly stalled: boolean
  readonly nextFix: string | null
  readonly distanceToNextFixNm: number | null
  readonly bearingToNextFixDeg: number | null
  readonly closingRateKt: number | null
  readonly routeStatus: AgentFlightState['mission']['routeStatus']
  readonly procedureCompliant: boolean
  readonly loadFactorG: number
  readonly jerkGPerSecond: number
  readonly eventRevision: number
  readonly outcome: AgentFlightState['mission']['outcome']
}

export interface FlightToolControlWindowResult extends FlightToolActionResult {
  readonly requestedDurationMs: number
  readonly actualDurationMs: number
  readonly sampleIntervalMs: number
  readonly stopReason: 'window_complete' | 'flight_event' | 'terminal_state' | 'control_transferred' | 'command_rejected'
  readonly samples: readonly FlightTelemetrySample[]
}

export type FlightToolName = keyof FlightToolArguments
export interface FlightToolDefinition<Name extends FlightToolName = FlightToolName> { readonly name: Name; readonly title: string; readonly description: string; readonly inputSchema: JsonSchema; readonly readOnly: boolean }

const emptySchema = { type: 'object', properties: {}, additionalProperties: false } as const

export const flightToolDefinitions = [
  {
    name: 'start_flight', title: 'Start flight', readOnly: false,
    description: 'Start a fresh flight and take aircraft control. The environment privately selects a reproducible scenario; no future condition is disclosed before its flight event. Read the mission and live state, then operate the aircraft through the same control surface available to a human pilot.',
    inputSchema: emptySchema,
  },
  {
    name: 'get_mission_brief', title: 'Read mission brief', readOnly: true,
    description: 'Read the assigned preflight route, start, airports, runways, deadline, aircraft procedures, and landing criteria. File brief.assignedRoute with set_route before takeoff. Future conditions remain sealed.', inputSchema: emptySchema,
  },
  {
    name: 'get_flight_state', title: 'Read flight state', readOnly: true,
    description: 'Read current flight data and machine-readable guidance. Navigation includes bearing, closing rate, checkpoint width, achievable turn radius, and whether progress has stalled. Passenger safety includes current G-load and jerk. The private scenario seed is never returned during a run.', inputSchema: emptySchema,
  },
  {
    name: 'get_decision_context', title: 'Read emergency options', readOnly: true,
    description: 'Available only after emergency_detected. Read the newly available evidence, comfort envelope, fuel, decision time, and route options. Before the event it returns available false without revealing routes or future conditions. This starts the agent decision clock if it has not started.', inputSchema: emptySchema,
  },
  {
    name: 'inspect_flight_evidence', title: 'Inspect evidence', readOnly: true,
    description: 'Read weather, cockpit, traffic, or passenger evidence currently available to the crew. Before an enroute event this contains only normal preflight reports, never the sealed future condition. Omit source to inspect all reports.',
    inputSchema: { type: 'object', properties: { source: { type: 'string', enum: evidenceSources } }, additionalProperties: false },
  },
  {
    name: 'set_route', title: 'Load preflight route', readOnly: false,
    description: 'Before takeoff, load the dispatcher-filed plan from the mission brief into the FMS. Filing does not move the aircraft. A later diversion requires an ATC request, clearance, and readback. The flight director emits checkpoint_reached when the aircraft flies through each gate.',
    inputSchema: { type: 'object', properties: { plan: { type: 'string', enum: routePlans }, reason: { type: 'string', minLength: 1 } }, required: ['plan', 'reason'], additionalProperties: false },
  },
  {
    name: 'request_diversion', title: 'Request ATC diversion', readOnly: false,
    description: 'After emergency_detected and get_decision_context, request one route from context.routeOptions. This sends the request to simulated ATC but does not change the active route. Wait for atc_clearance_received before acting.',
    inputSchema: { type: 'object', properties: { plan: { type: 'string', enum: routePlans }, reason: { type: 'string', minLength: 1 } }, required: ['plan', 'reason'], additionalProperties: false },
  },
  {
    name: 'accept_clearance', title: 'Read back ATC clearance', readOnly: false,
    description: 'Accept the current ATC clearance by copying its clearance.id and reading back its destination, runway, altitude, and initial heading. Acceptance loads the cleared route into the FMS and resumes route guidance.',
    inputSchema: { type: 'object', properties: { clearance_id: { type: 'string', minLength: 1 }, readback: { type: 'string', minLength: 1 } }, required: ['clearance_id', 'readback'], additionalProperties: false },
  },
  {
    name: 'set_flight_controls', title: 'Set flight controls', readOnly: false,
    description: 'Apply persistent direct flight controls. Throttle ranges from 0 to 1. Pitch and bank intent range from -1 to 1; positive pitch is nose-up and positive bank is right. Omitted controls keep their current values. Pitch or bank remains active until changed, so prefer fly_control_window for finite stick movements when reasoning latency is uncertain. This uses the same aerodynamics, actuator response, collision rules, and consequences as keyboard input. Applying thrust after the preflight route is filed starts the takeoff roll.',
    inputSchema: {
      type: 'object',
      properties: {
        throttle: { type: 'number', minimum: 0, maximum: 1 },
        pitchIntent: { type: 'number', minimum: -1, maximum: 1 },
        bankIntent: { type: 'number', minimum: -1, maximum: 1 },
        gearDown: { type: 'boolean' },
        flapsDeg: { type: 'number', enum: [0, 10, 20, 30] },
        reason: { type: 'string', minLength: 1 },
      },
      anyOf: [
        { required: ['throttle'] },
        { required: ['pitchIntent'] },
        { required: ['bankIntent'] },
        { required: ['gearDown'] },
        { required: ['flapsDeg'] },
      ],
      additionalProperties: false,
    },
  },
  {
    name: 'fly_control_window', title: 'Fly a control window', readOnly: false,
    description: 'Apply one finite pitch-and-bank stick movement while the 60 Hz simulation keeps flying, then return sampled telemetry from throughout the movement. Both axes are required; use zero to hold an axis neutral. The window ends early for a new flight event, terminal state, or control transfer, and pitch/bank input is automatically neutralized before the response returns. Use repeated short windows to observe the aircraft response and make the next decision without leaving a delayed command latched. Throttle, gear, and flaps remain at their commanded settings.',
    inputSchema: {
      type: 'object',
      properties: {
        throttle: { type: 'number', minimum: 0, maximum: 1 },
        pitchIntent: { type: 'number', minimum: -1, maximum: 1 },
        bankIntent: { type: 'number', minimum: -1, maximum: 1 },
        gearDown: { type: 'boolean' },
        flapsDeg: { type: 'number', enum: [0, 10, 20, 30] },
        duration_ms: { type: 'number', minimum: 250, maximum: 3000, default: 1000 },
        sample_interval_ms: { type: 'number', minimum: 100, maximum: 500, default: 250 },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['pitchIntent', 'bankIntent'],
      additionalProperties: false,
    },
  },
  {
    name: 'rebuild_active_leg', title: 'Rebuild active leg', readOnly: false,
    description: 'After route_progress_stalled, recover the airborne active leg. Use direct_intercept for a shorter rejoin, wider_pattern for more maneuvering room, or skip_noncritical only for an enroute checkpoint. Departure, base, final, and touchdown cannot be skipped.',
    inputSchema: { type: 'object', properties: { strategy: { type: 'string', enum: ['direct_intercept', 'wider_pattern', 'skip_noncritical'] }, reason: { type: 'string', minLength: 1 } }, required: ['strategy', 'reason'], additionalProperties: false },
  },
  {
    name: 'request_human_approval', title: 'Ask pilot', readOnly: false,
    description: 'Ask the pilot to approve a consequential action. The current direct-control inputs remain active while the pilot decides.',
    inputSchema: { type: 'object', properties: { question: { type: 'string', minLength: 1 }, requested_action: { type: 'string', minLength: 1 }, reason: { type: 'string', minLength: 1 } }, required: ['question', 'requested_action', 'reason'], additionalProperties: false },
  },
  {
    name: 'wait_for_flight_event', title: 'Wait for flight event', readOnly: true,
    description: 'Wait without polling for route, comfort, configuration, handoff, touchdown, completion, or failure events. Emergency and failure events preempt routine configuration notices. route_progress_stalled means the current leg should be rebuilt instead of orbited.',
    inputSchema: { type: 'object', properties: { after_revision: { type: 'number', minimum: 0 }, events: { type: 'array', items: { type: 'string', enum: flightEventValues }, minItems: 1 }, timeout_ms: { type: 'number', minimum: 1000, maximum: 15000, default: 15000 } }, additionalProperties: false },
  },
  {
    name: 'transfer_control', title: 'Transfer control', readOnly: false,
    description: 'Accept a pending handoff or return control to the pilot. Any direct pilot input also overrides the agent immediately.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string', enum: ['human', 'agent'] }, reason: { type: 'string' } }, required: ['owner'], additionalProperties: false },
  },
] as const satisfies readonly FlightToolDefinition[]

export const flightToolDefinitionsByName = Object.fromEntries(flightToolDefinitions.map((definition) => [definition.name, definition])) as unknown as { readonly [Name in FlightToolName]: FlightToolDefinition<Name> }
export function isFlightToolName(value: string): value is FlightToolName { return Object.hasOwn(flightToolDefinitionsByName, value) }
