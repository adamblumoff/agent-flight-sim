import { flightSimulator } from '../sim/flightSimulator'
import type {
  CheckrideDecision,
  CheckrideEvidenceSource,
  CheckrideSeed,
} from '../sim/types'
import type {
  FlightToolArguments,
  FlightToolName,
  FlightToolResults,
  ToolReceiptTone,
} from './flightTools'
import {
  checkrideDecisionValues,
  checkrideEvidenceSources,
  checkrideSeeds,
  flightCommandValues,
  flightEventValues,
  proceedToFixTargets,
} from './flightTools'

type UnknownInput = Readonly<Record<string, unknown>>

const flightCommands = new Set<string>(flightCommandValues)
const proceedToFixTargetSet = new Set<string>(proceedToFixTargets)
const seedSet = new Set<number>(checkrideSeeds)
const evidenceSourceSet = new Set<string>(checkrideEvidenceSources)
const checkrideDecisionSet = new Set<string>(checkrideDecisionValues)
const flightEventSet = new Set<string>(flightEventValues)

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

const boundedTimeout = (value: unknown): number => {
  if (value === undefined) return 15_000
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError('timeout_ms must be a finite number')
  }
  return Math.min(15_000, Math.max(1_000, Math.floor(value)))
}

const commandInput = (input: FlightToolArguments['command_flight']) => {
  if (!flightCommands.has(input.command)) {
    throw new TypeError('command is not a supported flight command')
  }
  let target = input.target
  if (input.command === 'proceed_to_fix' && target === undefined) {
    const nextFix = flightSimulator.getState().mission.nextFix
    if (nextFix === 'CROSSWIND' || nextFix === 'NORTH_GATE') target = nextFix
  }
  if (target !== undefined && !proceedToFixTargetSet.has(target)) {
    throw new TypeError('target must be CROSSWIND or NORTH_GATE')
  }
  if (input.command === 'proceed_to_fix' && target === undefined) {
    throw new TypeError('proceed_to_fix requires CROSSWIND or NORTH_GATE; no target could be inferred')
  }
  if (input.command !== 'proceed_to_fix' && target !== undefined) {
    throw new TypeError('target is only valid with proceed_to_fix')
  }
  if (input.wait_for_next_event !== undefined && typeof input.wait_for_next_event !== 'boolean') {
    throw new TypeError('wait_for_next_event must be a boolean')
  }

  return {
    command: input.command,
    target,
    reason: reasonInput(input),
  }
}

const executors: {
  readonly [Name in FlightToolName]: (
    input: FlightToolArguments[Name],
  ) => Promise<FlightToolResults[Name]>
} = {
  start_checkride: async (input) => {
    const seed = input.seed ?? 17
    if (!seedSet.has(seed)) throw new TypeError('seed must be 17, 42, or 81')
    flightSimulator.reset(seed as CheckrideSeed)
    flightSimulator.transferControl('agent', 'agent', 'AI checkride started')
    return receipt(`Checkride seed ${seed} ready`, 'automation', {
      seed: seed as CheckrideSeed,
      brief: flightSimulator.getMissionBrief(),
      state: flightSimulator.getState(),
    })
  },
  get_mission_brief: async () =>
    receipt('Mission brief read', 'neutral', {
      brief: flightSimulator.getMissionBrief(),
    }),
  get_flight_state: async () =>
    receipt('Live flight and checkride state read', 'neutral', {
      state: flightSimulator.getState(),
      units: {
        altitude: 'feet',
        airspeed: 'knots',
        verticalSpeed: 'feet per minute',
        angles: 'degrees',
        navigationDistance: 'nautical miles',
        glidepathError: 'feet',
        fuelEndurance: 'minutes',
      },
    }),
  inspect_flight_evidence: async (input) => {
    if (input.source !== undefined && !evidenceSourceSet.has(input.source)) {
      throw new TypeError('source must be weather, cockpit, traffic, or passenger')
    }
    const evidence = input.source === undefined
      ? checkrideEvidenceSources.map((source) =>
          flightSimulator.inspectCheckrideEvidence(source))
      : flightSimulator.inspectCheckrideEvidence(
          input.source as CheckrideEvidenceSource,
        )
    return receipt(
      input.source === undefined ? 'All evidence read' : `${input.source} evidence read`,
      'neutral',
      {
        evidence,
        inspectedSources: flightSimulator.getState().checkride.inspectedSources,
      },
    )
  },
  wait_for_flight_event: async (input) => {
    if (input.after_revision !== undefined &&
      (typeof input.after_revision !== 'number' || !Number.isFinite(input.after_revision))) {
      throw new TypeError('after_revision must be a finite number')
    }
    if (input.events !== undefined && (!Array.isArray(input.events) || input.events.length === 0)) {
      throw new TypeError('events must contain at least one event type')
    }
    if (input.events?.some((event) => !flightEventSet.has(event))) {
      throw new TypeError('events contains an unsupported flight event type')
    }
    const result = await flightSimulator.waitForFlightEvent({
      afterRevision: input.after_revision ?? flightSimulator.getEventRevision(),
      events: input.events ?? flightEventValues,
      timeoutMs: boundedTimeout(input.timeout_ms),
    })
    return {
      ...result,
      ok: true,
      summary: result.event === 'timeout' ? 'Flight event wait timed out' : result.message,
      tone: result.event === 'timeout' ? 'neutral' : 'automation',
    }
  },
  command_flight: async (input) => {
    const result = flightSimulator.commandFlight(commandInput(input), 'agent')
    const base = {
      ...result,
      ok: result.accepted,
      tone: result.accepted ? 'automation' as const : 'warning' as const,
    }
    if (!result.accepted || input.wait_for_next_event !== true) return base

    const nextEvent = await flightSimulator.waitForFlightEvent({
      afterRevision: result.eventRevision,
      events: flightEventValues,
      timeoutMs: boundedTimeout(input.timeout_ms),
    })
    return { ...base, nextEvent }
  },
  decide_checkride: async (input) => {
    if (!checkrideDecisionSet.has(input.decision)) {
      throw new TypeError('decision is not supported')
    }
    const result = flightSimulator.decideCheckride(
      input.decision as CheckrideDecision,
      'agent',
      reasonInput(input),
    )
    const base = {
      ...result,
      ok: result.accepted,
      tone: result.accepted ? 'automation' as const : 'warning' as const,
    }
    if (
      !result.accepted ||
      input.wait_for_next_event !== true ||
      result.humanApproval === 'pending' ||
      result.state.mission.allowedCommands.length > 0 ||
      result.state.mission.outcome !== 'in_progress'
    ) {
      return base
    }
    const nextEvent = await flightSimulator.waitForFlightEvent({
      afterRevision: result.eventRevision,
      events: ['command_required', 'mission_complete'],
      timeoutMs: boundedTimeout(input.timeout_ms),
    })
    return { ...base, nextEvent }
  },
  transfer_control: async (input) => {
    if (input.owner !== 'human' && input.owner !== 'agent') {
      throw new TypeError('owner must be human or agent')
    }
    const current = flightSimulator.getState()
    if (input.owner === 'agent' && current.controlOwner === 'human' && !current.handoffRequested) {
      throw new Error('The pilot has not requested an agent handoff.')
    }
    flightSimulator.transferControl(input.owner, 'agent', reasonInput(input))
    const state = flightSimulator.getState()
    const controlOwner = state.controlOwner
    return receipt(
      controlOwner === 'agent'
        ? 'Agent has the controls'
        : 'Pilot has the controls; agent guidance stopped',
      controlOwner === 'agent' ? 'automation' : 'success',
      { controlOwner, state },
    )
  },
}

export function executeFlightTool<Name extends FlightToolName>(
  name: Name,
  input: FlightToolArguments[Name],
): Promise<FlightToolResults[Name]> {
  return executors[name](input)
}

export function executeFlightToolFromUnknown(
  name: FlightToolName,
  input: unknown,
): Promise<FlightToolResults[FlightToolName]> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${name} input must be an object`)
  }
  return executors[name](input as never)
}
