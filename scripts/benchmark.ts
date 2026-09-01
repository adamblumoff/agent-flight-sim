import { flightSimulator } from '../src/sim/flightSimulator.ts'
import type { CheckrideSeed } from '../src/sim/types.ts'

const seeds = [17, 42, 81] as const satisfies readonly CheckrideSeed[]
const runs = []

for (const seed of seeds) {
  flightSimulator.reset(seed, 'judge')
  flightSimulator.transferControl('agent', 'agent', 'Reference benchmark policy')
  flightSimulator.setRoute('continue_kmdw', 'File the normal preflight route.', 'agent')
  flightSimulator.beginTakeoff('agent', 'Begin the judge episode.')
  const maximumSteps = flightSimulator.getState().checkride.deadlineSeconds * 10
  for (let step = 0; step < maximumSteps && flightSimulator.getState().mission.outcome === 'in_progress'; step += 1) {
    const state = flightSimulator.getState()
    if (state.checkride.status === 'decision_required' && state.route.plan !== 'return_kstl') {
      if (!state.checkride.decisionContextRead) flightSimulator.getDecisionContext()
      const atc = flightSimulator.getState().atc
      if (atc.status === 'none') flightSimulator.requestDiversion('return_kstl', 'Return to the nearby priority runway.', 'agent')
      if (atc.status === 'cleared' && atc.clearance) {
        const clearance = atc.clearance
        flightSimulator.acceptAtcClearance(
          clearance.id,
          `${clearance.destination} runway ${clearance.runway}, maintain ${clearance.altitudeFt} feet, initial heading ${Math.round(clearance.headingDeg)} degrees.`,
          'agent',
        )
      }
    }
    const current = flightSimulator.getState()
    if (!current.procedure.compliant) {
      flightSimulator.configureAircraft({ gearDown: current.procedure.gearDown, flapsDeg: current.procedure.flapsDeg, reason: current.procedure.instruction }, 'agent')
    }
    flightSimulator.advanceForTesting(0.1)
  }
  const state = flightSimulator.getState()
  runs.push({
    policy: 'deterministic-reference', seed,
    completed: state.mission.outcome === 'landed',
    score: state.checkride.score.total,
    wallSeconds: Number((state.elapsedSeconds / state.checkride.simulationRate).toFixed(1)),
    invalidCalls: 0,
    passengerInjuries: state.passengerSafety.status === 'injured' ? 1 : 0,
    routeRebuilds: flightSimulator.getTrace().filter((event) => event.action === 'active_leg_rebuilt').length,
    checkpointTimes: flightSimulator.getTrace()
      .filter((event) => event.action === 'checkpoint_reached')
      .map((event) => ({ elapsedSeconds: Number(event.elapsedSeconds.toFixed(1)), waypoint: event.details.waypointName })),
    terminalState: {
      phase: state.mission.phase,
      nextFix: state.mission.nextFix,
      distanceToNextFixNm: state.mission.distanceToNextFixNm,
      altitudeFt: state.altitudeFt,
      airspeedKt: state.airspeedKt,
      headingDeg: state.headingDeg,
      bankDeg: state.bankDeg,
      groundTrackDeg: state.motion.trackDeg,
      centerlineErrorNm: state.mission.centerlineErrorNm,
      distanceToThresholdNm: state.mission.distanceToThresholdNm,
    },
    landing: state.debrief.landing,
  })
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  scope: 'Environment baseline; this is not a multi-model result.', runs,
  aggregate: {
    completionRate: runs.filter((run) => run.completed).length / runs.length,
    meanScore: runs.reduce((total, run) => total + run.score, 0) / runs.length,
    meanWallSeconds: Number((runs.reduce((total, run) => total + run.wallSeconds, 0) / runs.length).toFixed(1)),
    passengerInjuries: runs.reduce((total, run) => total + run.passengerInjuries, 0),
    routeRebuilds: runs.reduce((total, run) => total + run.routeRebuilds, 0),
  },
}, null, 2))
