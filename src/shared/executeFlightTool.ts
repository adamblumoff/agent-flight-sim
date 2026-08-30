import { flightSimulator } from '../sim/flightSimulator.ts'
import type { ActiveLegRebuildStrategy, CheckrideSeed, EvidenceSource, FlightState, RoutePlan } from '../sim/types.ts'
import {
  checkrideSeeds, evidenceSources, flightEventValues, routePlans,
  type AgentFlightState, type FlightToolArguments, type FlightToolGuidance, type FlightToolName, type FlightToolResults,
  type ToolReceiptTone,
} from './flightTools.ts'

type UnknownInput = Readonly<Record<string, unknown>>
const evidenceSet = new Set<string>(evidenceSources)
const routeSet = new Set<string>(routePlans)
const eventSet = new Set<string>(flightEventValues)
const rebuildStrategySet = new Set<string>(['direct_intercept', 'wider_pattern', 'skip_noncritical'])
let missionBriefRead = false

const reasonInput = (input: UnknownInput, fallback = 'Requested by the copilot') => typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : fallback
const agentState = (state: FlightState): AgentFlightState => {
  const { seed: _privateSeed, ...checkride } = state.checkride
  return { ...state, checkride }
}

const next = (
  state: FlightState,
  requiredAction: string,
  recommendedNextTool: FlightToolName | null,
  recommendedArguments: Readonly<Record<string, unknown>> | null,
  allowedNextTools: readonly FlightToolName[],
): FlightToolGuidance => ({
  phase: state.mission.phase,
  requiredAction,
  recommendedNextTool,
  recommendedArguments,
  allowedNextTools,
  procedure: state.procedure,
  eventRevision: state.mission.eventRevision,
  decisionSecondsRemaining: state.checkride.decisionSecondsRemaining,
})

const guidanceFor = (state = flightSimulator.getState()): FlightToolGuidance => {
  if (state.mission.outcome !== 'in_progress') return next(state, 'review_debrief', null, null, ['get_flight_state'])
  if (state.controlOwner === 'human') {
    return state.handoffRequested
      ? next(state, 'accept_requested_handoff', 'transfer_control', { owner: 'agent', reason: 'Accept the pilot handoff request.' }, ['get_flight_state', 'transfer_control', 'wait_for_flight_event'])
      : next(state, 'wait_for_pilot_handoff', 'wait_for_flight_event', { after_revision: state.mission.eventRevision, events: ['handoff_requested', 'mission_complete', 'mission_failed'], timeout_ms: 15_000 }, ['get_flight_state', 'wait_for_flight_event'])
  }
  if (state.approval.status === 'pending') {
    return next(state, 'wait_for_pilot_approval', 'wait_for_flight_event', { after_revision: state.mission.eventRevision, events: ['approval_resolved'], timeout_ms: 15_000 }, ['get_flight_state', 'wait_for_flight_event'])
  }
  if (state.mission.phase === 'preflight') {
    if (state.route.plan === 'unassigned') {
      return missionBriefRead
        ? next(state, 'file_assigned_preflight_route', 'set_route', { plan: 'continue_klak', reason: 'File the assigned preflight route from the mission brief.' }, ['get_mission_brief', 'get_flight_state', 'set_route'])
        : next(state, 'read_assigned_mission', 'get_mission_brief', {}, ['get_mission_brief', 'get_flight_state'])
    }
    return next(state, 'begin_takeoff', 'begin_takeoff', { reason: 'The assigned route is filed and the takeoff configuration is compliant.' }, ['get_mission_brief', 'get_flight_state', 'begin_takeoff'])
  }
  if (state.checkride.status === 'decision_required') {
    if (!state.checkride.decisionContextRead) {
      return next(state, 'assess_new_flight_condition', 'get_decision_context', {}, ['get_flight_state', 'get_decision_context', 'inspect_flight_evidence', 'wait_for_flight_event'])
    }
    return next(state, 'select_route_from_decision_context', 'set_route', null, ['get_flight_state', 'get_decision_context', 'inspect_flight_evidence', 'set_route'])
  }
  if (state.mission.routeStatus === 'stalled') {
    return next(state, 'recover_active_route_leg', 'rebuild_active_leg', null, ['get_flight_state', 'rebuild_active_leg', 'wait_for_flight_event'])
  }
  if (!state.procedure.compliant) {
    return next(state, 'apply_required_aircraft_configuration', 'configure_aircraft', { gearDown: state.procedure.gearDown, flapsDeg: state.procedure.flapsDeg, reason: state.procedure.instruction }, ['get_flight_state', 'configure_aircraft', 'wait_for_flight_event'])
  }
  return next(state, 'continue_flight_and_wait_for_change', 'wait_for_flight_event', { after_revision: state.mission.eventRevision, timeout_ms: 15_000 }, ['get_flight_state', 'set_autopilot_targets', 'wait_for_flight_event'])
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

const executors: { readonly [Name in FlightToolName]: (input: FlightToolArguments[Name]) => Promise<FlightToolResults[Name]> } = {
  start_flight: async (input) => {
    if (Object.keys(input).length > 0) throw new TypeError('start_flight takes no arguments; mode and scenario are selected by the environment')
    const mode = flightSimulator.getState().mode
    flightSimulator.reset(randomScenarioSeed(), mode)
    flightSimulator.transferControl('agent', 'agent', 'Copilot started the assigned flight')
    missionBriefRead = false
    const state = flightSimulator.getState()
    return receipt(`${mode === 'judge' ? 'Judge' : 'Full'} flight is ready on North Field runway 18. Read the assigned mission before moving.`, 'automation', { runId: state.checkride.runId, mode, state: agentState(state) }, guidanceFor(state))
  },
  get_mission_brief: async () => {
    missionBriefRead = true
    return receipt('Assigned mission brief read. File brief.assignedRoute before takeoff.', 'neutral', { brief: flightSimulator.getMissionBrief() })
  },
  get_flight_state: async () => receipt('Live flight state read', 'neutral', {
    state: agentState(flightSimulator.getState()),
    units: { altitude: 'feet MSL', airspeed: 'knots', verticalSpeed: 'feet per minute', angles: 'degrees', distance: 'nautical miles', fuelEndurance: 'minutes' },
  }),
  get_decision_context: async () => flightSimulator.getState().checkride.status === 'decision_required'
    ? receipt('New flight condition assessed. Select a route from context.routeOptions.', 'neutral', { available: true, context: flightSimulator.getDecisionContext() })
    : receipt('Decision context is sealed until emergency_detected. Continue the assigned flight.', 'warning', { available: false, context: null }),
  inspect_flight_evidence: async (input) => {
    if (input.source !== undefined && !evidenceSet.has(input.source)) throw new TypeError('source must be weather, cockpit, traffic, or passenger')
    const evidence = input.source === undefined
      ? evidenceSources.map((source) => flightSimulator.inspectEvidence(source))
      : flightSimulator.inspectEvidence(input.source as EvidenceSource)
    return receipt(input.source ? `${input.source} report read` : 'All evidence read', 'neutral', { evidence, inspectedSources: flightSimulator.getState().checkride.inspectedSources })
  },
  set_route: async (input) => {
    if (!routeSet.has(input.plan)) throw new TypeError('plan must be continue_klak or return_kpwk')
    if (typeof input.reason !== 'string' || !input.reason.trim()) throw new TypeError('reason is required')
    return action(flightSimulator.setRoute(input.plan as RoutePlan, input.reason.trim(), 'agent'))
  },
  begin_takeoff: async (input) => {
    if (typeof input.reason !== 'string' || !input.reason.trim()) throw new TypeError('reason is required')
    return action(flightSimulator.beginTakeoff('agent', input.reason.trim()))
  },
  set_autopilot_targets: async (input) => action(flightSimulator.setAutopilotTargets(input, 'agent', reasonInput({ ...input }))),
  rebuild_active_leg: async (input) => {
    if (!rebuildStrategySet.has(input.strategy)) throw new TypeError('strategy must be direct_intercept, wider_pattern, or skip_noncritical')
    if (typeof input.reason !== 'string' || !input.reason.trim()) throw new TypeError('reason is required')
    return action(flightSimulator.rebuildActiveLeg(input.strategy as ActiveLegRebuildStrategy, input.reason.trim(), 'agent'))
  },
  configure_aircraft: async (input) => action(flightSimulator.configureAircraft(input, 'agent')),
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
    return receipt(state.controlOwner === 'agent' ? 'Copilot has control' : 'Pilot has control', state.controlOwner === 'agent' ? 'automation' : 'success', { controlOwner: state.controlOwner, state: agentState(state) })
  },
}

export function executeFlightTool<Name extends FlightToolName>(name: Name, input: FlightToolArguments[Name]): Promise<FlightToolResults[Name]> { return executors[name](input) }
export function executeFlightToolFromUnknown(name: FlightToolName, input: unknown): Promise<FlightToolResults[FlightToolName]> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError(`${name} input must be an object`)
  return executors[name](input as never)
}
