import assert from 'node:assert/strict'
import { flightSimulator } from '../src/sim/flightSimulator.ts'

flightSimulator.reset(17)
flightSimulator.transferControl('agent', 'agent', 'Simulation smoke test')
assert.equal(flightSimulator.getState().mission.phase, 'preflight')
assert.equal(flightSimulator.getState().route.plan, 'unassigned')

const preflight = flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
assert.equal(preflight.accepted, true)
assert.equal(preflight.state.mission.phase, 'takeoff')
assert.equal(preflight.state.route.destination, 'KLAK')
assert.ok(preflight.state.mission.distanceToThresholdNm > 10)

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

flightSimulator.reset(81)
flightSimulator.transferControl('agent', 'agent', 'Decision timer smoke test')
flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
flightSimulator.advanceForTesting(91)
const timerExpired = await flightSimulator.waitForFlightEvent({ afterRevision: 0, events: ['decision_timer_expired'], timeoutMs: 1_000 })
assert.equal(timerExpired.event, 'decision_timer_expired')
assert.equal(timerExpired.state.checkride.decisionSecondsRemaining, 0)
assert.equal(timerExpired.state.checkride.score.total, 85)

flightSimulator.reset(42)
flightSimulator.transferControl('agent', 'agent', 'Passenger dynamics smoke test')
flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
flightSimulator.advanceForTesting(25)
flightSimulator.transferControl('human', 'human', 'Test pilot began abrupt maneuvering')
flightSimulator.setThrottle(1, 'human', 'Maintain maneuvering power')
for (let index = 0; index < 56; index += 1) {
  flightSimulator.setPilotControls({
    pitchAxis: index % 2 === 0 ? 1 : -1,
    bankAxis: index % 4 < 2 ? 1 : -1,
  }, 'human', 'Abrupt alternating control input')
  flightSimulator.advanceForTesting(0.35)
}
flightSimulator.releasePilotControls()
const passengerSafety = flightSimulator.getState().passengerSafety
assert.ok(passengerSafety.distress > 0)
assert.ok(passengerSafety.jerkGPerSecond > 0 || passengerSafety.injuryProbability > 0)
const passengerEvent = await flightSimulator.waitForFlightEvent({ afterRevision: 0, events: ['passenger_safety_update'], timeoutMs: 1_000 })
assert.equal(passengerEvent.event, 'passenger_safety_update')

flightSimulator.reset(17)
flightSimulator.transferControl('agent', 'agent', 'Full mission smoke test')
flightSimulator.setRoute('continue_klak', 'Normal preflight route filed before takeoff.', 'agent')
for (let elapsed = 0; elapsed < 420 && flightSimulator.getState().mission.outcome === 'in_progress'; elapsed += 0.1) {
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
assert.equal(completedMission.passengerSafety.status, 'comfortable')

console.log(JSON.stringify({
  checkpoint: checkpoint.message,
  emergencyTimerSeconds: emergency.state.checkride.decisionSecondsRemaining,
  timerExpiredScore: timerExpired.state.checkride.score.total,
  reroute: reroute.state.mission.nextFix,
  passengerSafety,
  landing: completedMission.debrief.landing,
}, null, 2))
