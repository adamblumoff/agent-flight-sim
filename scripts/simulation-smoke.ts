import assert from 'node:assert/strict'
import { flightSimulator, landingRollAccelerationKtPerSecond } from '../src/sim/flightSimulator.ts'
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

flightSimulator.reset(17)
assert.equal(flightSimulator.getState().checkride.score.total, 100)
assert.deepEqual(flightSimulator.getState().checkride.score.deductions, [])
assert.equal(flightSimulator.getState().checkride.deadlineSeconds, 540)
flightSimulator.transferControl('agent', 'agent', 'Simulation smoke test')
assert.equal(flightSimulator.getState().mission.phase, 'preflight')
assert.equal(flightSimulator.getState().route.plan, 'unassigned')

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

flightSimulator.advanceForTesting(35)
const checkpoint = await flightSimulator.waitForFlightEvent({ afterRevision: 0, events: ['checkpoint_reached'], timeoutMs: 1_000 })
assert.equal(checkpoint.event, 'checkpoint_reached')
assert.equal(checkpoint.state.route.completedWaypointIds[0], 'NORTH_FIELD_CLIMB')
assert.equal(checkpoint.state.mission.nextFix, 'LAKESIDE_ENROUTE')

flightSimulator.advanceForTesting(12)
const emergency = await flightSimulator.waitForFlightEvent({ afterRevision: checkpoint.revision, events: ['emergency_detected'], timeoutMs: 1_000 })
assert.equal(emergency.event, 'emergency_detected')
assert.ok((emergency.state.checkride.decisionSecondsRemaining ?? 0) > 40)
assert.equal(emergency.state.route.plan, 'continue_klak')

flightSimulator.inspectEvidence('weather')
flightSimulator.inspectEvidence('cockpit')
const reroute = flightSimulator.setRoute('return_kpwk', 'Weather remains usable, but engine indications require the nearby priority runway.', 'agent')
assert.equal(reroute.accepted, true)
assert.equal(reroute.state.route.destination, 'KPWK')
assert.equal(reroute.state.checkride.decisionSecondsRemaining, null)
assert.equal(reroute.state.route.completedWaypointIds.length, 0)
assert.equal(reroute.state.mission.nextFix, 'KPWK_TURN_1')

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

flightSimulator.reset(81)
flightSimulator.transferControl('agent', 'agent', 'Decision timer smoke test')
flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
flightSimulator.beginTakeoff('agent', 'Begin timer smoke test departure')
flightSimulator.advanceForTesting(91)
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
flightSimulator.setPilotControls({ pitchAxis: 0, bankAxis: 1 }, 'human', 'Sustained maximum-bank input')
flightSimulator.advanceForTesting(12)
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
for (let elapsed = 0; elapsed < 540 && flightSimulator.getState().mission.outcome === 'in_progress'; elapsed += 0.1) {
  const state = flightSimulator.getState()
  if (state.checkride.status === 'decision_required' && state.route.plan !== 'return_kpwk') {
    flightSimulator.inspectEvidence('weather')
    flightSimulator.inspectEvidence('cockpit')
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
assert.ok(completedMission.checkride.deadlineSeconds - completedMission.elapsedSeconds > 30)

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
