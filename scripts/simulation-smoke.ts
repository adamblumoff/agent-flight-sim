import assert from 'node:assert/strict'
import { executeFlightTool } from '../src/shared/executeFlightTool.ts'
import { flightEventValues, flightToolDefinitions } from '../src/shared/flightTools.ts'
import { airborneDragKtPerSecond, groundMotionFor, stallResponseFor, turbulenceFor } from '../src/sim/aerodynamics.ts'
import { DREAMLINER_787_9_ENVELOPE, staticThrustAccelerationKtPerSecond } from '../src/sim/aircraftEnvelope.ts'
import { KMDW_RUNWAY_31C, KSTL_DEPARTURE_START, KSTL_RUNWAY_12R, KSTL_RUNWAY_30L } from '../src/sim/airfields.ts'
import { checkpointCaptureRadiusNm } from '../src/sim/checkpoints.ts'
import { approachAssessmentFor, arrivalLegProgressed, autopilotCommandFor, deepensUnsafeBank, distanceNm, flightSimulator, landingRollAccelerationKtPerSecond, navigationBearingDeg, routeFor } from '../src/sim/flightSimulator.ts'
import type { ControlOwner, FlightPlanProgram, RouteWaypoint, TraceActor } from '../src/sim/types.ts'

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
assert.ok(toolNames.includes('fly_control_window'))
assert.ok(toolNames.includes('program_flight_plan'))
assert.ok(toolNames.includes('level_attitude'))
assert.ok(flightEventValues.includes('stall_warning'))
assert.ok(!toolNames.includes('begin_takeoff' as never))
assert.ok(!toolNames.includes('set_autopilot_targets' as never))
assert.ok(!toolNames.includes('follow_flight_director' as never))
assert.equal(deepensUnsafeBank(-24.4, -0.4), true)
assert.equal(deepensUnsafeBank(-24.4, 0.4), false)
assert.equal(deepensUnsafeBank(20, -0.4), false)
assert.equal(arrivalLegProgressed(3, 2, 120, 150), true, 'Course capture must count as progress during a procedure turn')
assert.equal(arrivalLegProgressed(3, 2, 150, 150), false)

const returnOrigin = { lat: 38.69, lon: -90.22, headingDeg: 124, altitudeFt: 3_400, airspeedKt: 205 }
const returnRoute = routeFor('return_kstl', returnOrigin)
const [outboundEntry, courseReversal, finalEntry] = returnRoute.waypoints
assert.ok(Math.abs(((navigationBearingDeg(returnOrigin, outboundEntry) - returnOrigin.headingDeg + 540) % 360) - 180) < 5, 'Outbound leg must begin on the aircraft current heading')
assert.equal(courseReversal.captureHeadingDeg, 304, 'Course-reversal gate must publish the inbound runway heading')
assert.ok(courseReversal.captureRadiusNm >= 6, 'Course-reversal heading gate must contain the full coordinated turn')
assert.equal(courseReversal.altitudeFt, outboundEntry.altitudeFt, 'Course reversal must remain level before final intercept')
assert.ok(distanceNm(courseReversal, finalEntry) >= 2.5, 'Course reversal must leave room to intercept final')

const falseStableApproach = approachAssessmentFor({
  phase: 'approach',
  returnArrival: true,
  activeKind: 'final',
  frameAlongNm: -3.3,
  centerlineErrorNm: -0.078,
  glidepathErrorFt: 98,
  distanceToThresholdNm: 3.31,
  distanceToActiveFixNm: 0.81,
  closingRateToActiveFixKt: -45,
  altitudeAglFt: 1_152,
  runwayHeadingErrorDeg: 113,
  verticalSpeedFpm: -2_318,
  airspeedKt: 149,
  gearDown: true,
  flapsDeg: 20,
})
assert.equal(falseStableApproach.stable, false)
assert.equal(falseStableApproach.goAroundRequired, true)

const stableApproach = approachAssessmentFor({
  phase: 'approach',
  returnArrival: true,
  activeKind: 'touchdown',
  frameAlongNm: -2.5,
  centerlineErrorNm: 0.005,
  glidepathErrorFt: 40,
  distanceToThresholdNm: 2.5,
  distanceToActiveFixNm: 2.5,
  closingRateToActiveFixKt: 142,
  altitudeAglFt: 800,
  runwayHeadingErrorDeg: -3,
  verticalSpeedFpm: -500,
  airspeedKt: 145,
  gearDown: true,
  flapsDeg: 20,
})
assert.equal(stableApproach.stable, true)
assert.equal(stableApproach.goAroundRequired, false)

const unsafeBase = approachAssessmentFor({
  phase: 'enroute',
  returnArrival: true,
  activeKind: 'base',
  frameAlongNm: -3.5,
  centerlineErrorNm: 1.2,
  glidepathErrorFt: -500,
  distanceToThresholdNm: 4.2,
  distanceToActiveFixNm: 0.9,
  closingRateToActiveFixKt: 80,
  altitudeAglFt: 1_133,
  runwayHeadingErrorDeg: 155,
  verticalSpeedFpm: -3_421,
  airspeedKt: 192,
  gearDown: true,
  flapsDeg: 20,
})
assert.equal(unsafeBase.stable, false)
assert.equal(unsafeBase.goAroundRequired, true)

const safeGoAroundClimb = approachAssessmentFor({
  phase: 'enroute',
  returnArrival: true,
  activeKind: 'enroute',
  frameAlongNm: -1,
  centerlineErrorNm: 1.2,
  glidepathErrorFt: -500,
  distanceToThresholdNm: 1.5,
  distanceToActiveFixNm: 1,
  closingRateToActiveFixKt: 160,
  altitudeAglFt: 900,
  runwayHeadingErrorDeg: 150,
  verticalSpeedFpm: 1_200,
  airspeedKt: 205,
  gearDown: false,
  flapsDeg: 10,
})
assert.equal(safeGoAroundClimb.goAroundRequired, false)

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
assert.equal(brief.details.brief.deadlineSeconds, 480)
const program: FlightPlanProgram = {
  plan: 'continue_kmdw', rotateSpeedKt: 155, climbPitchDeg: 10, climbSpeedKt: 180,
  cruiseAltitudeFt: 3_000, cruiseSpeedKt: 230, maxBankDeg: 22,
  approachSpeedKt: 145, landingFlapsDeg: 30,
}
const route = await executeFlightTool('program_flight_plan', {
  plan: program.plan,
  rotate_speed_kt: program.rotateSpeedKt,
  climb_pitch_deg: program.climbPitchDeg,
  climb_speed_kt: program.climbSpeedKt,
  cruise_altitude_ft: program.cruiseAltitudeFt,
  cruise_speed_kt: program.cruiseSpeedKt,
  max_bank_deg: program.maxBankDeg,
  approach_speed_kt: program.approachSpeedKt,
  landing_flaps_deg: program.landingFlapsDeg,
  reason: 'Program the assigned flight.',
})
assert.equal(route.ok, true)
assert.equal(route.state.autopilot.engaged, true)
const takeoffDirectorCommand = autopilotCommandFor(flightSimulator.getState(), program)
assert.equal(takeoffDirectorCommand.throttle, 1)
assert.equal(takeoffDirectorCommand.flapsDeg, 10)
const controls = await executeFlightTool('fly_control_window', { throttle: 1, pitchIntent: 0, bankIntent: 0, duration_ms: 250, reason: 'Start the takeoff roll.' })
assert.equal(controls.ok, true)
assert.equal(controls.state.mission.phase, 'takeoff')

const controlWindow = await executeFlightTool('fly_control_window', {
  pitchIntent: 0.25,
  bankIntent: -0.2,
  duration_ms: 250,
  sample_interval_ms: 100,
  reason: 'Verify finite agent controls and telemetry sampling.',
})
assert.equal(controlWindow.ok, true)
assert.ok(controlWindow.samples.length >= 1)
assert.equal(controlWindow.state.controlInputs.pitchAxis, 0)
assert.equal(controlWindow.state.controlInputs.bankAxis, 0)

for (const seed of [17, 42, 81] as const) {
  flightSimulator.reset(seed)
  flightSimulator.transferControl('agent', 'agent', 'Autopilot diagnostic')
  assert.equal(flightSimulator.programFlightPlan(program, 'Program the assigned departure.', 'agent').accepted, true)
  while (flightSimulator.getState().checkride.status !== 'decision_required' && flightSimulator.getState().elapsedSeconds < 180) {
    flightSimulator.advanceForTesting(1)
  }
  assert.equal(flightSimulator.getState().checkride.status, 'decision_required', `Seed ${seed} must reveal the emergency in flight`)
  flightSimulator.getDecisionContext('agent')
  assert.equal(flightSimulator.requestDiversion('return_kstl', 'Return to the closest suitable runway.', 'agent').accepted, true)
  flightSimulator.advanceForTesting(5)
  const clearance = flightSimulator.getState().atc.clearance
  assert.ok(clearance, `Seed ${seed} must receive an ATC clearance`)
  assert.equal(flightSimulator.acceptAtcClearance(
    clearance.id,
    `${clearance.destination} runway ${clearance.runway}, altitude ${clearance.altitudeFt}, heading ${Math.round(clearance.headingDeg)}`,
    'agent',
  ).accepted, true)
  const returnProgram: FlightPlanProgram = {
    ...program,
    plan: 'return_kstl',
    cruiseAltitudeFt: clearance.altitudeFt,
    cruiseSpeedKt: clearance.airspeedKt,
  }
  assert.equal(flightSimulator.programFlightPlan(returnProgram, 'Program the cleared emergency return.', 'agent').accepted, true)
  while (flightSimulator.getState().mission.outcome === 'in_progress' && flightSimulator.getState().elapsedSeconds < 900) {
    flightSimulator.advanceForTesting(1)
  }
  const terminal = flightSimulator.getState()
  assert.equal(terminal.mission.outcome, 'landed', `Seed ${seed} autopilot ended as ${terminal.mission.outcome}`)
}

console.log('simulation diagnostics passed')
