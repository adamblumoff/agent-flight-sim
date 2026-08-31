import assert from 'node:assert/strict'
import { flightToolDefinitionsFor } from '../src/shared/flightTools.ts'
import { executeFlightTool, executeFlightToolFromUnknown } from '../src/shared/executeFlightTool.ts'
import { flightSimulator, landingRollAccelerationKtPerSecond, navigationBearingDeg } from '../src/sim/flightSimulator.ts'
import { airborneDragKtPerSecond, groundMotionFor, stallResponseFor, turbulenceFor, windCorrectedHeadingDeg } from '../src/sim/aerodynamics.ts'
import { CONCORDE_ENVELOPE } from '../src/sim/aircraftEnvelope.ts'
import type { AtcClearance, DiversionPlan } from '../src/sim/types.ts'

const clearanceReadback = (clearance: AtcClearance) => `${clearance.destination} runway ${clearance.runway}, maintain ${clearance.altitudeFt} feet, initial heading ${Math.round(clearance.headingDeg)} degrees.`
const manageEmergencyClearance = (plan: DiversionPlan, reason: string) => {
  const state = flightSimulator.getState()
  if (state.checkride.status !== 'decision_required') return
  if (!state.checkride.decisionContextRead) flightSimulator.getDecisionContext()
  const atc = flightSimulator.getState().atc
  if (atc.status === 'none') flightSimulator.requestDiversion(plan, reason, 'agent')
  if (atc.status === 'cleared' && atc.clearance) flightSimulator.acceptAtcClearance(atc.clearance.id, clearanceReadback(atc.clearance), 'agent')
}

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
assert.throws(() => flightSimulator.getDecisionContext(), /sealed until emergency_detected/)

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
assert.equal(flightSimulator.setRoute('return_kstl', 'Attempted without the combined context.', 'agent').accepted, false)

const decisionContext = flightSimulator.getDecisionContext()
assert.equal(decisionContext.evidence.length, 4)
assert.equal(decisionContext.routeOptions.length, 2)
assert.equal(decisionContext.routeOptions.find((option) => option.recommended)?.plan, 'return_kstl')
assert.ok((decisionContext.routeOptions.find((option) => option.plan === 'return_kstl')?.estimatedMinutes ?? 0) > 3)
const lakesideOption = decisionContext.routeOptions.find((option) => option.plan === 'continue_klak')
assert.equal(lakesideOption?.runway, '04')
assert.ok((lakesideOption?.estimatedMinutes ?? 0) > 3)
assert.ok((lakesideOption?.estimatedMinutes ?? Number.POSITIVE_INFINITY) * 60 + flightSimulator.getState().elapsedSeconds < flightSimulator.getState().checkride.deadlineSeconds)
assert.equal(flightSimulator.getState().checkride.inspectedSources.length, 4)
assert.equal(flightSimulator.rebuildActiveLeg('direct_intercept', 'Do not rewrite a healthy route.', 'agent').accepted, false)
assert.equal(flightSimulator.setRoute('return_kstl', 'Attempt to bypass ATC after reading the context.', 'agent').accepted, false)
const diversionRequest = flightSimulator.requestDiversion('return_kstl', 'Weather remains usable, but engine indications require the nearby priority runway.', 'agent')
assert.equal(diversionRequest.accepted, true)
assert.equal(diversionRequest.state.atc.status, 'requested')
assert.equal(diversionRequest.state.route.destination, 'KLAK')
flightSimulator.advanceForTesting(2.1)
const atcEvent = await flightSimulator.waitForFlightEvent({ afterRevision: emergency.revision, events: ['atc_clearance_received'], timeoutMs: 1_000 })
assert.equal(atcEvent.event, 'atc_clearance_received')
assert.equal(atcEvent.state.atc.status, 'cleared')
assert.equal(atcEvent.state.route.destination, 'KLAK')
const clearance = atcEvent.state.atc.clearance
assert.ok(clearance)
assert.equal(flightSimulator.acceptAtcClearance(clearance.id, 'KSTL runway 30L', 'agent').accepted, false)
const reroute = flightSimulator.acceptAtcClearance(clearance.id, clearanceReadback(clearance), 'agent')
assert.equal(reroute.accepted, true)
assert.equal(reroute.state.atc.status, 'accepted')
assert.equal(reroute.state.route.destination, 'KSTL')
assert.equal(reroute.state.checkride.decisionSecondsRemaining, null)
assert.equal(reroute.state.route.completedWaypointIds.length, 0)
assert.equal(reroute.state.mission.nextFix, 'KSTL_TURN_1')
const missedRouteState = flightSimulator.getState()
const missedRouteFix = missedRouteState.route.waypoints[missedRouteState.route.activeWaypointIndex]
flightSimulator.setAutopilotTargets({ headingDeg: (navigationBearingDeg(missedRouteState, missedRouteFix) + 90) % 360, lateralMode: 'heading' }, 'agent', 'Deliberately miss the route to exercise recovery')
// Allow the standard 60-second convergence watchdog to fire while the
// deliberately divergent heading is still on the KSTL intercept leg.
flightSimulator.advanceForTesting(70)
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
assert.equal(humanRoute.route.plan, 'return_kstl')
assert.equal(humanRoute.route.destination, 'KSTL')
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
assert.equal(overrideRoute.route.plan, 'return_kstl')
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
  manageEmergencyClearance('return_kstl', 'Immediate KSTL return after reassessing the changed conditions.')
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
    mission: completedMission.mission,
    position: { lat: completedMission.lat, lon: completedMission.lon, headingDeg: completedMission.headingDeg, altitudeFt: completedMission.altitudeFt },
    route: completedMission.route,
    motion: completedMission.motion,
    procedure: completedMission.procedure,
  }, null, 2))
}
assert.equal(completedMission.mission.outcome, 'landed')
assert.equal(completedMission.debrief.landing?.safe, true)
assert.ok(completedMission.route.completedWaypointIds.includes('KSTL_TOUCHDOWN'))
assert.ok(completedMission.route.completedWaypointIds.filter((id) => id.startsWith('KSTL_TURN_')).length <= 3)
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
    manageEmergencyClearance('return_kstl', 'The combined context favors the nearby priority runway.')
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
    manageEmergencyClearance('continue_klak', 'Continue to Lakeside after reviewing the combined context.')
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

const judgeResults = []
const judgeConfigurationTool = flightToolDefinitionsFor('judge').find(({ name }) => name === 'configure_aircraft')
const fullConfigurationTool = flightToolDefinitionsFor('full').find(({ name }) => name === 'configure_aircraft')
assert.ok(judgeConfigurationTool)
assert.ok(fullConfigurationTool)
assert.deepEqual((judgeConfigurationTool.inputSchema.properties as { flapsDeg: { enum: readonly number[] } }).flapsDeg.enum, [0])
assert.ok(!judgeConfigurationTool.description.includes('10°'))
assert.deepEqual((fullConfigurationTool.inputSchema.properties as { flapsDeg: { enum: readonly number[] } }).flapsDeg.enum, [0, 10, 20, 30])
for (const seed of [17, 42, 81] as const) {
  flightSimulator.reset(seed, 'judge')
  flightSimulator.transferControl('agent', 'agent', `Judge seed ${seed} regression`)
  assert.equal(flightSimulator.getState().flapsDeg, 0)
  assert.ok(flightSimulator.getMissionBrief().successConditions.some((condition) => condition.includes('no conventional flaps')))
  assert.equal(flightSimulator.configureAircraft({ flapsDeg: 10, reason: 'Reject conventional flap use on Concorde.' }, 'agent').accepted, false)
  flightSimulator.setRoute('continue_klak', 'Normal route filed for the judge episode.', 'agent')
  flightSimulator.beginTakeoff('agent', 'Begin compressed judge episode')
  let rotationSpeedKt: number | null = null
  let airborneSpeedKt: number | null = null
  for (let elapsed = 0; elapsed < 720 && flightSimulator.getState().mission.outcome === 'in_progress'; elapsed += 0.1) {
    manageEmergencyClearance('return_kstl', 'Use the nearby priority runway in judge mode.')
    const current = flightSimulator.getState()
    if (!current.procedure.compliant) flightSimulator.configureAircraft({ gearDown: current.procedure.gearDown, flapsDeg: current.procedure.flapsDeg, reason: current.procedure.instruction }, 'agent')
    flightSimulator.advanceForTesting(0.1)
    const advanced = flightSimulator.getState()
    if (rotationSpeedKt === null && advanced.pitchDeg > 0.1) rotationSpeedKt = advanced.airspeedKt
    if (airborneSpeedKt === null && advanced.aircraftPhase === 'airborne') airborneSpeedKt = advanced.airspeedKt
    assert.equal(advanced.flapsDeg, 0)
  }
  const judgeState = flightSimulator.getState()
  judgeResults.push({ seed, outcome: judgeState.mission.outcome, elapsedSeconds: judgeState.elapsedSeconds, score: judgeState.checkride.score.total, rotationSpeedKt, airborneSpeedKt, nextFix: judgeState.mission.nextFix, distanceToNextFixNm: judgeState.mission.distanceToNextFixNm, route: judgeState.route.completedWaypointIds, landing: judgeState.debrief.landing, impact: judgeState.impact, position: { lat: judgeState.lat, lon: judgeState.lon, altitudeFt: judgeState.altitudeFt, headingDeg: judgeState.headingDeg, airspeedKt: judgeState.airspeedKt } })
  assert.equal(judgeState.checkride.deadlineSeconds, 720)
  assert.equal(judgeState.checkride.wallClockDeadlineSeconds, 240)
  assert.equal(judgeState.checkride.simulationRate, 3)
  assert.ok((rotationSpeedKt ?? 0) >= CONCORDE_ENVELOPE.rotateSpeedKt - 1 && (rotationSpeedKt ?? Number.POSITIVE_INFINITY) <= CONCORDE_ENVELOPE.rotateSpeedKt + 2, `Judge seed ${seed} should begin rotation at VR: ${rotationSpeedKt}`)
  assert.ok((airborneSpeedKt ?? 0) >= CONCORDE_ENVELOPE.takeoffSafetySpeedKt, `Judge seed ${seed} should reach V2 by the 35-foot phase transition: ${airborneSpeedKt}`)
  assert.equal(judgeState.mission.outcome, 'landed', `Judge seed ${seed} should land: ${JSON.stringify(judgeResults.at(-1))}`)
  assert.ok(judgeState.elapsedSeconds / judgeState.checkride.simulationRate < 240, `Judge seed ${seed} should finish inside four minutes: ${JSON.stringify(judgeResults.at(-1))}`)
}

for (const seed of [17, 42, 81] as const) {
  flightSimulator.reset(seed, 'judge')
  flightSimulator.transferControl('agent', 'agent', `Judge seed ${seed} Lakeside diversion regression`)
  flightSimulator.setRoute('continue_klak', 'File the normal route before the Judge diversion test.', 'agent')
  flightSimulator.beginTakeoff('agent', 'Begin the Judge Lakeside diversion test.')
  for (let elapsed = 0; elapsed < 720 && flightSimulator.getState().mission.outcome === 'in_progress'; elapsed += 0.1) {
    manageEmergencyClearance('continue_klak', 'Continue to Lakeside runway 04 after reviewing the combined context.')
    const current = flightSimulator.getState()
    if (!current.procedure.compliant) flightSimulator.configureAircraft({ gearDown: current.procedure.gearDown, flapsDeg: current.procedure.flapsDeg, reason: current.procedure.instruction }, 'agent')
    flightSimulator.advanceForTesting(0.1)
  }
  const lakesideJudgeState = flightSimulator.getState()
  assert.equal(lakesideJudgeState.mission.outcome, 'landed', `Judge seed ${seed} should complete the advertised Lakeside diversion: ${JSON.stringify({ landing: lakesideJudgeState.debrief.landing, impact: lakesideJudgeState.impact, route: lakesideJudgeState.route.completedWaypointIds })}`)
  assert.equal(lakesideJudgeState.debrief.landing?.runway, 'KLAK 04')
  assert.equal(lakesideJudgeState.debrief.landing?.safe, true)
  assert.ok(lakesideJudgeState.elapsedSeconds / lakesideJudgeState.checkride.simulationRate < 240)
}

flightSimulator.reset(17, 'judge')
flightSimulator.transferControl('agent', 'agent', 'Delayed judge decision regression')
flightSimulator.setRoute('continue_klak', 'Normal route filed before the delayed decision test.', 'agent')
flightSimulator.beginTakeoff('agent', 'Begin delayed judge decision regression')
flightSimulator.advanceForTesting(51)
const prioritizedEmergency = await flightSimulator.waitForFlightEvent({
  afterRevision: 0,
  events: ['configuration_required', 'emergency_detected'],
  timeoutMs: 1_000,
})
assert.equal(prioritizedEmergency.event, 'emergency_detected')
const headingBeforeDecisionHold = flightSimulator.getState().headingDeg
flightSimulator.advanceForTesting(120)
const heldState = flightSimulator.getState()
assert.ok(Math.abs(heldState.bankDeg) >= 10 && Math.abs(heldState.bankDeg) <= 13, `Decision hold should use a shallow bank: ${heldState.bankDeg.toFixed(1)}°`)
assert.ok(Math.abs(((heldState.headingDeg - headingBeforeDecisionHold + 540) % 360) - 180) > 20, 'Decision hold should turn instead of extending the departure heading')
assert.ok((heldState.checkride.decisionSecondsRemaining ?? 0) >= 19, `Judge decision timer should use wall time: ${heldState.checkride.decisionSecondsRemaining}`)
flightSimulator.getDecisionContext()
flightSimulator.requestDiversion('return_kstl', 'Return to the priority runway after deliberate model thinking time.', 'agent')
flightSimulator.advanceForTesting(6.1)
const delayedClearance = flightSimulator.getState().atc.clearance
assert.ok(delayedClearance)
flightSimulator.acceptAtcClearance(delayedClearance.id, clearanceReadback(delayedClearance), 'agent')
for (let elapsed = 0; elapsed < 720 && flightSimulator.getState().mission.outcome === 'in_progress'; elapsed += 0.1) {
  const state = flightSimulator.getState()
  if (state.mission.routeStatus === 'stalled') {
    flightSimulator.rebuildActiveLeg('direct_intercept', 'Recover the delayed judge route after the convergence watchdog fired.', 'agent')
  }
  if (!state.procedure.compliant) flightSimulator.configureAircraft({ gearDown: state.procedure.gearDown, flapsDeg: state.procedure.flapsDeg, reason: state.procedure.instruction }, 'agent')
  flightSimulator.advanceForTesting(0.1)
}
const delayedJudgeState = flightSimulator.getState()
assert.equal(delayedJudgeState.mission.outcome, 'landed', `Delayed Judge flight should land: ${JSON.stringify({ elapsedSeconds: delayedJudgeState.elapsedSeconds, route: delayedJudgeState.route.completedWaypointIds, mission: delayedJudgeState.mission, landing: delayedJudgeState.debrief.landing, impact: delayedJudgeState.impact, position: { lat: delayedJudgeState.lat, lon: delayedJudgeState.lon, altitudeFt: delayedJudgeState.altitudeFt, headingDeg: delayedJudgeState.headingDeg, airspeedKt: delayedJudgeState.airspeedKt } })}`)
assert.ok(delayedJudgeState.elapsedSeconds / delayedJudgeState.checkride.simulationRate < 240, `Delayed Judge flight should finish inside four minutes: ${delayedJudgeState.elapsedSeconds / delayedJudgeState.checkride.simulationRate}`)

flightSimulator.reset(17)
for (let attempt = 0; attempt < 30; attempt += 1) {
  flightSimulator.configureAircraft({ gearDown: false, reason: `Deliberate procedure violation ${attempt + 1}` }, 'human')
}
const saturatedScore = flightSimulator.getState().checkride.score
const displayedDeductions = saturatedScore.deductions.reduce((total, deduction) => total + deduction.points, 0)
assert.equal(saturatedScore.total, 0)
assert.equal(displayedDeductions, 100, 'Displayed deductions should reconcile exactly with the final score')

const startTool = flightToolDefinitionsFor('judge').find(({ name }) => name === 'start_flight')
assert.ok(startTool)
assert.deepEqual(startTool.inputSchema.properties, {}, 'The agent must not choose a scenario seed or evaluation mode')
await assert.rejects(
  executeFlightToolFromUnknown('start_flight', { seed: 81 }),
  /takes no arguments/,
)

const preflightStates = ([17, 42, 81] as const).map((seed) => {
  flightSimulator.reset(seed, 'judge')
  const state = flightSimulator.getState()
  return { fuelMinutesRemaining: state.fuelMinutesRemaining, scenario: state.scenario }
})
assert.deepEqual(preflightStates[0], preflightStates[1])
assert.deepEqual(preflightStates[1], preflightStates[2])

const sealedDepartureStates = ([17, 42, 81] as const).map((seed) => {
  flightSimulator.reset(seed, 'judge')
  flightSimulator.transferControl('agent', 'agent', 'Sealed departure trajectory regression')
  flightSimulator.setRoute('continue_klak', 'File the same assigned route.', 'agent')
  flightSimulator.beginTakeoff('agent', 'Begin the same assigned departure.')
  flightSimulator.advanceForTesting(40)
  const state = flightSimulator.getState()
  const { seed: _seed, runId: _runId, ...checkride } = state.checkride
  return { ...state, checkride }
})
assert.deepEqual(sealedDepartureStates[0], sealedDepartureStates[1])
assert.deepEqual(sealedDepartureStates[1], sealedDepartureStates[2])

flightSimulator.reset(17, 'judge')
const rawStart = await executeFlightTool('start_flight', {})
const hasPrivateSeed = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasPrivateSeed)
  if (typeof value !== 'object' || value === null) return false
  return Object.entries(value).some(([key, nested]) => key === 'seed' || hasPrivateSeed(nested))
}
const assertSafeAgentResult = (value: unknown) => {
  const serialized = JSON.stringify(value)
  assert.equal(hasPrivateSeed(value), false, 'Live WebMCP results must not expose the private scenario seed')
  assert.doesNotMatch(serialized, /Oil pressure is dropping|intermittently unresponsive|heavy rain puts runway 30L/i)
  assert.match(serialized, /recommendedNextTool/)
}
assertSafeAgentResult(rawStart)
assert.equal(rawStart.guidance.recommendedNextTool, 'get_mission_brief')
assert.equal(rawStart.details.mode, 'judge')
assert.equal(rawStart.details.runId, rawStart.details.state.checkride.runId)
const sealedDecision = await executeFlightTool('get_decision_context', {})
assert.equal(sealedDecision.details.available, false)
assert.equal(sealedDecision.details.context, null)
assert.equal(sealedDecision.guidance.recommendedNextTool, 'get_mission_brief')

const rawBrief = await executeFlightTool('get_mission_brief', {})
assertSafeAgentResult(rawBrief)
assert.deepEqual(rawBrief.details.brief.assignedRoute, { plan: 'continue_klak', destination: 'KLAK', runway: '22' })
assert.equal(rawBrief.guidance.recommendedNextTool, 'set_route')
const rawRoute = await executeFlightTool('set_route', { plan: 'continue_klak', reason: 'File the assigned preflight route.' })
assertSafeAgentResult(rawRoute)
assert.equal(rawRoute.guidance.recommendedNextTool, 'begin_takeoff')
const rawTakeoff = await executeFlightTool('begin_takeoff', { reason: 'Assigned route filed and takeoff configuration verified.' })
assertSafeAgentResult(rawTakeoff)
assert.equal(rawTakeoff.guidance.recommendedNextTool, 'wait_for_flight_event')

flightSimulator.advanceForTesting(51)
const rawEmergency = await executeFlightTool('wait_for_flight_event', { after_revision: 0, events: ['emergency_detected'], timeout_ms: 1_000 })
assert.equal(hasPrivateSeed(rawEmergency), false)
assert.equal(rawEmergency.event, 'emergency_detected')
assert.equal(rawEmergency.guidance.recommendedNextTool, 'get_decision_context')
const rawEvidence = await executeFlightTool('inspect_flight_evidence', {})
assert.equal(rawEvidence.details.inspectedSources.length, 4)
assert.equal(rawEvidence.guidance.recommendedNextTool, 'get_decision_context')
const prematureRoute = await executeFlightTool('set_route', { plan: 'return_kstl', reason: 'Attempt a route before combined decision context.' })
assert.equal(prematureRoute.accepted, false)
assert.equal(prematureRoute.guidance.recommendedNextTool, 'get_decision_context')
const rawDecision = await executeFlightTool('get_decision_context', {})
assert.equal(hasPrivateSeed(rawDecision), false)
assert.equal(rawDecision.details.available, true)
assert.equal(rawDecision.details.context?.evidence.length, 4)
assert.equal(rawDecision.guidance.recommendedNextTool, 'request_diversion')
const rawDiversion = await executeFlightTool('request_diversion', { plan: 'return_kstl', reason: 'Request the nearby priority runway after reviewing all evidence.' })
assert.equal(rawDiversion.accepted, true)
assert.equal(rawDiversion.state.atc.status, 'requested')
assert.equal(rawDiversion.guidance.recommendedNextTool, 'wait_for_flight_event')
flightSimulator.advanceForTesting(6.1)
const rawAtcEvent = await executeFlightTool('wait_for_flight_event', { after_revision: rawEmergency.revision, events: ['atc_clearance_received'], timeout_ms: 1_000 })
assert.equal(rawAtcEvent.event, 'atc_clearance_received')
assert.equal(rawAtcEvent.state.atc.status, 'cleared')
assert.equal(rawAtcEvent.guidance.recommendedNextTool, 'accept_clearance')
const rawClearance = rawAtcEvent.state.atc.clearance
assert.ok(rawClearance)
const rawAcceptance = await executeFlightTool('accept_clearance', { clearance_id: rawClearance.id, readback: clearanceReadback(rawClearance) })
assert.equal(rawAcceptance.state.atc.status, 'accepted')
assert.equal(rawAcceptance.guidance.recommendedNextTool, 'configure_aircraft')
const humanControl = await executeFlightTool('transfer_control', { owner: 'human', reason: 'Return control for ownership guidance regression.' })
assert.equal(humanControl.details.controlOwner, 'human')
assert.equal(humanControl.guidance.recommendedNextTool, 'wait_for_flight_event')
assert.deepEqual(humanControl.guidance.allowedNextTools, ['get_flight_state', 'wait_for_flight_event'])

console.log(JSON.stringify({
  checkpoint: checkpoint.message,
  emergencyTimerSeconds: emergency.state.checkride.decisionSecondsRemaining,
  timerExpiredScore: timerExpired.state.checkride.score.total,
  reroute: reroute.state.mission.nextFix,
  passengerSafety,
  emergencyTurnFixes: completedMission.route.completedWaypointIds.filter((id) => id.startsWith('KSTL_TURN_')).length,
  missionElapsedSeconds: completedMission.elapsedSeconds,
  missionRemainingSeconds: completedMission.checkride.deadlineSeconds - completedMission.elapsedSeconds,
  landing: completedMission.debrief.landing,
  judgeResults,
  delayedJudge: { elapsedSeconds: delayedJudgeState.elapsedSeconds, score: delayedJudgeState.checkride.score.total },
}, null, 2))
