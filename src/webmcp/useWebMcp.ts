import { useEffect, useState } from 'react'
import { flightSimulator } from '../sim/flightSimulator'

export type WebMcpStatus = 'registering' | 'ready' | 'unsupported' | 'error'
type ToolInput = Record<string, unknown>

const emptySchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

function numberInput(input: Record<string, unknown>, key: string) {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${key} must be a finite number`)
  }
  return value
}

function reasonInput(input: Record<string, unknown>) {
  const reason = input.reason
  return typeof reason === 'string' && reason.trim()
    ? reason.trim()
    : 'Requested by the AI copilot'
}

function createFlightTools(): WebMCP.ModelContextTool[] {
  return [
    {
      name: 'get_flight_state',
      title: 'Get flight state',
      description:
        'Read the aircraft position, attitude, speed, configuration, control owner, and active flight-director targets.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute: () => ({
        ...flightSimulator.getState(),
        units: {
          altitude: 'feet',
          airspeed: 'knots',
          verticalSpeed: 'feet per minute',
          angles: 'degrees',
        },
      }),
    },
    {
      name: 'get_flight_recorder',
      title: 'Get flight recorder',
      description: 'Read the recent human and AI actions recorded during this flight.',
      inputSchema: emptySchema,
      annotations: { readOnlyHint: true },
      execute: () => ({ events: flightSimulator.getTrace().slice(-20) }),
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
      execute: (input: ToolInput) => {
        const value = numberInput(input, 'value')
        flightSimulator.setThrottle(value, 'agent', reasonInput(input))
        return { ok: true, throttle: flightSimulator.getState().throttle }
      },
    },
    {
      name: 'configure_aircraft',
      title: 'Configure aircraft',
      description: 'Set flap angle and landing-gear position for the current phase of flight.',
      inputSchema: {
        type: 'object',
        properties: {
          flaps_degrees: { type: 'number', enum: [0, 10, 20, 30] },
          gear_down: { type: 'boolean' },
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
      execute: (input: ToolInput) => {
        const reason = reasonInput(input)
        if (typeof input.flaps_degrees === 'number') {
          flightSimulator.setFlaps(input.flaps_degrees, 'agent', reason)
        }
        if (typeof input.gear_down === 'boolean') {
          flightSimulator.setGear(input.gear_down, 'agent', reason)
        }
        const state = flightSimulator.getState()
        return { ok: true, flapsDegrees: state.flapsDeg, gearDown: state.gearDown }
      },
    },
    {
      name: 'set_flight_director',
      title: 'Set flight director',
      description:
        'Engage the local flight controller with target heading, altitude, and airspeed. The browser handles the real-time control loop.',
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
      execute: (input: ToolInput) => {
        flightSimulator.setFlightDirector(
          {
            enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
            headingDeg:
              typeof input.heading_degrees === 'number' ? input.heading_degrees : undefined,
            altitudeFt:
              typeof input.altitude_feet === 'number' ? input.altitude_feet : undefined,
            airspeedKt:
              typeof input.airspeed_knots === 'number' ? input.airspeed_knots : undefined,
          },
          'agent',
          reasonInput(input),
        )
        return { ok: true, flightDirector: flightSimulator.getState().flightDirector }
      },
    },
    {
      name: 'transfer_control',
      title: 'Transfer flight control',
      description:
        'Transfer primary flight control to the human or AI. Use only after a clear verbal handoff.',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', enum: ['human', 'agent'] },
          reason: { type: 'string' },
        },
        required: ['owner'],
        additionalProperties: false,
      },
      execute: (input: ToolInput) => {
        if (input.owner !== 'human' && input.owner !== 'agent') {
          throw new TypeError('owner must be human or agent')
        }
        flightSimulator.transferControl(input.owner, 'agent', reasonInput(input))
        return { ok: true, controlOwner: flightSimulator.getState().controlOwner }
      },
    },
    {
      name: 'trigger_training_scenario',
      title: 'Trigger training scenario',
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
      execute: (input: ToolInput) => {
        if (input.scenario !== 'engine_instability' && input.scenario !== 'clear') {
          throw new TypeError('scenario must be engine_instability or clear')
        }
        flightSimulator.triggerScenario(input.scenario, 'agent', reasonInput(input))
        return { ok: true, scenario: flightSimulator.getState().scenario }
      },
    },
  ]
}

export function useWebMcp() {
  const [status, setStatus] = useState<WebMcpStatus>('registering')

  useEffect(() => {
    if (!document.modelContext) {
      setStatus('unsupported')
      return
    }
    const modelContext = document.modelContext

    const controller = new AbortController()

    async function registerTools() {
      try {
        await Promise.all(
          createFlightTools().map((tool) =>
            modelContext.registerTool(tool, { signal: controller.signal }),
          ),
        )
        if (!controller.signal.aborted) setStatus('ready')
      } catch (error) {
        if (!controller.signal.aborted) {
          controller.abort()
          setStatus('error')
          console.error('WebMCP registration failed', error)
        }
      }
    }

    void registerTools()
    return () => controller.abort()
  }, [])

  return status
}
