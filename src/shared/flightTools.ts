import type {
  ActionReceipt, AircraftConfigurationInput, AutopilotTargetsInput, CheckrideSeed,
  ControlOwner, EvidenceSource, FlightEventType, FlightEventWaitResult, FlightEvidence,
  FlightState, MissionBrief, RoutePlan,
} from '../sim/types'

type JsonSchema = Readonly<Record<string, unknown>>
export type ToolReceiptTone = 'neutral' | 'success' | 'warning' | 'critical' | 'automation'
export interface FlightToolReceipt<T> { readonly ok: true; readonly summary: string; readonly tone: ToolReceiptTone; readonly details: T }

export const checkrideSeeds = [17, 42, 81] as const satisfies readonly CheckrideSeed[]
export const evidenceSources = ['weather', 'cockpit', 'traffic', 'passenger'] as const satisfies readonly EvidenceSource[]
export const routePlans = ['continue_klak', 'return_kpwk'] as const satisfies readonly RoutePlan[]
export const flightEventValues = ['handoff_requested', 'emergency_detected', 'decision_timer_expired', 'plan_updated', 'checkpoint_reached', 'passenger_safety_update', 'configuration_required', 'configuration_confirmed', 'approval_required', 'approval_resolved', 'approach_stable', 'touchdown', 'mission_complete', 'mission_failed'] as const satisfies readonly FlightEventType[]

export interface FlightToolArguments {
  start_flight: { readonly seed?: CheckrideSeed }
  get_mission_brief: Record<string, never>
  get_flight_state: Record<string, never>
  inspect_flight_evidence: { readonly source?: EvidenceSource }
  set_route: { readonly plan: 'continue_klak' | 'return_kpwk'; readonly reason: string }
  set_autopilot_targets: AutopilotTargetsInput
  configure_aircraft: AircraftConfigurationInput
  request_human_approval: { readonly question: string; readonly requested_action: string; readonly reason: string }
  wait_for_flight_event: { readonly after_revision?: number; readonly events?: readonly FlightEventType[]; readonly timeout_ms?: number }
  transfer_control: { readonly owner: ControlOwner; readonly reason?: string }
}

export interface FlightToolResults {
  start_flight: FlightToolReceipt<{ readonly seed: CheckrideSeed; readonly brief: MissionBrief; readonly state: FlightState }>
  get_mission_brief: FlightToolReceipt<{ readonly brief: MissionBrief }>
  get_flight_state: FlightToolReceipt<{ readonly state: FlightState; readonly units: Readonly<Record<string, string>> }>
  inspect_flight_evidence: FlightToolReceipt<{ readonly evidence: FlightEvidence | readonly FlightEvidence[]; readonly inspectedSources: readonly EvidenceSource[] }>
  set_route: ActionReceipt & { readonly ok: boolean; readonly tone: ToolReceiptTone }
  set_autopilot_targets: ActionReceipt & { readonly ok: boolean; readonly tone: ToolReceiptTone }
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
    description: 'Start a reproducible mission on North Field runway 18 and take copilot control. The aircraft remains stopped until set_route files the continue_klak preflight route.',
    inputSchema: { type: 'object', properties: { seed: { type: 'number', enum: checkrideSeeds, default: 17 } }, additionalProperties: false },
  },
  {
    name: 'get_mission_brief', title: 'Read mission brief', readOnly: true,
    description: 'Read the start, airports, runways, route choices, deadline, and landing criteria.', inputSchema: emptySchema,
  },
  {
    name: 'get_flight_state', title: 'Read flight state', readOnly: true,
    description: 'Read live aircraft motion, fuel, control owner, current route, required phase-specific aircraft configuration, autopilot targets, approval, scenario conditions, and debrief.', inputSchema: emptySchema,
  },
  {
    name: 'inspect_flight_evidence', title: 'Inspect evidence', readOnly: true,
    description: 'Read current weather, cockpit, traffic, or passenger evidence. Omit source to inspect all four reports.',
    inputSchema: { type: 'object', properties: { source: { type: 'string', enum: evidenceSources } }, additionalProperties: false },
  },
  {
    name: 'set_route', title: 'Choose route', readOnly: false,
    description: 'Before takeoff, file continue_klak to Lakeside Municipal runway 22; this starts the takeoff roll. After emergency_detected, inspect at least two reports and replace it with return_kpwk. Each captured checkpoint emits checkpoint_reached.',
    inputSchema: { type: 'object', properties: { plan: { type: 'string', enum: routePlans }, reason: { type: 'string', minLength: 1 } }, required: ['plan', 'reason'], additionalProperties: false },
  },
  {
    name: 'set_autopilot_targets', title: 'Set autopilot targets', readOnly: false,
    description: 'Adjust intent-level heading, altitude, speed, or vertical mode. Use this for a deliberate correction, not continuous stick inputs.',
    inputSchema: { type: 'object', properties: { headingDeg: { type: 'number', minimum: 0, maximum: 359.99 }, altitudeFt: { type: 'number', minimum: 645, maximum: 4000 }, airspeedKt: { type: 'number', minimum: 65, maximum: 140 }, verticalMode: { type: 'string', enum: ['climb', 'level', 'descend', 'approach'] }, reason: { type: 'string' } }, minProperties: 1, additionalProperties: false },
  },
  {
    name: 'configure_aircraft', title: 'Configure aircraft', readOnly: false,
    description: 'Set landing gear and flaps for the current procedure stage. Read state.procedure first: premature or out-of-sequence settings are rejected, and configuration_required events announce each transition.',
    inputSchema: { type: 'object', properties: { gearDown: { type: 'boolean' }, flapsDeg: { type: 'number', enum: [0, 10, 20, 30] }, reason: { type: 'string' } }, minProperties: 1, additionalProperties: false },
  },
  {
    name: 'request_human_approval', title: 'Ask pilot', readOnly: false,
    description: 'Ask the pilot to approve a consequential action. Existing autopilot targets keep the aircraft moving while the pilot decides.',
    inputSchema: { type: 'object', properties: { question: { type: 'string', minLength: 1 }, requested_action: { type: 'string', minLength: 1 }, reason: { type: 'string', minLength: 1 } }, required: ['question', 'requested_action', 'reason'], additionalProperties: false },
  },
  {
    name: 'wait_for_flight_event', title: 'Wait for flight event', readOnly: true,
    description: 'Wait without polling for a configuration change, handoff, approval, touchdown, mission completion, or failure. Call again after a timeout.',
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
