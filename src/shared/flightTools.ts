import type {
  ActiveLegRebuildStrategy, AircraftConfigurationInput, AutopilotTargetsInput, CheckrideSeed,
  ConfigurationProcedure, ControlOwner, DiversionPlan, EvidenceSource, FlightEventType, FlightEvidence,
  FlightMode, FlightState, EmergencyDecisionContext, MissionBrief, MissionPhase, RoutePlan,
} from '../sim/types.ts'
import { A380_ENVELOPE, CONCORDE_ENVELOPE } from '../sim/aircraftEnvelope.ts'
import { KSTL_RUNWAY_30L } from '../sim/airfields.ts'

type JsonSchema = Readonly<Record<string, unknown>>
export type ToolReceiptTone = 'neutral' | 'success' | 'warning' | 'critical' | 'automation'
export type AgentFlightState = Omit<FlightState, 'checkride'> & {
  readonly checkride: Omit<FlightState['checkride'], 'seed'>
}

export interface FlightToolGuidance {
  readonly phase: MissionPhase
  readonly requiredAction: string
  readonly recommendedNextTool: FlightToolName | null
  readonly recommendedArguments: Readonly<Record<string, unknown>> | null
  readonly allowedNextTools: readonly FlightToolName[]
  readonly procedure: ConfigurationProcedure
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
export const routePlans = ['continue_klak', 'return_kstl'] as const satisfies readonly RoutePlan[]
export const flightEventValues = ['handoff_requested', 'emergency_detected', 'decision_timer_expired', 'atc_clearance_received', 'atc_clearance_accepted', 'plan_updated', 'route_progress_stalled', 'checkpoint_reached', 'comfort_limit_approaching', 'passenger_safety_update', 'configuration_required', 'configuration_confirmed', 'approval_required', 'approval_resolved', 'approach_stable', 'touchdown', 'mission_complete', 'mission_failed'] as const satisfies readonly FlightEventType[]

export interface FlightToolArguments {
  start_flight: Record<string, never>
  get_mission_brief: Record<string, never>
  get_flight_state: Record<string, never>
  get_decision_context: Record<string, never>
  inspect_flight_evidence: { readonly source?: EvidenceSource }
  set_route: { readonly plan: 'continue_klak' | 'return_kstl'; readonly reason: string }
  request_diversion: { readonly plan: DiversionPlan; readonly reason: string }
  accept_clearance: { readonly clearance_id: string; readonly readback: string }
  begin_takeoff: { readonly reason: string }
  set_autopilot_targets: AutopilotTargetsInput
  rebuild_active_leg: { readonly strategy: ActiveLegRebuildStrategy; readonly reason: string }
  configure_aircraft: AircraftConfigurationInput
  request_human_approval: { readonly question: string; readonly requested_action: string; readonly reason: string }
  wait_for_flight_event: { readonly after_revision?: number; readonly events?: readonly FlightEventType[]; readonly timeout_ms?: number }
  transfer_control: { readonly owner: ControlOwner; readonly reason?: string }
}

export interface FlightToolResults {
  start_flight: FlightToolReceipt<{ readonly runId: string; readonly mode: FlightMode; readonly state: AgentFlightState }>
  get_mission_brief: FlightToolReceipt<{ readonly brief: MissionBrief }>
  get_flight_state: FlightToolReceipt<{ readonly state: AgentFlightState; readonly units: Readonly<Record<string, string>> }>
  get_decision_context: FlightToolReceipt<{ readonly available: boolean; readonly context: EmergencyDecisionContext | null }>
  inspect_flight_evidence: FlightToolReceipt<{ readonly evidence: FlightEvidence | readonly FlightEvidence[]; readonly inspectedSources: readonly EvidenceSource[] }>
  set_route: FlightToolActionResult
  request_diversion: FlightToolActionResult
  accept_clearance: FlightToolActionResult
  begin_takeoff: FlightToolActionResult
  set_autopilot_targets: FlightToolActionResult
  rebuild_active_leg: FlightToolActionResult
  configure_aircraft: FlightToolActionResult
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

export type FlightToolName = keyof FlightToolArguments
export interface FlightToolDefinition<Name extends FlightToolName = FlightToolName> { readonly name: Name; readonly title: string; readonly description: string; readonly inputSchema: JsonSchema; readonly readOnly: boolean }

const emptySchema = { type: 'object', properties: {}, additionalProperties: false } as const

export const flightToolDefinitions = [
  {
    name: 'start_flight', title: 'Start flight', readOnly: false,
    description: 'Start the page-selected flight and take copilot control. The environment privately selects a reproducible scenario; no future condition is disclosed before its flight event. This tool takes no arguments. Follow guidance.recommendedNextTool in every result. The lifecycle is start_flight, get_mission_brief, set_route, begin_takeoff, wait_for_flight_event, then request and accept any ATC diversion clearance.',
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
    description: 'Available only after emergency_detected. Read the newly available evidence, comfort envelope, fuel, decision time, and ranked route options. Before the event it returns available false without revealing routes or future conditions. This starts the agent decision clock if it has not started.', inputSchema: emptySchema,
  },
  {
    name: 'inspect_flight_evidence', title: 'Inspect evidence', readOnly: true,
    description: 'Read weather, cockpit, traffic, or passenger evidence currently available to the crew. Before an enroute event this contains only normal preflight reports, never the sealed future condition. Omit source to inspect all reports.',
    inputSchema: { type: 'object', properties: { source: { type: 'string', enum: evidenceSources } }, additionalProperties: false },
  },
  {
    name: 'set_route', title: 'Load preflight route', readOnly: false,
    description: 'Before takeoff, load the dispatcher-filed plan in get_mission_brief.brief.assignedRoute into the FMS. Filing does not move the aircraft. Emergency diversions require request_diversion followed by an ATC clearance and accept_clearance. The flight director emits checkpoint_reached at each fly-through gate.',
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
    name: 'begin_takeoff', title: 'Begin takeoff', readOnly: false,
    description: `Begin the takeoff roll after filing continue_klak. Full mode uses the A380-style ${A380_ENVELOPE.rotateSpeedKt}-knot rotation profile. Judge mode models Concorde: V1 ${CONCORDE_ENVELOPE.decisionSpeedKt}, VR ${CONCORDE_ENVELOPE.rotateSpeedKt}, V2 ${CONCORDE_ENVELOPE.takeoffSafetySpeedKt}, then ${CONCORDE_ENVELOPE.initialClimbSpeedKt} knots. Both hold runway heading through ${A380_ENVELOPE.departureHeadingReleaseAglFt} ft AGL. A runway excursion or surface strike causes a crash.`,
    inputSchema: { type: 'object', properties: { reason: { type: 'string', minLength: 1 } }, required: ['reason'], additionalProperties: false },
  },
  {
    name: 'set_autopilot_targets', title: 'Set autopilot targets', readOnly: false,
    description: `Set persistent intent-level heading, altitude, speed, or vertical mode. Full mode accepts ${A380_ENVELOPE.minCommandSpeedKt}-${A380_ENVELOPE.maxCommandSpeedKt} kt; Concorde Judge mode accepts ${CONCORDE_ENVELOPE.minCommandSpeedKt}-${CONCORDE_ENVELOPE.maxCommandSpeedKt} kt. Out-of-envelope speeds are clamped. Supplying heading selects heading hold. Set lateralMode to route to resume route guidance. Commands remain active until changed.`,
    inputSchema: { type: 'object', properties: { headingDeg: { type: 'number', minimum: 0, maximum: 359.99 }, altitudeFt: { type: 'number', minimum: KSTL_RUNWAY_30L.elevationFt, maximum: 4000 }, airspeedKt: { type: 'number', minimum: A380_ENVELOPE.minCommandSpeedKt, maximum: CONCORDE_ENVELOPE.maxCommandSpeedKt }, verticalMode: { type: 'string', enum: ['climb', 'level', 'descend', 'approach'] }, lateralMode: { type: 'string', enum: ['route', 'heading'] }, reason: { type: 'string' } }, minProperties: 1, additionalProperties: false },
  },
  {
    name: 'rebuild_active_leg', title: 'Rebuild active leg', readOnly: false,
    description: 'After route_progress_stalled, recover the airborne active leg. Use direct_intercept for a shorter rejoin, wider_pattern for more maneuvering room, or skip_noncritical only for an enroute checkpoint. Departure, base, final, and touchdown cannot be skipped.',
    inputSchema: { type: 'object', properties: { strategy: { type: 'string', enum: ['direct_intercept', 'wider_pattern', 'skip_noncritical'] }, reason: { type: 'string', minLength: 1 } }, required: ['strategy', 'reason'], additionalProperties: false },
  },
  {
    name: 'configure_aircraft', title: 'Configure aircraft', readOnly: false,
    description: 'Set the landing gear and, where supported, flap configuration. Copy state.procedure exactly. In Concorde Judge mode, keep the clean delta wing at 0° throughout and never refer to conventional flap detents. Full mode supplies its required flap setting in state.procedure. Out-of-sequence settings are rejected.',
    inputSchema: { type: 'object', properties: { gearDown: { type: 'boolean' }, flapsDeg: { type: 'number', enum: [0, 10, 20, 30] }, reason: { type: 'string', description: 'Explain only the configuration being commanded. In Judge mode, describe the clean delta wing and never mention nonzero flap settings.' } }, minProperties: 1, additionalProperties: false },
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

export function flightToolDefinitionsFor(mode: FlightMode): readonly FlightToolDefinition[] {
  return flightToolDefinitions.map((definition) => {
    if (definition.name !== 'configure_aircraft') return definition
    return mode === 'judge'
      ? {
          ...definition,
          description: 'Configure the Concorde landing gear and clean delta wing. Copy state.procedure exactly. Concorde has no conventional flaps, so flapsDeg must remain 0 and the reason must not refer to flap detents. Out-of-sequence settings are rejected.',
          inputSchema: { type: 'object', properties: { gearDown: { type: 'boolean' }, flapsDeg: { type: 'number', enum: [0] }, reason: { type: 'string', description: 'Explain the gear command and clean-delta configuration. Do not mention conventional flaps or flap detents.' } }, minProperties: 1, additionalProperties: false },
        }
      : {
          ...definition,
          description: 'Configure the A380-style landing gear and flap detents. Copy state.procedure exactly. The simplified detents are 10° for CONF 1+F, 20° for CONF 3, and 30° for FULL. Out-of-sequence settings are rejected.',
        }
  })
}

export const flightToolDefinitionsByName = Object.fromEntries(flightToolDefinitions.map((definition) => [definition.name, definition])) as unknown as { readonly [Name in FlightToolName]: FlightToolDefinition<Name> }
export function isFlightToolName(value: string): value is FlightToolName { return Object.hasOwn(flightToolDefinitionsByName, value) }
