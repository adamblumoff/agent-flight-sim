import type {
  ControlOwner,
  FlightCommand,
  FlightCommandReceipt,
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

export interface FlightToolArguments {
  get_mission_brief: Record<string, never>
  get_flight_state: Record<string, never>
  command_flight: {
    readonly command: FlightCommand
    readonly target?: MissionFixId
    readonly reason?: string
  }
  transfer_control: {
    readonly owner: ControlOwner
    readonly reason?: string
  }
}

export interface FlightToolResults {
  get_mission_brief: FlightToolReceipt<{ readonly brief: MissionBrief }>
  get_flight_state: FlightToolReceipt<{
    readonly state: FlightState
    readonly units: Readonly<Record<string, string>>
  }>
  command_flight: CommandFlightToolReceipt
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
      },
      required: ['command'],
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
