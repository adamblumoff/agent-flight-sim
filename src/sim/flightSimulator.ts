import type {
  ActionReceipt, AircraftConfigurationInput, AtcClearance,
  CheckrideSeed, ConfigurationProcedure, DebriefEvent, EvidenceSource, FlightEvent,
  FlightEventType, FlightEventWaitInput, FlightEventWaitResult, FlightEvidence,
  DiversionPlan, FlightCommandStep, FlightCommandTrigger, FlightPlanProgram, FlightState, FlightStateListener, EmergencyDecisionContext, MissionBrief, MissionOutcome, MissionPhase,
  FlightMode, PilotControls, RouteCommandPoint, RoutePlan, RouteState, RouteWaypoint, ScenarioConditions, TraceActor,
  TraceEvent,
} from './types'
import type { FlightControlInput } from './flightCommands.ts'
import { checkpointCaptureRadiusNm } from './checkpoints.ts'
import { WIDE_BODY_TWINJET_ENVELOPE, staticThrustAccelerationKtPerSecond, type AircraftEnvelope } from './aircraftEnvelope.ts'
import { airborneDragKtPerSecond, groundMotionFor, stallResponseFor, turbulenceFor } from './aerodynamics.ts'
import { BUILD_ID } from '../buildInfo.ts'
import { MISSION_PROFILE } from './missionProfiles.ts'
import { reviewFlightPlan } from './flightPlanReview.ts'
import { FEET_PER_NAUTICAL_MILE, finalVerticalSpeedFpm, PILOT_OPERATING_LIMITS } from './pilotOperatingLimits.ts'
import {
  KMDW_AIRPORT,
  KMDW_RUNWAY_31C,
  KSTL_AIRPORT,
  KSTL_DEPARTURE_START,
  KSTL_RUNWAY_12R,
  KSTL_RUNWAY_30L,
  offsetPosition,
} from './airfields.ts'

const STEP = 1 / 60
const SNAPSHOT_INTERVAL = 0.1
const MAX_FRAME = 0.25
const MAX_AGENT_FRAME = 30
const BACKGROUND_CLOCK_INTERVAL_MS = 250
const MAX_WAIT_MS = 15_000
const EARTH_RADIUS_NM = 3_440.065
const FEET_PER_NM = FEET_PER_NAUTICAL_MILE
const KSTL_ELEVATION = KSTL_RUNWAY_30L.elevationFt
const MAX_SAFE_TOUCHDOWN_FPM = PILOT_OPERATING_LIMITS.approach.maxTouchdownSinkFpm
const BOUNCE_THRESHOLD_FPM = 240
const MAX_TOUCHDOWN_BANK_DEG = PILOT_OPERATING_LIMITS.approach.maxTouchdownBankDeg
const MAX_BOUNCES = 2
const CRASH_SLIDE_SECONDS = 2.5
const TAKEOFF_ROLLING_RESISTANCE_KT_PER_SECOND = 0.2
const TAKEOFF_AERO_DRAG_AT_ROTATE_KT_PER_SECOND = 0.65
const PILOT_PITCH_TRIM_RATE_DEG_PER_SECOND = 5.5
const PILOT_BANK_TRIM_RATE_DEG_PER_SECOND = 11.5
const PILOT_PITCH_RESPONSE_DEG_PER_SECOND = 8
const PILOT_BANK_RESPONSE_DEG_PER_SECOND = 16
const PILOT_VERTICAL_RESPONSE_FPM_PER_SECOND = 420
const EMERGENCY_DECISION_SECONDS = 60
const ATC_RESPONSE_WALL_SECONDS = 2
const LIFTOFF_CONFIRM_AGL_FT = 35
const ROUTE_STALL_SECONDS = 20
const ROUTE_OFF_COURSE_STALL_SECONDS = 30
const ROUTE_PROGRESS_EPSILON_NM = 0.015
export const arrivalLegProgressed = (distanceNm: number, bestDistanceNm: number, headingErrorDeg: number, bestHeadingErrorDeg: number) => (
  distanceNm < bestDistanceNm - ROUTE_PROGRESS_EPSILON_NM
  || headingErrorDeg < bestHeadingErrorDeg - 1
)
export const COMFORT_BANK_WARNING_DEG = 24
export const deepensUnsafeBank = (bankDeg: number, bankIntent: number) => Math.abs(bankDeg) >= COMFORT_BANK_WARNING_DEG
  && Math.abs(bankIntent) > 0.05
  && Math.sign(bankIntent) === Math.sign(bankDeg)
const isSafeGoAroundCommand = (command: FlightCommandStep | undefined) => command?.when.type === 'immediate'
  && command.vertical.mode === 'pitch'
  && command.vertical.pitchDeg >= PILOT_OPERATING_LIMITS.goAround.minimumPitchDeg
  && command.energy.mode === 'throttle'
  && command.energy.throttle >= PILOT_OPERATING_LIMITS.goAround.minimumThrottle
  && !command.gearDown
  && command.flapsDeg <= PILOT_OPERATING_LIMITS.goAround.maximumFlapsDeg
const COMFORT_LOAD_WARNING_G = 1.35
const COMFORT_JERK_WARNING_G_PER_SECOND = 0.9
const LANDING_ROLL_BASE_DRAG_KT_PER_SECOND = 1.4
const LANDING_ROLL_IDLE_BRAKING_KT_PER_SECOND = 2.6
const LANDING_ROLL_THRUST_KT_PER_SECOND = 4.8
const PASSENGER_INJURY_DRAW: Readonly<Record<CheckrideSeed, number>> = Object.freeze({ 17: 0.72, 42: 0.56, 81: 0.42 })

const FLIGHT_EVENT_PRIORITY: Readonly<Partial<Record<FlightEventType, number>>> = Object.freeze({
  mission_failed: 100,
  emergency_detected: 90,
  stall_warning: 89,
  go_around_required: 88,
  atc_clearance_received: 85,
  decision_timer_expired: 80,
  route_progress_stalled: 60,
})

const isDestructiveImpact = ({
  onRunway,
  gearDown,
  impactFpm,
  airspeedKt,
  bankDeg,
  pitchDeg,
  maxTouchdownSpeedKt,
}: {
  onRunway: boolean
  gearDown: boolean
  impactFpm: number
  airspeedKt: number
  bankDeg: number
  pitchDeg: number
  maxTouchdownSpeedKt: number
}) => impactFpm > 900
  || airspeedKt > maxTouchdownSpeedKt + 20
  || Math.abs(bankDeg) > 32
  || pitchDeg < -12
  || (!onRunway && (impactFpm > 650 || airspeedKt > maxTouchdownSpeedKt - 10 || Math.abs(bankDeg) > 24))
  || (!gearDown && (impactFpm > 350 || airspeedKt > maxTouchdownSpeedKt))

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const approach = (value: number, target: number, change: number) => value < target ? Math.min(value + change, target) : Math.max(value - change, target)
const damp = (value: number, target: number, lambda: number, dt: number) => target + (value - target) * Math.exp(-lambda * dt)
const radians = (degrees: number) => degrees * Math.PI / 180
const normalizeHeading = (degrees: number) => ((degrees % 360) + 360) % 360
const headingError = (target: number, current: number) => ((target - current + 540) % 360) - 180

export interface ApproachAssessmentInput {
  readonly phase: MissionPhase
  readonly returnArrival: boolean
  readonly activeKind: RouteWaypoint['kind'] | null
  readonly frameAlongNm: number
  readonly centerlineErrorNm: number
  readonly glidepathErrorFt: number
  readonly distanceToThresholdNm: number
  readonly distanceToActiveFixNm: number | null
  readonly closingRateToActiveFixKt: number | null
  readonly altitudeAglFt: number
  readonly runwayHeadingErrorDeg: number
  readonly verticalSpeedFpm: number
  readonly airspeedKt: number
  readonly gearDown: boolean
  readonly flapsDeg: number
}

export const approachAssessmentFor = (input: ApproachAssessmentInput) => {
  const envelope = WIDE_BODY_TWINJET_ENVELOPE
  const onArrival = input.phase === 'approach' && (input.activeKind === 'final' || input.activeKind === 'touchdown')
  const configured = input.gearDown && input.flapsDeg >= envelope.approachFlapsDeg
  const stable = onArrival
    && input.frameAlongNm >= -5
    && input.frameAlongNm <= -0.15
    && Math.abs(input.centerlineErrorNm) < 0.01
    && Math.abs(input.glidepathErrorFt) < 180
    && Math.abs(input.runwayHeadingErrorDeg) <= 12
    && input.verticalSpeedFpm >= PILOT_OPERATING_LIMITS.approach.stableDescentMinFpm
    && input.verticalSpeedFpm <= PILOT_OPERATING_LIMITS.approach.stableDescentMaxFpm
    && input.airspeedKt >= envelope.stableApproachMinKt
    && input.airspeedKt <= envelope.stableApproachMaxKt
    && configured
  const unsafeBase = input.returnArrival
    && input.activeKind === 'base'
    && input.altitudeAglFt > 0
    && input.altitudeAglFt <= 1_500
    && (
      input.verticalSpeedFpm < -1_200
      || input.airspeedKt > envelope.baseSpeedKt + 30
    )
  const unsafeCloseApproach = input.returnArrival && (
      (input.activeKind === 'final'
        && input.distanceToActiveFixNm !== null
        && input.distanceToActiveFixNm <= 2
        && input.closingRateToActiveFixKt !== null
        && input.closingRateToActiveFixKt < -20
        && input.distanceToThresholdNm <= 3.5
        && (Math.abs(input.centerlineErrorNm) > 0.35 || Math.abs(input.runwayHeadingErrorDeg) > 30))
      || ((input.activeKind === 'final' || input.activeKind === 'touchdown')
        && input.altitudeAglFt > 0
        && input.altitudeAglFt <= 1_500
        && input.distanceToThresholdNm <= 4.5
        && (
          Math.abs(input.runwayHeadingErrorDeg) > 30
          || Math.abs(input.centerlineErrorNm) > 0.35
          || input.glidepathErrorFt < -300
          || input.verticalSpeedFpm < PILOT_OPERATING_LIMITS.approach.goAroundDescentFpm
          || input.airspeedKt < envelope.stableApproachMinKt - 10
          || input.airspeedKt > envelope.stableApproachMaxKt + 15
          || !configured
        ))
    )
  return Object.freeze({ stable, goAroundRequired: unsafeBase || unsafeCloseApproach })
}
const coordinatedTurnRadiusNm = (airspeedKt: number, bankDeg: number) => {
  const speedMetersPerSecond = airspeedKt * 0.514_444
  return speedMetersPerSecond ** 2 / (9.81 * Math.tan(radians(bankDeg))) / 1_852
}

const controlAuthorityForAirspeed = (airspeedKt: number, envelope: AircraftEnvelope) => {
  const speedFraction = clamp(
    (airspeedKt - envelope.minCommandSpeedKt) / Math.max(1, envelope.enrouteSpeedKt - envelope.minCommandSpeedKt),
    0,
    1,
  )
  return 1.18 - speedFraction * 0.2
}

const blendHeading = (fromDeg: number, toDeg: number, amount: number) => normalizeHeading(fromDeg + headingError(toDeg, fromDeg) * amount)

const localLegFrame = (
  position: { lat: number; lon: number },
  origin: { lat: number; lon: number },
  target: { lat: number; lon: number },
) => {
  const courseDeg = navigationBearingDeg(origin, target)
  const legLengthNm = distanceNm(origin, target)
  const distanceFromOriginNm = distanceNm(origin, position)
  const bearingFromOriginDeg = navigationBearingDeg(origin, position)
  const relative = radians(headingError(bearingFromOriginDeg, courseDeg))
  return {
    alongNm: Math.cos(relative) * distanceFromOriginNm,
    crossNm: Math.sin(relative) * distanceFromOriginNm,
    courseDeg,
    legLengthNm,
  }
}

const routeGuidanceBearingDeg = (
  position: { lat: number; lon: number },
  origin: { lat: number; lon: number },
  target: RouteWaypoint,
) => {
  const frame = localLegFrame(position, origin, target)
  if (frame.legLengthNm < 0.05) return navigationBearingDeg(position, target)
  const lookaheadNm = clamp(distanceNm(position, target) * 0.45, 0.35, 1.2)
  const lookaheadAlongNm = clamp(frame.alongNm + lookaheadNm, 0, frame.legLengthNm)
  return navigationBearingDeg(position, offsetPosition(origin, frame.courseDeg, lookaheadAlongNm))
}

const anticipatedRouteBearingDeg = (
  position: { lat: number; lon: number },
  origin: { lat: number; lon: number },
  target: RouteWaypoint,
  following: RouteWaypoint | undefined,
  airspeedKt: number,
  routeBankDeg: number,
) => {
  const baseBearingDeg = routeGuidanceBearingDeg(position, origin, target)
  if (!following || target.kind === 'touchdown') return baseBearingDeg
  const inboundCourseDeg = navigationBearingDeg(origin, target)
  const outboundCourseDeg = navigationBearingDeg(target, following)
  const turnAngleDeg = Math.abs(headingError(outboundCourseDeg, inboundCourseDeg))
  if (turnAngleDeg < 12) return baseBearingDeg
  const turnRadiusNm = coordinatedTurnRadiusNm(Math.max(airspeedKt, 90), Math.max(10, routeBankDeg))
  const leadNm = clamp(turnRadiusNm * Math.tan(radians(Math.min(100, turnAngleDeg)) / 2), 0.15, target.kind === 'final' ? 1.5 : 0.65)
  const distanceToTargetNm = distanceNm(position, target)
  const blend = clamp((leadNm + target.captureRadiusNm - distanceToTargetNm) / Math.max(leadNm, 0.01), 0, target.kind === 'final' ? 1 : 0.25)
  return blendHeading(baseBearingDeg, outboundCourseDeg, blend)
}

export const landingRollAccelerationKtPerSecond = (throttle: number, maximumPower: number) => (
  throttle * maximumPower * LANDING_ROLL_THRUST_KT_PER_SECOND
  - LANDING_ROLL_BASE_DRAG_KT_PER_SECOND
  - (1 - throttle) * LANDING_ROLL_IDLE_BRAKING_KT_PER_SECOND
)

const initialScore = (): FlightState['checkride']['score'] => Object.freeze({ total: 100, deductions: Object.freeze([]) })

const withScoreDeduction = (
  score: FlightState['checkride']['score'],
  id: string,
  elapsedSeconds: number,
  points: number,
  reason: string,
): FlightState['checkride']['score'] => {
  if (score.deductions.some((deduction) => deduction.id === id)) return score
  const appliedPoints = Math.min(score.total, Math.max(0, points))
  if (appliedPoints === 0) return score
  const deduction = Object.freeze({ id, elapsedSeconds, points: appliedPoints, reason })
  return Object.freeze({
    total: score.total - appliedPoints,
    deductions: Object.freeze([...score.deductions, deduction]),
  })
}

const passengerSafetyFor = (
  previous: FlightState['passengerSafety'],
  bankDeg: number,
  verticalAccelerationFpmPerSecond: number,
  dt: number,
  injuryDraw: number,
  destructiveImpact: boolean,
): FlightState['passengerSafety'] => {
  if (destructiveImpact) return Object.freeze({ loadFactorG: 4.5, jerkGPerSecond: 4, distress: 100, injuryProbability: 1, status: 'injured', summary: 'Passengers were injured during the impact.' })
  const coordinatedTurnG = 1 / Math.max(0.25, Math.cos(radians(Math.min(75, Math.abs(bankDeg)))))
  const verticalG = verticalAccelerationFpmPerSecond / 60 / 32.174
  const rawG = clamp(coordinatedTurnG + verticalG, 0.15, 4.5)
  const loadFactorG = approach(previous.loadFactorG, rawG, 4 * dt)
  const rawJerk = Math.abs(loadFactorG - previous.loadFactorG) / Math.max(dt, STEP)
  const jerkGPerSecond = approach(previous.jerkGPerSecond, rawJerk, 8 * dt)
  const motionStress = Math.max(0, Math.abs(loadFactorG - 1) - 0.28) * 18
    + Math.max(0, jerkGPerSecond - 0.55) * 5
  const distress = clamp(previous.distress + (motionStress > 0 ? motionStress : -2.5) * dt, 0, 100)
  const injuryRate = Math.max(0, Math.abs(loadFactorG - 1) - 1.05) ** 2 * 0.035
    + Math.max(0, jerkGPerSecond - 1.7) ** 2 * 0.012
  const injuryProbability = clamp(1 - (1 - previous.injuryProbability) * Math.exp(-injuryRate * dt), 0, 1)
  const status = injuryProbability >= injuryDraw
    ? 'injured' as const
    : distress >= 60 || Math.abs(loadFactorG) >= 2.25
      ? 'distressed' as const
      : distress >= 20 || jerkGPerSecond >= 0.8
        ? 'uneasy' as const
        : 'comfortable' as const
  const summary = status === 'injured'
    ? 'A passenger was hurt by the aircraft motion.'
    : status === 'distressed'
      ? 'Passengers are distressed by sustained G-load and abrupt motion.'
      : status === 'uneasy'
        ? 'Passengers are becoming uneasy as the aircraft moves abruptly.'
        : 'Cabin motion is smooth.'
  return Object.freeze({ loadFactorG, jerkGPerSecond, distress, injuryProbability, status, summary })
}

const wideBodyTwinjetCollisionHull = Object.freeze([
  Object.freeze({ x: 0, y: 6.1, z: -31.4 }),
  Object.freeze({ x: 0, y: 6.1, z: 31.4 }),
  Object.freeze({ x: -30.05, y: 5.6, z: 5.2 }),
  Object.freeze({ x: 30.05, y: 5.6, z: 5.2 }),
  Object.freeze({ x: 0, y: 3.2, z: 0 }),
])
const wideBodyTwinjetGearContactPoints = Object.freeze([
  Object.freeze({ x: -5.7, y: 0, z: 7.6 }),
  Object.freeze({ x: 5.7, y: 0, z: 7.6 }),
  Object.freeze({ x: 0, y: 0, z: -22.2 }),
])
const wideBodyTwinjetCollisionPoints = Object.freeze([...wideBodyTwinjetCollisionHull, ...wideBodyTwinjetGearContactPoints])

const groundClearanceFt = (pitchDeg: number, bankDeg: number, gearDown: boolean) => {
  const pitch = radians(pitchDeg)
  const roll = radians(-bankDeg)
  const hull = wideBodyTwinjetCollisionHull
  const points = wideBodyTwinjetCollisionPoints
  let lowestMeters = 0
  const pointCount = gearDown ? points.length : hull.length
  for (let index = 0; index < pointCount; index += 1) {
    const point = points[index]
    const pitchedY = point.y * Math.cos(pitch) - point.z * Math.sin(pitch)
    const rotatedY = point.x * Math.sin(roll) + pitchedY * Math.cos(roll)
    lowestMeters = Math.min(lowestMeters, rotatedY)
  }
  return -lowestMeters / 0.3048
}

const KSTL_THRESHOLD = Object.freeze({ lat: KSTL_RUNWAY_30L.thresholdLat, lon: KSTL_RUNWAY_30L.thresholdLon })
const KMDW_THRESHOLD = Object.freeze({ lat: KMDW_RUNWAY_31C.thresholdLat, lon: KMDW_RUNWAY_31C.thresholdLon })

const routeEstimatedMinutes = (
  route: RouteState,
  origin: { lat: number; lon: number },
  trafficDelayMinutes = 0,
) => {
  let previous = origin
  let airborneMinutes = 0
  for (const fix of route.waypoints.slice(route.activeWaypointIndex)) {
    airborneMinutes += distanceNm(previous, fix) / Math.max(fix.airspeedKt, 120) * 60
    previous = fix
  }
  // Configuration, threshold crossing, touchdown, and rollout are real parts of
  // the arrival even though they are not represented as long route segments.
  return airborneMinutes + trafficDelayMinutes + 1.2
}

const SHARED_AUTONOMY_MISSION: MissionBrief = Object.freeze({
  id: 'SHARED-AUTONOMY-EMERGENCY-01',
  name: 'Rough running over St. Louis',
  objective: 'Depart St. Louis Lambert for Chicago Midway, assess the surprise emergency, and return safely to Lambert within eight minutes of the event.',
  start: 'Lined up on St. Louis Lambert runway 12R with the aircraft configured for takeoff.',
  deadlineSeconds: MISSION_PROFILE.deadlineSeconds,
  airports: Object.freeze([KSTL_AIRPORT, KMDW_AIRPORT]),
  runways: Object.freeze([KSTL_RUNWAY_12R, KSTL_RUNWAY_30L, KMDW_RUNWAY_31C]),
  assignedRoute: Object.freeze({
    plan: 'continue_kmdw', destination: 'KMDW', runway: '31C', altitudeFt: 3_000, airspeedKt: 230,
    commandPoints: Object.freeze([
      Object.freeze({ id: 'KSTL_CLIMB', name: 'Lambert runway 12R climb', kind: 'departure' as const, altitudeFt: 1_200, airspeedKt: WIDE_BODY_TWINJET_ENVELOPE.initialClimbSpeedKt, distanceToRunwayNm: 218.05, captureHeadingDeg: KSTL_RUNWAY_12R.headingDeg, gearDown: false, flapsDeg: 10 as const }),
      Object.freeze({ id: 'KSTL_DEPARTURE_CORRIDOR', name: 'Chicago departure corridor', kind: 'departure' as const, altitudeFt: 3_000, airspeedKt: WIDE_BODY_TWINJET_ENVELOPE.enrouteSpeedKt, distanceToRunwayNm: 218.34, captureHeadingDeg: KSTL_RUNWAY_12R.headingDeg, gearDown: false, flapsDeg: 0 as const }),
    ]),
  }),
  availablePlans: Object.freeze(['return_kstl', 'continue_kmdw'] as const),
  evidenceSources: Object.freeze(['weather', 'cockpit', 'traffic', 'passenger'] as const),
  successConditions: Object.freeze([
    'Take off from St. Louis Lambert runway 12R.',
    `At ${WIDE_BODY_TWINJET_ENVELOPE.rotateSpeedKt} knots, rotate at approximately ${WIDE_BODY_TWINJET_ENVELOPE.rotationRateDegPerSecond} degrees per second toward ${WIDE_BODY_TWINJET_ENVELOPE.initialClimbPitchDeg} degrees while holding runway heading. Liftoff occurs when aerodynamic lift exceeds weight.`,
    'Retract the gear after a positive climb rate, hold flaps 10 through acceleration altitude, then clean up on schedule.',
    'Read the combined emergency decision context before selecting a route.',
    `Fly the return near ${WIDE_BODY_TWINJET_ENVELOPE.emergencyTurnSpeedKt} knots, configure progressively, and stabilize near ${WIDE_BODY_TWINJET_ENVELOPE.approachSpeedKt} knots.`,
    `Reach final with the gear down and touch down below ${WIDE_BODY_TWINJET_ENVELOPE.maxTouchdownSpeedKt} knots and 600 feet per minute.`,
  ]),
})

const NORMAL_DEPARTURE_MISSION: MissionBrief = Object.freeze({
  ...SHARED_AUTONOMY_MISSION,
  name: 'St. Louis Lambert departure',
  objective: 'Depart St. Louis Lambert runway 12R for Chicago Midway, clean up the aircraft, and monitor for an enroute update.',
  availablePlans: Object.freeze(['continue_kmdw'] as const),
  successConditions: Object.freeze([
    'File the Chicago Midway runway 31C route before takeoff.',
    `At ${WIDE_BODY_TWINJET_ENVELOPE.rotateSpeedKt} knots, rotate at approximately ${WIDE_BODY_TWINJET_ENVELOPE.rotationRateDegPerSecond} degrees per second toward ${WIDE_BODY_TWINJET_ENVELOPE.initialClimbPitchDeg} degrees on St. Louis Lambert runway 12R.`,
    'Retract the gear after positive rate, then retract flaps on schedule above acceleration altitude.',
    'Monitor for an enroute update before changing the route.',
  ]),
})

const missionBriefFor = (emergency: boolean) => emergency ? SHARED_AUTONOMY_MISSION : NORMAL_DEPARTURE_MISSION

const scenarios: Readonly<Record<CheckrideSeed, ScenarioConditions>> = Object.freeze({
  17: Object.freeze({
    weather: Object.freeze({ visibilityMiles: 4, ceilingFt: 1_800, windDirectionDeg: 190, windSpeedKt: 12, summary: 'Rain. KSTL remains above minimums with a 9 knot crosswind.' }),
    engine: Object.freeze({ health: 'rough' as const, maximumPower: 0.72, summary: 'Exhaust gas temperatures are uneven. Available thrust is falling.' }),
    passenger: Object.freeze({ condition: 'urgent' as const, summary: 'The passenger is conscious but has chest pain.' }),
    traffic: Object.freeze({ delayMinutes: 0, priorityAvailable: true, summary: 'KSTL can clear an emergency return to runway 30L.' }),
  }),
  42: Object.freeze({
    weather: Object.freeze({ visibilityMiles: 1.5, ceilingFt: 850, windDirectionDeg: 250, windSpeedKt: 18, summary: 'Reported heavy rain puts runway 30L near approach minimums.' }),
    engine: Object.freeze({ health: 'rough' as const, maximumPower: 0.78, summary: 'The engine is rough but temperatures remain stable.' }),
    passenger: Object.freeze({ condition: 'stable' as const, summary: 'The passenger is uncomfortable but stable.' }),
    traffic: Object.freeze({ delayMinutes: 3, priorityAvailable: true, summary: 'KSTL reports a three minute delay unless the flight requests priority.' }),
  }),
  81: Object.freeze({
    weather: Object.freeze({ visibilityMiles: 3, ceilingFt: 1_300, windDirectionDeg: 170, windSpeedKt: 8, summary: 'Light rain. Both airports remain usable.' }),
    engine: Object.freeze({ health: 'failing' as const, maximumPower: 0.58, summary: 'Oil pressure is dropping. Continued power is not assured.' }),
    passenger: Object.freeze({ condition: 'critical' as const, summary: 'The passenger is intermittently unresponsive.' }),
    traffic: Object.freeze({ delayMinutes: 1, priorityAvailable: true, summary: 'Emergency priority is available at KSTL.' }),
  }),
})

const NORMAL_DEPARTURE_SCENARIO: ScenarioConditions = Object.freeze({
  weather: Object.freeze({ visibilityMiles: 10, ceilingFt: 6_500, windDirectionDeg: 180, windSpeedKt: 6, summary: 'Good visibility and light winds for departure.' }),
  engine: Object.freeze({ health: 'normal' as const, maximumPower: 1, summary: 'Engine indications are normal.' }),
  passenger: Object.freeze({ condition: 'stable' as const, summary: 'The cabin is secure and the passenger is comfortable.' }),
  traffic: Object.freeze({ delayMinutes: 0, priorityAvailable: false, summary: 'No traffic conflicts are reported.' }),
})

const createRunId = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

const EMERGENCY_ALERT = 'A new engine, weather, traffic, and passenger scenario has developed. Reassess the flight and build a route now.'
const SEALED_DEPARTURE_DYNAMICS_SEED: CheckrideSeed = 17

const evidenceFor = (scenario: ScenarioConditions): Readonly<Record<EvidenceSource, FlightEvidence>> => Object.freeze({
  weather: Object.freeze({ source: 'weather', headline: 'Airport weather', detail: scenario.weather.summary, reliability: 'current' }),
  cockpit: Object.freeze({ source: 'cockpit', headline: 'Engine indications', detail: scenario.engine.summary, reliability: 'current' }),
  traffic: Object.freeze({ source: 'traffic', headline: 'Arrival traffic', detail: scenario.traffic.summary, reliability: 'current' }),
  passenger: Object.freeze({ source: 'passenger', headline: 'Cabin report', detail: scenario.passenger.summary, reliability: 'current' }),
})

export const distanceNm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const dLat = radians(b.lat - a.lat)
  const dLon = radians(b.lon - a.lon)
  const lat1 = radians(a.lat)
  const lat2 = radians(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export const navigationBearingDeg = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const lat1 = radians(a.lat)
  const lat2 = radians(b.lat)
  const dLon = radians(b.lon - a.lon)
  return normalizeHeading(Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)) * 180 / Math.PI)
}

const runwayFrame = (position: { lat: number; lon: number }, threshold: { lat: number; lon: number }, heading: number) => {
  const northNm = (position.lat - threshold.lat) * 60
  const eastNm = (position.lon - threshold.lon) * 60 * Math.cos(radians(threshold.lat))
  const headingRad = radians(heading)
  return {
    alongNm: eastNm * Math.sin(headingRad) + northNm * Math.cos(headingRad),
    crossNm: -eastNm * Math.cos(headingRad) + northNm * Math.sin(headingRad),
  }
}

const waypoint = (
  id: string,
  name: string,
  kind: RouteWaypoint['kind'],
  position: { lat: number; lon: number },
  altitudeFt: number,
  airspeedKt: number,
  captureRadiusNm = 0.1,
  captureHeadingDeg?: number,
): RouteWaypoint => Object.freeze({ id, name, kind, ...position, altitudeFt, airspeedKt, captureRadiusNm, ...(captureHeadingDeg === undefined ? {} : { captureHeadingDeg }) })

const commandPointFor = (fix: RouteWaypoint, runwayThreshold: { lat: number; lon: number }): RouteCommandPoint => {
  const distanceToRunwayNm = Number(distanceNm(fix, runwayThreshold).toFixed(2))
  const gearDown = fix.kind === 'final' || fix.kind === 'touchdown'
  let flapsDeg: RouteCommandPoint['flapsDeg'] = 0
  if (fix.id === 'KSTL_CLIMB') flapsDeg = 10
  if (fix.kind === 'final') flapsDeg = distanceToRunwayNm <= 4.1 ? 30 : 20
  if (fix.kind === 'touchdown') flapsDeg = 30
  return Object.freeze({
    id: fix.id,
    name: fix.name,
    kind: fix.kind,
    altitudeFt: fix.altitudeFt,
    airspeedKt: fix.airspeedKt,
    distanceToRunwayNm,
    ...(fix.captureHeadingDeg === undefined ? {} : { captureHeadingDeg: fix.captureHeadingDeg }),
    gearDown,
    flapsDeg,
  })
}

const returnFinalLegs = (): readonly RouteWaypoint[] => {
  const envelope = WIDE_BODY_TWINJET_ENVELOPE
  const reciprocalHeading = normalizeHeading(KSTL_RUNWAY_30L.headingDeg + 180)
  const finalCheckpoint = (id: string, name: string, distanceToRunwayNm: number, airspeedKt: number, captureRadiusNm: number) => waypoint(
    id,
    name,
    'final',
    offsetPosition(KSTL_THRESHOLD, reciprocalHeading, distanceToRunwayNm),
    Math.round((KSTL_ELEVATION + Math.tan(radians(PILOT_OPERATING_LIMITS.approach.glidepathDeg)) * distanceToRunwayNm * FEET_PER_NM) / 100) * 100,
    airspeedKt,
    captureRadiusNm,
    KSTL_RUNWAY_30L.headingDeg,
  )
  return Object.freeze([
    finalCheckpoint('KSTL_FINAL_10', 'Runway 30L final, 10 NM', 10, envelope.finalSpeedKt, 0.65),
    finalCheckpoint('KSTL_FINAL_8', 'Runway 30L final, 8 NM', 8, 155, 0.45),
    finalCheckpoint('KSTL_FINAL_6', 'Runway 30L final, 6 NM', 6, 150, 0.4),
    finalCheckpoint('KSTL_FINAL_4', 'Runway 30L final, 4 NM', 4, 148, 0.35),
    finalCheckpoint('KSTL_FINAL_2', 'Runway 30L final, 2 NM', 2, envelope.approachSpeedKt, 0.25),
    finalCheckpoint('KSTL_FINAL_1', 'Runway 30L final, 1 NM', 1, envelope.approachSpeedKt, 0.18),
    waypoint('KSTL_TOUCHDOWN', 'Runway 30L touchdown', 'touchdown', offsetPosition(KSTL_THRESHOLD, KSTL_RUNWAY_30L.headingDeg, 0.14), KSTL_ELEVATION, envelope.approachSpeedKt, 0.012),
  ])
}

export const routeFor = (plan: RoutePlan, origin: { lat: number; lon: number; headingDeg?: number; altitudeFt?: number; airspeedKt?: number }): RouteState => {
  const envelope = WIDE_BODY_TWINJET_ENVELOPE
  if (plan === 'continue_kmdw') {
    return Object.freeze({ plan, destination: 'KMDW', runway: '31C', reason: null, activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), activeLegOrigin: Object.freeze({ lat: origin.lat, lon: origin.lon }), waypoints: Object.freeze([
      waypoint('KSTL_CLIMB', 'Lambert runway 12R climb', 'departure', offsetPosition(KSTL_DEPARTURE_START, KSTL_RUNWAY_12R.headingDeg, 1.35), 1_200, envelope.initialClimbSpeedKt, 0.45, KSTL_RUNWAY_12R.headingDeg),
      waypoint('KSTL_DEPARTURE_CORRIDOR', 'Chicago departure corridor', 'departure', offsetPosition(KSTL_DEPARTURE_START, KSTL_RUNWAY_12R.headingDeg, 8), 3_000, envelope.enrouteSpeedKt, 0.8, KSTL_RUNWAY_12R.headingDeg),
    ]) })
  }
  if (plan === 'return_kstl') {
    const outboundHeading = normalizeHeading(KSTL_RUNWAY_30L.headingDeg + 180)
    const distanceFromThresholdNm = distanceNm(origin, KSTL_THRESHOLD)
    const outboundPosition = offsetPosition(origin, outboundHeading, 10)
    const turnRadiusNm = clamp(coordinatedTurnRadiusNm(origin.airspeedKt ?? envelope.emergencyTurnSpeedKt, envelope.routeBankDeg), 1, 1.8)
    const courseReversalPosition = offsetPosition(outboundPosition, normalizeHeading(outboundHeading - 90), turnRadiusNm * 2)
    const baseDistanceNm = clamp(distanceFromThresholdNm + 6, 6.5, 9)
    const baseAltitudeFt = Math.round((KSTL_ELEVATION + Math.tan(radians(PILOT_OPERATING_LIMITS.approach.glidepathDeg)) * baseDistanceNm * FEET_PER_NM) / 100) * 100
    const originAltitudeFt = origin.altitudeFt ?? baseAltitudeFt + 400
    const procedureTurnAltitudeFt = Math.round(Math.max(baseAltitudeFt + 300, originAltitudeFt - 200) / 100) * 100
    return Object.freeze({ plan, destination: 'KSTL', runway: '30L', reason: null, activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), activeLegOrigin: Object.freeze({ lat: origin.lat, lon: origin.lon }), waypoints: Object.freeze([
      waypoint('KSTL_OUTBOUND', 'Runway 30L outbound leg', 'enroute', outboundPosition, procedureTurnAltitudeFt, envelope.emergencyTurnSpeedKt, 1.2, outboundHeading),
      waypoint('KSTL_COURSE_REVERSAL', 'Runway 30L course reversal', 'enroute', courseReversalPosition, procedureTurnAltitudeFt, envelope.emergencyTurnSpeedKt, 6, KSTL_RUNWAY_30L.headingDeg),
      ...returnFinalLegs(),
    ]) })
  }
  return Object.freeze({ plan, destination: null, runway: null, reason: null, activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), activeLegOrigin: Object.freeze({ lat: origin.lat, lon: origin.lon }), waypoints: Object.freeze([]) })
}

export interface FlightCommandTargets {
  readonly pitchDeg: number
  readonly bankDeg: number
  readonly throttle: number
  readonly gearDown: boolean
  readonly flapsDeg: 0 | 10 | 20 | 30
}

const flightCommandTriggerSatisfied = (state: FlightState, trigger: FlightCommandTrigger) => {
  if (trigger.type === 'immediate') return true
  if (trigger.type === 'airspeed_at_least') return state.airspeedKt >= trigger.value
  if (trigger.type === 'altitude_at_least') return state.altitudeFt >= trigger.value
  if (trigger.type === 'aircraft_phase') return state.aircraftPhase === trigger.value
  if (trigger.type === 'distance_to_runway_at_most') return state.mission.distanceToThresholdNm <= trigger.value
  const active = state.route.waypoints[state.route.activeWaypointIndex]
  return active?.id === trigger.value
}

export const flightCommandTargetsFor = (state: FlightState, command: FlightCommandStep): FlightCommandTargets => {
  let targetBankDeg: number
  if (command.lateral.mode === 'bank') {
    targetBankDeg = command.lateral.bankDeg
  } else {
    const lateral = command.lateral
    const desiredHeadingDeg = lateral.mode === 'heading'
      ? lateral.headingDeg
      : (() => {
          const fix = state.route.waypoints.find((waypoint) => waypoint.id === lateral.waypointId)
          if (fix?.kind !== 'touchdown' && fix?.captureHeadingDeg !== undefined && state.route.completedWaypointIds.includes(fix.id)) return fix.captureHeadingDeg
          const active = state.route.waypoints[state.route.activeWaypointIndex]
          if (active?.id === fix?.id && state.mission.bearingToNextFixDeg !== null) return state.mission.bearingToNextFixDeg
          return fix ? navigationBearingDeg(state, fix) : state.headingDeg
        })()
    const currentCourseDeg = lateral.mode === 'track_fix' ? state.motion.trackDeg : state.headingDeg
    targetBankDeg = state.aircraftPhase === 'airborne'
      ? clamp(headingError(desiredHeadingDeg, currentCourseDeg) * 0.35, -25, 25)
      : 0
  }

  let targetPitchDeg: number
  if (command.vertical.mode === 'pitch') {
    targetPitchDeg = command.vertical.pitchDeg
  } else {
    const altitudeErrorFt = command.vertical.altitudeFt - state.altitudeFt
    const lateral = command.lateral
    const trackedFix = lateral.mode === 'track_fix'
      ? state.route.waypoints.find((waypoint) => waypoint.id === lateral.waypointId)
      : undefined
    const active = state.route.waypoints[state.route.activeWaypointIndex]
    const secondsToFix = trackedFix && active?.id === trackedFix.id
      ? Math.max(0, distanceNm(state, trackedFix) - checkpointCaptureRadiusNm(trackedFix))
        / Math.max(90, state.motion.groundSpeedKt) * 3_600
      : null
    const scheduledVerticalSpeedFpm = secondsToFix === null
      ? altitudeErrorFt * 3
      : altitudeErrorFt * 60 / Math.max(8, secondsToFix)
    const minimumVerticalSpeedFpm = active?.kind === 'final' || active?.kind === 'touchdown' ? -950 : -1_800
    const targetVerticalSpeedFpm = clamp(scheduledVerticalSpeedFpm, minimumVerticalSpeedFpm, 1_800)
    const pathAngleDeg = Math.asin(clamp(targetVerticalSpeedFpm * 60 / (Math.max(90, state.airspeedKt) * FEET_PER_NM), -0.25, 0.25)) * 180 / Math.PI
    const landingAngleOfAttackDeg = active?.kind === 'final' || active?.kind === 'touchdown' ? PILOT_OPERATING_LIMITS.approach.landingAngleOfAttackDeg : 0
    targetPitchDeg = clamp(landingAngleOfAttackDeg + pathAngleDeg, -10, 15)
  }

  const throttle = command.energy.mode === 'throttle'
    ? command.energy.throttle
    : clamp(
        (0.55 + (command.energy.airspeedKt - state.airspeedKt) * 0.012)
          / Math.max(0.35, state.scenario.engine.maximumPower),
        0.05,
        1,
      )
  return Object.freeze({
    pitchDeg: targetPitchDeg,
    bankDeg: targetBankDeg,
    throttle,
    gearDown: command.gearDown,
    flapsDeg: command.flapsDeg,
  })
}

const initialRoute = (): RouteState => Object.freeze({ plan: 'unassigned', destination: null, runway: null, waypoints: Object.freeze([]), activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), activeLegOrigin: Object.freeze({ lat: KSTL_DEPARTURE_START.lat, lon: KSTL_DEPARTURE_START.lon }), reason: null })

const configurationProcedureFor = (state: Pick<FlightState, 'aircraftPhase' | 'altitudeFt' | 'airspeedKt' | 'route' | 'gearDown' | 'flapsDeg'>): ConfigurationProcedure => {
  if (state.aircraftPhase === 'landing_roll' || state.aircraftPhase === 'stopped' || state.aircraftPhase === 'crash_slide') {
    return Object.freeze({ stage: 'complete', gearDown: state.gearDown, flapsDeg: state.flapsDeg as 0 | 10 | 20 | 30, compliant: true, instruction: 'Configuration sequence complete.' })
  }
  const envelope = WIDE_BODY_TWINJET_ENVELOPE
  let stage: ConfigurationProcedure['stage'] = 'takeoff'
  let gearDown = true
  let flapsDeg: ConfigurationProcedure['flapsDeg'] = envelope.takeoffFlapsDeg
  let instruction = `Takeoff: gear down, flaps 10°; V1 ${envelope.decisionSpeedKt} kt, VR ${envelope.rotateSpeedKt} kt, V2 ${envelope.takeoffSafetySpeedKt} kt; rotate at ${envelope.rotationRateDegPerSecond}°/s toward ${envelope.initialClimbPitchDeg}°.`
  if (state.aircraftPhase === 'airborne') {
    const aglFt = state.altitudeFt - KSTL_RUNWAY_12R.elevationFt
    const activeKind = state.route.waypoints[state.route.activeWaypointIndex]?.kind
    if (activeKind === 'departure' && aglFt < 180) {
      stage = 'positive_rate'
      gearDown = false
      instruction = 'Positive rate: retract the landing gear; hold flaps 10°.'
    } else if ((!activeKind || activeKind === 'departure' || activeKind === 'enroute') && (aglFt < 1_000 || state.airspeedKt < envelope.flapRetractionSpeedKt)) {
      stage = 'positive_rate'
      gearDown = false
      instruction = `Climb: hold flaps 10° until 1,000 ft AGL and ${envelope.flapRetractionSpeedKt} kt while maintaining takeoff power.`
    } else if (!activeKind || activeKind === 'departure' || activeKind === 'enroute') {
      stage = 'climb_cleanup'
      gearDown = false
      flapsDeg = 0
      instruction = `Above 1,000 ft AGL and ${envelope.flapRetractionSpeedKt} kt: retract flaps to 0° and accelerate toward ${envelope.enrouteSpeedKt} kt.`
    } else if (activeKind === 'base') {
      stage = 'base'
      gearDown = false
      flapsDeg = 10
      instruction = `Base leg near ${envelope.baseSpeedKt} kt: select flaps 10°; keep the gear up.`
    } else if (activeKind === 'final') {
      stage = 'final'
      flapsDeg = envelope.approachFlapsDeg
      instruction = `Final near ${envelope.finalSpeedKt} kt: gear down, flaps 20°.`
    } else {
      stage = 'landing'
      flapsDeg = envelope.landingFlapsDeg
      instruction = `Landing: select flaps 30°, verify gear down, target ${envelope.approachSpeedKt} kt.`
    }
  }
  return Object.freeze({ stage, gearDown, flapsDeg, compliant: state.gearDown === gearDown && state.flapsDeg === flapsDeg, instruction })
}

const initialState = (seed: CheckrideSeed): FlightState => {
  const start = KSTL_DEPARTURE_START
  const scenario = NORMAL_DEPARTURE_SCENARIO
  const envelope = WIDE_BODY_TWINJET_ENVELOPE
  const profile = MISSION_PROFILE
  // Keep the known preflight state independent from the sealed event matrix.
  // Otherwise fuel endurance becomes an indirect scenario identifier.
  const fuel = 13.5
  const state = {
    ...start, altitudeFt: KSTL_RUNWAY_12R.elevationFt, airspeedKt: 0, verticalSpeedFpm: 0, headingDeg: KSTL_RUNWAY_12R.headingDeg,
    pitchDeg: 0, bankDeg: 0, throttle: 0, flapsDeg: envelope.takeoffFlapsDeg, gearDown: true,
    controlInputs: Object.freeze({ pitchAxis: 0, bankAxis: 0 }),
    elapsedSeconds: 0, fuelMinutesRemaining: fuel, flightMode: 'unselected',
    autopilot: Object.freeze({ engaged: false, program: null, activeCommandIndex: null, programmedAtElapsedSeconds: null }), route: initialRoute(), atc: Object.freeze({ status: 'none', requestedPlan: null, requestReason: null, clearance: null }), scenario,
    motion: Object.freeze({ longitudinalAccelerationKtPerSecond: 0, verticalAccelerationFpmPerSecond: 0, turnRateDegPerSecond: 0, groundSpeedKt: 0, trackDeg: KSTL_RUNWAY_12R.headingDeg, headwindKt: NORMAL_DEPARTURE_SCENARIO.weather.windSpeedKt, crosswindKt: 0, angleOfAttackDeg: 0, stalled: false, turbulenceLevel: 'none' }),
    impact: null,
    aircraftPhase: 'takeoff_roll',
    mission: Object.freeze({ phase: 'preflight', outcome: 'in_progress', nextFix: null, distanceToNextFixNm: null, bearingToNextFixDeg: null, headingErrorToNextFixDeg: null, altitudeErrorToNextFixFt: null, airspeedErrorToNextFixKt: null, closingRateKt: null, captureRadiusNm: null, minimumTurnRadiusNm: coordinatedTurnRadiusNm(envelope.initialClimbSpeedKt, envelope.routeBankDeg), routeStatus: 'idle', distanceToThresholdNm: distanceNm(start, KMDW_THRESHOLD), centerlineErrorNm: 0, glidepathErrorFt: 0, stableApproach: false, goAroundRequired: false, eventRevision: 0 }),
    checkride: Object.freeze({ runId: createRunId(), seed, buildId: BUILD_ID, profileId: profile.id, status: 'armed', objective: missionBriefFor(false).objective, deadlineSeconds: profile.deadlineSeconds, wallClockDeadlineSeconds: profile.wallClockDeadlineSeconds, wallClockSecondsRemaining: null, simulationRate: profile.simulationRate, decisionSecondsRemaining: null, emergencyStartedAtSeconds: null, decisionContextRead: false, fuelMinutesRemaining: fuel, alert: null, inspectedSources: Object.freeze([]), score: initialScore(), decision: null }),
    passengerSafety: Object.freeze({ loadFactorG: 1, jerkGPerSecond: 0, distress: 0, injuryProbability: 0, status: 'comfortable', summary: 'Cabin motion is smooth.' }),
    debrief: Object.freeze({ status: 'in_progress', elapsedSeconds: 0, decision: 'unassigned', decisionReason: null, events: Object.freeze([]), landing: null }),
  } satisfies Omit<FlightState, 'procedure'>
  return Object.freeze({ ...state, procedure: configurationProcedureFor(state) }) satisfies FlightState
}

interface EventWaiter { readonly afterRevision: number; readonly events: ReadonlySet<FlightEventType>; readonly resolve: (result: FlightEventWaitResult) => void; readonly timeout: ReturnType<typeof setTimeout> }
interface CrashDynamics {
  elapsedSeconds: number
  readonly outcome: 'unsafe_touchdown' | 'crashed' | 'fuel_exhausted'
  readonly rollDirection: -1 | 1
  readonly severity: 'hard' | 'destructive'
}

class FlightSimulator {
  private state = initialState(17)
  private previousState = this.state
  private snapshot = this.state
  private accumulator = 0
  private lastFrameMs: number | null = null
  private snapshotClock = 0
  private animationFrame: number | null = null
  private backgroundClock: ReturnType<typeof setInterval> | null = null
  private traceId = 1
  private eventRevision = 0
  private impactRevision = 0
  private bounceCount = 0
  private peakTouchdownImpactFpm = 0
  private crashDynamics: CrashDynamics | null = null
  private selectedScenario = scenarios[17]
  private emergencyTriggered = false
  private emergencyStartedAtWallMs: number | null = null
  private decisionTimerExpired = false
  private decisionTimerRunning = false
  private atcClearanceDueElapsedSeconds: number | null = null
  private pendingAtcRoute: RouteState | null = null
  private departureGuidanceReleased = false
  private fuelExhausted = false
  private highGExcursion = false
  private highGEventIndex = 0
  private abruptMotionExcursion = false
  private abruptMotionEventIndex = 0
  private comfortWarningActive = false
  private routeProgress = { waypointId: '', bestDistanceNm: Number.POSITIVE_INFINITY, bestHeadingErrorDeg: Number.POSITIVE_INFINITY, secondsWithoutProgress: 0, eventSent: false }
  private passengerInjuryDraw = PASSENGER_INJURY_DRAW[17]
  private pilotControls: PilotControls = Object.freeze({ pitchAxis: 0, bankAxis: 0 })
  private smoothedPilotControls = { pitchAxis: 0, bankAxis: 0 }
  private manualAttitudeTarget = { pitchDeg: 0, bankDeg: 0 }
  private readonly listeners = new Set<FlightStateListener>()
  private readonly waiters = new Set<EventWaiter>()
  private trace: readonly TraceEvent[] = Object.freeze([])
  private events: readonly FlightEvent[] = Object.freeze([])

  getState = () => this.state
  getPreviousState = () => this.previousState
  getInterpolationAlpha = (renderTimeMs: number) => {
    const pendingSeconds = this.lastFrameMs === null
      ? 0
      : clamp((renderTimeMs - this.lastFrameMs) / 1_000, 0, MAX_FRAME) * MISSION_PROFILE.simulationRate
    return clamp((this.accumulator + pendingSeconds) / STEP, 0, 1)
  }
  getSnapshot = () => this.snapshot
  getTrace = () => this.trace
  getEventRevision = () => this.eventRevision
  getMissionBrief = () => {
    const brief = missionBriefFor(this.emergencyTriggered)
    return Object.freeze({ ...brief, deadlineSeconds: MISSION_PROFILE.wallClockDeadlineSeconds })
  }
  subscribe = (listener: FlightStateListener) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  start = () => {
    if (this.animationFrame !== null || typeof requestAnimationFrame === 'undefined') return
    this.lastFrameMs = null
    this.animationFrame = requestAnimationFrame(this.tick)
    this.backgroundClock = setInterval(this.backgroundTick, BACKGROUND_CLOCK_INTERVAL_MS)
  }

  stop = () => {
    if (this.animationFrame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.animationFrame)
    if (this.backgroundClock !== null) clearInterval(this.backgroundClock)
    this.animationFrame = null
    this.backgroundClock = null
    this.lastFrameMs = null
  }

  reset = (seed: CheckrideSeed = this.state.checkride.seed) => {
    this.cancelWaiters()
    this.state = initialState(seed)
    this.snapshot = this.state
    this.events = Object.freeze([])
    this.eventRevision = 0
    this.trace = Object.freeze([])
    this.accumulator = 0
    this.impactRevision = 0
    this.bounceCount = 0
    this.peakTouchdownImpactFpm = 0
    this.crashDynamics = null
    this.selectedScenario = scenarios[seed]
    this.emergencyTriggered = false
    this.emergencyStartedAtWallMs = null
    this.decisionTimerExpired = false
    this.decisionTimerRunning = false
    this.atcClearanceDueElapsedSeconds = null
    this.pendingAtcRoute = null
    this.departureGuidanceReleased = false
    this.fuelExhausted = false
    this.highGExcursion = false
    this.highGEventIndex = 0
    this.abruptMotionExcursion = false
    this.abruptMotionEventIndex = 0
    this.comfortWarningActive = false
    this.routeProgress = { waypointId: '', bestDistanceNm: Number.POSITIVE_INFINITY, bestHeadingErrorDeg: Number.POSITIVE_INFINITY, secondsWithoutProgress: 0, eventSent: false }
    this.passengerInjuryDraw = PASSENGER_INJURY_DRAW[seed]
    this.pilotControls = Object.freeze({ pitchAxis: 0, bankAxis: 0 })
    this.smoothedPilotControls = { pitchAxis: 0, bankAxis: 0 }
    this.manualAttitudeTarget = { pitchDeg: 0, bankDeg: 0 }
    this.record('system', 'mission_started', `Flight seed ${seed} started`, {})
    this.previousState = this.state
    this.publish(this.state)
  }

  startFlight = (flightMode: Exclude<FlightMode, 'unselected'>, seed: CheckrideSeed = this.state.checkride.seed) => {
    if (this.state.flightMode !== 'unselected') return null
    this.reset(seed)
    this.state = Object.freeze({ ...this.state, flightMode })
    this.record(flightMode, 'flight_mode_selected', `${flightMode === 'human' ? 'Manual' : 'Agent'} flight selected`, { flightMode })
    this.addDebrief(flightMode, `${flightMode === 'human' ? 'Manual' : 'Agent'} flight selected`)
    this.previousState = this.state
    this.publish(this.state)
    return this.state
  }

  inspectEvidence = (source: EvidenceSource, actor: TraceActor = 'agent'): FlightEvidence => {
    this.assertActorMode(actor)
    if (this.emergencyTriggered) this.decisionTimerRunning = true
    const baseReport = evidenceFor(this.state.scenario)[source]
    const report = source === 'passenger'
      ? Object.freeze({ ...baseReport, detail: `${baseReport.detail} ${this.state.passengerSafety.summary}` })
      : baseReport
    if (!this.state.checkride.inspectedSources.includes(source)) {
      this.state = Object.freeze({ ...this.state, checkride: Object.freeze({ ...this.state.checkride, inspectedSources: Object.freeze([...this.state.checkride.inspectedSources, source]) }) })
      this.record(actor, 'evidence_inspected', report.headline, { source })
      this.publish(this.state)
    }
    return report
  }

  getDecisionContext = (actor: TraceActor = 'agent'): EmergencyDecisionContext => {
    this.assertActorMode(actor)
    if (!this.emergencyTriggered) throw new Error('Decision context is sealed until emergency_detected.')
    this.decisionTimerRunning = true
    this.state = Object.freeze({ ...this.state, checkride: Object.freeze({ ...this.state.checkride, decisionContextRead: true }) })
    const evidence = Object.freeze((['weather', 'cockpit', 'traffic', 'passenger'] as const).map((source) => this.inspectEvidence(source, actor)))
    const kstlDistanceNm = distanceNm(this.state, KSTL_THRESHOLD)
    const returnRoute = routeFor('return_kstl', this.state)
    const midwayDistanceNm = distanceNm(this.state, KMDW_THRESHOLD)
    const midwayEstimatedMinutes = midwayDistanceNm / WIDE_BODY_TWINJET_ENVELOPE.enrouteSpeedKt * 60 + 1.2
    const returnRisk = this.state.scenario.weather.visibilityMiles < 2 || this.state.scenario.traffic.delayMinutes >= 3 ? 'moderate' as const : 'low' as const
    const continueRisk = this.state.scenario.engine.health === 'normal' && this.state.scenario.passenger.condition === 'stable' ? 'moderate' as const : 'high' as const
    return Object.freeze({
      evidence,
      decisionSecondsRemaining: this.state.checkride.decisionSecondsRemaining,
      fuelMinutesRemaining: this.state.fuelMinutesRemaining,
      comfortLimits: Object.freeze({ maximumBankDeg: WIDE_BODY_TWINJET_ENVELOPE.routeBankDeg, warningLoadFactorG: COMFORT_LOAD_WARNING_G, warningJerkGPerSecond: COMFORT_JERK_WARNING_G_PER_SECOND }),
      routeOptions: Object.freeze([
        Object.freeze({ plan: 'return_kstl' as const, destination: 'KSTL' as const, runway: '30L' as const, distanceNm: kstlDistanceNm, estimatedMinutes: routeEstimatedMinutes(returnRoute, this.state, this.state.scenario.traffic.delayMinutes), risk: returnRisk, summary: 'Nearby long runway with emergency priority. Weather and traffic still require a stabilized arrival.', recommended: true }),
        Object.freeze({ plan: 'continue_kmdw' as const, destination: 'KMDW' as const, runway: '31C' as const, distanceNm: midwayDistanceNm, estimatedMinutes: midwayEstimatedMinutes, risk: continueRisk, summary: 'Filed destination is more than 200 NM away. Engine and passenger conditions may deteriorate before arrival.', recommended: false }),
      ]),
    })
  }

  setPilotControls = (input: PilotControls, actor: TraceActor = 'human', reason = 'Pilot controls') => {
    return this.setFlightControls({ pitchIntent: input.pitchAxis, bankIntent: input.bankAxis, reason }, actor)
  }

  releasePilotControls = (actor: TraceActor = 'human') => {
    if (this.modeRejection(actor)) return
    this.pilotControls = Object.freeze({ pitchAxis: 0, bankAxis: 0 })
    if (this.state.controlInputs.pitchAxis === 0 && this.state.controlInputs.bankAxis === 0) return
    this.state = Object.freeze({ ...this.state, controlInputs: this.pilotControls })
    this.publish(this.state)
  }

  levelPilotAttitude = (actor: TraceActor = 'human', reason = 'Pilot leveled the aircraft'): ActionReceipt => {
    const modeRejection = this.modeRejection(actor)
    if (modeRejection) return modeRejection
    if (this.state.mission.outcome !== 'in_progress') return this.receipt(false, 'The flight has already ended.')
    this.releasePilotControls(actor)
    const activeKind = this.state.route.waypoints[this.state.route.activeWaypointIndex]?.kind
    const pitchDeg = activeKind === 'final' || activeKind === 'touchdown' ? 5 : 0
    this.manualAttitudeTarget = { pitchDeg, bankDeg: 0 }
    if (actor === 'agent' && this.state.autopilot.engaged) this.state = Object.freeze({ ...this.state, autopilot: Object.freeze({ ...this.state.autopilot, engaged: false }) })
    this.record(actor, 'pilot_attitude_target', reason, { pitchDeg, bankDeg: 0 })
    this.publish(this.state)
    return this.receipt(true, `Bank target set to wings level and pitch target set to ${pitchDeg}°${pitchDeg === 5 ? ' for the 3° approach path' : ''}. Throttle and configuration are unchanged.`)
  }

  private beginTakeoff = (actor: TraceActor, reason: string) => {
    if (this.state.mission.phase !== 'preflight') return this.receipt(false, 'Takeoff has already started.')
    if (this.state.route.plan !== 'continue_kmdw') return this.receipt(false, 'File the Chicago Midway runway 31C route before takeoff.')
    this.state = Object.freeze({
      ...this.state,
      mission: Object.freeze({ ...this.state.mission, phase: 'takeoff' }),
    })
    this.record(actor, 'takeoff_started', reason, { runway: KSTL_RUNWAY_12R.id })
    this.publish(this.state)
    return this.receipt(true, `Cleared for takeoff on ${KSTL_RUNWAY_12R.id}.`)
  }

  setThrottle = (value: number, actor: TraceActor = 'human', reason = 'Set throttle') => {
    return this.setFlightControls({ throttle: value, reason }, actor)
  }

  setFlightControls = (input: FlightControlInput, actor: TraceActor = 'agent'): ActionReceipt => {
    const reason = input.reason?.trim() || `${actor} flight controls`
    const modeRejection = this.modeRejection(actor)
    if (modeRejection) return modeRejection
    const requestedBank = input.bankIntent ?? 0
    const nextThrottle = input.throttle ?? this.state.throttle
    const activeWaypoint = this.state.route.waypoints[this.state.route.activeWaypointIndex]
    const lowEnergyTurn = actor === 'agent'
      && this.state.aircraftPhase === 'airborne'
      && Math.abs(requestedBank) > 0.05
      && activeWaypoint !== undefined
      && this.state.airspeedKt < activeWaypoint.airspeedKt + 10
      && nextThrottle < 0.7
    if (lowEnergyTurn) {
      return this.receipt(false, `Low-energy turn rejected at ${this.state.airspeedKt.toFixed(0)} kt and ${Math.round(nextThrottle * 100)}% power. Use at least 70% power and preserve altitude before banking toward ${activeWaypoint.id}.`)
    }
    const unsafeBankCommand = actor === 'agent'
      && this.state.aircraftPhase === 'airborne'
      && deepensUnsafeBank(this.state.bankDeg, requestedBank)
    if (unsafeBankCommand) {
      const recoveryDirection = this.state.bankDeg < 0 ? 'positive' : 'negative'
      return this.receipt(false, `Unsafe bank continuation rejected at ${this.state.bankDeg.toFixed(1)}°. Command ${recoveryDirection} bankIntent to roll toward wings level before continuing the turn.`)
    }
    const recoveringFromStall = actor === 'agent' && this.state.motion.stalled
    if (recoveringFromStall) {
      const nextGearDown = input.gearDown ?? this.state.gearDown
      const nextFlapsDeg = input.flapsDeg ?? this.state.flapsDeg
      const lowersNose = (input.pitchIntent ?? this.pilotControls.pitchAxis) <= -0.1
      const worsensBank = Math.abs(requestedBank) > 0.05
        && Math.sign(requestedBank) === Math.sign(this.state.bankDeg)
      if (nextThrottle < 0.85 || nextGearDown || nextFlapsDeg > 10 || !lowersNose || worsensBank) {
        const bankDirection = Math.abs(this.state.bankDeg) <= 3
          ? 'near-zero'
          : this.state.bankDeg < 0 ? 'positive' : 'negative'
        return this.receipt(false, `Incomplete stall recovery rejected. Set throttle at least 0.85, pitchIntent at most -0.10, gear up, flaps no more than 10°, and use ${bankDirection} bankIntent to move toward wings level.`)
      }
      this.manualAttitudeTarget.bankDeg = 0
    }
    const throttle = input.throttle === undefined ? this.state.throttle : clamp(input.throttle, 0, 1)
    if (throttle > 0 && this.state.mission.phase === 'preflight' && this.state.route.plan === 'continue_kmdw') {
      this.beginTakeoff(actor, 'Throttle applied after the preflight route was filed')
    }
    this.pilotControls = Object.freeze({
      pitchAxis: input.pitchIntent === undefined ? this.pilotControls.pitchAxis : clamp(input.pitchIntent, -1, 1),
      bankAxis: recoveringFromStall ? 0 : input.bankIntent === undefined ? this.pilotControls.bankAxis : clamp(input.bankIntent, -1, 1),
    })
    this.state = Object.freeze({
      ...this.state,
      controlInputs: this.pilotControls,
      throttle,
      autopilot: actor === 'agent' && this.state.autopilot.engaged
        ? Object.freeze({ ...this.state.autopilot, engaged: false })
        : this.state.autopilot,
    })
    if (input.gearDown !== undefined || input.flapsDeg !== undefined) {
      const configuration = this.configureAircraft({ gearDown: input.gearDown, flapsDeg: input.flapsDeg, reason }, actor)
      if (!configuration.accepted) return configuration
    }
    this.record(actor, 'flight_controls', reason, {
      throttle: this.state.throttle,
      pitchIntent: this.pilotControls.pitchAxis,
      bankIntent: this.pilotControls.bankAxis,
      gearDown: this.state.gearDown,
      flapsDeg: this.state.flapsDeg,
    })
    this.publish(this.state)
    return this.receipt(true, `Controls set: power ${Math.round(this.state.throttle * 100)}%, pitch ${this.pilotControls.pitchAxis.toFixed(2)}, bank ${this.pilotControls.bankAxis.toFixed(2)}, gear ${this.state.gearDown ? 'down' : 'up'}.`)
  }

  setFlaps = (degrees: number, actor: TraceActor = 'human', reason = 'Set flaps') => this.configureAircraft({ flapsDeg: clamp(degrees, 0, 30) as 0 | 10 | 20 | 30, reason }, actor)
  setGear = (down: boolean, actor: TraceActor = 'human', reason = 'Set gear') => this.configureAircraft({ gearDown: down, reason }, actor)
  programFlightPlan = (program: FlightPlanProgram, reason: string, actor: TraceActor = 'agent'): ActionReceipt => {
    const modeRejection = this.modeRejection(actor)
    if (modeRejection) return modeRejection
    if (this.state.mission.outcome !== 'in_progress') return this.receipt(false, 'The flight has already ended.')
    const filingPreflight = this.state.mission.phase === 'preflight'
    if (filingPreflight && program.plan !== 'continue_kmdw') return this.receipt(false, 'The assigned preflight route is continue_kmdw.')
    if (!filingPreflight) {
      const clearance = this.state.atc.clearance
      if (!this.emergencyTriggered || this.state.atc.status !== 'accepted' || !clearance) {
        return this.receipt(false, 'Accept an ATC clearance before replacing an airborne flight plan.')
      }
      if (clearance.plan !== program.plan) return this.receipt(false, `The accepted clearance is for ${clearance.plan}.`)
    }

    let baseRoute = filingPreflight
      ? routeFor(program.plan, this.state)
      : this.pendingAtcRoute
        ?? (!program.restartRoute && this.state.route.plan === program.plan
          ? this.state.route
          : routeFor(program.plan, this.state))
    if (program.commands.length < 2 || program.commands.length > 16) return this.receipt(false, 'A flight program requires 2 to 16 ordered commands.')
    if (program.commands[0]?.when.type !== 'immediate') return this.receipt(false, 'The first flight command must use the immediate trigger.')
    if (program.restartRoute && this.state.mission.goAroundRequired && !isSafeGoAroundCommand(program.commands[0])) {
        return this.receipt(false, 'Unsafe go-around program. The immediate command must declare pitch of at least 5°, throttle of at least 0.85, gear up, and no more than 10° flaps before any altitude-hold command.')
    }
    if (program.goAroundCommands) {
      if (!isSafeGoAroundCommand(program.goAroundCommands[0])) return this.receipt(false, 'Unsafe pre-armed go-around. Its first command must be immediate with pitch of at least 5°, throttle of at least 0.85, gear up, and no more than 10° flaps.')
    }
    const allCommands = [...program.commands, ...(program.goAroundCommands ?? [])]
    const ids = new Set(allCommands.map((command) => command.id))
    if (ids.size !== allCommands.length) return this.receipt(false, 'Every normal and go-around command id must be unique.')
    const routeFixIds = new Set([...baseRoute.waypoints.map((waypoint) => waypoint.id), 'KSTL_GO_AROUND'])
    for (const command of allCommands) {
      if (command.when.type === 'active_waypoint' && !routeFixIds.has(command.when.value)) {
        return this.receipt(false, `Command ${command.id} uses unknown trigger waypoint ${command.when.value}.`)
      }
      if (command.lateral.mode === 'track_fix' && !routeFixIds.has(command.lateral.waypointId)) {
        return this.receipt(false, `Command ${command.id} tracks unknown waypoint ${command.lateral.waypointId}.`)
      }
    }
    if (program.restartRoute && this.state.mission.goAroundRequired) {
      const restarted = this.initiateGoAround(reason, actor)
      if (!restarted.accepted) return restarted
      baseRoute = this.state.route
    }
    const planReview = reviewFlightPlan(program)
    const activated = this.activateRoute(program.plan, reason, filingPreflight, actor, baseRoute)
    if (!activated.accepted) return activated
    this.pendingAtcRoute = null
    this.pilotControls = Object.freeze({ pitchAxis: 0, bankAxis: 0 })
    this.smoothedPilotControls = { pitchAxis: 0, bankAxis: 0 }
    const frozenCommands = Object.freeze(program.commands.map((command) => Object.freeze(command)))
    const frozenGoAroundCommands = program.goAroundCommands
      ? Object.freeze(program.goAroundCommands.map((command) => Object.freeze(command)))
      : undefined
    const frozenProgram = Object.freeze({
      plan: program.plan,
      commands: frozenCommands,
      ...(frozenGoAroundCommands ? { goAroundCommands: frozenGoAroundCommands } : {}),
    })
    const firstTargets = flightCommandTargetsFor(this.state, frozenCommands[0])
    this.manualAttitudeTarget = { pitchDeg: firstTargets.pitchDeg, bankDeg: firstTargets.bankDeg }
    this.state = Object.freeze({
      ...this.state,
      controlInputs: this.pilotControls,
      throttle: firstTargets.throttle,
      gearDown: firstTargets.gearDown,
      flapsDeg: firstTargets.flapsDeg,
      autopilot: Object.freeze({ engaged: true, program: frozenProgram, activeCommandIndex: 0, programmedAtElapsedSeconds: this.state.elapsedSeconds }),
    })
    this.record(actor, 'flight_plan_programmed', reason, { plan: program.plan, commands: frozenCommands })
    this.record(actor, 'flight_command_activated', frozenCommands[0].id, { commandIndex: 0, command: frozenCommands[0] })
    this.addDebrief(actor, `Programmed ${program.plan.replaceAll('_', ' ')} flight plan with ${frozenCommands.length} exact commands`)
    if (filingPreflight) this.beginTakeoff(actor, 'Programmed flight plan engaged for departure')
    this.publish(this.state)
    const reviewSummary = planReview.warnings.length ? ` Safety review: ${planReview.warnings.map((warning) => warning.message).join(' ')}` : ' Safety review passed.'
    return this.receipt(true, `${program.plan} command program engaged at ${frozenCommands[0].id}. It will execute continuously at 60 Hz while the agent thinks or waits.${reviewSummary}`, planReview)
  }

  setRoute = (plan: RoutePlan, reason: string, actor: TraceActor = 'agent'): ActionReceipt => {
    if (plan === 'unassigned') return this.receipt(false, 'Choose the assigned preflight route.')
    const modeRejection = this.modeRejection(actor)
    if (modeRejection) return modeRejection
    const filingPreflight = this.state.mission.phase === 'preflight'
    if (filingPreflight && plan !== 'continue_kmdw') return this.receipt(false, 'The preflight route is continue_kmdw to Chicago Midway runway 31C.')
    if (!filingPreflight) {
      if (actor === 'system' && this.emergencyTriggered) return this.activateRoute(plan, reason, false, actor)
      return this.receipt(false, this.emergencyTriggered
        ? 'Emergency routes require request_diversion, an ATC clearance, and accept_clearance.'
        : 'The filed route remains active until a new clearance is issued.')
    }
    return this.activateRoute(plan, reason, true, actor)
  }

  requestDiversion = (plan: DiversionPlan, reason: string, actor: TraceActor = 'agent'): ActionReceipt => {
    const modeRejection = this.modeRejection(actor)
    if (modeRejection) return modeRejection
    if (!this.emergencyTriggered || this.state.checkride.status !== 'decision_required') return this.receipt(false, 'No emergency diversion decision is active.')
    if (!this.state.checkride.decisionContextRead) return this.receipt(false, 'Wait for emergency_detected and review its decisionContext before requesting a diversion.')
    if (this.state.atc.status !== 'none') return this.receipt(false, `ATC is already ${this.state.atc.status}; continue the current clearance flow.`)
    this.decisionTimerRunning = false
    this.atcClearanceDueElapsedSeconds = this.state.elapsedSeconds + ATC_RESPONSE_WALL_SECONDS * MISSION_PROFILE.simulationRate
    this.pendingAtcRoute = null
    this.state = Object.freeze({
      ...this.state,
      atc: Object.freeze({ status: 'requested', requestedPlan: plan, requestReason: reason, clearance: null }),
      checkride: Object.freeze({ ...this.state.checkride, alert: 'Diversion requested. Maintain the hold and wait for ATC clearance.' }),
    })
    const requestedRoute = routeFor(plan, this.state)
    this.record(actor, 'atc_diversion_requested', reason, { plan, destination: requestedRoute.destination, runway: requestedRoute.runway })
    this.addDebrief(actor, `Requested ${plan.replaceAll('_', ' ')} from ATC`)
    this.publish(this.state)
    return this.receipt(true, 'Diversion request sent. Maintain present guidance and wait for atc_clearance_received.')
  }

  acceptAtcClearance = (clearanceId: string, readback: string, actor: TraceActor = 'agent'): ActionReceipt => {
    const modeRejection = this.modeRejection(actor)
    if (modeRejection) return modeRejection
    const clearance = this.state.atc.clearance
    if (this.state.atc.status !== 'cleared' || !clearance) return this.receipt(false, 'No ATC clearance is ready for readback.')
    if (clearance.id !== clearanceId) return this.receipt(false, 'The clearance_id does not match the current ATC clearance.')
    const normalized = readback.toUpperCase()
    const runwayReadBack = normalized.includes(clearance.runway) || normalized.includes(String(Number(clearance.runway)))
    const requiredReadbackPresent = normalized.includes(clearance.destination)
      && runwayReadBack
      && normalized.includes(String(clearance.altitudeFt))
      && normalized.includes(String(Math.round(clearance.headingDeg)))
    if (!requiredReadbackPresent) return this.receipt(false, 'Read back the clearance destination, runway, altitude, and initial heading exactly as issued.')
    this.atcClearanceDueElapsedSeconds = null
    this.state = Object.freeze({
      ...this.state,
      atc: Object.freeze({ ...this.state.atc, status: 'accepted' }),
      checkride: Object.freeze({ ...this.state.checkride, alert: `ATC clearance accepted: ${clearance.instruction}` }),
    })
    this.record(actor, 'atc_clearance_readback', readback, { clearanceId, plan: clearance.plan })
    this.addDebrief(actor, `Accepted ATC clearance ${clearance.id}`)
    this.queueEvent('atc_clearance_accepted', `Readback correct. ${clearance.instruction} Program the cleared flight plan now.`)
    this.publish(this.state)
    return this.receipt(true, `Clearance accepted. Program ${clearance.plan} with the cleared altitude and speed to engage the new route.`)
  }

  initiateGoAround = (reason: string, actor: TraceActor = 'agent'): ActionReceipt => {
    const modeRejection = this.modeRejection(actor)
    if (modeRejection) return modeRejection
    if (this.state.mission.outcome !== 'in_progress') return this.receipt(false, 'The flight has already ended.')
    if (this.state.aircraftPhase !== 'airborne' || this.state.route.destination !== 'KSTL' || this.state.checkride.status !== 'resolved') {
      return this.receipt(false, 'A go-around is available only while airborne on the cleared KSTL arrival.')
    }
    const activeKind = this.state.route.waypoints[this.state.route.activeWaypointIndex]?.kind
    const nearFinal = (activeKind === 'final' || activeKind === 'touchdown') && this.state.mission.distanceToThresholdNm <= 1.5
    if (!this.state.mission.goAroundRequired && !nearFinal) {
      return this.receipt(false, 'Continue the active arrival. A go-around becomes available when the approach is unsafe or the aircraft is established near final.')
    }
    const climbHeadingDeg = this.state.motion.trackDeg
    const climbAltitudeFt = Math.round(Math.max(this.state.altitudeFt + 800, 2_200) / 100) * 100
    const goAroundWaypoint = waypoint(
      'KSTL_GO_AROUND',
      'Missed approach climb',
      'enroute',
      offsetPosition(this.state, climbHeadingDeg, 3),
      climbAltitudeFt,
      180,
      0.65,
    )
    const finalLegs = returnFinalLegs()
    const reentryAltitudeFt = finalLegs[0].altitudeFt
    const outboundHeadingDeg = normalizeHeading(KSTL_RUNWAY_30L.headingDeg + 180)
    const rebuiltArrival = Object.freeze({
      plan: 'return_kstl' as const,
      destination: 'KSTL' as const,
      runway: '30L' as const,
      reason,
      activeWaypointIndex: 0,
      completedWaypointIds: Object.freeze([]),
      activeLegOrigin: Object.freeze({ lat: goAroundWaypoint.lat, lon: goAroundWaypoint.lon }),
      waypoints: Object.freeze([
        waypoint('KSTL_OUTBOUND', 'Runway 30L outbound leg', 'enroute', offsetPosition(KSTL_THRESHOLD, outboundHeadingDeg, 12), reentryAltitudeFt, WIDE_BODY_TWINJET_ENVELOPE.emergencyTurnSpeedKt, 1.2, outboundHeadingDeg),
        waypoint('KSTL_COURSE_REVERSAL', 'Runway 30L course reversal', 'enroute', offsetPosition(KSTL_THRESHOLD, outboundHeadingDeg, 14), reentryAltitudeFt, WIDE_BODY_TWINJET_ENVELOPE.emergencyTurnSpeedKt, 1.2),
        ...finalLegs,
      ]),
    })
    const route = Object.freeze({
      ...rebuiltArrival,
      reason,
      activeLegOrigin: Object.freeze({ lat: this.state.lat, lon: this.state.lon }),
      waypoints: Object.freeze([goAroundWaypoint, ...rebuiltArrival.waypoints]),
    })
    const bearingToNextFixDeg = navigationBearingDeg(this.state, goAroundWaypoint)
    this.routeProgress = { waypointId: '', bestDistanceNm: Number.POSITIVE_INFINITY, bestHeadingErrorDeg: Number.POSITIVE_INFINITY, secondsWithoutProgress: 0, eventSent: false }
    this.state = Object.freeze({
      ...this.state,
      route,
      mission: Object.freeze({
        ...this.state.mission,
        phase: 'enroute',
        nextFix: goAroundWaypoint.id,
        distanceToNextFixNm: distanceNm(this.state, goAroundWaypoint),
        bearingToNextFixDeg,
        headingErrorToNextFixDeg: headingError(bearingToNextFixDeg, this.state.motion.trackDeg),
        altitudeErrorToNextFixFt: goAroundWaypoint.altitudeFt - this.state.altitudeFt,
        airspeedErrorToNextFixKt: goAroundWaypoint.airspeedKt - this.state.airspeedKt,
        captureRadiusNm: checkpointCaptureRadiusNm(goAroundWaypoint),
        routeStatus: 'tracking',
        stableApproach: false,
        goAroundRequired: false,
      }),
      checkride: Object.freeze({ ...this.state.checkride, alert: 'Go-around active. Climb on the missed-approach route, then rejoin base and final.' }),
    })
    this.record(actor, 'go_around_initiated', reason, { nextFix: goAroundWaypoint.id, altitudeFt: goAroundWaypoint.altitudeFt, headingDeg: climbHeadingDeg })
    this.addDebrief(actor, 'Initiated a go-around at KSTL')
    this.queueEvent('plan_updated', 'Go-around route loaded. Climb toward KSTL_GO_AROUND, then follow base and final.')
    this.publish(this.state)
    return this.receipt(true, 'Go-around route loaded. Apply climb power and follow KSTL_GO_AROUND before rejoining base and final.')
  }

  private activatePrearmedGoAround() {
    const currentProgram = this.state.autopilot.program
    const commands = currentProgram?.goAroundCommands
    if (!currentProgram || !commands?.length) return false
    const initiated = this.initiateGoAround('Pre-armed unsafe-approach contingency', 'agent')
    if (!initiated.accepted) return false
    const firstTargets = flightCommandTargetsFor(this.state, commands[0])
    this.manualAttitudeTarget = { pitchDeg: firstTargets.pitchDeg, bankDeg: firstTargets.bankDeg }
    this.state = Object.freeze({
      ...this.state,
      throttle: firstTargets.throttle,
      gearDown: firstTargets.gearDown,
      flapsDeg: firstTargets.flapsDeg,
      autopilot: Object.freeze({
        engaged: true,
        program: Object.freeze({ plan: currentProgram.plan, commands, goAroundCommands: commands }),
        activeCommandIndex: 0,
        programmedAtElapsedSeconds: this.state.elapsedSeconds,
      }),
    })
    this.record('agent', 'flight_command_activated', commands[0].id, { commandIndex: 0, command: commands[0], contingency: 'go_around' })
    this.addDebrief('agent', `Activated pre-armed go-around command ${commands[0].id}`)
    this.publish(this.state)
    return true
  }

  private activateRoute(plan: DiversionPlan, reason: string, filingPreflight: boolean, actor: TraceActor, preparedRoute?: RouteState): ActionReceipt {
    const route = Object.freeze({ ...(preparedRoute ?? routeFor(plan, this.state)), reason })
    const activeTarget = route.waypoints[route.activeWaypointIndex]
    const activeBearingDeg = activeTarget ? navigationBearingDeg(this.state, activeTarget) : null
    this.routeProgress = { waypointId: '', bestDistanceNm: Number.POSITIVE_INFINITY, bestHeadingErrorDeg: Number.POSITIVE_INFINITY, secondsWithoutProgress: 0, eventSent: false }
    if (this.emergencyTriggered) this.decisionTimerRunning = false
    this.state = Object.freeze({
      ...this.state, route,
      mission: Object.freeze({
        ...this.state.mission,
        phase: filingPreflight ? 'preflight' : 'enroute',
        nextFix: activeTarget?.id ?? null,
        distanceToNextFixNm: activeTarget ? distanceNm(this.state, activeTarget) : null,
        bearingToNextFixDeg: activeBearingDeg,
        headingErrorToNextFixDeg: activeBearingDeg === null ? null : headingError(activeBearingDeg, this.state.motion.trackDeg),
        altitudeErrorToNextFixFt: activeTarget ? activeTarget.altitudeFt - this.state.altitudeFt : null,
        airspeedErrorToNextFixKt: activeTarget ? activeTarget.airspeedKt - this.state.airspeedKt : null,
        captureRadiusNm: activeTarget ? checkpointCaptureRadiusNm(activeTarget) : null,
        routeStatus: activeTarget ? 'tracking' : 'idle',
        stableApproach: false,
        goAroundRequired: false,
      }),
      checkride: Object.freeze({ ...this.state.checkride, status: filingPreflight ? 'armed' : 'resolved', decisionSecondsRemaining: null, decision: filingPreflight ? null : plan }),
      debrief: Object.freeze({ ...this.state.debrief, decision: plan, decisionReason: reason }),
    })
    this.record(actor, filingPreflight ? 'preflight_route_filed' : 'route_selected', reason, { plan, destination: route.destination, runway: route.runway })
    this.addDebrief(actor, filingPreflight ? 'Filed Chicago Midway runway 31C route' : `Selected ${plan.replaceAll('_', ' ')}`)
    this.queueEvent('plan_updated', filingPreflight ? 'Preflight route to Chicago Midway runway 31C filed.' : `${plan.replaceAll('_', ' ')} route loaded.`)
    this.publish(this.state)
    return this.receipt(true, `${route.destination ?? 'Holding'} route loaded.`)
  }

  configureAircraft = (input: AircraftConfigurationInput, actor: TraceActor = 'agent'): ActionReceipt => {
    const modeRejection = this.modeRejection(actor)
    if (modeRejection) return modeRejection
    const required = configurationProcedureFor(this.state)
    const configured = { ...this.state, gearDown: input.gearDown ?? this.state.gearDown, flapsDeg: input.flapsDeg ?? this.state.flapsDeg }
    const procedure = configurationProcedureFor(configured)
    const incorrectConfiguration = actor !== 'system'
      && ((input.gearDown !== undefined && input.gearDown !== this.state.gearDown && input.gearDown !== required.gearDown)
        || (input.flapsDeg !== undefined && input.flapsDeg !== this.state.flapsDeg && input.flapsDeg !== required.flapsDeg))
    const score = incorrectConfiguration
      ? withScoreDeduction(
          this.state.checkride.score,
          `configuration-${this.traceId}`,
          this.state.elapsedSeconds,
          4,
          `Incorrect ${required.stage.replaceAll('_', ' ')} configuration`,
        )
      : this.state.checkride.score
    this.state = Object.freeze({ ...configured, procedure, checkride: Object.freeze({ ...this.state.checkride, score }) })
    this.record(actor, 'aircraft_configured', input.reason ?? 'Aircraft configuration updated', { gearDown: this.state.gearDown, flapsDeg: this.state.flapsDeg })
    if (incorrectConfiguration) this.addDebrief('system', `−4 points: incorrect ${required.stage.replaceAll('_', ' ')} configuration`)
    if (procedure.compliant && !required.compliant) this.queueEvent('configuration_confirmed', procedure.instruction)
    this.publish(this.state)
    return this.receipt(true, `Gear ${this.state.gearDown ? 'down' : 'up'}, flaps ${this.state.flapsDeg}°. ${procedure.compliant ? 'Configuration check complete.' : procedure.instruction}`)
  }

  waitForFlightEvent = (input: FlightEventWaitInput): Promise<FlightEventWaitResult> => {
    const existing = this.events
      .filter((event) => event.revision > input.afterRevision && input.events.includes(event.type))
      .sort((left, right) => {
        const priorityDelta = (FLIGHT_EVENT_PRIORITY[right.type] ?? 0) - (FLIGHT_EVENT_PRIORITY[left.type] ?? 0)
        return priorityDelta || left.revision - right.revision
      })[0]
    if (existing) return Promise.resolve(this.eventResult(existing))
    return new Promise((resolve) => {
      const waiter: EventWaiter = {
        afterRevision: input.afterRevision,
        events: new Set(input.events),
        resolve,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter)
          resolve({ revision: this.eventRevision, event: 'timeout', message: 'No matching event before timeout.', state: this.state })
        }, clamp(input.timeoutMs, 1_000, MAX_WAIT_MS)),
      }
      this.waiters.add(waiter)
    })
  }

  /** Runs the real fixed-step loop without wall-clock waiting. */
  advanceForTesting = (seconds: number) => {
    const steps = Math.max(0, Math.round(seconds / STEP))
    for (let index = 0; index < steps; index += 1) {
      this.previousState = this.state
      this.advance(STEP)
    }
    this.snapshot = this.state
    this.emit()
  }

  private readonly backgroundTick = () => {
    if (typeof performance !== 'undefined') this.advanceClock(performance.now())
  }

  private readonly advanceClock = (timeMs: number) => {
    if (this.lastFrameMs === null) this.lastFrameMs = timeMs
    const maxFrame = this.state.flightMode === 'agent' ? MAX_AGENT_FRAME : MAX_FRAME
    this.accumulator += Math.min((timeMs - this.lastFrameMs) / 1_000, maxFrame) * MISSION_PROFILE.simulationRate
    this.lastFrameMs = timeMs
    while (this.accumulator >= STEP) {
      this.previousState = this.state
      this.advance(STEP)
      this.accumulator -= STEP
      this.snapshotClock += STEP
    }
    if (this.snapshotClock >= SNAPSHOT_INTERVAL) {
      this.snapshotClock = 0
      this.snapshot = this.state
      this.emit()
    }
  }

  private readonly tick = (timeMs: number) => {
    this.advanceClock(timeMs)
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private advance(dt: number) {
    if (this.crashDynamics) {
      this.advanceCrash(dt)
      return
    }
    if (this.state.mission.outcome !== 'in_progress') return
    if (this.state.mission.phase === 'preflight') return
    let programmedGroundHeadingDeg: number | null = null
    if (this.state.flightMode === 'agent' && this.state.autopilot.engaged && this.state.autopilot.program) {
      const program = this.state.autopilot.program
      let activeCommandIndex = this.state.autopilot.activeCommandIndex ?? 0
      const nextCommand = program.commands[activeCommandIndex + 1]
      if (nextCommand && flightCommandTriggerSatisfied(this.state, nextCommand.when)) {
        activeCommandIndex += 1
        this.record('agent', 'flight_command_activated', nextCommand.id, { commandIndex: activeCommandIndex, command: nextCommand })
        this.addDebrief('agent', `Activated command ${nextCommand.id}`)
      }
      const command = program.commands[activeCommandIndex]
      const targets = flightCommandTargetsFor(this.state, command)
      if ((this.state.aircraftPhase === 'landing_roll' || this.state.aircraftPhase === 'stopped') && command.lateral.mode === 'heading') {
        programmedGroundHeadingDeg = command.lateral.headingDeg
      }
      this.pilotControls = Object.freeze({ pitchAxis: 0, bankAxis: 0 })
      this.smoothedPilotControls = { pitchAxis: 0, bankAxis: 0 }
      this.manualAttitudeTarget = { pitchDeg: targets.pitchDeg, bankDeg: targets.bankDeg }
      const configured = {
        ...this.state,
        throttle: targets.throttle,
        gearDown: targets.gearDown,
        flapsDeg: targets.flapsDeg,
        controlInputs: this.pilotControls,
        autopilot: Object.freeze({ ...this.state.autopilot, activeCommandIndex }),
      }
      this.state = Object.freeze({ ...configured, procedure: configurationProcedureFor(configured) })
    }
    const scenario = this.state.scenario
    const dynamicsSeed = this.emergencyTriggered ? this.state.checkride.seed : SEALED_DEPARTURE_DYNAMICS_SEED
    const envelope = WIDE_BODY_TWINJET_ENVELOPE
    if (!this.departureGuidanceReleased && this.state.altitudeFt - KSTL_RUNWAY_12R.elevationFt >= envelope.departureHeadingReleaseAglFt) this.departureGuidanceReleased = true
    let { headingDeg: heading, bankDeg: bank, pitchDeg: pitch, throttle, airspeedKt: airspeed, verticalSpeedFpm: verticalSpeed } = this.state

    if (this.fuelExhausted && this.state.aircraftPhase === 'airborne') {
      throttle = 0
      bank = approach(bank, 0, 12 * dt)
      pitch = approach(pitch, -6, 5 * dt)
      verticalSpeed = approach(verticalSpeed, -1_050, 360 * dt)
    } else {
      const onTakeoffRoll = this.state.aircraftPhase === 'takeoff_roll'
      const controlAuthority = controlAuthorityForAirspeed(airspeed, envelope)
      this.smoothedPilotControls.pitchAxis = damp(this.smoothedPilotControls.pitchAxis, this.pilotControls.pitchAxis, 6, dt)
      this.smoothedPilotControls.bankAxis = damp(this.smoothedPilotControls.bankAxis, this.pilotControls.bankAxis, 5.5, dt)
      this.manualAttitudeTarget.pitchDeg = clamp(
        this.manualAttitudeTarget.pitchDeg + this.smoothedPilotControls.pitchAxis * PILOT_PITCH_TRIM_RATE_DEG_PER_SECOND * controlAuthority * dt,
        onTakeoffRoll ? 0 : -10,
        onTakeoffRoll ? envelope.liftoffPitchDeg : 15,
      )
      this.manualAttitudeTarget.bankDeg = onTakeoffRoll
        ? 0
        : clamp(this.manualAttitudeTarget.bankDeg + this.smoothedPilotControls.bankAxis * PILOT_BANK_TRIM_RATE_DEG_PER_SECOND * controlAuthority * dt, -25, 25)
      const targetPitch = this.manualAttitudeTarget.pitchDeg
      pitch = approach(
        pitch,
        targetPitch,
        (onTakeoffRoll ? envelope.rotationRateDegPerSecond : PILOT_PITCH_RESPONSE_DEG_PER_SECOND * controlAuthority) * dt,
      )
      bank = approach(bank, this.manualAttitudeTarget.bankDeg, PILOT_BANK_RESPONSE_DEG_PER_SECOND * controlAuthority * dt)
      if (programmedGroundHeadingDeg !== null) {
        heading = normalizeHeading(heading + clamp(headingError(programmedGroundHeadingDeg, heading), -10 * dt, 10 * dt))
      }
      const activeKind = this.state.route.waypoints[this.state.route.activeWaypointIndex]?.kind
      const onLandingPath = activeKind === 'final' || activeKind === 'touchdown'
      const targetVerticalSpeed = clamp(onLandingPath
        ? finalVerticalSpeedFpm(airspeed, pitch)
        : airspeed * FEET_PER_NM / 60 * Math.sin(radians(pitch)), -4_500, 4_500)
      verticalSpeed = approach(verticalSpeed, targetVerticalSpeed, PILOT_VERTICAL_RESPONSE_FPM_PER_SECOND * dt)
    }

    const turbulence = turbulenceFor(scenario.weather, this.state.elapsedSeconds + dt, dynamicsSeed)
    if (this.state.aircraftPhase === 'airborne' && turbulence.level !== 'none') {
      verticalSpeed += turbulence.verticalAccelerationFpmPerSecond * dt
      bank = clamp(bank + turbulence.rollRateDegPerSecond * dt, -60, 60)
    }

    const power = throttle * scenario.engine.maximumPower
    const publishedStaticThrustAcceleration = staticThrustAccelerationKtPerSecond(envelope)
    const activeKind = this.state.route.waypoints[this.state.route.activeWaypointIndex]?.kind
    const landingAngleOfAttackDeg = activeKind === 'final' || activeKind === 'touchdown' ? PILOT_OPERATING_LIMITS.approach.landingAngleOfAttackDeg : 0
    const gravityAlongFlightPath = -Math.sin(radians(pitch - landingAngleOfAttackDeg)) * 5.5
    const airborneDrag = airborneDragKtPerSecond(airspeed, this.state.gearDown, bank, this.state.flapsDeg)
    const acceleration = this.fuelExhausted
      ? -airborneDrag + gravityAlongFlightPath
      : this.state.aircraftPhase === 'takeoff_roll'
      ? power * publishedStaticThrustAcceleration
        - (airspeed > 0.05 || power > 0 ? TAKEOFF_ROLLING_RESISTANCE_KT_PER_SECOND : 0)
        - TAKEOFF_AERO_DRAG_AT_ROTATE_KT_PER_SECOND * (airspeed / envelope.rotateSpeedKt) ** 2
      : power * publishedStaticThrustAcceleration - airborneDrag + gravityAlongFlightPath
    airspeed = clamp(airspeed + acceleration * dt, 0, envelope.maxSimulationSpeedKt)
    const turnRate = airspeed > 20 ? 1_091 * Math.tan(radians(clamp(bank, -60, 60))) / airspeed : 0
    heading = normalizeHeading(heading + turnRate * dt)
    const stall = stallResponseFor(airspeed, pitch, verticalSpeed, bank, this.state.flapsDeg)
    if (this.state.aircraftPhase === 'airborne' && stall.severity > 0) {
      verticalSpeed = approach(verticalSpeed, Math.min(verticalSpeed, -stall.sinkRateFpm), (520 + stall.severity * 480) * dt)
      pitch = approach(pitch, Math.min(pitch, 4 - stall.severity * 13), (5 + stall.severity * 5) * dt)
    }
    const wind = groundMotionFor(airspeed, heading, scenario.weather, this.state.elapsedSeconds + dt, dynamicsSeed)
    const groundSpeedKt = this.state.aircraftPhase === 'airborne' ? wind.groundSpeedKt : airspeed
    const groundTrackDeg = this.state.aircraftPhase === 'airborne' ? wind.trackDeg : heading
    const position = offsetPosition(this.state, groundTrackDeg, groundSpeedKt * dt / 3_600)
    let altitude = this.state.altitudeFt + verticalSpeed * dt / 60
    const elapsedSeconds = this.state.elapsedSeconds + dt
    const fuelMinutesRemaining = Math.max(0, this.state.fuelMinutesRemaining - dt / 60 / MISSION_PROFILE.simulationRate * (0.65 + throttle * 0.55))

    let routeUpdate = this.advanceRoute(position, altitude, groundTrackDeg)
    const runway = this.runway(routeUpdate.route)
    const frame = runwayFrame(position, runway.threshold, runway.heading)
    // Lambert 30L includes the published 150-foot runway plus 75-foot paved
    // shoulders on each side. The renderer and collision envelope share this
    // 300-foot paved surface; score still records distance from centerline.
    const pavedShoulderFt = runway.id === 'KSTL 30L' ? 75 : 0
    const onRunway = frame.alongNm >= 0
      && frame.alongNm <= runway.lengthFt / FEET_PER_NM
      && Math.abs(frame.crossNm) <= (runway.widthFt / 2 + pavedShoulderFt) / FEET_PER_NM
    const departureFrame = runwayFrame(position, { lat: KSTL_RUNWAY_12R.thresholdLat, lon: KSTL_RUNWAY_12R.thresholdLon }, KSTL_RUNWAY_12R.headingDeg)
    const onDepartureRunway = departureFrame.alongNm >= 0
      && departureFrame.alongNm <= KSTL_RUNWAY_12R.lengthFt / FEET_PER_NM
      && Math.abs(departureFrame.crossNm) <= KSTL_RUNWAY_12R.widthFt / 2 / FEET_PER_NM
    let phase = routeUpdate.phase
    let outcome: MissionOutcome = 'in_progress'
    let landing = this.state.debrief.landing
    let impact = this.state.impact
    let touchdownJustOccurred = false
    let landingJustRecorded = false
    let crashJustOccurred = false
    let aircraftPhase = this.state.aircraftPhase
    let departedJustNow = false

    if (aircraftPhase === 'takeoff_roll') {
      phase = 'takeoff'
      const takeoffContactAltitude = KSTL_RUNWAY_12R.elevationFt + groundClearanceFt(pitch, bank, this.state.gearDown)
      if (!onDepartureRunway && airspeed > 20) {
        aircraftPhase = 'airborne'
        altitude = takeoffContactAltitude
        verticalSpeed = -1
      } else if (stall.liftToWeightRatio <= 1) {
        altitude = takeoffContactAltitude
        verticalSpeed = 0
      } else {
        const excessLiftClimbFpm = clamp((stall.liftToWeightRatio - 1) * 2_400, 120, envelope.initialClimbVerticalSpeedFpm)
        verticalSpeed = Math.max(verticalSpeed, excessLiftClimbFpm)
      }
      if (stall.liftToWeightRatio > 1 && altitude > KSTL_RUNWAY_12R.elevationFt + LIFTOFF_CONFIRM_AGL_FT && verticalSpeed > 0) {
        aircraftPhase = 'airborne'
        phase = routeUpdate.route.plan === 'unassigned' ? 'planning' : 'enroute'
        departedJustNow = true
      }
    }

    const contactAltitude = runway.elevation + groundClearanceFt(pitch, bank, this.state.gearDown)
    const groundContact = aircraftPhase === 'landing_roll'
      || aircraftPhase === 'stopped'
      || (altitude <= contactAltitude + (onRunway ? 10 : 0) && verticalSpeed <= (onRunway ? 100 : 0))
    if (aircraftPhase !== 'takeoff_roll' && groundContact) {
      altitude = contactAltitude
      const impactFpm = Math.abs(verticalSpeed)
      this.peakTouchdownImpactFpm = Math.max(this.peakTouchdownImpactFpm, impactFpm)
      const safeContact = onRunway
        && this.state.gearDown
        && this.state.flapsDeg >= envelope.approachFlapsDeg
        && airspeed <= envelope.maxTouchdownSpeedKt
        && impactFpm <= MAX_SAFE_TOUCHDOWN_FPM
        && Math.abs(bank) <= MAX_TOUCHDOWN_BANK_DEG
        && pitch >= -6

      if (safeContact && impactFpm > BOUNCE_THRESHOLD_FPM && this.bounceCount < MAX_BOUNCES) {
        this.bounceCount += 1
        altitude = runway.elevation + 0.15
        verticalSpeed = impactFpm * (this.bounceCount === 1 ? 0.36 : 0.22)
        airspeed *= 0.97
        pitch = Math.max(pitch, 1.5)
        bank *= 0.55
        phase = 'flare'
      } else if (safeContact) {
        aircraftPhase = 'landing_roll'
        phase = 'rollout'
        verticalSpeed = 0
        const rolloutAcceleration = landingRollAccelerationKtPerSecond(throttle, scenario.engine.maximumPower)
        airspeed = Math.max(0, airspeed + rolloutAcceleration * dt)
        if (!landing) {
          landing = Object.freeze({ runway: runway.id, sinkRateFpm: Math.round(this.peakTouchdownImpactFpm), airspeedKt: Math.round(airspeed), centerlineErrorFt: Math.round(Math.abs(frame.crossNm) * FEET_PER_NM), touchdownDistanceFt: Math.round(frame.alongNm * FEET_PER_NM), bounces: this.bounceCount, onRunway: true, safe: true })
          touchdownJustOccurred = true
          landingJustRecorded = true
        }
        if (airspeed < 5) {
          aircraftPhase = 'stopped'
          outcome = 'landed'
        }
      } else {
        aircraftPhase = 'crash_slide'
        const crashOutcome = this.fuelExhausted ? 'fuel_exhausted' : onRunway ? 'unsafe_touchdown' : 'crashed'
        const rollDirection = frame.crossNm < 0 ? -1 : 1
        const destructive = isDestructiveImpact({
          onRunway,
          gearDown: this.state.gearDown,
          impactFpm,
          airspeedKt: airspeed,
          bankDeg: bank,
          pitchDeg: pitch,
          maxTouchdownSpeedKt: envelope.maxTouchdownSpeedKt,
        })
        landing = Object.freeze({ runway: runway.id, sinkRateFpm: Math.round(impactFpm), airspeedKt: Math.round(airspeed), centerlineErrorFt: Math.round(Math.abs(frame.crossNm) * FEET_PER_NM), touchdownDistanceFt: Math.round(frame.alongNm * FEET_PER_NM), bounces: this.bounceCount, onRunway, safe: false })
        this.impactRevision += 1
        this.crashDynamics = { elapsedSeconds: 0, outcome: crashOutcome, rollDirection, severity: destructive ? 'destructive' : 'hard' }
        impact = Object.freeze({
          revision: this.impactRevision,
          severity: destructive ? 'destructive' : 'hard',
          sinkRateFpm: impactFpm,
          airspeedKt: airspeed,
          bankDeg: bank,
          pitchDeg: pitch,
          onRunway,
          rollDirection,
        })
        outcome = crashOutcome
        crashJustOccurred = true
        throttle = 0
        verticalSpeed = 0
        phase = 'failed'
      }
    }
    if (landingJustRecorded) {
      const touchdownWaypoint = routeUpdate.route.waypoints[routeUpdate.route.activeWaypointIndex]
      if (touchdownWaypoint?.kind === 'touchdown' && !routeUpdate.route.completedWaypointIds.includes(touchdownWaypoint.id)) {
        routeUpdate = {
          ...routeUpdate,
          route: Object.freeze({
            ...routeUpdate.route,
            completedWaypointIds: Object.freeze([...routeUpdate.route.completedWaypointIds, touchdownWaypoint.id]),
          }),
          reached: touchdownWaypoint,
          next: null,
        }
      }
    }
    const fuelJustExhausted = fuelMinutesRemaining <= 0 && !this.fuelExhausted
    if (fuelJustExhausted) this.fuelExhausted = true

    const motion = Object.freeze({
      longitudinalAccelerationKtPerSecond: (airspeed - this.state.airspeedKt) / dt,
      verticalAccelerationFpmPerSecond: (verticalSpeed - this.state.verticalSpeedFpm) / dt,
      turnRateDegPerSecond: turnRate,
      groundSpeedKt,
      trackDeg: groundTrackDeg,
      headwindKt: this.state.aircraftPhase === 'airborne' ? wind.headwindKt : 0,
      crosswindKt: this.state.aircraftPhase === 'airborne' ? wind.crosswindKt : 0,
      angleOfAttackDeg: stall.angleOfAttackDeg,
      // A low-speed aircraft on its wheels is not in an aerodynamic stall.
      // Keep stall annunciation and the associated guidance airborne-only.
      stalled: aircraftPhase === 'airborne' && stall.severity >= 0.18,
      turbulenceLevel: this.state.aircraftPhase === 'airborne' ? turbulence.level : 'none',
    })
    const stallJustDetected = motion.stalled && !this.state.motion.stalled
    const passengerSafety = passengerSafetyFor(
      this.state.passengerSafety,
      bank,
      motion.verticalAccelerationFpmPerSecond,
      dt,
      this.passengerInjuryDraw,
      impact?.severity === 'destructive',
    )
    const passengerStatusChanged = passengerSafety.status !== this.state.passengerSafety.status
    const comfortLimitApproaching = aircraftPhase === 'airborne'
      && (Math.abs(bank) >= COMFORT_BANK_WARNING_DEG || passengerSafety.loadFactorG >= COMFORT_LOAD_WARNING_G || passengerSafety.jerkGPerSecond >= COMFORT_JERK_WARNING_G_PER_SECOND)
    const decisionSecondsRemaining = this.state.checkride.status === 'decision_required' && this.decisionTimerRunning
      ? Math.max(0, (this.state.checkride.decisionSecondsRemaining ?? EMERGENCY_DECISION_SECONDS) - dt / MISSION_PROFILE.simulationRate)
      : this.state.checkride.decisionSecondsRemaining
    const decisionTimerJustExpired = decisionSecondsRemaining === 0 && !this.decisionTimerExpired && this.state.checkride.status === 'decision_required'
    const partialWithoutProcedure = { ...this.state, ...position, altitudeFt: altitude, airspeedKt: airspeed, verticalSpeedFpm: verticalSpeed, headingDeg: heading, pitchDeg: pitch, bankDeg: bank, throttle, elapsedSeconds, fuelMinutesRemaining, motion, impact, aircraftPhase, route: routeUpdate.route }
    const procedure = configurationProcedureFor(partialWithoutProcedure)
    const partial = { ...partialWithoutProcedure, procedure } as FlightState
    const wallClockSecondsRemaining = this.emergencyStartedAtWallMs === null
      ? null
      : Math.max(0, MISSION_PROFILE.wallClockDeadlineSeconds - (Date.now() - this.emergencyStartedAtWallMs) / 1_000)
    const deadlineExceeded = wallClockSecondsRemaining === 0 && outcome === 'in_progress'
    const mission = this.navigation(partial, phase, outcome, runway)
    const approachJustStabilized = mission.stableApproach && !this.state.mission.stableApproach
    const goAroundJustRequired = mission.goAroundRequired && !this.state.mission.goAroundRequired
    const status = outcome === 'in_progress' ? 'in_progress' : outcome === 'landed' ? 'landed' : 'failed'
    let score = this.state.checkride.score
    if (decisionTimerJustExpired) {
      score = withScoreDeduction(score, 'decision-timeout', elapsedSeconds, 15, 'Emergency route decision exceeded 60 seconds')
    }
    if (deadlineExceeded) {
      score = withScoreDeduction(score, 'mission-timeout', elapsedSeconds, 12, `Mission exceeded the ${Math.round(this.state.checkride.wallClockDeadlineSeconds / 60)}-minute emergency window`)
    }
    // Ignore the brief acceleration transient at rotation; handling penalties
    // start once the aircraft is established above the departure surface.
    const airborne = aircraftPhase === 'airborne' && altitude > runway.elevation + 250
    if (airborne && passengerSafety.loadFactorG >= 1.45 && !this.highGExcursion) {
      this.highGExcursion = true
      this.highGEventIndex += 1
      const points = passengerSafety.loadFactorG >= 1.9 ? 10 : passengerSafety.loadFactorG >= 1.65 ? 6 : 3
      score = withScoreDeduction(
        score,
        `high-g-${this.highGEventIndex}`,
        elapsedSeconds,
        points,
        `${passengerSafety.loadFactorG.toFixed(2)} G maneuver`,
      )
    } else if (passengerSafety.loadFactorG < 1.25) {
      this.highGExcursion = false
    }
    if (airborne && passengerSafety.jerkGPerSecond >= 1.2 && !this.abruptMotionExcursion) {
      this.abruptMotionExcursion = true
      this.abruptMotionEventIndex += 1
      score = withScoreDeduction(score, `jerk-${this.abruptMotionEventIndex}`, elapsedSeconds, 4, 'Abrupt control input disturbed the cabin')
    } else if (passengerSafety.jerkGPerSecond < 0.45) {
      this.abruptMotionExcursion = false
    }
    if (landingJustRecorded && this.peakTouchdownImpactFpm > 360) {
      score = withScoreDeduction(score, 'hard-landing', elapsedSeconds, 6, 'Hard landing')
    }
    if (landingJustRecorded && Math.abs(frame.crossNm) * FEET_PER_NM > 55) {
      score = withScoreDeduction(score, 'off-center-landing', elapsedSeconds, 4, 'Touchdown away from runway centerline')
    }
    if (crashJustOccurred) {
      score = withScoreDeduction(score, 'crash', elapsedSeconds, score.total, impact?.severity === 'destructive' ? 'Destructive impact' : 'Unsafe touchdown')
    }
    const previousDeductionIds = new Set(this.state.checkride.score.deductions.map((deduction) => deduction.id))
    const newDeductions = score.deductions.filter((deduction) => !previousDeductionIds.has(deduction.id))
    this.state = Object.freeze({
      ...partial,
      mission, passengerSafety,
      checkride: Object.freeze({ ...this.state.checkride, fuelMinutesRemaining, wallClockSecondsRemaining, decisionSecondsRemaining, status: status === 'in_progress' ? this.state.checkride.status : 'complete', score }),
      debrief: Object.freeze({ ...this.state.debrief, status, elapsedSeconds, landing }),
    })
    for (const deduction of newDeductions) this.addDebrief('system', `−${deduction.points} points: ${deduction.reason}`)
    const departureEstablished = routeUpdate.route.completedWaypointIds.includes('KSTL_CLIMB')
    if (!this.emergencyTriggered && aircraftPhase === 'airborne' && departureEstablished && elapsedSeconds >= MISSION_PROFILE.emergencyTriggerSeconds) {
      this.emergencyTriggered = true
      this.emergencyStartedAtWallMs = Date.now()
      this.decisionTimerRunning = true
      this.state = Object.freeze({
        ...this.state,
        scenario: this.selectedScenario,
        checkride: Object.freeze({
          ...this.state.checkride,
          status: 'decision_required',
          wallClockSecondsRemaining: MISSION_PROFILE.wallClockDeadlineSeconds,
          decisionSecondsRemaining: EMERGENCY_DECISION_SECONDS,
          emergencyStartedAtSeconds: elapsedSeconds,
          decisionContextRead: false,
          objective: missionBriefFor(true).objective,
          alert: EMERGENCY_ALERT,
          inspectedSources: Object.freeze([]),
        }),
      })
      this.record('system', 'scenario_triggered', EMERGENCY_ALERT, { seed: this.state.checkride.seed })
      this.addDebrief('system', 'Unexpected emergency scenario received')
      this.queueEvent('emergency_detected', `${EMERGENCY_ALERT} Weather: ${this.selectedScenario.weather.summary} Engine: ${this.selectedScenario.engine.summary} Passenger: ${this.selectedScenario.passenger.summary} Traffic: ${this.selectedScenario.traffic.summary} Review the decisionContext returned with this event, then request return_kstl or continue_kmdw from ATC within 60 seconds.`)
    }
    if (this.state.atc.status === 'requested'
      && this.atcClearanceDueElapsedSeconds !== null
      && elapsedSeconds >= this.atcClearanceDueElapsedSeconds) this.issueAtcClearance()
    if (decisionTimerJustExpired) {
      this.decisionTimerExpired = true
      this.state = Object.freeze({ ...this.state, checkride: Object.freeze({ ...this.state.checkride, alert: 'The emergency decision window expired. Request a diversion immediately.' }) })
      this.record('system', 'decision_timer_expired', 'Emergency route decision took longer than 60 seconds', {})
      this.queueEvent('decision_timer_expired', 'The 60 second emergency decision window expired. Request a diversion immediately.')
    }
    if (fuelJustExhausted && outcome === 'in_progress') {
      this.record('system', 'fuel_exhausted', 'The engine stopped after fuel exhaustion', {})
      this.addDebrief('system', 'Fuel exhausted; engine-out descent began')
      this.queueEvent('emergency_detected', 'Fuel exhausted. The engine has stopped; the aircraft is descending.')
    }
    if (stallJustDetected && outcome === 'in_progress') {
      this.record('system', 'stall_warning', 'Aerodynamic stall detected', {
        airspeedKt: this.state.airspeedKt,
        angleOfAttackDeg: this.state.motion.angleOfAttackDeg,
        bankDeg: this.state.bankDeg,
      })
      this.addDebrief('system', 'Aerodynamic stall warning activated')
      this.queueEvent('stall_warning', 'Aerodynamic stall. Recover now: throttle at least 0.85, pitchIntent at most -0.10, gear up, flaps no more than 10°, and bank toward wings level.')
    }
    if (procedure.stage !== this.previousState.procedure.stage && !procedure.compliant) this.queueEvent('configuration_required', procedure.instruction)
    if (routeUpdate.stalled) {
      this.record('system', 'route_progress_stalled', 'The active arrival command stopped converging', { nextFix: routeUpdate.next?.id ?? null, distanceNm: routeUpdate.next ? distanceNm(this.state, routeUpdate.next) : null })
      this.addDebrief('system', 'Active arrival command stopped converging')
      this.queueEvent('route_progress_stalled', `The active arrival command is not converging on ${routeUpdate.next?.name ?? 'the next fix'}. The simulator has not changed the route or command program.`)
    }
    if (routeUpdate.reached) {
      const nextMessage = routeUpdate.next && routeUpdate.next.id !== routeUpdate.reached.id
        ? ` Next checkpoint: ${routeUpdate.next.name}.`
        : ' Final route checkpoint captured.'
      this.record(this.activeFlightActor(), 'checkpoint_reached', routeUpdate.reached.name, {
        waypointId: routeUpdate.reached.id,
        waypointName: routeUpdate.reached.name,
        nextFix: routeUpdate.next?.name ?? null,
        final: routeUpdate.next === null,
      })
      this.addDebrief(this.activeFlightActor(), `Reached ${routeUpdate.reached.name}`)
      this.queueEvent('checkpoint_reached', `Reached checkpoint ${routeUpdate.reached.name}.${nextMessage}`)
    }
    if (passengerStatusChanged && (passengerSafety.status === 'distressed' || passengerSafety.status === 'injured')) {
      this.record('system', 'passenger_safety_update', passengerSafety.summary, { loadFactorG: passengerSafety.loadFactorG, jerkGPerSecond: passengerSafety.jerkGPerSecond, injuryProbability: passengerSafety.injuryProbability })
      this.addDebrief('system', passengerSafety.summary)
      this.queueEvent('passenger_safety_update', `${passengerSafety.summary} Current load ${passengerSafety.loadFactorG.toFixed(2)} G; jerk ${passengerSafety.jerkGPerSecond.toFixed(2)} G/s.`)
    }
    if (comfortLimitApproaching && !this.comfortWarningActive) {
      this.comfortWarningActive = true
      this.queueEvent('comfort_limit_approaching', `Cabin comfort margin is narrowing: ${passengerSafety.loadFactorG.toFixed(2)} G and ${passengerSafety.jerkGPerSecond.toFixed(2)} G/s jerk. Keep bank at or below ${envelope.routeBankDeg}° and avoid reversing the turn.`)
    } else if (!comfortLimitApproaching) {
      this.comfortWarningActive = false
    }
    if (goAroundJustRequired) {
      this.record('system', 'go_around_required', `${runway.id} approach is unsafe`, {
        runway: runway.id,
        altitudeAglFt: partial.altitudeFt - runway.elevation,
        verticalSpeedFpm: partial.verticalSpeedFpm,
        centerlineErrorNm: mission.centerlineErrorNm,
      })
      const prearmed = this.activatePrearmedGoAround()
      this.queueEvent('go_around_required', prearmed
        ? `${runway.id} approach became unsafe. The pre-armed exact-command go-around activated immediately.`
        : `${runway.id} approach is unsafe. Replace the flight program with an immediate climb and set restart_route true for a new circuit.`)
    }
    if (approachJustStabilized) {
      this.record('system', 'approach_stable', `${runway.id} approach is stable`, { runway: runway.id })
      this.queueEvent('approach_stable', `${runway.id} approach is stable.`)
    }
    if (departedJustNow) this.addDebrief(this.activeFlightActor(), `Departed ${KSTL_RUNWAY_12R.id}`)
    if (touchdownJustOccurred && landing) {
      this.record('system', 'touchdown', `Touchdown on ${runway.id}`, { ...landing })
      this.queueEvent('touchdown', `Touchdown on ${runway.id}.`)
    }
    if (outcome !== 'in_progress') this.finish(outcome)
  }

  private advanceCrash(dt: number) {
    const crash = this.crashDynamics!
    crash.elapsedSeconds += dt
    const runway = this.runway()
    const destructive = crash.severity === 'destructive'
    const decelerationKtPerSecond = destructive ? 64 : 42
    const turnRateDegPerSecond = destructive ? 12 : 4
    const targetPitchDeg = destructive ? -14 : -5
    const targetBankDeg = crash.rollDirection * (destructive ? 68 : 26)
    const airspeed = Math.max(0, this.state.airspeedKt - decelerationKtPerSecond * dt)
    const heading = normalizeHeading(this.state.headingDeg + crash.rollDirection * turnRateDegPerSecond * dt)
    const position = offsetPosition(this.state, heading, airspeed * dt / 3_600)
    const elapsedSeconds = this.state.elapsedSeconds + dt
    const fuelMinutesRemaining = Math.max(0, this.state.fuelMinutesRemaining - dt / 60 / MISSION_PROFILE.simulationRate * 0.65)
    const pitch = approach(this.state.pitchDeg, targetPitchDeg, (destructive ? 28 : 14) * dt)
    const bank = approach(this.state.bankDeg, targetBankDeg, (destructive ? 62 : 24) * dt)
    const finished = crash.elapsedSeconds >= CRASH_SLIDE_SECONDS || airspeed < 3
    const outcome: MissionOutcome = crash.outcome
    const partial = {
      ...this.state,
      ...position,
      altitudeFt: runway.elevation,
      airspeedKt: airspeed,
      verticalSpeedFpm: 0,
      headingDeg: heading,
      pitchDeg: pitch,
      bankDeg: bank,
      throttle: 0,
      elapsedSeconds,
      fuelMinutesRemaining,
      aircraftPhase: 'crash_slide',
      motion: Object.freeze({
        longitudinalAccelerationKtPerSecond: (airspeed - this.state.airspeedKt) / dt,
        verticalAccelerationFpmPerSecond: -this.state.verticalSpeedFpm / dt,
        turnRateDegPerSecond: crash.rollDirection * turnRateDegPerSecond,
        groundSpeedKt: airspeed,
        trackDeg: heading,
        headwindKt: 0,
        crosswindKt: 0,
        angleOfAttackDeg: 0,
        stalled: false,
        turbulenceLevel: 'none',
      }),
    } as FlightState
    const mission = this.navigation(partial, 'failed', outcome, runway)
    const status = 'failed'
    this.state = Object.freeze({
      ...partial,
      mission,
      checkride: Object.freeze({ ...this.state.checkride, fuelMinutesRemaining, status: 'complete' }),
      debrief: Object.freeze({ ...this.state.debrief, status, elapsedSeconds }),
    })
    if (finished) {
      this.crashDynamics = null
    }
  }

  private advanceRoute(position: { lat: number; lon: number }, altitudeFt: number, _headingDeg: number): { route: RouteState; phase: MissionPhase; reached: RouteWaypoint | null; next: RouteWaypoint | null; stalled: boolean } {
    const route = this.state.route
    const active = route.waypoints[route.activeWaypointIndex]
    if (!active) return { route, phase: this.state.mission.phase, reached: null, next: null, stalled: false }
    const horizontalDistanceNm = distanceNm(position, active)
    const captureRadiusNm = checkpointCaptureRadiusNm(active)
    const runwayAlignedFinal = active.kind === 'final' && route.destination === 'KSTL'
      ? horizontalDistanceNm <= captureRadiusNm
        && Math.abs(headingError(KSTL_RUNWAY_30L.headingDeg, _headingDeg)) <= 45
      : false
    const captureHeadingToleranceDeg = active.id === 'KSTL_COURSE_REVERSAL' ? 25 : 45
    const headingConstraintSatisfied = active.captureHeadingDeg === undefined
      || Math.abs(headingError(active.captureHeadingDeg, _headingDeg)) <= captureHeadingToleranceDeg
    const departureCaptureSatisfied = active.kind !== 'departure' || (
      altitudeFt >= KSTL_RUNWAY_12R.elevationFt + LIFTOFF_CONFIRM_AGL_FT
      && altitudeFt >= active.altitudeFt - 700
      && altitudeFt <= active.altitudeFt + 700
      && this.state.verticalSpeedFpm > 100
    )
    const goAroundCaptureSatisfied = active.id !== 'KSTL_GO_AROUND' || (
      altitudeFt >= active.altitudeFt - 300
      && this.state.verticalSpeedFpm > -1_000
    )
    const reached = !route.completedWaypointIds.includes(active.id)
      && (active.kind === 'final' && route.destination === 'KSTL'
        ? runwayAlignedFinal
        : horizontalDistanceNm <= captureRadiusNm && headingConstraintSatisfied && departureCaptureSatisfied && goAroundCaptureSatisfied)
    const completedWaypointIds = reached
      ? Object.freeze([...route.completedWaypointIds, active.id])
      : route.completedWaypointIds
    const index = reached ? Math.min(route.activeWaypointIndex + 1, route.waypoints.length - 1) : route.activeWaypointIndex
    const activeLegOrigin = reached ? Object.freeze({ lat: position.lat, lon: position.lon }) : route.activeLegOrigin
    const next = route.waypoints[index]
    const following = route.waypoints[index + 1]
    const final = next.kind === 'final' || next.kind === 'touchdown'
    const updatedRoute = reached
      ? Object.freeze({ ...route, activeWaypointIndex: index, completedWaypointIds, activeLegOrigin })
      : route
    const directRouteBearingDeg = anticipatedRouteBearingDeg(position, activeLegOrigin, next, following, this.state.airspeedKt, WIDE_BODY_TWINJET_ENVELOPE.routeBankDeg)
    const routeBearingDeg = next.captureHeadingDeg !== undefined && distanceNm(position, next) <= checkpointCaptureRadiusNm(next)
      ? next.captureHeadingDeg
      : directRouteBearingDeg
    const routeHeadingErrorDeg = Math.abs(headingError(routeBearingDeg, _headingDeg))
    if (this.routeProgress.waypointId !== next.id || reached) {
      this.routeProgress = { waypointId: next.id, bestDistanceNm: distanceNm(position, next), bestHeadingErrorDeg: routeHeadingErrorDeg, secondsWithoutProgress: 0, eventSent: false }
    } else if (arrivalLegProgressed(horizontalDistanceNm, this.routeProgress.bestDistanceNm, routeHeadingErrorDeg, this.routeProgress.bestHeadingErrorDeg)) {
      // A procedure turn initially increases distance to the inbound fix. Treat
      // deliberate course capture as progress and begin measuring distance again
      // from the widest point of the turn.
      this.routeProgress.bestDistanceNm = horizontalDistanceNm
      this.routeProgress.bestHeadingErrorDeg = routeHeadingErrorDeg
      this.routeProgress.secondsWithoutProgress = 0
    } else {
      this.routeProgress.secondsWithoutProgress += STEP
    }
    const recoverableArrivalLeg = route.plan === 'return_kstl'
      && (active.kind === 'enroute' || active.kind === 'base')
    const airborne = altitudeFt - this.runway(route).elevation >= LIFTOFF_CONFIRM_AGL_FT
    const stalled = this.state.checkride.status === 'resolved'
      && recoverableArrivalLeg
      && airborne
      && this.routeProgress.secondsWithoutProgress >= (routeHeadingErrorDeg > 25 ? ROUTE_OFF_COURSE_STALL_SECONDS : ROUTE_STALL_SECONDS)
      && !this.routeProgress.eventSent
    if (!stalled) return { route: updatedRoute, phase: final ? 'approach' : 'enroute', reached: reached ? active : null, next, stalled: false }

    this.routeProgress.eventSent = true
    return { route: updatedRoute, phase: final ? 'approach' : 'enroute', reached: null, next, stalled: true }
  }

  private runway(route: RouteState = this.state.route) {
    if (route.destination === 'KMDW') {
      return {
        threshold: KMDW_THRESHOLD,
        heading: KMDW_RUNWAY_31C.headingDeg,
        elevation: KMDW_RUNWAY_31C.elevationFt,
        lengthFt: KMDW_RUNWAY_31C.lengthFt,
        widthFt: KMDW_RUNWAY_31C.widthFt,
        id: 'KMDW 31C',
      }
    }
    return {
      threshold: KSTL_THRESHOLD,
      heading: KSTL_RUNWAY_30L.headingDeg,
      elevation: KSTL_RUNWAY_30L.elevationFt,
      lengthFt: KSTL_RUNWAY_30L.lengthFt,
      widthFt: KSTL_RUNWAY_30L.widthFt,
      id: 'KSTL 30L',
    }
  }

  private glidepathAltitude(position: { lat: number; lon: number }, threshold: { lat: number; lon: number }, elevation: number) {
    return elevation + Math.tan(radians(PILOT_OPERATING_LIMITS.approach.glidepathDeg)) * distanceNm(position, threshold) * FEET_PER_NM
  }

  private navigation(state: FlightState, phase: MissionPhase, outcome: MissionOutcome, runway: ReturnType<FlightSimulator['runway']>) {
    const envelope = WIDE_BODY_TWINJET_ENVELOPE
    const active = state.route.waypoints[state.route.activeWaypointIndex]
    const directBearingToNextFixDeg = active ? navigationBearingDeg(state, active) : null
    const following = state.route.waypoints[state.route.activeWaypointIndex + 1]
    const guidedBearingToNextFixDeg = active
      ? anticipatedRouteBearingDeg(state, state.route.activeLegOrigin, active, following, state.airspeedKt, envelope.routeBankDeg)
      : null
    const frame = runwayFrame(state, runway.threshold, runway.heading)
    const runwayRelativeTouchdownGuidance = active?.kind === 'touchdown'
      && state.route.destination === 'KSTL'
      && frame.alongNm >= -5
      && frame.alongNm <= runway.lengthFt / FEET_PER_NM
      && Math.abs(frame.crossNm) <= 0.5
    const bearingToNextFixDeg = runwayRelativeTouchdownGuidance
      ? normalizeHeading(KSTL_RUNWAY_30L.headingDeg + clamp(frame.crossNm * 120, -25, 25))
      : active && active.captureHeadingDeg !== undefined && distanceNm(state, active) <= checkpointCaptureRadiusNm(active)
        ? active.captureHeadingDeg
        : guidedBearingToNextFixDeg ?? directBearingToNextFixDeg
    const headingErrorToNextFixDeg = bearingToNextFixDeg === null ? null : headingError(bearingToNextFixDeg, state.motion.trackDeg)
    const closingRateKt = active && bearingToNextFixDeg !== null
      ? state.motion.groundSpeedKt * Math.cos(radians(headingError(bearingToNextFixDeg, state.motion.trackDeg)))
      : null
    const distanceToThresholdNm = distanceNm(state, runway.threshold)
    const touchdownTarget = state.route.waypoints.find((waypoint) => waypoint.kind === 'touchdown') ?? runway.threshold
    const glidepathAltitudeFt = this.glidepathAltitude(state, touchdownTarget, runway.elevation)
    const glidepathErrorFt = state.altitudeFt - glidepathAltitudeFt
    const glidepathGuided = state.route.destination === 'KSTL' && (active?.kind === 'final' || active?.kind === 'touchdown')
    const approach = approachAssessmentFor({
      phase,
      returnArrival: state.route.destination === 'KSTL',
      activeKind: active?.kind ?? null,
      frameAlongNm: frame.alongNm,
      centerlineErrorNm: frame.crossNm,
      glidepathErrorFt,
      distanceToThresholdNm,
      distanceToActiveFixNm: active ? distanceNm(state, active) : null,
      closingRateToActiveFixKt: closingRateKt,
      altitudeAglFt: state.altitudeFt - runway.elevation,
      runwayHeadingErrorDeg: headingError(runway.heading, state.motion.trackDeg),
      verticalSpeedFpm: state.verticalSpeedFpm,
      airspeedKt: state.airspeedKt,
      gearDown: state.gearDown,
      flapsDeg: state.flapsDeg,
    })
    return Object.freeze({
      phase: outcome === 'in_progress' ? phase : outcome === 'landed' ? 'complete' : 'failed',
      outcome, nextFix: active?.id ?? null,
      distanceToNextFixNm: active ? distanceNm(state, active) : null,
      bearingToNextFixDeg,
      headingErrorToNextFixDeg,
      altitudeErrorToNextFixFt: active ? (glidepathGuided ? glidepathAltitudeFt : active.altitudeFt) - state.altitudeFt : null,
      airspeedErrorToNextFixKt: active ? active.airspeedKt - state.airspeedKt : null,
      closingRateKt,
      captureRadiusNm: active ? checkpointCaptureRadiusNm(active) : null,
      minimumTurnRadiusNm: coordinatedTurnRadiusNm(Math.max(state.airspeedKt, envelope.minCommandSpeedKt), envelope.routeBankDeg),
      routeStatus: active ? (this.routeProgress.eventSent ? 'stalled' : 'tracking') : 'idle',
      distanceToThresholdNm, centerlineErrorNm: frame.crossNm,
      glidepathErrorFt,
      stableApproach: approach.stable,
      goAroundRequired: this.state.mission.goAroundRequired || approach.goAroundRequired,
      eventRevision: this.eventRevision,
    })
  }

  private finish(outcome: MissionOutcome) {
    if (this.events.some((event) => event.type === 'mission_complete' || event.type === 'mission_failed')) return
    const success = outcome === 'landed'
    this.addDebrief('system', success ? 'Aircraft stopped safely' : `Mission ended: ${outcome.replaceAll('_', ' ')}`)
    this.record('system', success ? 'mission_complete' : 'mission_failed', success ? 'Aircraft stopped safely' : `Mission failed: ${outcome.replaceAll('_', ' ')}`, {
      outcome,
      runway: this.state.debrief.landing?.runway ?? this.runway().id,
      score: this.state.checkride.score.total,
      landing: this.state.debrief.landing,
    })
    this.queueEvent(success ? 'mission_complete' : 'mission_failed', success ? 'Aircraft stopped safely.' : `Mission failed: ${outcome.replaceAll('_', ' ')}.`)
  }

  private issueAtcClearance() {
    const plan = this.state.atc.requestedPlan
    if (this.state.atc.status !== 'requested' || !plan) return
    const route = routeFor(plan, this.state)
    const initial = route.waypoints[route.activeWaypointIndex]
    if (!initial || !route.destination || !route.runway) return
    this.pendingAtcRoute = route
    const headingDeg = navigationBearingDeg(this.state, initial)
    const clearance: AtcClearance = Object.freeze({
      id: `ATC-${this.state.checkride.runId.slice(0, 8)}-${this.eventRevision + 1}`,
      plan,
      destination: route.destination,
      runway: route.runway,
      routing: plan === 'return_kstl' ? 'vectors' : 'direct',
      initialFix: initial.name,
      headingDeg,
      altitudeFt: initial.altitudeFt,
      airspeedKt: initial.airspeedKt,
      approach: `${route.destination} runway ${route.runway}`,
      instruction: `${plan === 'return_kstl' ? 'Radar vectors' : `Cleared direct ${initial.name}`} to ${route.destination}; fly heading ${Math.round(headingDeg).toString().padStart(3, '0')}°, maintain ${initial.altitudeFt} ft and ${initial.airspeedKt} kt, expect runway ${route.runway}.`,
      commandPoints: Object.freeze(route.waypoints.map((fix) => commandPointFor(fix, route.destination === 'KSTL' ? KSTL_THRESHOLD : KMDW_THRESHOLD))),
    })
    this.atcClearanceDueElapsedSeconds = null
    this.state = Object.freeze({
      ...this.state,
      atc: Object.freeze({ ...this.state.atc, status: 'cleared', clearance }),
      checkride: Object.freeze({ ...this.state.checkride, alert: `ATC clearance received: ${clearance.instruction}` }),
    })
    this.record('system', 'atc_clearance_issued', clearance.instruction, {
      clearanceId: clearance.id,
      plan,
      destination: clearance.destination,
      runway: clearance.runway,
      routing: clearance.routing,
      initialFix: clearance.initialFix,
      headingDeg: clearance.headingDeg,
      altitudeFt: clearance.altitudeFt,
      airspeedKt: clearance.airspeedKt,
      approach: clearance.approach,
      commandPoints: clearance.commandPoints,
    })
    this.addDebrief('system', `ATC issued ${clearance.id}`)
    this.queueEvent('atc_clearance_received', `${clearance.instruction} Read back clearance ${clearance.id} with destination, runway, altitude, and initial heading.`)
  }

  private activeFlightActor(): TraceActor {
    return this.state.flightMode === 'unselected' ? 'system' : this.state.flightMode
  }

  private assertActorMode(actor: TraceActor) {
    if (actor === 'system') return
    if (this.state.flightMode === 'unselected') throw new Error('Choose a manual or agent flight before continuing.')
    if (this.state.flightMode !== actor) throw new Error(`This run is locked to ${this.state.flightMode} control. Start a new flight to change modes.`)
  }

  private modeRejection(actor: TraceActor): ActionReceipt | null {
    if (actor === 'system') return null
    if (this.state.flightMode === 'unselected') {
      return this.receipt(false, 'Choose a manual or agent flight before using the controls.')
    }
    if (this.state.flightMode !== actor) {
      return this.receipt(false, `This run is locked to ${this.state.flightMode} control. Start a new flight to change modes.`)
    }
    return null
  }

  private addDebrief(actor: TraceActor, summary: string) {
    const event: DebriefEvent = Object.freeze({ elapsedSeconds: this.state.elapsedSeconds, actor, summary })
    this.state = Object.freeze({ ...this.state, debrief: Object.freeze({ ...this.state.debrief, events: Object.freeze([...this.state.debrief.events.slice(-19), event]) }) })
  }

  private receipt(accepted: boolean, summary: string, planReview?: ActionReceipt['planReview']): ActionReceipt {
    return Object.freeze({ accepted, summary, eventRevision: this.eventRevision, state: this.state, ...(planReview ? { planReview } : {}) })
  }

  private record(actor: TraceActor, action: string, reason: string, details: Readonly<Record<string, unknown>>) {
    const event = Object.freeze({ id: this.traceId++, time: Date.now(), elapsedSeconds: this.state.elapsedSeconds, actor, action, reason, details })
    this.trace = Object.freeze([...this.trace.slice(-249), event])
  }

  private queueEvent(type: FlightEventType, message: string) {
    const event = Object.freeze({ revision: ++this.eventRevision, type, elapsedSeconds: this.state.elapsedSeconds, message, phase: this.state.mission.phase, routePlan: this.state.route.plan })
    this.events = Object.freeze([...this.events.slice(-49), event])
    this.state = Object.freeze({ ...this.state, mission: Object.freeze({ ...this.state.mission, eventRevision: event.revision }) })
    for (const waiter of this.waiters) {
      if (event.revision <= waiter.afterRevision || !waiter.events.has(event.type)) continue
      clearTimeout(waiter.timeout)
      this.waiters.delete(waiter)
      waiter.resolve(this.eventResult(event))
    }
  }

  private eventResult(event: FlightEvent): FlightEventWaitResult {
    if (event.type === 'emergency_detected' && this.state.checkride.status === 'decision_required') this.decisionTimerRunning = true
    return Object.freeze({ revision: event.revision, event: event.type, message: event.message, state: this.state })
  }

  private cancelWaiters() {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout)
      waiter.resolve({ revision: this.eventRevision, event: 'timeout', message: 'Mission reset.', state: this.state })
    }
    this.waiters.clear()
  }

  private publish(state: FlightState) { this.state = state; this.snapshot = state; this.emit() }
  private emit() { for (const listener of this.listeners) listener() }
}

export const flightSimulator = new FlightSimulator()
