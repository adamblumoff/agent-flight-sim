import { COMFORT_BANK_WARNING_DEG, flightSimulator } from '../sim/flightSimulator.ts'
import type { FlightControlInput } from '../sim/flightCommands.ts'
import type { AircraftPhase, CheckrideSeed, FlightCommandStep, FlightEventType, FlightPlanProgram, FlightState, RoutePlan } from '../sim/types.ts'
import {
  checkrideSeeds, flightEventValues, routePlans,
  type AgentFlightState, type FlightToolArguments, type FlightToolGuidance, type FlightToolName, type FlightToolResults,
  type FlightTelemetrySample, type ToolReceiptTone,
} from './flightTools.ts'

type UnknownInput = Readonly<Record<string, unknown>>
const routeSet = new Set<string>(routePlans)
const eventSet = new Set<string>(flightEventValues)
const controlWindowInterruptEvents = new Set<FlightEventType>([
  'emergency_detected', 'decision_timer_expired', 'atc_clearance_received',
  'route_progress_stalled', 'checkpoint_reached', 'stall_warning',
  'go_around_required', 'approach_stable', 'touchdown',
  'mission_complete', 'mission_failed',
])

const reasonInput = (input: UnknownInput, fallback = 'Requested by the agent') => typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : fallback
const agentState = (state: FlightState): AgentFlightState => {
  const { seed: _privateSeed, ...checkride } = state.checkride
  return { ...state, checkride }
}

const observationActions = ['get_flight_state', 'wait_for_flight_event'] as const satisfies readonly FlightToolName[]

const hazardsFor = (state: FlightState): readonly string[] => {
  const hazards: string[] = []
  if (state.checkride.alert) hazards.push(state.checkride.alert)
  if (state.motion.stalled) hazards.push('Aerodynamic stall detected. Lower the nose, use at least 85% power, keep gear up and flaps at 10° or less, and roll toward wings level.')
  if (state.aircraftPhase === 'airborne' && Math.abs(state.pitchDeg) >= 12) hazards.push(`Pitch is ${state.pitchDeg.toFixed(1)}°. Use level_attitude before commanding more ${state.pitchDeg > 0 ? 'nose-up' : 'nose-down'} input.`)
  if (state.aircraftPhase === 'airborne' && (state.mission.airspeedErrorToNextFixKt ?? 0) > 30) hazards.push(`Low energy: airspeed is ${state.mission.airspeedErrorToNextFixKt!.toFixed(0)} kt below the active target. Increase throttle toward 1.00 and avoid climbing until speed recovers.`)
  if (Math.abs(state.bankDeg) >= COMFORT_BANK_WARNING_DEG) hazards.push(`Bank is ${state.bankDeg.toFixed(1)}°. Do not deepen this turn; command bankIntent with the opposite sign to roll toward wings level.`)
  if (state.mission.routeStatus === 'stalled') hazards.push('The active route leg is no longer converging.')
  if (state.mission.goAroundRequired) hazards.push('The approach is unsafe. Reprogram immediately with restart_route true. Lead with an exact pitch of at least 5°, throttle of at least 0.85, gear up, and no more than 10° flaps; use altitude hold only after the climb is established.')
  if (!state.procedure.compliant) hazards.push(state.procedure.instruction)
  if (state.passengerSafety.status !== 'comfortable') hazards.push(state.passengerSafety.summary)
  if (state.fuelMinutesRemaining <= 3) hazards.push(`${state.fuelMinutesRemaining.toFixed(1)} minutes of fuel endurance remain.`)
  if (state.checkride.decisionSecondsRemaining !== null) hazards.push(`${Math.ceil(state.checkride.decisionSecondsRemaining)} seconds remain for the active decision.`)
  return Object.freeze([...new Set(hazards)])
}

const availableActionsFor = (state: FlightState): readonly FlightToolName[] => {
  if (state.mission.outcome !== 'in_progress') return ['get_flight_state']
  const actions: FlightToolName[] = [...observationActions]
  if (state.controlOwner === 'human') {
    if (state.handoffRequested) actions.push('transfer_control')
    return Object.freeze(actions)
  }
  if (state.checkride.status === 'decision_required') {
    if (!state.checkride.decisionContextRead) actions.push('get_decision_context')
    else if (state.atc.status === 'none') actions.push('request_diversion')
    else if (state.atc.status === 'cleared') actions.push('accept_clearance')
    else if (state.atc.status === 'accepted') actions.push('program_flight_plan')
    return Object.freeze(actions)
  }
  actions.push('transfer_control')
  if (!state.autopilot.engaged && state.motion.stalled) actions.push('fly_control_window', 'level_attitude', 'program_flight_plan')
  if (state.mission.goAroundRequired) actions.push('program_flight_plan')
  if (state.mission.phase === 'preflight') actions.push('get_mission_brief', 'program_flight_plan')
  return Object.freeze(actions)
}

const objectiveFor = (state: FlightState) => {
  if (state.mission.outcome !== 'in_progress') return 'Review the completed flight and its debrief.'
  if (state.controlOwner === 'human') return state.handoffRequested
    ? 'A handoff is available; control remains with the pilot until it is accepted.'
    : 'Monitor the flight until the pilot requests a handoff.'
  if (state.mission.phase === 'preflight') return state.route.plan === 'unassigned'
    ? 'Review the assignment, file the preflight route, and prepare the aircraft for departure.'
    : 'Conduct a safe departure on the filed route.'
  if (state.checkride.status === 'decision_required') return 'Maintain control while assessing the new condition and coordinating any route change with ATC.'
  if (state.motion.stalled) return 'Recover the stall now with high power, nose-down input, clean configuration, and wings-level bank correction.'
  if (state.mission.routeStatus === 'stalled') return 'Stabilize the aircraft and recover progress toward the active route leg.'
  if (state.mission.goAroundRequired) return 'Replace the command program now with exact go-around commands that climb away from the ground before rejoining the published arrival.'
  return 'Fly the active route, manage aircraft configuration, and land safely within the published limits.'
}

const controlCueFor = (state: FlightState) => {
  if (state.controlOwner !== 'agent' || state.mission.outcome !== 'in_progress' || !state.mission.nextFix) return null
  if (state.motion.stalled) return 'STALL: use throttle 0.85 or higher, negative pitchIntent, gear up, flaps 0° or 10°, and bankIntent toward wings level.'
  if (state.mission.goAroundRequired) return 'GO AROUND: replace the return_kstl program with restart_route true. The immediate command must use positive pitch and high throttle with gear up and no more than 10° flaps before altitude hold.'
  if (state.autopilot.engaged && state.autopilot.program && state.autopilot.activeCommandIndex !== null) {
    const command = state.autopilot.program.commands[state.autopilot.activeCommandIndex]
    return command ? `Command ${command.id} is active and will persist until its next declared trigger.` : null
  }
  return 'The autopilot is disengaged. Use manual controls only to recover, then submit the complete flight plan again.'
}

const guidanceFor = (state = flightSimulator.getState()): FlightToolGuidance => {
  const missionWallSecondsRemaining = state.checkride.wallClockSecondsRemaining ?? state.checkride.wallClockDeadlineSeconds
  return {
    phase: state.mission.phase,
    objective: objectiveFor(state),
    controlCue: controlCueFor(state),
    procedure: state.procedure,
    hazards: hazardsFor(state),
    availableActions: availableActionsFor(state),
    eventRevision: state.mission.eventRevision,
    decisionSecondsRemaining: state.checkride.decisionSecondsRemaining,
    missionWallSecondsRemaining,
  }
}

const receipt = <T>(summary: string, tone: ToolReceiptTone, details: T, guidance = guidanceFor()) => ({ ok: true as const, summary, tone, guidance, details })
const action = (result: ReturnType<typeof flightSimulator.setRoute>) => ({
  ...result,
  state: agentState(result.state),
  ok: result.accepted,
  tone: result.accepted ? 'automation' as const : 'warning' as const,
  guidance: guidanceFor(result.state),
})

const randomScenarioSeed = (): CheckrideSeed => {
  const randomIndex = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
    ? crypto.getRandomValues(new Uint32Array(1))[0] % checkrideSeeds.length
    : Math.floor(Math.random() * checkrideSeeds.length)
  return checkrideSeeds[randomIndex]
}

const boundedTimeout = (value: unknown) => {
  if (value === undefined) return 15_000
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('timeout_ms must be a finite number')
  return Math.min(15_000, Math.max(1_000, Math.floor(value)))
}

const boundedWindowNumber = (value: unknown, name: string, fallback: number, minimum: number, maximum: number) => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`)
  if (value < minimum || value > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}`)
  return Math.floor(value)
}

const requiredProgramNumber = (value: unknown, name: string, minimum: number, maximum: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`)
  if (value < minimum || value > maximum) throw new RangeError(`${name} must be between ${minimum} and ${maximum}`)
  return value
}

const requiredProgramString = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`)
  return value.trim()
}

const flightPlanProgram = (input: FlightToolArguments['program_flight_plan']): FlightPlanProgram => {
  if (!routeSet.has(input.plan)) throw new TypeError('plan must be continue_kmdw or return_kstl')
  if (input.restart_route !== undefined && typeof input.restart_route !== 'boolean') throw new TypeError('restart_route must be a boolean')
  if (!Array.isArray(input.commands) || input.commands.length < 2 || input.commands.length > 16) throw new RangeError('commands must contain 2 to 16 entries')
  const aircraftPhases = new Set<AircraftPhase>(['takeoff_roll', 'airborne', 'landing_roll', 'stopped', 'crash_slide'])
  const commands = input.commands.map((raw, index): FlightCommandStep => {
    const prefix = `commands[${index}]`
    const id = requiredProgramString(raw.id, `${prefix}.id`)
    let when: FlightCommandStep['when']
    if (raw.when.type === 'immediate') when = Object.freeze({ type: 'immediate' })
    else if (raw.when.type === 'airspeed_at_least') when = Object.freeze({ type: raw.when.type, value: requiredProgramNumber(raw.when.value, `${prefix}.when.value`, 120, 260) })
    else if (raw.when.type === 'altitude_at_least') when = Object.freeze({ type: raw.when.type, value: requiredProgramNumber(raw.when.value, `${prefix}.when.value`, 585, 6_000) })
    else if (raw.when.type === 'distance_to_runway_at_most') when = Object.freeze({ type: raw.when.type, value: requiredProgramNumber(raw.when.value, `${prefix}.when.value`, 0, 100) })
    else if (raw.when.type === 'active_waypoint') when = Object.freeze({ type: raw.when.type, value: requiredProgramString(raw.when.value, `${prefix}.when.value`) })
    else if (raw.when.type === 'aircraft_phase' && typeof raw.when.value === 'string' && aircraftPhases.has(raw.when.value as AircraftPhase)) when = Object.freeze({ type: raw.when.type, value: raw.when.value as AircraftPhase })
    else throw new TypeError(`${prefix}.when is invalid`)

    let lateral: FlightCommandStep['lateral']
    if (raw.lateral.mode === 'heading') lateral = Object.freeze({ mode: 'heading', headingDeg: requiredProgramNumber(raw.lateral.heading_deg, `${prefix}.lateral.heading_deg`, 0, 359.999) })
    else if (raw.lateral.mode === 'track_fix') lateral = Object.freeze({ mode: 'track_fix', waypointId: requiredProgramString(raw.lateral.waypoint_id, `${prefix}.lateral.waypoint_id`) })
    else if (raw.lateral.mode === 'bank') lateral = Object.freeze({ mode: 'bank', bankDeg: requiredProgramNumber(raw.lateral.bank_deg, `${prefix}.lateral.bank_deg`, -25, 25) })
    else throw new TypeError(`${prefix}.lateral.mode is invalid`)

    let vertical: FlightCommandStep['vertical']
    if (raw.vertical.mode === 'pitch') vertical = Object.freeze({ mode: 'pitch', pitchDeg: requiredProgramNumber(raw.vertical.pitch_deg, `${prefix}.vertical.pitch_deg`, -10, 15) })
    else if (raw.vertical.mode === 'altitude') vertical = Object.freeze({ mode: 'altitude', altitudeFt: requiredProgramNumber(raw.vertical.altitude_ft, `${prefix}.vertical.altitude_ft`, 585, 6_000) })
    else throw new TypeError(`${prefix}.vertical.mode is invalid`)

    let energy: FlightCommandStep['energy']
    if (raw.energy.mode === 'throttle') energy = Object.freeze({ mode: 'throttle', throttle: requiredProgramNumber(raw.energy.throttle, `${prefix}.energy.throttle`, 0, 1) })
    else if (raw.energy.mode === 'airspeed') energy = Object.freeze({ mode: 'airspeed', airspeedKt: requiredProgramNumber(raw.energy.airspeed_kt, `${prefix}.energy.airspeed_kt`, 120, 260) })
    else throw new TypeError(`${prefix}.energy.mode is invalid`)
    if (typeof raw.gear_down !== 'boolean') throw new TypeError(`${prefix}.gear_down must be a boolean`)
    if (![0, 10, 20, 30].includes(raw.flaps_deg)) throw new RangeError(`${prefix}.flaps_deg must be 0, 10, 20, or 30`)
    return Object.freeze({ id, when, lateral, vertical, energy, gearDown: raw.gear_down, flapsDeg: raw.flaps_deg })
  })
  return Object.freeze({
    plan: input.plan,
    commands: Object.freeze(commands),
    restartRoute: input.restart_route ?? false,
  })
}

const flightControlInput = (input: FlightControlInput): FlightControlInput => {
  const controlKeys = ['throttle', 'pitchIntent', 'bankIntent', 'gearDown', 'flapsDeg'] as const
  if (!controlKeys.some((key) => input[key] !== undefined)) throw new TypeError('A control window requires at least one control value')
  for (const key of ['throttle', 'pitchIntent', 'bankIntent'] as const) {
    const value = input[key]
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) throw new TypeError(`${key} must be a finite number`)
  }
  if (input.throttle !== undefined && (input.throttle < 0 || input.throttle > 1)) throw new RangeError('throttle must be between 0 and 1')
  if (input.pitchIntent !== undefined && (input.pitchIntent < -1 || input.pitchIntent > 1)) throw new RangeError('pitchIntent must be between -1 and 1')
  if (input.bankIntent !== undefined && (input.bankIntent < -1 || input.bankIntent > 1)) throw new RangeError('bankIntent must be between -1 and 1')
  if (input.gearDown !== undefined && typeof input.gearDown !== 'boolean') throw new TypeError('gearDown must be a boolean')
  if (input.flapsDeg !== undefined && !([0, 10, 20, 30] as const).includes(input.flapsDeg)) throw new RangeError('flapsDeg must be 0, 10, 20, or 30')
  if (input.reason !== undefined && (typeof input.reason !== 'string' || !input.reason.trim())) throw new TypeError('reason must be a non-empty string')
  return input
}

const telemetrySample = (state: FlightState): FlightTelemetrySample => Object.freeze({
  elapsedSeconds: state.elapsedSeconds,
  airspeedKt: state.airspeedKt,
  altitudeFt: state.altitudeFt,
  verticalSpeedFpm: state.verticalSpeedFpm,
  headingDeg: state.headingDeg,
  pitchDeg: state.pitchDeg,
  bankDeg: state.bankDeg,
  throttle: state.throttle,
  pitchIntent: state.controlInputs.pitchAxis,
  bankIntent: state.controlInputs.bankAxis,
  groundSpeedKt: state.motion.groundSpeedKt,
  angleOfAttackDeg: state.motion.angleOfAttackDeg,
  stalled: state.motion.stalled,
  nextFix: state.mission.nextFix,
  distanceToNextFixNm: state.mission.distanceToNextFixNm,
  bearingToNextFixDeg: state.mission.bearingToNextFixDeg,
  headingErrorToNextFixDeg: state.mission.headingErrorToNextFixDeg,
  altitudeErrorToNextFixFt: state.mission.altitudeErrorToNextFixFt,
  airspeedErrorToNextFixKt: state.mission.airspeedErrorToNextFixKt,
  closingRateKt: state.mission.closingRateKt,
  routeStatus: state.mission.routeStatus,
  procedureCompliant: state.procedure.compliant,
  loadFactorG: state.passengerSafety.loadFactorG,
  jerkGPerSecond: state.passengerSafety.jerkGPerSecond,
  eventRevision: state.mission.eventRevision,
  outcome: state.mission.outcome,
})

const flyControlWindow = async (input: FlightToolArguments['fly_control_window']): Promise<FlightToolResults['fly_control_window']> => {
  const stateBeforeWindow = flightSimulator.getState()
  const maneuvering = Math.abs(input.pitchIntent) > 0.05 || Math.abs(input.bankIntent) > 0.05
  const aggressivePitch = Math.abs(input.pitchIntent) >= 0.3
  const maxDurationMs = stateBeforeWindow.aircraftPhase !== 'airborne'
    ? 6_000
    : aggressivePitch
      ? 5_000
      : maneuvering
        ? 10_000
        : 30_000
  const requestedDurationMs = boundedWindowNumber(input.duration_ms, 'duration_ms', 3_000, 250, 30_000)
  const durationMs = Math.min(requestedDurationMs, maxDurationMs)
  const sampleIntervalMs = boundedWindowNumber(input.sample_interval_ms, 'sample_interval_ms', 250, 100, 500)
  const currentState = stateBeforeWindow
  if (currentState.checkride.status === 'decision_required') {
    const requiredAction = !currentState.checkride.decisionContextRead
      ? 'get_decision_context'
      : currentState.atc.status === 'none'
        ? 'request_diversion'
        : currentState.atc.status === 'cleared'
          ? 'accept_clearance'
          : 'wait_for_flight_event'
    return {
      accepted: false,
      ok: false,
      summary: `Emergency checklist active. Call ${requiredAction} before another control window.`,
      eventRevision: currentState.mission.eventRevision,
      state: agentState(currentState),
      tone: 'warning',
      guidance: guidanceFor(currentState),
      requestedDurationMs,
      actualDurationMs: 0,
      sampleIntervalMs,
      stopReason: 'command_rejected',
      interruptedBy: null,
      samples: Object.freeze([telemetrySample(currentState)]),
    }
  }
  const controls = flightControlInput({
    throttle: input.throttle,
    pitchIntent: input.pitchIntent,
    bankIntent: input.bankIntent,
    gearDown: input.gearDown,
    flapsDeg: input.flapsDeg,
    reason: input.reason,
  })
  const command = flightSimulator.setFlightControls(controls, 'agent')
  const startedAt = Date.now()
  const startRevision = command.state.mission.eventRevision
  const samples: FlightTelemetrySample[] = [telemetrySample(command.state)]

  if (!command.accepted) {
    return {
      ...action(command),
      requestedDurationMs,
      actualDurationMs: 0,
      sampleIntervalMs,
      stopReason: 'command_rejected',
      interruptedBy: null,
      samples: Object.freeze(samples),
    }
  }

  let interruptedBy: FlightEventType | null = null
  const stopReason = await new Promise<FlightToolResults['fly_control_window']['stopReason']>((resolve) => {
    let settled = false
    const finish = (reason: FlightToolResults['fly_control_window']['stopReason']) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearInterval(interval)
      unsubscribe()
      resolve(reason)
    }
    const capture = (recordSample = false) => {
      const state = flightSimulator.getState()
      const previous = samples.at(-1)
      if (!previous || recordSample || state.mission.eventRevision !== previous.eventRevision) samples.push(telemetrySample(state))
      if (state.controlOwner !== 'agent') finish('control_transferred')
      else if (state.mission.outcome !== 'in_progress') finish('terminal_state')
      else if (state.mission.eventRevision !== startRevision) {
        const interruptingEvent = flightSimulator.getEventsSince(startRevision).find((event) => controlWindowInterruptEvents.has(event.type))
        if (interruptingEvent) {
          interruptedBy = interruptingEvent.type
          finish('flight_event')
        }
      }
    }
    const unsubscribe = flightSimulator.subscribe(() => capture())
    const interval = setInterval(() => capture(true), sampleIntervalMs)
    const timeout = setTimeout(() => finish('window_complete'), durationMs)
  })

  flightSimulator.setFlightControls({ pitchIntent: 0, bankIntent: 0, reason: 'Finite control window complete; stick neutralized' }, 'system')
  const finalState = flightSimulator.getState()
  const finalSample = telemetrySample(finalState)
  if (samples.at(-1)?.elapsedSeconds !== finalSample.elapsedSeconds || samples.at(-1)?.pitchIntent !== 0 || samples.at(-1)?.bankIntent !== 0) samples.push(finalSample)
  const accepted = finalState.controlOwner === 'agent'
  return {
    accepted,
    ok: accepted,
    summary: `${command.summary}${requestedDurationMs > durationMs ? ` ${stateBeforeWindow.aircraftPhase === 'airborne' ? 'Maneuvering' : 'Ground'} window safely capped at ${durationMs} ms.` : ''} Observed ${samples.length} telemetry samples; stick neutralized after ${Date.now() - startedAt} ms (${interruptedBy ?? stopReason.replaceAll('_', ' ')}).`,
    eventRevision: finalState.mission.eventRevision,
    state: agentState(finalState),
    tone: finalState.mission.outcome === 'in_progress' ? 'automation' : 'warning',
    guidance: guidanceFor(finalState),
    requestedDurationMs,
    actualDurationMs: Date.now() - startedAt,
    sampleIntervalMs,
    stopReason,
    interruptedBy,
    samples: Object.freeze(samples),
  }
}

const executors: { readonly [Name in FlightToolName]: (input: FlightToolArguments[Name]) => Promise<FlightToolResults[Name]> } = {
  start_flight: async (input) => {
    if (Object.keys(input).length > 0) throw new TypeError('start_flight takes no arguments; the scenario is selected by the environment')
    flightSimulator.reset(randomScenarioSeed())
    flightSimulator.transferControl('agent', 'agent', 'Agent started the assigned flight')
    const state = flightSimulator.getState()
    return receipt('Flight is ready at St. Louis Lambert. Review the assignment before moving.', 'automation', { runId: state.checkride.runId, state: agentState(state) }, guidanceFor(state))
  },
  get_mission_brief: async () => {
    return receipt('Assigned mission brief read.', 'neutral', { brief: flightSimulator.getMissionBrief() })
  },
  get_flight_state: async () => receipt('Live flight state read', 'neutral', {
    state: agentState(flightSimulator.getState()),
    units: { altitude: 'feet MSL', airspeed: 'knots', verticalSpeed: 'feet per minute', angles: 'degrees', distance: 'nautical miles', fuelEndurance: 'minutes' },
  }),
  get_decision_context: async () => flightSimulator.getState().checkride.status === 'decision_required'
    ? receipt('New flight condition assessed.', 'neutral', { available: true, context: flightSimulator.getDecisionContext() })
    : receipt('Decision context is sealed until emergency_detected. Continue the assigned flight.', 'warning', { available: false, context: null }),
  program_flight_plan: async (input) => {
    if (typeof input.reason !== 'string' || !input.reason.trim()) throw new TypeError('reason is required')
    return action(flightSimulator.programFlightPlan(flightPlanProgram(input), input.reason.trim(), 'agent'))
  },
  request_diversion: async (input) => {
    if (!routeSet.has(input.plan)) throw new TypeError('plan must be continue_kmdw or return_kstl')
    if (typeof input.reason !== 'string' || !input.reason.trim()) throw new TypeError('reason is required')
    return action(flightSimulator.requestDiversion(input.plan as Exclude<RoutePlan, 'unassigned'>, input.reason.trim(), 'agent'))
  },
  accept_clearance: async (input) => {
    if (typeof input.clearance_id !== 'string' || !input.clearance_id.trim()) throw new TypeError('clearance_id is required')
    if (typeof input.readback !== 'string' || !input.readback.trim()) throw new TypeError('readback is required')
    return action(flightSimulator.acceptAtcClearance(input.clearance_id.trim(), input.readback.trim(), 'agent'))
  },
  level_attitude: async (input) => action(flightSimulator.levelPilotAttitude('agent', reasonInput(input, 'Agent selected wings level'))),
  fly_control_window: flyControlWindow,
  wait_for_flight_event: async (input) => {
    if (input.after_revision !== undefined && (typeof input.after_revision !== 'number' || !Number.isFinite(input.after_revision))) throw new TypeError('after_revision must be a finite number')
    if (input.events !== undefined && (!Array.isArray(input.events) || input.events.length === 0 || input.events.some((event) => !eventSet.has(event)))) throw new TypeError('events contains an unsupported flight event')
    const result = await flightSimulator.waitForFlightEvent({ afterRevision: input.after_revision ?? flightSimulator.getEventRevision(), events: input.events ?? flightEventValues, timeoutMs: boundedTimeout(input.timeout_ms) })
    return {
      ...result,
      state: agentState(result.state),
      ok: true,
      summary: result.event === 'timeout' ? 'No new flight event' : result.message,
      tone: result.event === 'timeout' ? 'neutral' : 'automation',
      guidance: guidanceFor(result.state),
    }
  },
  transfer_control: async (input) => {
    if (input.owner !== 'human' && input.owner !== 'agent') throw new TypeError('owner must be human or agent')
    const current = flightSimulator.getState()
    if (input.owner === 'agent' && current.controlOwner === 'human' && !current.handoffRequested) throw new Error('The pilot has not requested a copilot handoff.')
    flightSimulator.transferControl(input.owner, 'agent', reasonInput(input))
    const state = flightSimulator.getState()
    return receipt(state.controlOwner === 'agent' ? 'Agent has control' : 'Pilot has control', state.controlOwner === 'agent' ? 'automation' : 'success', { controlOwner: state.controlOwner, state: agentState(state) })
  },
}

export function executeFlightTool<Name extends FlightToolName>(name: Name, input: FlightToolArguments[Name]): Promise<FlightToolResults[Name]> { return executors[name](input) }
export function executeFlightToolFromUnknown(name: FlightToolName, input: unknown): Promise<FlightToolResults[FlightToolName]> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError(`${name} input must be an object`)
  return executors[name](input as never)
}
