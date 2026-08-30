import assert from 'node:assert/strict'
import { flightSimulator, landingRollAccelerationKtPerSecond, navigationBearingDeg } from '../src/sim/flightSimulator.ts'
import { airborneDragKtPerSecond, groundMotionFor, stallResponseFor, turbulenceFor, windCorrectedHeadingDeg } from '../src/sim/aerodynamics.ts'

const headwind = groundMotionFor(170, 180, { visibilityMiles: 10, ceilingFt: 6_500, windDirectionDeg: 180, windSpeedKt: 12, summary: 'Test wind' }, 0, 17)
assert.ok(headwind.groundSpeedKt < 170)
assert.ok(headwind.headwindKt > 10)
const desiredTrackDeg = 159
const correctionWeather = { visibilityMiles: 10, ceilingFt: 6_500, windDirectionDeg: 190, windSpeedKt: 18, summary: 'Crosswind test' }
const correctedHeadingDeg = windCorrectedHeadingDeg(desiredTrackDeg, 140, correctionWeather, 12, 42)
const correctedMotion = groundMotionFor(140, correctedHeadingDeg, correctionWeather, 12, 42)
assert.ok(Math.abs(((correctedMotion.trackDeg - desiredTrackDeg + 540) % 360) - 180) < 0.01)
assert.ok(airborneDragKtPerSecond(230, 30, true, 0) > airborneDragKtPerSecond(230, 0, false, 0))
assert.ok(airborneDragKtPerSecond(230, 0, false, 0) > airborneDragKtPerSecond(140, 0, false, 0))
assert.ok(stallResponseFor(100, 18, 0, 0, 0).severity > 0.5)
const turbulenceSamples = Array.from({ length: 180 }, (_, second) => turbulenceFor(correctionWeather, second, 42))
assert.ok(turbulenceSamples.some((sample) => sample.level !== 'none'))
assert.ok(turbulenceSamples.every((sample) => Math.abs(sample.verticalAccelerationFpmPerSecond) < 300))
assert.ok(landingRollAccelerationKtPerSecond(1, 1) > 0)
assert.ok(landingRollAccelerationKtPerSecond(0, 1) < 0)
assert.ok(Math.abs(navigationBearingDeg({ lat: 42, lon: -88 }, { lat: 42, lon: -87.9 }) - 90) < 0.1)

flightSimulator.reset(17)
assert.equal(flightSimulator.getState().checkride.score.total, 100)
assert.deepEqual(flightSimulator.getState().checkride.score.deductions, [])
assert.equal(flightSimulator.getState().checkride.deadlineSeconds, 600)
flightSimulator.transferControl('agent', 'agent', 'Simulation smoke test')
assert.equal(flightSimulator.getState().mission.phase, 'preflight')
assert.equal(flightSimulator.getState().route.plan, 'unassigned')
flightSimulator.getDecisionContext()

const preflight = flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
assert.equal(preflight.accepted, true)
assert.equal(preflight.state.mission.phase, 'preflight')
assert.equal(preflight.state.route.destination, 'KLAK')
assert.ok(preflight.state.mission.distanceToThresholdNm > 10)
flightSimulator.advanceForTesting(10)
assert.equal(flightSimulator.getState().airspeedKt, 0)
assert.equal(flightSimulator.getState().throttle, 0)
assert.equal(flightSimulator.beginTakeoff('agent', 'Route filed and departure clearance received.').accepted, true)
assert.equal(flightSimulator.getState().mission.phase, 'takeoff')

let peakTakeoffPitchDeg = 0
let peakTakeoffRotationRateDegPerSecond = 0
let previousTakeoffPitchDeg = flightSimulator.getState().pitchDeg
for (let elapsed = 0; elapsed < 40; elapsed += 0.1) {
  flightSimulator.advanceForTesting(0.1)
  const state = flightSimulator.getState()
  peakTakeoffPitchDeg = Math.max(peakTakeoffPitchDeg, state.pitchDeg)
  peakTakeoffRotationRateDegPerSecond = Math.max(peakTakeoffRotationRateDegPerSecond, (state.pitchDeg - previousTakeoffPitchDeg) / 0.1)
  previousTakeoffPitchDeg = state.pitchDeg
}
assert.ok(peakTakeoffPitchDeg >= 12.4, `Expected 12.5° initial pitch, reached ${peakTakeoffPitchDeg.toFixed(1)}°`)
assert.ok(peakTakeoffRotationRateDegPerSecond <= 3.05, `Rotation exceeded 3°/s: ${peakTakeoffRotationRateDegPerSecond.toFixed(2)}°/s`)
const checkpoint = await flightSimulator.waitForFlightEvent({ afterRevision: 0, events: ['checkpoint_reached'], timeoutMs: 1_000 })
assert.equal(checkpoint.event, 'checkpoint_reached')
assert.equal(checkpoint.state.route.completedWaypointIds[0], 'NORTH_FIELD_CLIMB')
assert.equal(checkpoint.state.mission.nextFix, 'LAKESIDE_ENROUTE')
assert.equal(checkpoint.state.mission.captureRadiusNm, 0.8)

flightSimulator.advanceForTesting(7)
const emergency = await flightSimulator.waitForFlightEvent({ afterRevision: checkpoint.revision, events: ['emergency_detected'], timeoutMs: 1_000 })
assert.equal(emergency.event, 'emergency_detected')
assert.ok((emergency.state.checkride.decisionSecondsRemaining ?? 0) > 40)
assert.equal(emergency.state.route.plan, 'continue_klak')
assert.equal(flightSimulator.setRoute('return_kpwk', 'Attempted without the combined context.', 'agent').accepted, false)

const decisionContext = flightSimulator.getDecisionContext()
assert.equal(decisionContext.evidence.length, 4)
assert.equal(decisionContext.routeOptions.length, 2)
assert.equal(decisionContext.routeOptions.find((option) => option.recommended)?.plan, 'return_kpwk')
assert.ok((decisionContext.routeOptions.find((option) => option.plan === 'return_kpwk')?.estimatedMinutes ?? 0) > 4)
const lakesideOption = decisionContext.routeOptions.find((option) => option.plan === 'continue_klak')
assert.equal(lakesideOption?.runway, '04')
assert.ok((lakesideOption?.estimatedMinutes ?? 0) > 3)
assert.ok((lakesideOption?.estimatedMinutes ?? Number.POSITIVE_INFINITY) * 60 + flightSimulator.getState().elapsedSeconds < flightSimulator.getState().checkride.deadlineSeconds)
assert.equal(flightSimulator.getState().checkride.inspectedSources.length, 4)
assert.equal(flightSimulator.rebuildActiveLeg('direct_intercept', 'Do not rewrite a healthy route.', 'agent').accepted, false)
const reroute = flightSimulator.setRoute('return_kpwk', 'Weather remains usable, but engine indications require the nearby priority runway.', 'agent')
assert.equal(reroute.accepted, true)
assert.equal(reroute.state.route.destination, 'KPWK')
assert.equal(reroute.state.checkride.decisionSecondsRemaining, null)
assert.equal(reroute.state.route.completedWaypointIds.length, 0)
assert.equal(reroute.state.mission.nextFix, 'KPWK_TURN_1')
const missedRouteState = flightSimulator.getState()
const missedRouteFix = missedRouteState.route.waypoints[missedRouteState.route.activeWaypointIndex]
flightSimulator.setAutopilotTargets({ headingDeg: (navigationBearingDeg(missedRouteState, missedRouteFix) + 180) % 360, lateralMode: 'heading' }, 'agent', 'Deliberately miss the route to exercise recovery')
flightSimulator.advanceForTesting(45)
const stalledRoute = await flightSimulator.waitForFlightEvent({ afterRevision: emergency.revision, events: ['route_progress_stalled'], timeoutMs: 1_000 })
assert.equal(stalledRoute.event, 'route_progress_stalled', JSON.stringify({ mission: flightSimulator.getState().mission, route: flightSimulator.getState().route, heading: flightSimulator.getState().headingDeg, autopilot: flightSimulator.getState().autopilot }))
assert.equal(flightSimulator.getState().mission.routeStatus, 'stalled')
assert.equal(flightSimulator.rebuildActiveLeg('direct_intercept', 'Recover the deliberately missed route.', 'agent').accepted, true)

flightSimulator.reset(17)
flightSimulator.setRoute('continue_klak', 'Pilot filed the route before applying power.', 'human')
flightSimulator.advanceForTesting(3)
assert.equal(flightSimulator.getState().mission.phase, 'preflight')
assert.equal(flightSimulator.getState().airspeedKt, 0)
flightSimulator.setThrottle(1, 'human', 'Pilot applied takeoff power')
assert.equal(flightSimulator.getState().mission.phase, 'takeoff')
flightSimulator.advanceForTesting(2)
assert.ok(flightSimulator.getState().airspeedKt > 0)

flightSimulator.setPilotControls({ pitchAxis: 1, bankAxis: 0 }, 'human', 'Pilot rotated for takeoff')
flightSimulator.advanceForTesting(4)
flightSimulator.releasePilotControls()
flightSimulator.advanceForTesting(42)
const humanEmergency = await flightSimulator.waitForFlightEvent({ afterRevision: 0, events: ['emergency_detected'], timeoutMs: 1_000 })
assert.equal(humanEmergency.event, 'emergency_detected')
const humanRoute = flightSimulator.getState()
assert.equal(humanRoute.controlOwner, 'human')
assert.equal(humanRoute.route.plan, 'return_kpwk')
assert.equal(humanRoute.route.destination, 'KPWK')
assert.equal(humanRoute.checkride.status, 'resolved')
assert.equal(humanRoute.checkride.decisionSecondsRemaining, null)
assert.equal(humanRoute.autopilot.enabled, false)
const humanPlanUpdate = await flightSimulator.waitForFlightEvent({ afterRevision: humanEmergency.revision, events: ['plan_updated'], timeoutMs: 1_000 })
assert.equal(humanPlanUpdate.event, 'plan_updated')

flightSimulator.reset(42)
flightSimulator.transferControl('agent', 'agent', 'Pilot override regression')
flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
flightSimulator.beginTakeoff('agent', 'Begin pilot override regression')
flightSimulator.advanceForTesting(46)
assert.equal(flightSimulator.getState().checkride.status, 'decision_required')
flightSimulator.transferControl('human', 'human', 'Pilot took control before the emergency event was consumed')
const overrideRoute = flightSimulator.getState()
assert.equal(overrideRoute.controlOwner, 'human')
assert.equal(overrideRoute.route.plan, 'return_kpwk')
assert.equal(overrideRoute.checkride.status, 'resolved')
assert.equal(overrideRoute.checkride.decisionSecondsRemaining, null)
assert.equal(overrideRoute.autopilot.enabled, false)

flightSimulator.reset(81)
flightSimulator.transferControl('agent', 'agent', 'Decision timer smoke test')
flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
flightSimulator.beginTakeoff('agent', 'Begin timer smoke test departure')
flightSimulator.advanceForTesting(46)
const deliveredEmergency = await flightSimulator.waitForFlightEvent({ afterRevision: 0, events: ['emergency_detected'], timeoutMs: 1_000 })
assert.equal(deliveredEmergency.event, 'emergency_detected')
flightSimulator.getDecisionContext()
flightSimulator.advanceForTesting(61)
const timerExpired = await flightSimulator.waitForFlightEvent({ afterRevision: 0, events: ['decision_timer_expired'], timeoutMs: 1_000 })
assert.equal(timerExpired.event, 'decision_timer_expired')
assert.equal(timerExpired.state.checkride.decisionSecondsRemaining, 0)
assert.equal(timerExpired.state.checkride.score.total, 85)

flightSimulator.reset(17)
flightSimulator.transferControl('agent', 'agent', 'Passenger comfort smoke test')
flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
flightSimulator.beginTakeoff('agent', 'Begin passenger comfort departure')
flightSimulator.advanceForTesting(40)
flightSimulator.transferControl('human', 'human', 'Test pilot began smooth maneuvering')
const pitchBeforeTap = flightSimulator.getState().pitchDeg
for (let index = 0; index < 12; index += 1) {
  flightSimulator.setPilotControls({
    pitchAxis: index % 2 === 0 ? 1 : -1,
    bankAxis: index % 4 < 2 ? 1 : -1,
  }, 'human', 'Brief keyboard input')
  flightSimulator.advanceForTesting(0.1)
  flightSimulator.releasePilotControls()
  flightSimulator.advanceForTesting(0.45)
}
const comfortablePassengers = flightSimulator.getState().passengerSafety
assert.ok(Math.abs(flightSimulator.getState().pitchDeg - pitchBeforeTap) < 2)
assert.equal(comfortablePassengers.status, 'comfortable')
assert.ok(comfortablePassengers.distress < 10)

flightSimulator.reset(42)
flightSimulator.transferControl('agent', 'agent', 'Passenger dynamics smoke test')
flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
flightSimulator.beginTakeoff('agent', 'Begin passenger dynamics departure')
flightSimulator.advanceForTesting(40)
flightSimulator.transferControl('human', 'human', 'Test pilot began abrupt maneuvering')
flightSimulator.setThrottle(1, 'human', 'Maintain maneuvering power')
const bankBeforeHold = flightSimulator.getState().bankDeg
flightSimulator.setPilotControls({ pitchAxis: 0, bankAxis: 1 }, 'human', 'Sustained maximum-bank input')
flightSimulator.advanceForTesting(1)
assert.ok(Math.abs(flightSimulator.getState().bankDeg - bankBeforeHold) < 10)
flightSimulator.advanceForTesting(17)
flightSimulator.releasePilotControls()
const passengerSafety = flightSimulator.getState().passengerSafety
assert.ok(passengerSafety.distress > 0)
assert.ok(passengerSafety.loadFactorG > 1.5)
assert.ok(passengerSafety.status === 'distressed' || passengerSafety.status === 'injured')
assert.ok(flightSimulator.getState().checkride.score.total < 100)
assert.ok(flightSimulator.getState().checkride.score.deductions.some((deduction) => deduction.reason.includes('G maneuver')))
const passengerEvent = await flightSimulator.waitForFlightEvent({ afterRevision: 0, events: ['passenger_safety_update'], timeoutMs: 1_000 })
assert.equal(passengerEvent.event, 'passenger_safety_update')

flightSimulator.reset(17)
flightSimulator.transferControl('agent', 'agent', 'Full mission smoke test')
flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
flightSimulator.beginTakeoff('agent', 'Begin full mission departure')
for (let elapsed = 0; elapsed < 600 && flightSimulator.getState().mission.outcome === 'in_progress'; elapsed += 0.1) {
  const state = flightSimulator.getState()
  if (state.checkride.status === 'decision_required' && state.route.plan !== 'return_kpwk') {
    flightSimulator.getDecisionContext()
    flightSimulator.setRoute('return_kpwk', 'Immediate KPWK return after reassessing the changed conditions.', 'agent')
  }
  const current = flightSimulator.getState()
  if (!current.procedure.compliant) {
    flightSimulator.configureAircraft({
      gearDown: current.procedure.gearDown,
      flapsDeg: current.procedure.flapsDeg,
      reason: current.procedure.instruction,
    }, 'agent')
  }
  flightSimulator.advanceForTesting(0.1)
}
const completedMission = flightSimulator.getState()
if (completedMission.mission.outcome !== 'landed') {
  console.error(JSON.stringify({
    outcome: completedMission.mission.outcome,
    landing: completedMission.debrief.landing,
    impact: completedMission.impact,
    route: completedMission.route,
    motion: completedMission.motion,
    procedure: completedMission.procedure,
  }, null, 2))
}
assert.equal(completedMission.mission.outcome, 'landed')
assert.equal(completedMission.debrief.landing?.safe, true)
assert.ok(completedMission.route.completedWaypointIds.includes('KPWK_TOUCHDOWN'))
assert.ok(completedMission.route.completedWaypointIds.filter((id) => id.startsWith('KPWK_TURN_')).length <= 3)
assert.equal(completedMission.passengerSafety.status, 'comfortable')
assert.ok(completedMission.elapsedSeconds > 300)
assert.ok(completedMission.elapsedSeconds < completedMission.checkride.deadlineSeconds)
const unexpectedRouteStalls = flightSimulator.getTrace().filter((event) => event.action === 'route_progress_stalled')
assert.equal(unexpectedRouteStalls.length, 0, JSON.stringify(unexpectedRouteStalls))

for (const seed of [42, 81] as const) {
  flightSimulator.reset(seed)
  flightSimulator.transferControl('agent', 'agent', `Seed ${seed} route regression`)
  flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
  flightSimulator.beginTakeoff('agent', `Begin seed ${seed} departure`)
  for (let elapsed = 0; elapsed < 600 && flightSimulator.getState().mission.outcome === 'in_progress'; elapsed += 0.1) {
    const state = flightSimulator.getState()
    if (state.checkride.status === 'decision_required' && state.route.plan !== 'return_kpwk') {
      flightSimulator.getDecisionContext()
      flightSimulator.setRoute('return_kpwk', 'The combined context favors the nearby priority runway.', 'agent')
    }
    const current = flightSimulator.getState()
    if (!current.procedure.compliant) flightSimulator.configureAircraft({ gearDown: current.procedure.gearDown, flapsDeg: current.procedure.flapsDeg, reason: current.procedure.instruction }, 'agent')
    flightSimulator.advanceForTesting(0.1)
  }
  assert.equal(flightSimulator.getState().mission.outcome, 'landed', `Seed ${seed} should land: ${JSON.stringify({ landing: flightSimulator.getState().debrief.landing, impact: flightSimulator.getState().impact, route: flightSimulator.getState().route, mission: flightSimulator.getState().mission })}`)
  assert.equal(flightSimulator.getState().passengerSafety.status, 'comfortable', `Seed ${seed} should preserve passenger comfort`)
  assert.ok(flightSimulator.getState().elapsedSeconds < flightSimulator.getState().checkride.deadlineSeconds, `Seed ${seed} should finish inside ten minutes`)
}

for (const seed of [17, 42, 81] as const) {
  flightSimulator.reset(seed)
  flightSimulator.transferControl('agent', 'agent', `Seed ${seed} Lakeside continuation regression`)
  flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
  flightSimulator.beginTakeoff('agent', 'Begin Lakeside continuation')
  for (let elapsed = 0; elapsed < 600 && flightSimulator.getState().mission.outcome === 'in_progress'; elapsed += 0.1) {
    const state = flightSimulator.getState()
    if (state.checkride.status === 'decision_required') {
      flightSimulator.getDecisionContext()
      flightSimulator.setRoute('continue_klak', 'Continue to Lakeside after reviewing the combined context.', 'agent')
    }
    const current = flightSimulator.getState()
    if (!current.procedure.compliant) flightSimulator.configureAircraft({ gearDown: current.procedure.gearDown, flapsDeg: current.procedure.flapsDeg, reason: current.procedure.instruction }, 'agent')
    flightSimulator.advanceForTesting(0.1)
  }
  const lakesideMission = flightSimulator.getState()
  assert.equal(lakesideMission.mission.outcome, 'landed', `Seed ${seed} should complete the Lakeside continuation: ${JSON.stringify({ landing: lakesideMission.debrief.landing, impact: lakesideMission.impact, fuel: lakesideMission.fuelMinutesRemaining })}`)
  assert.equal(lakesideMission.debrief.landing?.runway, 'KLAK 04')
  assert.equal(lakesideMission.debrief.landing?.safe, true)
  assert.ok(lakesideMission.fuelMinutesRemaining > 0)
  assert.ok(lakesideMission.elapsedSeconds < lakesideMission.checkride.deadlineSeconds, `Seed ${seed} should complete the Lakeside continuation inside ten minutes`)
}

console.log(JSON.stringify({
  checkpoint: checkpoint.message,
  emergencyTimerSeconds: emergency.state.checkride.decisionSecondsRemaining,
  timerExpiredScore: timerExpired.state.checkride.score.total,
  reroute: reroute.state.mission.nextFix,
  passengerSafety,
  emergencyTurnFixes: completedMission.route.completedWaypointIds.filter((id) => id.startsWith('KPWK_TURN_')).length,
  missionElapsedSeconds: completedMission.elapsedSeconds,
  missionRemainingSeconds: completedMission.checkride.deadlineSeconds - completedMission.elapsedSeconds,
  landing: completedMission.debrief.landing,
}, null, 2))
