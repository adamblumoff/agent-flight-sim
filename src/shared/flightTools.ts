import type {
  ControlOwner,
  FlightDirectorState,
  FlightScenario,
  FlightState,
  TraceEvent,
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

export interface FlightToolArguments {
  get_flight_state: Record<string, never>
  get_flight_recorder: Record<string, never>
  set_throttle: { readonly value: number; readonly reason?: string }
  configure_aircraft: {
    readonly flaps_degrees?: 0 | 10 | 20 | 30
    readonly gear_down?: boolean
    readonly reason?: string
  }
  set_flight_director: {
    readonly enabled?: boolean
    readonly heading_degrees?: number
    readonly altitude_feet?: number
    readonly airspeed_knots?: number
    readonly reason?: string
  }
  transfer_control: {
    readonly owner: ControlOwner
    readonly reason?: string
  }
  trigger_training_scenario: {
    readonly scenario: FlightScenario
    readonly reason?: string
  }
}

export interface FlightToolResults {
  get_flight_state: FlightToolReceipt<{
    readonly state: FlightState
    readonly units: Readonly<Record<string, string>>
  }>
  get_flight_recorder: FlightToolReceipt<{ readonly events: readonly TraceEvent[] }>
  set_throttle: FlightToolReceipt<{ readonly throttle: number }>
  configure_aircraft: FlightToolReceipt<{
    readonly flapsDegrees: number
    readonly gearDown: boolean
  }>
  set_flight_director: FlightToolReceipt<{
    readonly flightDirector: FlightDirectorState
  }>
  transfer_control: FlightToolReceipt<{ readonly controlOwner: ControlOwner }>
  trigger_training_scenario: FlightToolReceipt<{ readonly scenario: FlightScenario }>
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
    name: 'get_flight_state',
    title: 'Read flight state',
    description:
      'Read the live aircraft position, attitude, speed, configuration, control owner, and flight-director targets. Never changes the flight.',
    inputSchema: emptySchema,
    readOnly: true,
  },
  {
    name: 'get_flight_recorder',
    title: 'Read flight recorder',
    description: 'Read the 20 most recent human, agent, and system actions. Never changes the flight.',
    inputSchema: emptySchema,
    readOnly: true,
  },
  {
    name: 'set_throttle',
    title: 'Set throttle',
    description: 'Set engine throttle from zero to one. Use smooth, deliberate changes.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', minimum: 0, maximum: 1 },
        reason: { type: 'string' },
      },
      required: ['value'],
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'configure_aircraft',
    title: 'Configure aircraft',
    description: 'Set flap angle, landing-gear position, or both for the current phase of flight.',
    inputSchema: {
      type: 'object',
      properties: {
        flaps_degrees: { type: 'number', enum: [0, 10, 20, 30] },
        gear_down: { type: 'boolean' },
        reason: { type: 'string' },
      },
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'set_flight_director',
    title: 'Set flight director',
    description:
      'Set or disable heading, altitude, and airspeed targets. The browser runs the real-time control loop only while the agent owns the controls.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        heading_degrees: { type: 'number', minimum: 0, maximum: 359 },
        altitude_feet: { type: 'number', minimum: 500, maximum: 12000 },
        airspeed_knots: { type: 'number', minimum: 60, maximum: 180 },
        reason: { type: 'string' },
      },
      additionalProperties: false,
    },
    readOnly: false,
  },
  {
    name: 'transfer_control',
    title: 'Transfer flight control',
    description:
      'Transfer primary flight control to the human or the agent. Use only after an explicit verbal handoff. Returning control to the human immediately stops agent control.',
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
  {
    name: 'trigger_training_scenario',
    title: 'Set training scenario',
    description: 'Start or clear a moderate engine-instability training event.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario: { type: 'string', enum: ['engine_instability', 'clear'] },
        reason: { type: 'string' },
      },
      required: ['scenario'],
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
