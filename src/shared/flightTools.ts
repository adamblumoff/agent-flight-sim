import type {
  CheckrideSeed, ConfigurationProcedure, ControlOwner, DiversionPlan,
  EmergencyDecisionContext, FlightEventType, FlightState, MissionBrief,
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
export const routePlans = ['continue_kmdw', 'return_kstl'] as const satisfies readonly RoutePlan[]
export const flightEventValues = ['handoff_requested', 'emergency_detected', 'decision_timer_expired', 'atc_clearance_received', 'atc_clearance_accepted', 'plan_updated', 'route_progress_stalled', 'checkpoint_reached', 'comfort_limit_approaching', 'passenger_safety_update', 'configuration_required', 'configuration_confirmed', 'approach_stable', 'touchdown', 'mission_complete', 'mission_failed'] as const satisfies readonly FlightEventType[]

export interface FlightToolArguments {
  start_flight: Record<string, never>
  get_mission_brief: Record<string, never>
  get_flight_state: Record<string, never>
  get_decision_context: Record<string, never>
  set_route: { readonly plan: 'continue_kmdw' | 'return_kstl'; readonly reason: string }
  request_diversion: { readonly plan: DiversionPlan; readonly reason: string }
  accept_clearance: { readonly clearance_id: string; readonly readback: string }
  fly_control_window: {
    readonly pitchIntent: number
    readonly bankIntent: number
    readonly throttle?: number
    readonly gearDown?: boolean
    readonly flapsDeg?: 0 | 10 | 20 | 30
    readonly reason?: string
    readonly duration_ms?: number
    readonly sample_interval_ms?: number
  }
  wait_for_flight_event: { readonly after_revision?: number; readonly events?: readonly FlightEventType[]; readonly timeout_ms?: number }
  transfer_control: { readonly owner: ControlOwner; readonly reason?: string }
}

export interface FlightToolResults {
  start_flight: FlightToolReceipt<{ readonly runId: string; readonly state: AgentFlightState }>
  get_mission_brief: FlightToolReceipt<{ readonly brief: MissionBrief }>
  get_flight_state: FlightToolReceipt<{ readonly state: AgentFlightState; readonly units: Readonly<Record<string, string>> }>
  get_decision_context: FlightToolReceipt<{ readonly available: boolean; readonly context: EmergencyDecisionContext | null }>
  set_route: FlightToolActionResult
  request_diversion: FlightToolActionResult
  accept_clearance: FlightToolActionResult
  fly_control_window: FlightToolControlWindowResult
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
  readonly headingErrorToNextFixDeg: number | null
  readonly altitudeErrorToNextFixFt: number | null
  readonly airspeedErrorToNextFixKt: number | null
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
  readonly interruptedBy: FlightEventType | null
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
    description: 'Read current flight data and machine-readable guidance. Navigation includes bearing, signed heading error (positive right, negative left), signed altitude error (positive climb), signed airspeed error (positive accelerate), closing rate, checkpoint width, achievable turn radius, and whether progress has stalled. Passenger safety includes current G-load and jerk. The private scenario seed is never returned during a run.', inputSchema: emptySchema,
  },
  {
    name: 'get_decision_context', title: 'Read emergency options', readOnly: true,
    description: 'Available only after emergency_detected. Read the newly available evidence, comfort envelope, fuel, decision time, and route options. Before the event it returns available false without revealing routes or future conditions. This starts the agent decision clock if it has not started.', inputSchema: emptySchema,
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
    name: 'fly_control_window', title: 'Fly a control window', readOnly: false,
    description: 'Apply one finite pitch-and-bank stick movement while the 60 Hz simulation keeps flying, then return sampled telemetry from throughout the movement. Both axes are required; use zero to hold an axis neutral. The window ends early only for a safety-critical or navigation-changing flight event, terminal state, or control transfer. It reports actualDurationMs, interruptedBy, and sampled telemetry, then automatically neutralizes pitch and bank. Throttle, gear, and flaps remain at their commanded settings. Use longer neutral-axis windows for stable flight and short windows for maneuvering near checkpoints.',
    inputSchema: {
      type: 'object',
      properties: {
        throttle: { type: 'number', minimum: 0, maximum: 1 },
        pitchIntent: { type: 'number', minimum: -1, maximum: 1 },
        bankIntent: { type: 'number', minimum: -1, maximum: 1 },
        gearDown: { type: 'boolean' },
        flapsDeg: { type: 'number', enum: [0, 10, 20, 30] },
        duration_ms: { type: 'number', minimum: 250, maximum: 10000, default: 1000 },
        sample_interval_ms: { type: 'number', minimum: 100, maximum: 500, default: 250 },
        reason: { type: 'string', minLength: 1 },
      },
      required: ['pitchIntent', 'bankIntent'],
      additionalProperties: false,
    },
  },
  {
    name: 'wait_for_flight_event', title: 'Wait for flight event', readOnly: true,
    description: 'Wait without polling for route, comfort, configuration, handoff, touchdown, completion, or failure events. Emergency and failure events preempt routine notices. If a base leg stops converging, ATC automatically resequences the active route direct to final before returning route_progress_stalled.',
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
