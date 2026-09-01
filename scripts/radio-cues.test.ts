import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { buildRadioCue, formatAviationHeading, formatAviationRunway } from '../src/audio/radioCues.ts'
import { RADIO_VOICE_PACK, radioVoiceClipFor, radioVoicePackCovers } from '../src/audio/radioVoicePack.ts'
import type { FlightState, TraceEvent } from '../src/sim/types.ts'

const state = {
  mode: 'full',
  route: {
    destination: 'KSTL',
    runway: '30L',
    activeWaypointIndex: 1,
    waypoints: [{ name: 'Initial fix' }, { name: 'Lambert final' }],
  },
  atc: {
    clearance: {
      destination: 'KSTL',
      runway: '30L',
      headingDeg: 40,
      altitudeFt: 1_500,
      airspeedKt: 230,
      routing: 'vectors',
    },
  },
  scenario: {
    engine: { summary: 'Left engine thrust is falling.' },
    weather: { summary: 'Heavy rain, visibility one mile.' },
    passenger: { summary: 'One passenger needs urgent care.' },
    traffic: { summary: 'Emergency priority is available.' },
  },
  mission: { nextFix: 'LAMBERT_FINAL', outcome: 'in_progress' },
  checkride: { runId: 'run-a048', seed: 17, score: { total: 96 } },
  debrief: { landing: { runway: 'KSTL 30L' } },
} as unknown as FlightState

const trace = (id: number, action: string, reason: string, details: Record<string, unknown>): TraceEvent => ({
  id,
  time: 123,
  elapsedSeconds: 45,
  actor: action.startsWith('atc_clearance_issued') ? 'system' : 'agent',
  action,
  reason,
  details,
})

const diversion = buildRadioCue(trace(1, 'atc_diversion_requested', 'Falling thrust and urgent passenger.', {
  plan: 'return_kstl',
  destination: 'KSTL',
}), state)
assert.deepEqual(diversion, {
  id: 'run-a048:trace:1:diversion-request',
  kind: 'diversion-request',
  speaker: 'copilot',
  speakerLabel: 'Copilot',
  priority: 'high',
  text: 'Approach, Flightdeck one seven requests St. Louis Lambert. Falling thrust and urgent passenger.',
  payloadRef: { traceId: 1, action: 'atc_diversion_requested' },
})

const midwayFiled = buildRadioCue(trace(11, 'preflight_route_filed', 'Filed route', {
  destination: 'KMDW',
  runway: '31C',
}), state)
assert.equal(midwayFiled?.text, 'Flight plan loaded for Chicago Midway, runway three one center.')
assert.equal(radioVoiceClipFor(midwayFiled!), null, 'flight-plan captions must not produce copilot audio')

const clearanceEvent = trace(2, 'atc_clearance_issued', 'clearance', {
  destination: 'KSTL',
  runway: '30L',
  headingDeg: 40,
  altitudeFt: 1_500,
  airspeedKt: 230,
  routing: 'vectors',
})
const clearance = buildRadioCue(clearanceEvent, state)
assert.equal(clearance?.speaker, 'atc')
assert.equal(clearance?.priority, 'interrupt')
assert.equal(clearance?.text, 'Flightdeck one seven, radar vectors St. Louis Lambert. Fly heading zero four zero, maintain one thousand five hundred feet and two hundred thirty knots. Expect runway three zero left.')

const readback = buildRadioCue(trace(3, 'atc_clearance_readback', 'KSTL runway 30L, maintain 1500 feet, initial heading 040.', {}), state)
assert.equal(readback?.text, 'KSTL runway 30L, maintain 1500 feet, initial heading 040.')

const configuration = buildRadioCue(trace(4, 'aircraft_configured', 'Landing configuration', { gearDown: true, flapsDeg: 0 }), state)
assert.equal(configuration?.text, 'Gear down, clean delta.')

const checkpoint = buildRadioCue(trace(5, 'checkpoint_reached', 'Lambert base', {
  waypointName: 'Lambert base',
  nextFix: 'Lambert final',
  final: false,
}), state)
assert.equal(checkpoint?.text, 'Lambert base captured. Next, Lambert final.')

const approach = buildRadioCue(trace(6, 'approach_stable', 'KSTL 30L approach is stable', { runway: 'KSTL 30L' }), state)
assert.equal(approach?.text, 'Flightdeck one seven, runway three zero left, cleared to land.')

const touchdown = buildRadioCue(trace(7, 'touchdown', 'Touchdown on KSTL 30L', {
  runway: 'KSTL 30L',
  sinkRateFpm: 320,
  airspeedKt: 145,
  bounces: 0,
}), state)
assert.equal(touchdown?.text, 'Touchdown.')

const completion = buildRadioCue(trace(8, 'mission_complete', 'Aircraft stopped safely', { runway: 'KSTL 30L', score: 96 }), state)
assert.equal(completion?.text, 'Aircraft stopped on runway three zero left. Score ninety six.')

const failureState = { ...state, mission: { ...state.mission, outcome: 'fuel_exhausted' } } as FlightState
const failure = buildRadioCue(trace(9, 'mission_failed', 'Mission failed', { outcome: 'fuel_exhausted' }), failureState)
assert.equal(failure?.text, 'Mission failed. fuel exhausted.')
assert.equal(failure?.priority, 'interrupt')

assert.equal(buildRadioCue(trace(10, 'evidence_inspected', 'Weather checked', { source: 'weather' }), state), null)
assert.deepEqual(buildRadioCue(clearanceEvent, state), buildRadioCue(clearanceEvent, state), 'same input must produce byte-identical data')
assert.equal(JSON.stringify(buildRadioCue(clearanceEvent, state)), JSON.stringify(buildRadioCue(clearanceEvent, state)))
assert.equal(formatAviationHeading(400), 'zero four zero')
assert.equal(formatAviationRunway('KSTL-30L'), 'three zero left')

const audibleKinds = [
  'takeoff-clearance',
  'clearance-issued',
  'landing-clearance',
] as const
assert.equal(radioVoicePackCovers(audibleKinds), true, 'every ATC cue kind needs a deterministic clip')
assert.deepEqual([...new Set(RADIO_VOICE_PACK.map(({ voice }) => voice))], ['af_heart'], 'the radio pack must use exactly one ATC voice')
assert.ok(RADIO_VOICE_PACK.every((clip) => clip.speaker === 'atc'), 'non-ATC cues must never enter the voice pack')
assert.equal(radioVoiceClipFor(clearance!)?.key, 'clearance-issued-kstl-30l')
assert.equal(radioVoiceClipFor(approach!)?.key, 'landing-clearance-30l')
assert.equal(radioVoiceClipFor(diversion!), null, 'copilot requests stay visible in the transcript but silent')
for (const clip of RADIO_VOICE_PACK) {
  assert.ok(statSync(`public${clip.url.split('?')[0]}`).size > 0, `missing generated audio for ${clip.key}`)
}

console.log('Deterministic radio cue tests passed')
