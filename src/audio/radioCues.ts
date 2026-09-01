import type { FlightState, TraceEvent } from '../sim/types.ts'

export type RadioSpeaker = 'copilot' | 'atc' | 'system' | 'cabin'
export type RadioPriority = 'low' | 'normal' | 'high' | 'interrupt'
export type RadioCueKind =
  | 'route-filed'
  | 'takeoff-clearance'
  | 'configuration'
  | 'scenario-warning'
  | 'diversion-request'
  | 'clearance-issued'
  | 'clearance-readback'
  | 'checkpoint'
  | 'route-stalled'
  | 'route-rebuilt'
  | 'cabin-safety'
  | 'approval-request'
  | 'landing-clearance'
  | 'touchdown'
  | 'mission-complete'
  | 'mission-failed'

export interface RadioCue {
  readonly id: string
  readonly kind: RadioCueKind
  readonly speaker: RadioSpeaker
  readonly speakerLabel: string
  readonly priority: RadioPriority
  readonly text: string
  readonly payloadRef: {
    readonly traceId: number
    readonly action: string
  }
}

const digitWords = Object.freeze(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])
const smallNumberWords = Object.freeze([
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
])
const tensWords = Object.freeze(['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'])

const wordsBelowThousand = (value: number): string => {
  if (value < 20) return smallNumberWords[value]
  if (value < 100) return `${tensWords[Math.floor(value / 10)]}${value % 10 ? ` ${smallNumberWords[value % 10]}` : ''}`
  return `${smallNumberWords[Math.floor(value / 100)]} hundred${value % 100 ? ` ${wordsBelowThousand(value % 100)}` : ''}`
}

export const formatAviationNumber = (value: number): string => {
  const rounded = Math.max(0, Math.round(value))
  if (rounded < 1_000) return wordsBelowThousand(rounded)
  if (rounded < 1_000_000) {
    const thousands = Math.floor(rounded / 1_000)
    const remainder = rounded % 1_000
    return `${wordsBelowThousand(thousands)} thousand${remainder ? ` ${wordsBelowThousand(remainder)}` : ''}`
  }
  return String(rounded).split('').map((digit) => digitWords[Number(digit)]).join(' ')
}

export const formatAviationHeading = (value: number): string => {
  const normalized = ((Math.round(value) % 360) + 360) % 360
  return String(normalized).padStart(3, '0').split('').map((digit) => digitWords[Number(digit)]).join(' ')
}

export const formatAviationRunway = (value: string): string => value
  .trim()
  .toUpperCase()
  .replace(/^.*[- ]/, '')
  .split('')
  .map((character) => {
    if (/\d/.test(character)) return digitWords[Number(character)]
    if (character === 'L') return 'left'
    if (character === 'R') return 'right'
    if (character === 'C') return 'center'
    return ''
  })
  .filter(Boolean)
  .join(' ')

const cleanText = (value: string): string => Array.from(value, (character) => {
  const code = character.charCodeAt(0)
  return code < 32 || code === 127 ? ' ' : character
}).join('')
  .replace(/\s+/g, ' ')
  .trim()

const detailString = (event: TraceEvent, key: string) => typeof event.details[key] === 'string' ? cleanText(event.details[key]) : null
const detailNumber = (event: TraceEvent, key: string) => typeof event.details[key] === 'number' && Number.isFinite(event.details[key]) ? event.details[key] : null
const detailBoolean = (event: TraceEvent, key: string) => typeof event.details[key] === 'boolean' ? event.details[key] : null

const destinationCodeForPlan = (plan: string | null): string | null => {
  if (!plan) return null
  if (plan === 'continue_kmdw') return 'KMDW'
  if (plan === 'return_kstl') return 'KSTL'
  return null
}

const airportName = (code: string) => {
  if (code === 'KSTL') return 'St. Louis Lambert'
  if (code === 'KMDW') return 'Chicago Midway'
  return code
}

const callSign = (state: FlightState) => `Flightdeck ${String(state.checkride.seed).split('').map((digit) => digitWords[Number(digit)]).join(' ')}`

const cue = (
  event: TraceEvent,
  runId: string,
  kind: RadioCueKind,
  speaker: RadioSpeaker,
  speakerLabel: string,
  priority: RadioPriority,
  text: string,
): RadioCue => Object.freeze({
  id: `${runId}:trace:${event.id}:${kind}`,
  kind,
  speaker,
  speakerLabel,
  priority,
  text: cleanText(text),
  payloadRef: Object.freeze({ traceId: event.id, action: event.action }),
})

const runwayFromState = (state: FlightState) => state.route.runway ?? state.atc.clearance?.runway ?? null

/**
 * Observation-only trace entries deliberately stay silent. WebMCP reads and
 * timeouts are not recorded, while evidence reads are retained for audit.
 */
export const silentRadioActions = Object.freeze(new Set(['evidence_inspected']))

export const buildRadioCue = (event: TraceEvent, state: FlightState, runId = state.checkride.runId): RadioCue | null => {
  if (silentRadioActions.has(event.action)) return null
  const callsign = callSign(state)

  switch (event.action) {
    case 'preflight_route_filed': {
      const destination = detailString(event, 'destination') ?? state.route.destination
      const runway = detailString(event, 'runway') ?? runwayFromState(state)
      if (!destination || !runway) return null
      return cue(event, runId, 'route-filed', 'copilot', 'Copilot', 'low', `Flight plan loaded for ${airportName(destination)}, runway ${formatAviationRunway(runway)}.`)
    }
    case 'takeoff_started': {
      const runway = detailString(event, 'runway')
      if (!runway) return null
      return cue(event, runId, 'takeoff-clearance', 'atc', 'St. Louis tower', 'normal', `${callsign}, runway ${formatAviationRunway(runway)}, cleared for takeoff.`)
    }
    case 'aircraft_configured': {
      const gearDown = detailBoolean(event, 'gearDown')
      const flapsDeg = detailNumber(event, 'flapsDeg')
      if (gearDown === null || flapsDeg === null) return null
      const gear = gearDown ? 'Gear down' : 'Gear up'
      const flaps = flapsDeg === 0 ? 'flaps up' : `flaps ${formatAviationNumber(flapsDeg)}`
      return cue(event, runId, 'configuration', 'copilot', 'Copilot', 'low', `${gear}, ${flaps}.`)
    }
    case 'scenario_triggered':
      return cue(
        event,
        runId,
        'scenario-warning',
        'system',
        'Cockpit alert',
        'interrupt',
        `Master warning. Engine: ${state.scenario.engine.summary} Weather: ${state.scenario.weather.summary} Passenger: ${state.scenario.passenger.summary} Traffic: ${state.scenario.traffic.summary}`,
      )
    case 'atc_diversion_requested': {
      const plan = detailString(event, 'plan')
      const destination = detailString(event, 'destination')
        ?? state.atc.clearance?.destination
        ?? destinationCodeForPlan(plan)
      if (!destination) return null
      return cue(event, runId, 'diversion-request', 'copilot', 'Copilot', 'high', `Approach, ${callsign} requests ${airportName(destination)}. ${cleanText(event.reason)}`)
    }
    case 'atc_clearance_issued': {
      const clearance = state.atc.clearance
      const destination = detailString(event, 'destination') ?? clearance?.destination
      const runway = detailString(event, 'runway') ?? clearance?.runway
      const headingDeg = detailNumber(event, 'headingDeg') ?? clearance?.headingDeg
      const altitudeFt = detailNumber(event, 'altitudeFt') ?? clearance?.altitudeFt
      const airspeedKt = detailNumber(event, 'airspeedKt') ?? clearance?.airspeedKt
      const routing = detailString(event, 'routing') ?? clearance?.routing
      const initialFix = detailString(event, 'initialFix') ?? clearance?.initialFix
      if (!destination || !runway || headingDeg === undefined || altitudeFt === undefined || airspeedKt === undefined) return null
      const routeWords = routing === 'vectors' ? `radar vectors ${airportName(destination)}` : `cleared direct ${initialFix ?? airportName(destination)}`
      return cue(event, runId, 'clearance-issued', 'atc', 'Approach control', 'interrupt', `${callsign}, ${routeWords}. Fly heading ${formatAviationHeading(headingDeg)}, maintain ${formatAviationNumber(altitudeFt)} feet and ${formatAviationNumber(airspeedKt)} knots. Expect runway ${formatAviationRunway(runway)}.`)
    }
    case 'atc_clearance_readback':
      return cue(event, runId, 'clearance-readback', 'copilot', 'Copilot', 'high', cleanText(event.reason))
    case 'checkpoint_reached': {
      const waypointName = detailString(event, 'waypointName') ?? cleanText(event.reason)
      const nextFix = detailString(event, 'nextFix') ?? state.route.waypoints[state.route.activeWaypointIndex]?.name ?? null
      const final = detailBoolean(event, 'final') === true
      return cue(event, runId, 'checkpoint', 'system', 'Flight director', 'low', `${waypointName} captured.${!final && nextFix && nextFix !== waypointName ? ` Next, ${nextFix}.` : ''}`)
    }
    case 'route_progress_stalled': {
      const nextFix = detailString(event, 'nextFix') ?? state.mission.nextFix
      const distanceNm = detailNumber(event, 'distanceNm')
      if (!nextFix || distanceNm === null) return null
      return cue(event, runId, 'route-stalled', 'system', 'Flight director', 'high', `Route progress stalled at ${nextFix}, ${distanceNm.toFixed(1)} miles.`)
    }
    case 'active_leg_rebuilt': {
      const strategy = detailString(event, 'strategy')
      const nextFix = detailString(event, 'nextFix')
      if (!strategy || !nextFix) return null
      return cue(event, runId, 'route-rebuilt', 'copilot', 'Copilot', 'normal', `Route rebuilt using ${strategy.replaceAll('_', ' ')}. Intercepting ${nextFix}.`)
    }
    case 'passenger_safety_update':
      return cue(event, runId, 'cabin-safety', 'cabin', 'Cabin', 'high', cleanText(event.reason))
    case 'approval_requested': {
      const requestedAction = detailString(event, 'requestedAction')
      return cue(event, runId, 'approval-request', 'copilot', 'Copilot', 'interrupt', `${cleanText(event.reason)}${requestedAction ? ` Requested action: ${requestedAction}.` : ''}`)
    }
    case 'approach_stable': {
      const runway = detailString(event, 'runway') ?? runwayFromState(state)
      if (!runway) return null
      return cue(event, runId, 'landing-clearance', 'atc', 'Tower', 'high', `${callsign}, runway ${formatAviationRunway(runway)}, cleared to land.`)
    }
    case 'touchdown':
      return cue(event, runId, 'touchdown', 'system', 'Cockpit callout', 'high', 'Touchdown.')
    case 'mission_complete': {
      const runway = detailString(event, 'runway') ?? state.debrief.landing?.runway
      const score = detailNumber(event, 'score') ?? state.checkride.score.total
      if (!runway) return null
      return cue(event, runId, 'mission-complete', 'copilot', 'Copilot', 'high', `Aircraft stopped on runway ${formatAviationRunway(runway)}. Score ${formatAviationNumber(score)}.`)
    }
    case 'mission_failed': {
      const outcome = (detailString(event, 'outcome') ?? state.mission.outcome).replaceAll('_', ' ')
      return cue(event, runId, 'mission-failed', 'system', 'Cockpit alert', 'interrupt', `Mission failed. ${outcome}.`)
    }
    default:
      return null
  }
}
