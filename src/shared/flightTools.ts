import type {
  CheckrideDecision,
  CheckrideDecisionReceipt,
  CheckrideEvidence,
  CheckrideEvidenceSource,
  CheckrideSeed,
  ControlOwner,
  FlightCommand,
  FlightCommandReceipt,
  FlightEventType,
  FlightEventWaitResult,
  FlightState,
  MissionBrief,
  MissionFixId,
} from '../sim/types'

export type JsonSchema = Readonly<{
  type: 'object'
  properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  required?: readonly string[]
  additionalProperties: false
}>

export type ToolReceiptTone = 'neutral' | 'success' | 'warning' | 'critical' | 'automation'

export interface FlightToolReceipt<TDetails = Readonly<Record<string, unknown>>> {
  readonly ok: true
  readonly summary: string
  readonly tone: ToolReceiptTone
  readonly details: TDetails
}

export type CommandFlightToolReceipt = FlightCommandReceipt & Readonly<{
  ok: boolean
  tone: ToolReceiptTone
  nextEvent?: FlightEventWaitResult
}>

export type WaitFlightEventToolReceipt = FlightEventWaitResult & Readonly<{
  ok: true
  summary: string
  tone: ToolReceiptTone
}>

export const flightCommandValues = [
  'takeoff',
  'proceed_to_fix',
  'enter_downwind',
  'extend_downwind',
  'begin_approach',
  'land',
  'go_around',
] as const satisfies readonly FlightCommand[]

export const proceedToFixTargets = [
  'CROSSWIND',
  'NORTH_GATE',
] as const satisfies readonly MissionFixId[]

export const checkrideSeeds = [17, 42, 81] as const satisfies readonly CheckrideSeed[]

export const checkrideEvidenceSources = [
  'weather',
  'cockpit',
  'traffic',
  'passenger',
] as const satisfies readonly CheckrideEvidenceSource[]

export const checkrideDecisionValues = [
  'divert',
  'request_priority',
  'declare_minimum_fuel',
  'continue',
  'hold',
] as const satisfies readonly CheckrideDecision[]

export const flightEventValues = [
  'command_required',
  'system_alert',
  'decision_resolved',
  'human_approval_required',
  'human_approval_resolved',
  'touchdown',
  'mission_complete',
] as const satisfies readonly FlightEventType[]

export interface FlightToolArguments {
  start_checkride: {
    readonly seed?: CheckrideSeed
  }
  get_mission_brief: Record<string, never>
  get_flight_state: Record<string, never>
  inspect_flight_evidence: {
    readonly source?: CheckrideEvidenceSource
  }
  wait_for_flight_event: {
    readonly after_revision?: number
    readonly events?: readonly FlightEventType[]
    readonly timeout_ms?: number
  }
  command_flight: {
    readonly command: FlightCommand
    readonly target?: MissionFixId
    readonly reason?: string
    readonly wait_for_next_event?: boolean
    readonly timeout_ms?: number
  }
  decide_checkride: {
    readonly decision: CheckrideDecision
    readonly reason?: string
    readonly wait_for_next_event?: boolean
    readonly timeout_ms?: number
  }
  transfer_control: {
    readonly owner: ControlOwner
    readonly reason?: string
  }
}

export interface FlightToolResults {
  start_checkride: FlightToolReceipt<{
    readonly seed: CheckrideSeed
    readonly brief: MissionBrief
    readonly state: FlightState
  }>
  get_mission_brief: FlightToolReceipt<{ readonly brief: MissionBrief }>
  get_flight_state: FlightToolReceipt<{
    readonly state: FlightState
    readonly units: Readonly<Record<string, string>>
  }>
  inspect_flight_evidence: FlightToolReceipt<{
    readonly evidence: CheckrideEvidence | readonly CheckrideEvidence[]
    readonly inspectedSources: readonly CheckrideEvidenceSource[]
  }>
  wait_for_flight_event: WaitFlightEventToolReceipt
  command_flight: CommandFlightToolReceipt
  decide_checkride: CheckrideDecisionReceipt & Readonly<{
    ok: boolean
    tone: ToolReceiptTone
    nextEvent?: FlightEventWaitResult
  }>
  transfer_control: FlightToolReceipt<{ readonly controlOwner: ControlOwner }>
}

export type FlightToolName = keyof FlightToolArguments

export interface FlightToolDefinition<Name extends FlightToolName = FlightToolName> {
  readonly name: Name
  readonly title: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly readOnly: boolean
}

const emptySchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const satisfies JsonSchema

export const flightToolDefinitions = [
  {
    name: 'start_checkride',
    title: 'Start AI checkride',
    description:
      'Reset the simulator, give the browser agent control, and return the full mission brief plus initial state. Choose seed 17, 42, or 81 for a reproducible hidden event sequence.',
    inputSchema: {
      type: 'object',
      properties: {
        seed: { type: 'number', enum: checkrideSeeds, default: 17 },
      },
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'get_mission_brief',
    title: 'Read mission brief',
    description:
      'Reread the runway, route, named fixes, flight constraints, success criteria, and legal first commands. start_checkride already returns this brief. Never changes the flight.',
    inputSchema: emptySchema,
    readOnly: true,
  },
  {
    name: 'get_flight_state',
    title: 'Read flight state',
    description:
      'Read the live aircraft state and mission navigation, including the active leg, next fix, navigation errors, approach stability, and allowed commands. Never changes the flight.',
    inputSchema: emptySchema,
    readOnly: true,
  },
  {
    name: 'inspect_flight_evidence',
    title: 'Inspect flight evidence',
    description:
      'Read evidence after a checkride alert. Omit source to inspect weather, cockpit, traffic, and passenger reports together. Individual reports may be stale or unreliable.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: checkrideEvidenceSources },
      },
      additionalProperties: false,
    },
    readOnly: true,
  },
  {
    name: 'wait_for_flight_event',
    title: 'Wait for flight event',
    description:
      'Wait without polling for the next actionable event. Omit every argument for a bounded 15 second wait. Call again after a timeout; the receipt always includes the current state and revision.',
    inputSchema: {
      type: 'object',
      properties: {
        after_revision: { type: 'number', minimum: 0 },
        events: { type: 'array', items: { type: 'string', enum: flightEventValues }, minItems: 1 },
        timeout_ms: { type: 'number', minimum: 1000, maximum: 15000, default: 15000 },
      },
      additionalProperties: false,
    },
    readOnly: true,
  },
  {
    name: 'command_flight',
    title: 'Command the flight',
    description:
      'Issue one legal phase command and receive an immediate acknowledgment. Then use wait_for_flight_event for the next gate. Set wait_for_next_event to true only when one combined request is more useful. The simulator infers the current CROSSWIND or NORTH_GATE target when omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          enum: flightCommandValues,
        },
        target: {
          type: 'string',
          enum: proceedToFixTargets,
        },
        reason: { type: 'string' },
        wait_for_next_event: { type: 'boolean', default: false },
        timeout_ms: { type: 'number', minimum: 1000, maximum: 15000, default: 15000 },
      },
      required: ['command'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'decide_checkride',
    title: 'Make checkride decision',
    description:
      'Choose one allowed response after inspecting evidence and receive an immediate acknowledgment. Use wait_for_flight_event if the decision starts a new flight segment. A human-approval request returns control to the pilot.',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: checkrideDecisionValues },
        reason: { type: 'string' },
        wait_for_next_event: { type: 'boolean', default: false },
        timeout_ms: { type: 'number', minimum: 1000, maximum: 15000, default: 15000 },
      },
      required: ['decision'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'transfer_control',
    title: 'Transfer flight control',
    description:
      'Transfer primary flight control to the pilot or agent after an explicit handoff. Returning control to the pilot stops agent mission guidance immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', enum: ['human', 'agent'] },
        reason: { type: 'string' },
      },
      required: ['owner'],
      additionalProperties: false,
    },
    readOnly: false,
  },
] as const satisfies readonly FlightToolDefinition[]

export const flightToolDefinitionsByName = Object.fromEntries(
  flightToolDefinitions.map((definition) => [definition.name, definition]),
) as unknown as { readonly [Name in FlightToolName]: FlightToolDefinition<Name> }

export function isFlightToolName(value: string): value is FlightToolName {
  return Object.hasOwn(flightToolDefinitionsByName, value)
}
