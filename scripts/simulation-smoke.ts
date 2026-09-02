import assert from 'node:assert/strict'
import { executeFlightTool } from '../src/shared/executeFlightTool.ts'
import { flightEventValues, flightToolDefinitions } from '../src/shared/flightTools.ts'
import { airborneDragKtPerSecond, groundMotionFor, stallResponseFor, turbulenceFor } from '../src/sim/aerodynamics.ts'
import { DREAMLINER_787_9_ENVELOPE, staticThrustAccelerationKtPerSecond } from '../src/sim/aircraftEnvelope.ts'
import { KMDW_RUNWAY_31C, KSTL_DEPARTURE_START, KSTL_RUNWAY_12R, KSTL_RUNWAY_30L } from '../src/sim/airfields.ts'
import { checkpointCaptureRadiusNm } from '../src/sim/checkpoints.ts'
import { approachAssessmentFor, arrivalLegProgressed, deepensUnsafeBank, distanceNm, flightCommandTargetsFor, flightSimulator, landingRollAccelerationKtPerSecond, navigationBearingDeg, routeFor } from '../src/sim/flightSimulator.ts'
import type { FlightCommandStep, FlightMode, FlightPlanProgram, RouteCommandPoint, RouteWaypoint, TraceActor } from '../src/sim/types.ts'

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
assert.deepEqual(toolNames, ['start_flight', 'program_flight_plan', 'request_diversion', 'accept_clearance', 'wait_for_flight_event'])
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

const runSharedCommands = (mode: Exclude<FlightMode, 'unselected'>) => {
  const actor: TraceActor = mode
  flightSimulator.reset(17)
  assert.ok(flightSimulator.startFlight(mode))
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
assert.equal(flightSimulator.getState().flightMode, 'unselected')
assert.equal(flightSimulator.setThrottle(1, 'human', 'Blocked before selection').accepted, false)
assert.ok(flightSimulator.startFlight('human'))
assert.equal(flightSimulator.startFlight('agent'), null, 'A selected mode cannot change during the run')
await assert.rejects(() => executeFlightTool('start_flight', {}), /already started/, 'WebMCP cannot replace an active manual run')
await assert.rejects(
  () => executeFlightTool('wait_for_flight_event', { timeout_ms: 1_000 }),
  /not in agent mode/,
  'WebMCP event waits are unavailable during a manual run',
)
assert.equal(flightSimulator.setThrottle(1, 'agent', 'Blocked cross-mode input').accepted, false)
assert.equal(flightSimulator.setThrottle(1, 'human', 'Allowed manual input').accepted, true)
flightSimulator.reset(17)
assert.equal(flightSimulator.getState().flightMode, 'unselected', 'Reset must restore mode selection')
const started = await executeFlightTool('start_flight', {})
assert.equal(started.ok, true)
assert.equal(started.details.state.flightMode, 'agent')
assert.equal(flightSimulator.setThrottle(0, 'human', 'Blocked manual input in agent mode').accepted, false)
assert.equal(started.details.brief.deadlineSeconds, 480)
assert.deepEqual(started.details.brief.assignedRoute.commandPoints.map(({ id }) => id), ['KSTL_CLIMB', 'KSTL_DEPARTURE_CORRIDOR'])
assert.deepEqual(
  started.details.brief.assignedRoute.commandPoints.map(({ altitudeFt, airspeedKt, captureHeadingDeg }) => ({ altitudeFt, airspeedKt, captureHeadingDeg })),
  [
    { altitudeFt: 1_200, airspeedKt: 190, captureHeadingDeg: 124 },
    { altitudeFt: 3_000, airspeedKt: 235, captureHeadingDeg: 124 },
  ],
)
const program: FlightPlanProgram = {
  plan: 'continue_kmdw',
  commands: [
    { id: 'takeoff-roll', when: { type: 'immediate' }, lateral: { mode: 'heading', headingDeg: 124 }, vertical: { mode: 'pitch', pitchDeg: 0 }, energy: { mode: 'throttle', throttle: 1 }, gearDown: true, flapsDeg: 10 },
    { id: 'rotate', when: { type: 'airspeed_at_least', value: 155 }, lateral: { mode: 'heading', headingDeg: 124 }, vertical: { mode: 'pitch', pitchDeg: 10 }, energy: { mode: 'throttle', throttle: 1 }, gearDown: true, flapsDeg: 10 },
    { id: 'positive-rate', when: { type: 'aircraft_phase', value: 'airborne' }, lateral: { mode: 'track_fix', waypointId: 'KSTL_CLIMB' }, vertical: { mode: 'pitch', pitchDeg: 8 }, energy: { mode: 'airspeed', airspeedKt: 180 }, gearDown: false, flapsDeg: 10 },
    { id: 'climb-cleanup', when: { type: 'altitude_at_least', value: 1_600 }, lateral: { mode: 'track_fix', waypointId: 'KSTL_DEPARTURE_CORRIDOR' }, vertical: { mode: 'altitude', altitudeFt: 3_000 }, energy: { mode: 'airspeed', airspeedKt: 230 }, gearDown: false, flapsDeg: 0 },
  ],
}
const route = await executeFlightTool('program_flight_plan', {
  plan: program.plan,
  commands: program.commands.map((command) => ({
    id: command.id,
    when: { type: command.when.type, ...('value' in command.when ? { value: command.when.value } : {}) },
    lateral: command.lateral.mode === 'heading' ? { mode: 'heading' as const, heading_deg: command.lateral.headingDeg }
      : command.lateral.mode === 'track_fix' ? { mode: 'track_fix' as const, waypoint_id: command.lateral.waypointId }
        : { mode: 'bank' as const, bank_deg: command.lateral.bankDeg },
    vertical: command.vertical.mode === 'pitch' ? { mode: 'pitch' as const, pitch_deg: command.vertical.pitchDeg }
      : { mode: 'altitude' as const, altitude_ft: command.vertical.altitudeFt },
    energy: command.energy.mode === 'throttle' ? { mode: 'throttle' as const, throttle: command.energy.throttle }
      : { mode: 'airspeed' as const, airspeed_kt: command.energy.airspeedKt },
    gear_down: command.gearDown,
    flaps_deg: command.flapsDeg,
  })),
  reason: 'Program the assigned flight.',
})
assert.equal(route.ok, true)
assert.equal(route.state.autopilot.engaged, true)
const takeoffDirectorCommand = flightCommandTargetsFor(flightSimulator.getState(), program.commands[0])
assert.equal(takeoffDirectorCommand.throttle, 1)
assert.equal(takeoffDirectorCommand.flapsDeg, 10)
flightSimulator.advanceForTesting(90)
const emergency = await executeFlightTool('wait_for_flight_event', {
  after_revision: route.eventRevision,
  events: ['emergency_detected'],
  timeout_ms: 1_000,
})
assert.equal(emergency.event, 'emergency_detected')
assert.ok(emergency.decisionContext)
assert.equal(emergency.state.checkride.decisionContextRead, true)

for (const seed of [17, 42, 81] as const) {
  flightSimulator.reset(seed)
  assert.ok(flightSimulator.startFlight('agent'))
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
  assert.deepEqual(clearance.commandPoints.map(({ id }) => id), [
    'KSTL_OUTBOUND', 'KSTL_COURSE_REVERSAL',
    'KSTL_FINAL_10', 'KSTL_FINAL_8', 'KSTL_FINAL_6', 'KSTL_FINAL_4', 'KSTL_FINAL_2', 'KSTL_FINAL_1',
    'KSTL_TOUCHDOWN',
  ])
  assert.ok(clearance.commandPoints.every(({ altitudeFt, airspeedKt, distanceToRunwayNm }) => altitudeFt > 0 && airspeedKt > 0 && distanceToRunwayNm >= 0))
  assert.equal(flightSimulator.acceptAtcClearance(
    clearance.id,
    `${clearance.destination} runway ${clearance.runway}, altitude ${clearance.altitudeFt}, heading ${Math.round(clearance.headingDeg)}`,
    'agent',
  ).accepted, true)
  const commandForCheckpoint = (checkpoint: RouteCommandPoint, index: number): FlightCommandStep => {
    return Object.freeze({
      id: `cross-${checkpoint.id.toLowerCase()}`,
      when: index === 0 ? Object.freeze({ type: 'immediate' as const }) : Object.freeze({ type: 'active_waypoint' as const, value: checkpoint.id }),
      lateral: Object.freeze({ mode: 'track_fix' as const, waypointId: checkpoint.id }),
      vertical: Object.freeze({ mode: 'altitude' as const, altitudeFt: checkpoint.altitudeFt }),
      energy: Object.freeze({ mode: 'airspeed' as const, airspeedKt: checkpoint.airspeedKt }),
      gearDown: checkpoint.gearDown,
      flapsDeg: checkpoint.flapsDeg,
    })
  }
  const returnProgram: FlightPlanProgram = {
    plan: 'return_kstl',
    commands: [
      ...clearance.commandPoints.map(commandForCheckpoint),
      { id: 'flare', when: { type: 'distance_to_runway_at_most', value: 0.35 }, lateral: { mode: 'track_fix', waypointId: 'KSTL_TOUCHDOWN' }, vertical: { mode: 'pitch', pitchDeg: 7.2 }, energy: { mode: 'airspeed', airspeedKt: 145 }, gearDown: true, flapsDeg: 30 },
      { id: 'decrab', when: { type: 'distance_to_runway_at_most', value: 0.05 }, lateral: { mode: 'heading', headingDeg: 299 }, vertical: { mode: 'pitch', pitchDeg: 7.2 }, energy: { mode: 'airspeed', airspeedKt: 145 }, gearDown: true, flapsDeg: 30 },
      { id: 'rollout', when: { type: 'aircraft_phase', value: 'landing_roll' }, lateral: { mode: 'heading', headingDeg: 304 }, vertical: { mode: 'pitch', pitchDeg: 0 }, energy: { mode: 'throttle', throttle: 0 }, gearDown: true, flapsDeg: 30 },
    ],
  }
  assert.equal(flightSimulator.programFlightPlan(returnProgram, 'Program the cleared emergency return.', 'agent').accepted, true)
  if (seed === 17) {
    while (flightSimulator.getState().route.activeWaypointIndex === 0 && flightSimulator.getState().mission.outcome === 'in_progress') {
      flightSimulator.advanceForTesting(1)
    }
    const progressBeforeReplacement = flightSimulator.getState().route
    const resumedCommands = returnProgram.commands.slice(progressBeforeReplacement.activeWaypointIndex).map((command, index) => index === 0
      ? Object.freeze({ ...command, when: Object.freeze({ type: 'immediate' as const }) })
      : command)
    assert.equal(flightSimulator.programFlightPlan(
      { ...returnProgram, commands: resumedCommands },
      'Refine exact commands without restarting the cleared route.',
      'agent',
    ).accepted, true)
    assert.equal(flightSimulator.getState().route.activeWaypointIndex, progressBeforeReplacement.activeWaypointIndex)
    assert.deepEqual(flightSimulator.getState().route.completedWaypointIds, progressBeforeReplacement.completedWaypointIds)
  }
  while (flightSimulator.getState().mission.outcome === 'in_progress' && flightSimulator.getState().elapsedSeconds < 900) {
    flightSimulator.advanceForTesting(1)
  }
  const terminal = flightSimulator.getState()
  assert.equal(terminal.mission.outcome, 'landed', `Seed ${seed} autopilot ended as ${terminal.mission.outcome}`)
}

flightSimulator.reset(17)
assert.ok(flightSimulator.startFlight('agent'))
const unsafeProgram: FlightPlanProgram = {
  plan: 'continue_kmdw',
  commands: [
    { id: 'never-rotate', when: { type: 'immediate' }, lateral: { mode: 'heading', headingDeg: 124 }, vertical: { mode: 'pitch', pitchDeg: 0 }, energy: { mode: 'throttle', throttle: 1 }, gearDown: true, flapsDeg: 10 },
    { id: 'unreachable-climb', when: { type: 'altitude_at_least', value: 6_000 }, lateral: { mode: 'track_fix', waypointId: 'KSTL_CLIMB' }, vertical: { mode: 'pitch', pitchDeg: 10 }, energy: { mode: 'throttle', throttle: 1 }, gearDown: false, flapsDeg: 10 },
  ],
}
assert.equal(flightSimulator.programFlightPlan(unsafeProgram, 'Deliberately unsafe no-rotation program.', 'agent').accepted, true)
flightSimulator.advanceForTesting(180)
assert.notEqual(flightSimulator.getState().mission.outcome, 'landed', 'The simulator must not rescue an unsafe command program')
assert.equal(flightSimulator.getState().autopilot.activeCommandIndex, 0)

console.log('simulation diagnostics passed')
