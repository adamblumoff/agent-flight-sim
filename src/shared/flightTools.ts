import type {
  ActionReceipt, ActiveLegRebuildStrategy, AircraftConfigurationInput, AutopilotTargetsInput, CheckrideSeed,
  ControlOwner, EvidenceSource, FlightEventType, FlightEventWaitResult, FlightEvidence,
  FlightMode, FlightState, EmergencyDecisionContext, MissionBrief, RoutePlan,
} from '../sim/types'
import { A380_ENVELOPE, CONCORDE_ENVELOPE } from '../sim/aircraftEnvelope'

type JsonSchema = Readonly<Record<string, unknown>>
export type ToolReceiptTone = 'neutral' | 'success' | 'warning' | 'critical' | 'automation'
export interface FlightToolReceipt<T> { readonly ok: true; readonly summary: string; readonly tone: ToolReceiptTone; readonly details: T }

export const checkrideSeeds = [17, 42, 81] as const satisfies readonly CheckrideSeed[]
export const evidenceSources = ['weather', 'cockpit', 'traffic', 'passenger'] as const satisfies readonly EvidenceSource[]
export const routePlans = ['continue_klak', 'return_kpwk'] as const satisfies readonly RoutePlan[]
export const flightEventValues = ['handoff_requested', 'emergency_detected', 'decision_timer_expired', 'plan_updated', 'route_progress_stalled', 'checkpoint_reached', 'comfort_limit_approaching', 'passenger_safety_update', 'configuration_required', 'configuration_confirmed', 'approval_required', 'approval_resolved', 'approach_stable', 'touchdown', 'mission_complete', 'mission_failed'] as const satisfies readonly FlightEventType[]

export interface FlightToolArguments {
  start_flight: { readonly seed?: CheckrideSeed; readonly mode?: FlightMode }
  get_mission_brief: Record<string, never>
  get_flight_state: Record<string, never>
  get_decision_context: Record<string, never>
  inspect_flight_evidence: { readonly source?: EvidenceSource }
  set_route: { readonly plan: 'continue_klak' | 'return_kpwk'; readonly reason: string }
  begin_takeoff: { readonly reason: string }
  set_autopilot_targets: AutopilotTargetsInput
  rebuild_active_leg: { readonly strategy: ActiveLegRebuildStrategy; readonly reason: string }
  configure_aircraft: AircraftConfigurationInput
  request_human_approval: { readonly question: string; readonly requested_action: string; readonly reason: string }
  wait_for_flight_event: { readonly after_revision?: number; readonly events?: readonly FlightEventType[]; readonly timeout_ms?: number }
  transfer_control: { readonly owner: ControlOwner; readonly reason?: string }
}

export interface FlightToolResults {
  start_flight: FlightToolReceipt<{ readonly seed: CheckrideSeed; readonly mode: FlightMode; readonly brief: MissionBrief; readonly state: FlightState }>
  get_mission_brief: FlightToolReceipt<{ readonly brief: MissionBrief }>
  get_flight_state: FlightToolReceipt<{ readonly state: FlightState; readonly units: Readonly<Record<string, string>> }>
  get_decision_context: FlightToolReceipt<{ readonly context: EmergencyDecisionContext }>
  inspect_flight_evidence: FlightToolReceipt<{ readonly evidence: FlightEvidence | readonly FlightEvidence[]; readonly inspectedSources: readonly EvidenceSource[] }>
  set_route: ActionReceipt & { readonly ok: boolean; readonly tone: ToolReceiptTone }
  begin_takeoff: ActionReceipt & { readonly ok: boolean; readonly tone: ToolReceiptTone }
  set_autopilot_targets: ActionReceipt & { readonly ok: boolean; readonly tone: ToolReceiptTone }
  rebuild_active_leg: ActionReceipt & { readonly ok: boolean; readonly tone: ToolReceiptTone }
  configure_aircraft: ActionReceipt & { readonly ok: boolean; readonly tone: ToolReceiptTone }
  request_human_approval: ActionReceipt & { readonly ok: boolean; readonly tone: ToolReceiptTone }
  wait_for_flight_event: FlightEventWaitResult & { readonly ok: true; readonly summary: string; readonly tone: ToolReceiptTone }
  transfer_control: FlightToolReceipt<{ readonly controlOwner: ControlOwner; readonly state: FlightState }>
}

export type FlightToolName = keyof FlightToolArguments
export interface FlightToolDefinition<Name extends FlightToolName = FlightToolName> { readonly name: Name; readonly title: string; readonly description: string; readonly inputSchema: JsonSchema; readonly readOnly: boolean }

const emptySchema = { type: 'object', properties: {}, additionalProperties: false } as const

export const flightToolDefinitions = [
  {
    name: 'start_flight', title: 'Start flight', readOnly: false,
    description: 'Start a reproducible mission on North Field runway 18 and take copilot control. Use full for the ten-minute evaluation or judge for the compressed four-minute demo. The aircraft remains stopped while the copilot files the preflight route.',
    inputSchema: { type: 'object', properties: { seed: { type: 'number', enum: checkrideSeeds, default: 17 }, mode: { type: 'string', enum: ['full', 'judge'], default: 'full' } }, additionalProperties: false },
  },
  {
    name: 'get_mission_brief', title: 'Read mission brief', readOnly: true,
    description: 'Read the start, airports, runways, route choices, deadline, and landing criteria.', inputSchema: emptySchema,
  },
  {
    name: 'get_flight_state', title: 'Read flight state', readOnly: true,
    description: 'Read live flight data. Navigation includes bearing, closing rate, checkpoint width, achievable turn radius, and whether progress has stalled. Passenger safety includes current G-load and jerk.', inputSchema: emptySchema,
  },
  {
    name: 'get_decision_context', title: 'Read emergency options', readOnly: true,
    description: 'After emergency_detected, read all evidence, the comfort envelope, fuel, decision time, and ranked KPWK/KLAK route options in one call. This starts the agent decision clock if it has not started.', inputSchema: emptySchema,
  },
  {
    name: 'inspect_flight_evidence', title: 'Inspect evidence', readOnly: true,
    description: 'Read current weather, cockpit, traffic, or passenger evidence. Omit source to inspect all four reports.',
    inputSchema: { type: 'object', properties: { source: { type: 'string', enum: evidenceSources } }, additionalProperties: false },
  },
  {
    name: 'set_route', title: 'Choose route', readOnly: false,
    description: 'Before takeoff, file continue_klak to Lakeside Municipal runway 22. Filing does not move the aircraft. After emergency_detected, read get_decision_context and choose return_kpwk or continue_klak. The flight director follows a physically achievable route and emits checkpoint_reached at each fly-through gate.',
    inputSchema: { type: 'object', properties: { plan: { type: 'string', enum: routePlans }, reason: { type: 'string', minLength: 1 } }, required: ['plan', 'reason'], additionalProperties: false },
  },
  {
    name: 'begin_takeoff', title: 'Begin takeoff', readOnly: false,
    description: `Begin the takeoff roll after filing continue_klak. Full mode uses the A380-style ${A380_ENVELOPE.rotateSpeedKt}-knot rotation profile. Judge mode models Concorde: V1 ${CONCORDE_ENVELOPE.decisionSpeedKt}, VR ${CONCORDE_ENVELOPE.rotateSpeedKt}, V2 ${CONCORDE_ENVELOPE.takeoffSafetySpeedKt}, then ${CONCORDE_ENVELOPE.initialClimbSpeedKt} knots. Both hold runway heading through ${A380_ENVELOPE.departureHeadingReleaseAglFt} ft AGL. A runway excursion or surface strike causes a crash.`,
    inputSchema: { type: 'object', properties: { reason: { type: 'string', minLength: 1 } }, required: ['reason'], additionalProperties: false },
  },
  {
    name: 'set_autopilot_targets', title: 'Set autopilot targets', readOnly: false,
    description: `Set persistent intent-level heading, altitude, speed, or vertical mode. Full mode accepts ${A380_ENVELOPE.minCommandSpeedKt}-${A380_ENVELOPE.maxCommandSpeedKt} kt; Concorde Judge mode accepts ${CONCORDE_ENVELOPE.minCommandSpeedKt}-${CONCORDE_ENVELOPE.maxCommandSpeedKt} kt. Out-of-envelope speeds are clamped. Supplying heading selects heading hold. Set lateralMode to route to resume route guidance. Commands remain active until changed.`,
    inputSchema: { type: 'object', properties: { headingDeg: { type: 'number', minimum: 0, maximum: 359.99 }, altitudeFt: { type: 'number', minimum: 645, maximum: 4000 }, airspeedKt: { type: 'number', minimum: A380_ENVELOPE.minCommandSpeedKt, maximum: CONCORDE_ENVELOPE.maxCommandSpeedKt }, verticalMode: { type: 'string', enum: ['climb', 'level', 'descend', 'approach'] }, lateralMode: { type: 'string', enum: ['route', 'heading'] }, reason: { type: 'string' } }, minProperties: 1, additionalProperties: false },
  },
  {
    name: 'rebuild_active_leg', title: 'Rebuild active leg', readOnly: false,
    description: 'After route_progress_stalled, recover the airborne active leg. Use direct_intercept for a shorter rejoin, wider_pattern for more maneuvering room, or skip_noncritical only for an enroute checkpoint. Departure, base, final, and touchdown cannot be skipped.',
    inputSchema: { type: 'object', properties: { strategy: { type: 'string', enum: ['direct_intercept', 'wider_pattern', 'skip_noncritical'] }, reason: { type: 'string', minLength: 1 } }, required: ['strategy', 'reason'], additionalProperties: false },
  },
  {
    name: 'configure_aircraft', title: 'Configure aircraft', readOnly: false,
    description: 'Set landing gear and high-lift configuration. Full mode uses simplified A380 flap detents: 10° is CONF 1+F, 20° is CONF 3, and 30° is FULL. Concorde Judge mode has no conventional flaps and requires 0° throughout. Read state.procedure first; out-of-sequence settings are rejected.',
    inputSchema: { type: 'object', properties: { gearDown: { type: 'boolean' }, flapsDeg: { type: 'number', enum: [0, 10, 20, 30] }, reason: { type: 'string' } }, minProperties: 1, additionalProperties: false },
  },
  {
    name: 'request_human_approval', title: 'Ask pilot', readOnly: false,
    description: 'Ask the pilot to approve a consequential action. Existing autopilot targets keep the aircraft moving while the pilot decides.',
    inputSchema: { type: 'object', properties: { question: { type: 'string', minLength: 1 }, requested_action: { type: 'string', minLength: 1 }, reason: { type: 'string', minLength: 1 } }, required: ['question', 'requested_action', 'reason'], additionalProperties: false },
  },
  {
    name: 'wait_for_flight_event', title: 'Wait for flight event', readOnly: true,
    description: 'Wait without polling for route, comfort, configuration, handoff, touchdown, completion, or failure events. Emergency and failure events preempt routine configuration notices. route_progress_stalled means the current leg should be rebuilt instead of orbited.',
    inputSchema: { type: 'object', properties: { after_revision: { type: 'number', minimum: 0 }, events: { type: 'array', items: { type: 'string', enum: flightEventValues }, minItems: 1 }, timeout_ms: { type: 'number', minimum: 1000, maximum: 15000, default: 15000 } }, additionalProperties: false },
  },
  {
    name: 'transfer_control', title: 'Transfer control', readOnly: false,
    description: 'Accept a pending handoff or return control to the pilot. Any direct pilot input also overrides the copilot immediately.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string', enum: ['human', 'agent'] }, reason: { type: 'string' } }, required: ['owner'], additionalProperties: false },
  },
] as const satisfies readonly FlightToolDefinition[]

export const flightToolDefinitionsByName = Object.fromEntries(flightToolDefinitions.map((definition) => [definition.name, definition])) as unknown as { readonly [Name in FlightToolName]: FlightToolDefinition<Name> }
export function isFlightToolName(value: string): value is FlightToolName { return Object.hasOwn(flightToolDefinitionsByName, value) }
