import { flightSimulator } from '../sim/flightSimulator'
import type {
  FlightToolArguments,
  FlightToolName,
  FlightToolResults,
  ToolReceiptTone,
} from './flightTools'
import { flightCommandValues, proceedToFixTargets } from './flightTools'

type UnknownInput = Readonly<Record<string, unknown>>

const flightCommands = new Set<string>(flightCommandValues)
const proceedToFixTargetSet = new Set<string>(proceedToFixTargets)

const reasonInput = (input: UnknownInput): string => {
  const reason = input.reason
  return typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : 'Requested by the browser agent'
}

const receipt = <Details>(
  summary: string,
  tone: ToolReceiptTone,
  details: Details,
) => ({ ok: true as const, summary, tone, details })

const commandInput = (input: FlightToolArguments['command_flight']) => {
  if (!flightCommands.has(input.command)) {
    throw new TypeError('command is not a supported flight command')
  }
  if (input.target !== undefined && !proceedToFixTargetSet.has(input.target)) {
    throw new TypeError('target must be CROSSWIND or NORTH_GATE')
  }
  if (input.command === 'proceed_to_fix' && input.target === undefined) {
    throw new TypeError('proceed_to_fix requires a target')
  }
  if (input.command !== 'proceed_to_fix' && input.target !== undefined) {
    throw new TypeError('target is only valid with proceed_to_fix')
  }

  return {
    command: input.command,
    target: input.target,
    reason: reasonInput(input),
  }
}

const executors: {
  readonly [Name in FlightToolName]: (
    input: FlightToolArguments[Name],
  ) => FlightToolResults[Name]
} = {
  get_mission_brief: () =>
    receipt('Mission brief read', 'neutral', {
      brief: flightSimulator.getMissionBrief(),
    }),
  get_flight_state: () =>
    receipt('Live flight and mission state read', 'neutral', {
      state: flightSimulator.getState(),
      units: {
        altitude: 'feet',
        airspeed: 'knots',
        verticalSpeed: 'feet per minute',
        angles: 'degrees',
        navigationDistance: 'nautical miles',
        glidepathError: 'feet',
      },
    }),
  command_flight: (input) => {
    const result = flightSimulator.commandFlight(commandInput(input), 'agent')
    return {
      ...result,
      ok: result.accepted,
      tone: result.accepted ? 'automation' : 'warning',
    }
  },
  transfer_control: (input) => {
    if (input.owner !== 'human' && input.owner !== 'agent') {
      throw new TypeError('owner must be human or agent')
    }
    flightSimulator.transferControl(input.owner, 'agent', reasonInput(input))
    const controlOwner = flightSimulator.getState().controlOwner
    return receipt(
      controlOwner === 'agent' ? 'Agent has the controls' : 'Pilot has the controls; agent guidance stopped',
      controlOwner === 'agent' ? 'automation' : 'success',
      { controlOwner },
    )
  },
}

export function executeFlightTool<Name extends FlightToolName>(
  name: Name,
  input: FlightToolArguments[Name],
): FlightToolResults[Name] {
  return executors[name](input)
}

export function executeFlightToolFromUnknown(
  name: FlightToolName,
  input: unknown,
): FlightToolResults[FlightToolName] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${name} input must be an object`)
  }
  return executors[name](input as never)
}
