import { WIDE_BODY_TWINJET_ENVELOPE } from '../sim/aircraftEnvelope'
import type { FlightState, RoutePlan } from '../sim/types'

export interface CopilotObservation {
  readonly label: string
  readonly value: string
  readonly tone?: 'normal' | 'caution' | 'critical'
}

export interface CopilotDebrief {
  readonly title: string
  readonly outcome: string
  readonly elapsed: string
  readonly score: string
  readonly decision: string
  readonly summary: string
  readonly events: readonly string[]
  readonly deductions: readonly {
    readonly elapsed: string
    readonly label: string
    readonly points: number
    readonly reason: string
  }[]
}

export const routePlanLabels: Record<RoutePlan, string> = {
  unassigned: 'Route pending',
  continue_kmdw: 'Chicago Midway',
  return_kstl: 'Return to KSTL',
}

export const formatLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase())

export const formatElapsed = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export const formatAngleMagnitude = (degrees: number) => (Math.abs(degrees) < 0.05 ? 0 : Math.abs(degrees)).toFixed(1)
export const pitchDirection = (degrees: number) => degrees > 0.05 ? '° UP' : degrees < -0.05 ? '° DN' : '° LVL'
export const bankDirection = (degrees: number) => degrees > 0.05 ? '° R' : degrees < -0.05 ? '° L' : '° LVL'

export const deductionLabel = (id: string) => {
  if (id === 'mission-timeout') return 'time limit'
  if (id === 'decision-timeout') return 'late decision'
  if (id.startsWith('configuration-')) return 'configuration'
  if (id.startsWith('high-g-')) return 'high G'
  if (id.startsWith('jerk-')) return 'abrupt input'
  if (id === 'hard-landing') return 'hard landing'
  if (id === 'off-center-landing') return 'off center'
  return id.replaceAll('-', ' ')
}

export function deriveObservations(state: FlightState): readonly CopilotObservation[] {
  const { weather, engine, passenger, traffic } = state.scenario
  const weatherTone = weather.visibilityMiles < 3 || weather.ceilingFt < 1_000
    ? 'critical'
    : weather.visibilityMiles < 5 || weather.ceilingFt < 2_000
      ? 'caution'
      : 'normal'

  return [
    {
      label: 'Weather',
      value: `${weather.summary} · ${weather.visibilityMiles} mi, ${weather.ceilingFt.toLocaleString()} ft ceiling · wind ${weather.windDirectionDeg.toString().padStart(3, '0')}° at ${weather.windSpeedKt} kt`,
      tone: weatherTone,
    },
    {
      label: 'Engine',
      value: engine.summary,
      tone: engine.health === 'failing' ? 'critical' : engine.health === 'rough' ? 'caution' : 'normal',
    },
    {
      label: 'Passenger',
      value: `${passenger.summary} ${state.passengerSafety.summary} · ${state.passengerSafety.loadFactorG.toFixed(2)} G · ${state.passengerSafety.jerkGPerSecond.toFixed(2)} G/s jerk`,
      tone: state.passengerSafety.status === 'injured' || passenger.condition === 'critical'
        ? 'critical'
        : state.passengerSafety.status === 'distressed' || state.passengerSafety.status === 'uneasy' || passenger.condition === 'urgent'
          ? 'caution'
          : 'normal',
    },
    {
      label: 'Traffic',
      value: traffic.summary,
      tone: traffic.delayMinutes >= 10 ? 'caution' : 'normal',
    },
  ]
}

export function deriveRecommendation(state: FlightState): string {
  if (state.mission.phase === 'preflight') return state.route.plan === 'unassigned'
    ? 'File the Chicago Midway runway 31C route before beginning the takeoff roll.'
    : 'The Chicago Midway route is filed. Apply power when you are ready to begin the takeoff roll.'
  if (state.mission.phase === 'takeoff') return 'Climb through 1,000 feet, clean up the aircraft, then continue on the assigned departure.'
  if (state.mission.goAroundRequired) return 'Go around now. Climb away from the ground before trying another approach.'
  if (!state.procedure.compliant) return state.procedure.instruction
  if (state.mission.routeStatus === 'stalled') return 'ATC has issued fresh arrival vectors. Follow the updated route guidance.'
  if (state.checkride.status === 'armed') return 'Departure is normal. Maintain the climb and monitor for changes.'
  if (state.checkride.status === 'decision_required') {
    if (state.atc.status === 'requested') return 'Maintain the current hold while ATC prepares the diversion clearance.'
    if (state.atc.status === 'cleared') return `Read back and accept clearance ${state.atc.clearance?.id ?? ''} before changing course.`
    return 'Review the emergency evidence, choose a diversion, and request clearance from ATC.'
  }
  if (state.flightMode === 'human' && state.route.plan === 'return_kstl') {
    return 'The safest emergency route was loaded automatically. Fly the active checkpoints to KSTL runway 30L.'
  }
  if (state.route.reason) return state.route.reason
  if (state.flightMode === 'agent' && !state.autopilot.engaged) return 'Check the current conditions before changing the route or aircraft configuration.'
  if (state.scenario.engine.health === 'failing' || state.scenario.passenger.condition === 'critical') return 'Commit to the nearby runway promptly and configure early for landing.'
  return 'Verify that the nearby runway remains usable, then commit to the return.'
}

export function derivePlan(state: FlightState): readonly string[] {
  if (state.mission.phase === 'preflight') {
    if (state.route.plan !== 'unassigned') return [
      'Advance power for takeoff from runway 12R.',
      'Rotate at 155 knots, climb through 1,000 feet, then clean up the aircraft.',
    ]
    return [
      'File the Chicago Midway runway 31C route before departure.',
      'Take off from St. Louis Lambert runway 12R, clean up the aircraft, and monitor for changes.',
    ]
  }
  if (state.mission.phase === 'takeoff') return [
    'Rotate at 155 knots and establish a positive climb rate.',
    'Retract the gear, then clean up the aircraft above acceleration altitude.',
  ]
  if (state.mission.goAroundRequired) return [
    'Initiate the go-around and command a positive climb.',
    'Capture the climb-ahead point, then follow the outbound course reversal and final.',
  ]
  if (state.checkride.status === 'decision_required') {
    if (state.atc.status === 'requested') return [
      `ATC is evaluating the ${routePlanLabels[state.atc.requestedPlan ?? 'unassigned'].toLowerCase()} request.`,
      'Maintain the current hold and wait for the clearance event.',
    ]
    if (state.atc.status === 'cleared' && state.atc.clearance) return [
      state.atc.clearance.instruction,
      `Read back clearance ${state.atc.clearance.id}; the FMS route loads only after acceptance.`,
    ]
    return [
      'Read the combined emergency context and compare the two usable diversions.',
      'Request one route from ATC; do not change course until it is cleared and read back.',
    ]
  }
  if (state.route.plan === 'unassigned') {
    if (state.checkride.status === 'armed') return [
      'Complete the normal departure and clean up the aircraft.',
      'Maintain the climb while monitoring for new conditions.',
    ]
    return [
      'Read the combined emergency context and compare the two usable routes.',
      'Commit to one route, then configure the aircraft for the selected runway.',
    ]
  }
  if (!state.procedure.compliant) return [
    state.procedure.instruction,
    'Verify the configuration, then continue to the active route fix.',
  ]

  const remainingWaypoints = state.route.waypoints.slice(state.route.activeWaypointIndex)
  if (remainingWaypoints.length > 0) return remainingWaypoints.slice(0, 3).map((waypoint) =>
    `${waypoint.name} · ${waypoint.altitudeFt.toLocaleString()} ft · ${waypoint.airspeedKt} kt`
  )
  return [`${routePlanLabels[state.route.plan]}${state.route.runway ? ` for runway ${state.route.runway}` : ''}.`]
}

export function deriveAction(state: FlightState): string {
  if (state.mission.phase === 'preflight') return state.route.plan === 'unassigned' ? 'Waiting for the preflight route.' : 'Preflight route filed; ready for takeoff.'
  if (state.mission.phase === 'takeoff' && state.aircraftPhase === 'takeoff_roll') {
    return `Accelerating on Lambert runway 12R. At ${WIDE_BODY_TWINJET_ENVELOPE.rotateSpeedKt} knots, rotate toward ${WIDE_BODY_TWINJET_ENVELOPE.initialClimbPitchDeg}°.`
  }
  if (state.mission.goAroundRequired) return 'The approach is unsafe. Abandon the landing and climb.'
  if (state.checkride.status === 'armed') return 'Normal departure. Monitoring the aircraft and surrounding conditions.'
  if (state.checkride.status === 'decision_required') {
    if (state.atc.status === 'requested') return 'Diversion requested. Holding while ATC prepares the clearance.'
    if (state.atc.status === 'cleared') return `ATC clearance ${state.atc.clearance?.id ?? ''} is awaiting readback.`
    return 'Assessing the emergency before requesting a diversion clearance.'
  }
  if (state.mission.routeStatus === 'stalled') return 'ATC issued fresh vectors. Following the updated next fix.'
  if (state.flightMode === 'human' && state.route.plan === 'return_kstl') {
    const waypoint = state.route.waypoints[state.route.activeWaypointIndex]
    return waypoint ? `You are flying. Follow the active route to ${waypoint.name}.` : 'You are flying the emergency return to KSTL runway 30L.'
  }
  if (state.flightMode === 'agent' && !state.autopilot.engaged) return 'Reading the emergency context and comparing the available routes.'
  if (!state.procedure.compliant) return state.procedure.instruction
  if (state.flightMode === 'agent') return 'The agent is selecting its next flight input.'
  return 'Monitoring the aircraft and emergency conditions while you fly.'
}

export function deriveHeadline(state: FlightState): string {
  if (state.mission.phase === 'preflight') return state.route.plan === 'unassigned' ? 'Preflight route required' : 'Ready for takeoff'
  if (state.mission.phase === 'takeoff') return 'Departing Lambert runway 12R'
  if (state.mission.goAroundRequired) return 'Go around'
  if (state.checkride.status === 'armed') return 'Normal departure'
  if (state.checkride.status === 'decision_required') {
    if (state.atc.status === 'requested') return 'Waiting for ATC clearance'
    if (state.atc.status === 'cleared') return 'ATC clearance received'
    return 'Diversion decision required'
  }
  if (state.flightMode === 'agent' && !state.autopilot.engaged) return 'Assessing the emergency'
  if (state.flightMode === 'agent') return state.route.destination ? `Flying to ${state.route.destination}` : 'Managing the flight'
  return state.scenario.engine.health === 'normal' ? 'Ready when you are' : 'Emergency in progress'
}

export function deriveDebrief(state: FlightState): CopilotDebrief | null {
  if (state.debrief.status === 'in_progress') return null
  const landing = state.debrief.landing
  const landingSummary = landing
    ? landing.onRunway
      ? `${landing.safe ? 'Stable' : 'Unsafe'} touchdown on runway ${landing.runway} at ${Math.abs(Math.round(landing.sinkRateFpm))} fpm${landing.bounces ? ` after ${landing.bounces} ${landing.bounces === 1 ? 'bounce' : 'bounces'}` : ''}, ${Math.round(landing.centerlineErrorFt)} ft from centerline.`
      : `The aircraft hit the ground outside ${landing.runway} at ${Math.abs(Math.round(landing.sinkRateFpm))} fpm and ${Math.round(landing.airspeedKt)} kt.`
    : state.debrief.decisionReason ?? 'The flight ended before a landing result was recorded.'

  return {
    title: state.debrief.status === 'landed' ? 'Safely on the ground' : 'The flight did not finish safely',
    outcome: state.debrief.status === 'landed' ? 'Landed' : 'Failed',
    elapsed: formatElapsed(state.debrief.elapsedSeconds / state.checkride.simulationRate),
    score: `${state.checkride.score.total}/100`,
    decision: routePlanLabels[state.debrief.decision],
    summary: landingSummary,
    events: state.debrief.events.slice(-4).map((event) => event.summary),
    deductions: state.checkride.score.deductions.map((deduction) => ({
      elapsed: formatElapsed(deduction.elapsedSeconds / state.checkride.simulationRate),
      label: deductionLabel(deduction.id),
      points: deduction.points,
      reason: deduction.reason,
    })),
  }
}
