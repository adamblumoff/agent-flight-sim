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
  'human_approval_required',
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
    readonly source: CheckrideEvidenceSource
  }
  wait_for_flight_event: {
    readonly after_revision: number
    readonly events: readonly FlightEventType[]
    readonly timeout_ms?: number
  }
  command_flight: {
    readonly command: FlightCommand
    readonly target?: MissionFixId
    readonly reason?: string
    readonly wait_until_decision?: boolean
    readonly timeout_ms?: number
  }
  decide_checkride: {
    readonly decision: CheckrideDecision
    readonly reason?: string
  }
  transfer_control: {
    readonly owner: ControlOwner
    readonly reason?: string
  }
}

export interface FlightToolResults {
  start_checkride: FlightToolReceipt<{
    readonly seed: CheckrideSeed
    readonly state: FlightState
  }>
  get_mission_brief: FlightToolReceipt<{ readonly brief: MissionBrief }>
  get_flight_state: FlightToolReceipt<{
    readonly state: FlightState
    readonly units: Readonly<Record<string, string>>
  }>
  inspect_flight_evidence: FlightToolReceipt<{
    readonly evidence: CheckrideEvidence
    readonly inspectedSources: readonly CheckrideEvidenceSource[]
  }>
  wait_for_flight_event: WaitFlightEventToolReceipt
  command_flight: CommandFlightToolReceipt
  decide_checkride: CheckrideDecisionReceipt & Readonly<{
    ok: boolean
    tone: ToolReceiptTone
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
      'Reset the simulator into a reproducible deteriorating-arrival checkride. Choose seed 17, 42, or 81 to compare agents against the same hidden event sequence.',
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
      'Read the runway, route, named fixes, flight constraints, success criteria, and legal first commands. Call this before flying the mission. Never changes the flight.',
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
      'Read one evidence source after a checkride alert. Weather, cockpit, traffic, and passenger reports are separate and may be stale or unreliable.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: checkrideEvidenceSources },
      },
      required: ['source'],
      additionalProperties: false,
    },
    readOnly: true,
  },
  {
    name: 'wait_for_flight_event',
    title: 'Wait for flight event',
    description:
      'Wait for the next matching revision without polling. The call returns on a command gate, system alert, human approval request, touchdown, mission completion, or a bounded timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        after_revision: { type: 'number', minimum: 0 },
        events: { type: 'array', items: { type: 'string', enum: flightEventValues }, minItems: 1 },
        timeout_ms: { type: 'number', minimum: 1000, maximum: 30000, default: 30000 },
      },
      required: ['after_revision', 'events'],
      additionalProperties: false,
    },
    readOnly: true,
  },
  {
    name: 'command_flight',
    title: 'Command the flight',
    description:
      'Issue one phase-level mission command while the agent has control. Use startingCommands from the brief or allowedCommands from the latest state or command receipt. proceed_to_fix also requires a target. The receipt includes the resulting state and legal next commands, so do not read state again unless the aircraft has had time to move.',
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
        wait_until_decision: { type: 'boolean', default: false },
        timeout_ms: { type: 'number', minimum: 1000, maximum: 30000, default: 30000 },
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
      'Choose one allowed response to the active checkride alert. Inspect the relevant evidence first. Some risky choices pause for human approval.',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: checkrideDecisionValues },
        reason: { type: 'string' },
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
