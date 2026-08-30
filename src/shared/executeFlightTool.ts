import { flightSimulator } from '../sim/flightSimulator'
import type { ActiveLegRebuildStrategy, CheckrideSeed, EvidenceSource, RoutePlan } from '../sim/types'
import {
  checkrideSeeds, evidenceSources, flightEventValues, routePlans,
  type FlightToolArguments, type FlightToolName, type FlightToolResults,
  type ToolReceiptTone,
} from './flightTools'

type UnknownInput = Readonly<Record<string, unknown>>
const seedSet = new Set<number>(checkrideSeeds)
const evidenceSet = new Set<string>(evidenceSources)
const routeSet = new Set<string>(routePlans)
const eventSet = new Set<string>(flightEventValues)
const rebuildStrategySet = new Set<string>(['direct_intercept', 'wider_pattern', 'skip_noncritical'])

const reasonInput = (input: UnknownInput, fallback = 'Requested by the copilot') => typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim() : fallback
const receipt = <T>(summary: string, tone: ToolReceiptTone, details: T) => ({ ok: true as const, summary, tone, details })
const action = (result: ReturnType<typeof flightSimulator.setRoute>) => ({ ...result, ok: result.accepted, tone: result.accepted ? 'automation' as const : 'warning' as const })
const boundedTimeout = (value: unknown) => {
  if (value === undefined) return 15_000
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('timeout_ms must be a finite number')
  return Math.min(15_000, Math.max(1_000, Math.floor(value)))
}

const executors: { readonly [Name in FlightToolName]: (input: FlightToolArguments[Name]) => Promise<FlightToolResults[Name]> } = {
  start_flight: async (input) => {
    const seed = input.seed ?? 17
    const mode = input.mode ?? 'full'
    if (!seedSet.has(seed)) throw new TypeError('seed must be 17, 42, or 81')
    if (mode !== 'full' && mode !== 'judge') throw new TypeError('mode must be full or judge')
    flightSimulator.reset(seed as CheckrideSeed, mode)
    flightSimulator.transferControl('agent', 'agent', 'Copilot started the emergency mission')
    return receipt(`${mode === 'judge' ? 'Judge' : 'Full'} mission seed ${seed} is ready for a preflight route on North Field runway 18`, 'automation', { seed: seed as CheckrideSeed, mode, brief: flightSimulator.getMissionBrief(), state: flightSimulator.getState() })
  },
  get_mission_brief: async () => receipt('Mission brief read', 'neutral', { brief: flightSimulator.getMissionBrief() }),
  get_flight_state: async () => receipt('Live flight state read', 'neutral', {
    state: flightSimulator.getState(),
    units: { altitude: 'feet MSL', airspeed: 'knots', verticalSpeed: 'feet per minute', angles: 'degrees', distance: 'nautical miles', fuelEndurance: 'minutes' },
  }),
  get_decision_context: async () => receipt('Emergency decision context read', 'neutral', { context: flightSimulator.getDecisionContext() }),
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
    return { ...result, ok: true, summary: result.event === 'timeout' ? 'No new flight event' : result.message, tone: result.event === 'timeout' ? 'neutral' : 'automation' }
  },
  transfer_control: async (input) => {
    if (input.owner !== 'human' && input.owner !== 'agent') throw new TypeError('owner must be human or agent')
    const current = flightSimulator.getState()
    if (input.owner === 'agent' && current.controlOwner === 'human' && !current.handoffRequested) throw new Error('The pilot has not requested a copilot handoff.')
    flightSimulator.transferControl(input.owner, 'agent', reasonInput(input))
    const state = flightSimulator.getState()
    return receipt(state.controlOwner === 'agent' ? 'Copilot has control' : 'Pilot has control', state.controlOwner === 'agent' ? 'automation' : 'success', { controlOwner: state.controlOwner, state })
  },
}

export function executeFlightTool<Name extends FlightToolName>(name: Name, input: FlightToolArguments[Name]): Promise<FlightToolResults[Name]> { return executors[name](input) }
export function executeFlightToolFromUnknown(name: FlightToolName, input: unknown): Promise<FlightToolResults[FlightToolName]> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError(`${name} input must be an object`)
  return executors[name](input as never)
}
