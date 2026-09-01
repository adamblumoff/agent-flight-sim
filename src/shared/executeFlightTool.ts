import { flightSimulator } from '../sim/flightSimulator.ts'
import type { FlightControlInput } from '../sim/flightCommands.ts'
import type { ActiveLegRebuildStrategy, CheckrideSeed, EvidenceSource, FlightState, RoutePlan } from '../sim/types.ts'
import {
  checkrideSeeds, evidenceSources, flightEventValues, routePlans,
  type AgentFlightState, type FlightToolArguments, type FlightToolGuidance, type FlightToolName, type FlightToolResults,
  type FlightTelemetrySample, type ToolReceiptTone,
} from './flightTools.ts'

type UnknownInput = Readonly<Record<string, unknown>>
const evidenceSet = new Set<string>(evidenceSources)
const routeSet = new Set<string>(routePlans)
const eventSet = new Set<string>(flightEventValues)
const rebuildStrategySet = new Set<string>(['direct_intercept', 'wider_pattern', 'skip_noncritical'])

const reasonInput = (input: UnknownInput, fallback = 'Requested by the agent') => typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : fallback
const agentState = (state: FlightState): AgentFlightState => {
  const { seed: _privateSeed, ...checkride } = state.checkride
  return { ...state, checkride }
}

const observationActions = ['get_flight_state', 'inspect_flight_evidence', 'wait_for_flight_event'] as const satisfies readonly FlightToolName[]

const hazardsFor = (state: FlightState): readonly string[] => {
  const hazards: string[] = []
  if (state.checkride.alert) hazards.push(state.checkride.alert)
  if (state.motion.stalled) hazards.push('Aerodynamic stall detected.')
  if (state.mission.routeStatus === 'stalled') hazards.push('The active route leg is no longer converging.')
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
  actions.push('fly_control_window', 'set_flight_controls', 'transfer_control', 'request_human_approval')
  if (state.mission.phase === 'preflight') actions.push('get_mission_brief', 'set_route')
  if (state.checkride.status === 'decision_required') {
    actions.push('get_decision_context')
    if (state.checkride.decisionContextRead && state.atc.status === 'none') actions.push('request_diversion')
    if (state.atc.status === 'cleared') actions.push('accept_clearance')
  }
  if (state.mission.routeStatus === 'stalled') actions.push('rebuild_active_leg')
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
  if (state.mission.routeStatus === 'stalled') return 'Stabilize the aircraft and recover progress toward the active route leg.'
  return 'Fly the active route, manage aircraft configuration, and land safely within the published limits.'
}

const guidanceFor = (state = flightSimulator.getState()): FlightToolGuidance => ({
  phase: state.mission.phase,
  objective: objectiveFor(state),
  procedure: state.procedure,
  hazards: hazardsFor(state),
  availableActions: availableActionsFor(state),
  eventRevision: state.mission.eventRevision,
  decisionSecondsRemaining: state.checkride.decisionSecondsRemaining,
})

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

const flightControlInput = (input: FlightControlInput): FlightControlInput => {
  const controlKeys = ['throttle', 'pitchIntent', 'bankIntent', 'gearDown', 'flapsDeg'] as const
  if (!controlKeys.some((key) => input[key] !== undefined)) throw new TypeError('set_flight_controls requires at least one control value')
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
  closingRateKt: state.mission.closingRateKt,
  routeStatus: state.mission.routeStatus,
  procedureCompliant: state.procedure.compliant,
  loadFactorG: state.passengerSafety.loadFactorG,
  jerkGPerSecond: state.passengerSafety.jerkGPerSecond,
  eventRevision: state.mission.eventRevision,
  outcome: state.mission.outcome,
})

const flyControlWindow = async (input: FlightToolArguments['fly_control_window']): Promise<FlightToolResults['fly_control_window']> => {
  const durationMs = boundedWindowNumber(input.duration_ms, 'duration_ms', 1_000, 250, 3_000)
  const sampleIntervalMs = boundedWindowNumber(input.sample_interval_ms, 'sample_interval_ms', 250, 100, 500)
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
      requestedDurationMs: durationMs,
      actualDurationMs: 0,
      sampleIntervalMs,
      stopReason: 'command_rejected',
      samples: Object.freeze(samples),
    }
  }

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
    const capture = () => {
      const state = flightSimulator.getState()
      const previous = samples.at(-1)
      if (!previous || state.elapsedSeconds !== previous.elapsedSeconds || state.mission.eventRevision !== previous.eventRevision) samples.push(telemetrySample(state))
      if (state.controlOwner !== 'agent') finish('control_transferred')
      else if (state.mission.outcome !== 'in_progress') finish('terminal_state')
      else if (state.mission.eventRevision !== startRevision) finish('flight_event')
    }
    const unsubscribe = flightSimulator.subscribe(capture)
    const interval = setInterval(capture, sampleIntervalMs)
    const timeout = setTimeout(() => finish('window_complete'), durationMs)
  })

  flightSimulator.setFlightControls({ pitchIntent: 0, bankIntent: 0, reason: 'Finite control window complete; stick neutralized' }, 'agent')
  const finalState = flightSimulator.getState()
  const finalSample = telemetrySample(finalState)
  if (samples.at(-1)?.elapsedSeconds !== finalSample.elapsedSeconds || samples.at(-1)?.pitchIntent !== 0 || samples.at(-1)?.bankIntent !== 0) samples.push(finalSample)
  const accepted = finalState.controlOwner === 'agent'
  return {
    accepted,
    ok: accepted,
    summary: `${command.summary} Observed ${samples.length} telemetry samples; stick neutralized after ${Date.now() - startedAt} ms (${stopReason.replaceAll('_', ' ')}).`,
    eventRevision: finalState.mission.eventRevision,
    state: agentState(finalState),
    tone: finalState.mission.outcome === 'in_progress' ? 'automation' : 'warning',
    guidance: guidanceFor(finalState),
    requestedDurationMs: durationMs,
    actualDurationMs: Date.now() - startedAt,
    sampleIntervalMs,
    stopReason,
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
  inspect_flight_evidence: async (input) => {
    if (input.source !== undefined && !evidenceSet.has(input.source)) throw new TypeError('source must be weather, cockpit, traffic, or passenger')
    const evidence = input.source === undefined
      ? evidenceSources.map((source) => flightSimulator.inspectEvidence(source))
      : flightSimulator.inspectEvidence(input.source as EvidenceSource)
    return receipt(input.source ? `${input.source} report read` : 'All evidence read', 'neutral', { evidence, inspectedSources: flightSimulator.getState().checkride.inspectedSources })
  },
  set_route: async (input) => {
    if (!routeSet.has(input.plan)) throw new TypeError('plan must be continue_kmdw or return_kstl')
    if (typeof input.reason !== 'string' || !input.reason.trim()) throw new TypeError('reason is required')
    return action(flightSimulator.setRoute(input.plan as RoutePlan, input.reason.trim(), 'agent'))
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
  set_flight_controls: async (input) => action(flightSimulator.setFlightControls(flightControlInput(input), 'agent')),
  fly_control_window: flyControlWindow,
  rebuild_active_leg: async (input) => {
    if (!rebuildStrategySet.has(input.strategy)) throw new TypeError('strategy must be direct_intercept, wider_pattern, or skip_noncritical')
    if (typeof input.reason !== 'string' || !input.reason.trim()) throw new TypeError('reason is required')
    return action(flightSimulator.rebuildActiveLeg(input.strategy as ActiveLegRebuildStrategy, input.reason.trim(), 'agent'))
  },
  request_human_approval: async (input) => {
    if (![input.question, input.requested_action, input.reason].every((value) => typeof value === 'string' && value.trim())) throw new TypeError('question, requested_action, and reason are required')
    return action(flightSimulator.requestHumanApproval(input.question.trim(), input.requested_action.trim(), input.reason.trim(), 'agent'))
  },
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
