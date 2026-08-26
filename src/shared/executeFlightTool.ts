import { flightSimulator } from '../sim/flightSimulator'
import type {
  FlightToolArguments,
  FlightToolName,
  FlightToolResults,
  ToolReceiptTone,
} from './flightTools'

type UnknownInput = Readonly<Record<string, unknown>>

const numberInput = (input: UnknownInput, key: string): number => {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${key} must be a finite number`)
  }
  return value
}

const reasonInput = (input: UnknownInput): string => {
  const reason = input.reason
  return typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : 'Requested by the browser agent'
}

const receipt = <Details extends Readonly<Record<string, unknown>>>(
  summary: string,
  tone: ToolReceiptTone,
  details: Details,
) => ({ ok: true as const, summary, tone, details })

const percentage = (value: number) => `${Math.round(value * 100)}%`

const executors: {
  readonly [Name in FlightToolName]: (
    input: FlightToolArguments[Name],
  ) => FlightToolResults[Name]
} = {
  get_flight_state: () =>
    receipt('Live flight state read', 'neutral', {
      state: flightSimulator.getState(),
      units: {
        altitude: 'feet',
        airspeed: 'knots',
        verticalSpeed: 'feet per minute',
        angles: 'degrees',
      },
    }),
  get_flight_recorder: () =>
    receipt('Recent flight actions read', 'neutral', {
      events: flightSimulator.getTrace().slice(-20),
    }),
  set_throttle: (input) => {
    const value = numberInput(input, 'value')
    flightSimulator.setThrottle(value, 'agent', reasonInput(input))
    const throttle = flightSimulator.getState().throttle
    return receipt(`Throttle set to ${percentage(throttle)}`, 'success', { throttle })
  },
  configure_aircraft: (input) => {
    const reason = reasonInput(input)
    if (input.flaps_degrees !== undefined) {
      if (![0, 10, 20, 30].includes(input.flaps_degrees)) {
        throw new TypeError('flaps_degrees must be 0, 10, 20, or 30')
      }
      flightSimulator.setFlaps(input.flaps_degrees, 'agent', reason)
    }
    if (input.gear_down !== undefined) {
      flightSimulator.setGear(input.gear_down, 'agent', reason)
    }
    if (input.flaps_degrees === undefined && input.gear_down === undefined) {
      throw new TypeError('configure_aircraft requires flaps_degrees, gear_down, or both')
    }
    const state = flightSimulator.getState()
    return receipt(
      `Aircraft configured: flaps ${state.flapsDeg}°, gear ${state.gearDown ? 'down' : 'up'}`,
      'success',
      { flapsDegrees: state.flapsDeg, gearDown: state.gearDown },
    )
  },
  set_flight_director: (input) => {
    flightSimulator.setFlightDirector(
      {
        enabled: input.enabled ?? true,
        headingDeg: input.heading_degrees,
        altitudeFt: input.altitude_feet,
        airspeedKt: input.airspeed_knots,
      },
      'agent',
      reasonInput(input),
    )
    const flightDirector = flightSimulator.getState().flightDirector
    return receipt(
      flightDirector.enabled
        ? `Flight director set: ${Math.round(flightDirector.headingDeg)}° · ${Math.round(flightDirector.altitudeFt)} ft · ${Math.round(flightDirector.airspeedKt)} kt`
        : 'Flight director disabled',
      flightDirector.enabled ? 'automation' : 'success',
      { flightDirector },
    )
  },
  transfer_control: (input) => {
    if (input.owner !== 'human' && input.owner !== 'agent') {
      throw new TypeError('owner must be human or agent')
    }
    flightSimulator.transferControl(input.owner, 'agent', reasonInput(input))
    const controlOwner = flightSimulator.getState().controlOwner
    return receipt(
      controlOwner === 'agent' ? 'Agent has the controls' : 'Pilot has the controls; agent control stopped',
      controlOwner === 'agent' ? 'automation' : 'success',
      { controlOwner },
    )
  },
  trigger_training_scenario: (input) => {
    if (input.scenario !== 'engine_instability' && input.scenario !== 'clear') {
      throw new TypeError('scenario must be engine_instability or clear')
    }
    flightSimulator.triggerScenario(input.scenario, 'agent', reasonInput(input))
    const scenario = flightSimulator.getState().scenario
    return receipt(
      scenario === 'clear' ? 'Training scenario cleared' : 'Engine instability scenario active',
      scenario === 'clear' ? 'success' : 'warning',
      { scenario },
    )
  },
}

export function executeFlightTool<Name extends FlightToolName>(
  name: Name,
  input: FlightToolArguments[Name],
): FlightToolResults[Name] {
  return executors[name](input)
}

export function executeFlightToolFromUnknown(name: FlightToolName, input: unknown): FlightToolResults[FlightToolName] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${name} input must be an object`)
  }
  return executors[name](input as never)
}
