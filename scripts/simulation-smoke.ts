import assert from 'node:assert/strict'
import { executeFlightTool } from '../src/shared/executeFlightTool.ts'
import { flightToolDefinitions } from '../src/shared/flightTools.ts'
import { airborneDragKtPerSecond, groundMotionFor, stallResponseFor, turbulenceFor } from '../src/sim/aerodynamics.ts'
import { DREAMLINER_787_9_ENVELOPE, staticThrustAccelerationKtPerSecond } from '../src/sim/aircraftEnvelope.ts'
import { KMDW_RUNWAY_31C, KSTL_DEPARTURE_START, KSTL_RUNWAY_12R, KSTL_RUNWAY_30L } from '../src/sim/airfields.ts'
import { checkpointCaptureRadiusNm } from '../src/sim/checkpoints.ts'
import { flightSimulator, landingRollAccelerationKtPerSecond, navigationBearingDeg } from '../src/sim/flightSimulator.ts'
import type { ControlOwner, RouteWaypoint, TraceActor } from '../src/sim/types.ts'

const weather = {
  visibilityMiles: 10,
  ceilingFt: 6_500,
  windDirectionDeg: 190,
  windSpeedKt: 18,
  summary: 'Diagnostic wind',
}

const headwind = groundMotionFor(170, 180, { ...weather, windDirectionDeg: 180, windSpeedKt: 12 }, 0, 17)
assert.ok(headwind.groundSpeedKt < 170)
assert.ok(headwind.headwindKt > 10)
assert.ok(airborneDragKtPerSecond(230, true, 0) > airborneDragKtPerSecond(230, false, 0))
assert.ok(airborneDragKtPerSecond(160, false, 0, 30) > airborneDragKtPerSecond(160, false, 0, 0))
assert.ok(airborneDragKtPerSecond(230, false, 0) > airborneDragKtPerSecond(140, false, 0))
assert.ok(stallResponseFor(100, 18, 0, 0).severity > 0.5)
assert.ok(stallResponseFor(DREAMLINER_787_9_ENVELOPE.rotateSpeedKt, 4, 0, 0, 10).liftToWeightRatio < 1)
assert.ok(stallResponseFor(DREAMLINER_787_9_ENVELOPE.rotateSpeedKt, 10, 0, 0, 10).liftToWeightRatio > 1)
assert.ok(staticThrustAccelerationKtPerSecond(DREAMLINER_787_9_ENVELOPE) > 6)
assert.ok(Array.from({ length: 180 }, (_, second) => turbulenceFor(weather, second, 42)).some((sample) => sample.level !== 'none'))
assert.ok(landingRollAccelerationKtPerSecond(1, 1) > 0)
assert.ok(landingRollAccelerationKtPerSecond(0, 1) < 0)
assert.ok(Math.abs(navigationBearingDeg({ lat: 42, lon: -88 }, { lat: 42, lon: -87.9 }) - 90) < 0.1)
assert.equal(KSTL_RUNWAY_12R.headingDeg, 124)
assert.equal(KSTL_RUNWAY_30L.headingDeg, 304)
const midwayCourseDeg = navigationBearingDeg(KSTL_DEPARTURE_START, { lat: KMDW_RUNWAY_31C.thresholdLat, lon: KMDW_RUNWAY_31C.thresholdLon })
assert.ok(midwayCourseDeg > 30 && midwayCourseDeg < 40)

const gate: RouteWaypoint = {
  id: 'TEST_GATE', name: 'Test gate', kind: 'enroute', lat: 38.7, lon: -90.4,
  altitudeFt: 1_500, airspeedKt: 190, captureRadiusNm: 0.08,
}
assert.equal(checkpointCaptureRadiusNm(gate), 0.16)

const toolNames = flightToolDefinitions.map(({ name }) => name)
assert.ok(toolNames.includes('set_flight_controls'))
assert.ok(!toolNames.includes('begin_takeoff' as never))
assert.ok(!toolNames.includes('set_autopilot_targets' as never))

const runSharedCommands = (owner: ControlOwner) => {
  const actor: TraceActor = owner
  flightSimulator.reset(17)
  if (owner === 'agent') flightSimulator.transferControl('agent', 'agent', 'Diagnostic handoff')
  assert.equal(flightSimulator.setRoute('continue_kmdw', 'File the assigned route.', actor).accepted, true)
  assert.equal(flightSimulator.setFlightControls({ throttle: 1, pitchIntent: 0.35, bankIntent: 0, reason: 'Shared command diagnostic' }, actor).accepted, true)
  flightSimulator.advanceForTesting(4)
  const state = flightSimulator.getState()
  return {
    airspeedKt: state.airspeedKt,
    altitudeFt: state.altitudeFt,
    pitchDeg: state.pitchDeg,
    bankDeg: state.bankDeg,
    throttle: state.throttle,
    phase: state.mission.phase,
  }
}

const humanResult = runSharedCommands('human')
const agentResult = runSharedCommands('agent')
assert.deepEqual(agentResult, humanResult, 'Caller identity must not change flight physics')
assert.equal(agentResult.phase, 'takeoff')
assert.equal(agentResult.throttle, 1)

flightSimulator.reset(17)
flightSimulator.transferControl('agent', 'agent', 'WebMCP diagnostic')
const started = await executeFlightTool('start_flight', {})
assert.equal(started.ok, true)
const brief = await executeFlightTool('get_mission_brief', {})
assert.equal(brief.details.brief.deadlineSeconds, 360)
const route = await executeFlightTool('set_route', { plan: 'continue_kmdw', reason: 'File the assigned preflight route.' })
assert.equal(route.ok, true)
const controls = await executeFlightTool('set_flight_controls', { throttle: 1, pitchIntent: 0, bankIntent: 0, reason: 'Start the takeoff roll.' })
assert.equal(controls.ok, true)
assert.equal(controls.state.mission.phase, 'takeoff')

console.log('simulation diagnostics passed')
