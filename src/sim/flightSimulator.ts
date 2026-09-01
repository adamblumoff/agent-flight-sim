import type {
  ActionReceipt, ActiveLegRebuildStrategy, AircraftConfigurationInput, AtcClearance, AutopilotState, AutopilotTargetsInput,
  CheckrideSeed, ConfigurationProcedure, ControlOwner, DebriefEvent, EvidenceSource, FlightEvent,
  FlightEventType, FlightEventWaitInput, FlightEventWaitResult, FlightEvidence,
  DiversionPlan, FlightMode, FlightState, FlightStateListener, EmergencyDecisionContext, MissionBrief, MissionOutcome, MissionPhase,
  PilotControls, RoutePlan, RouteState, RouteWaypoint, ScenarioConditions, TraceActor,
  TraceEvent,
} from './types'
import { checkpointCaptureRadiusNm } from './checkpoints.ts'
import { CONCORDE_ENVELOPE, flightEnvelopeFor, staticThrustAccelerationKtPerSecond, type AircraftEnvelope } from './aircraftEnvelope.ts'
import { airborneDragKtPerSecond, groundMotionFor, stallResponseFor, turbulenceFor, windCorrectedHeadingDeg } from './aerodynamics.ts'
import { BUILD_ID } from '../buildInfo.ts'
import { missionProfileFor } from './missionProfiles.ts'
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
const MAX_WAIT_MS = 15_000
const EARTH_RADIUS_NM = 3_440.065
const FEET_PER_NM = 6_076.12
const KSTL_ELEVATION = KSTL_RUNWAY_30L.elevationFt
const MAX_SAFE_TOUCHDOWN_FPM = 600
const BOUNCE_THRESHOLD_FPM = 240
const MAX_TOUCHDOWN_BANK_DEG = 18
const MAX_BOUNCES = 2
const CRASH_SLIDE_SECONDS = 2.5
const A380_TAKEOFF_ACCELERATION_KT_PER_SECOND = 5.8
const A380_AIRBORNE_ACCELERATION_KT_PER_SECOND = 8.5
const TAKEOFF_ROLLING_RESISTANCE_KT_PER_SECOND = 0.2
const TAKEOFF_AERO_DRAG_AT_ROTATE_KT_PER_SECOND = 0.65
const PILOT_PITCH_TRIM_RATE_DEG_PER_SECOND = 5.5
const PILOT_BANK_TRIM_RATE_DEG_PER_SECOND = 11.5
const PILOT_PITCH_RESPONSE_DEG_PER_SECOND = 8
const PILOT_BANK_RESPONSE_DEG_PER_SECOND = 16
const PILOT_VERTICAL_RESPONSE_FPM_PER_SECOND = 420
const EMERGENCY_DECISION_SECONDS = 60
const ATC_RESPONSE_WALL_SECONDS = 2
const MAX_EMERGENCY_TURN_FIXES = 3
const DECISION_HOLD_BANK_DEG = 12
const DECISION_HOLD_HEADING_LEAD_DEG = 20
const LIFTOFF_CONFIRM_AGL_FT = 35
const ROUTE_STALL_SECONDS = 20
const ROUTE_PROGRESS_EPSILON_NM = 0.015
const ROUTE_CAPTURE_FLOOR_NM = 0.28
const COMFORT_BANK_WARNING_DEG = 24
const COMFORT_LOAD_WARNING_G = 1.35
const COMFORT_JERK_WARNING_G_PER_SECOND = 0.9
const LANDING_ROLL_BASE_DRAG_KT_PER_SECOND = 1.4
const LANDING_ROLL_IDLE_BRAKING_KT_PER_SECOND = 2.6
const LANDING_ROLL_THRUST_KT_PER_SECOND = 4.8
const PASSENGER_INJURY_DRAW: Readonly<Record<CheckrideSeed, number>> = Object.freeze({ 17: 0.72, 42: 0.56, 81: 0.42 })

const FLIGHT_EVENT_PRIORITY: Readonly<Partial<Record<FlightEventType, number>>> = Object.freeze({
  mission_failed: 100,
  emergency_detected: 90,
  atc_clearance_received: 85,
  decision_timer_expired: 80,
  approval_required: 70,
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
  if (!following || target.kind !== 'enroute') return baseBearingDeg
  const inboundCourseDeg = navigationBearingDeg(origin, target)
  const outboundCourseDeg = navigationBearingDeg(target, following)
  const turnAngleDeg = Math.abs(headingError(outboundCourseDeg, inboundCourseDeg))
  if (turnAngleDeg < 12) return baseBearingDeg
  const turnRadiusNm = coordinatedTurnRadiusNm(Math.max(airspeedKt, 90), Math.max(10, routeBankDeg))
  const leadNm = clamp(turnRadiusNm * Math.tan(radians(Math.min(100, turnAngleDeg)) / 2), 0.15, 0.65)
  const distanceToTargetNm = distanceNm(position, target)
  const blend = clamp((leadNm + target.captureRadiusNm - distanceToTargetNm) / Math.max(leadNm, 0.01), 0, 0.25)
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

// A380-class envelope: 72.7 m long, 79.8 m span, with simplified contact points.
const collisionHull = Object.freeze([
  Object.freeze({ x: 0, y: 4.6, z: -36.4 }),
  Object.freeze({ x: 0, y: 5, z: 36.2 }),
  Object.freeze({ x: -39.6, y: 8, z: 5.9 }),
  Object.freeze({ x: 39.6, y: 8, z: 5.9 }),
  Object.freeze({ x: 0, y: 4.4, z: 0 }),
])
const extendedGearContactPoints = Object.freeze([
  Object.freeze({ x: -7.1, y: 0, z: 5 }),
  Object.freeze({ x: 7.1, y: 0, z: 5 }),
  Object.freeze({ x: 0, y: 0, z: -24.2 }),
])
const collisionPoints = Object.freeze([...collisionHull, ...extendedGearContactPoints])

const concordeCollisionHull = Object.freeze([
  Object.freeze({ x: 0, y: 4.15, z: -34.2 }),
  Object.freeze({ x: 0, y: 4.15, z: 34.2 }),
  Object.freeze({ x: -13.7, y: 4.05, z: 10.5 }),
  Object.freeze({ x: 13.7, y: 4.05, z: 10.5 }),
  Object.freeze({ x: 0, y: 2.7, z: 0 }),
])
const concordeGearContactPoints = Object.freeze([
  Object.freeze({ x: -4.6, y: 0, z: 7.2 }),
  Object.freeze({ x: 4.6, y: 0, z: 7.2 }),
  Object.freeze({ x: 0, y: 0, z: -23.5 }),
])
const concordeCollisionPoints = Object.freeze([...concordeCollisionHull, ...concordeGearContactPoints])

const groundClearanceFt = (pitchDeg: number, bankDeg: number, gearDown: boolean, mode: FlightMode) => {
  const pitch = radians(pitchDeg)
  const roll = radians(-bankDeg)
  const hull = mode === 'judge' ? concordeCollisionHull : collisionHull
  const points = mode === 'judge' ? concordeCollisionPoints : collisionPoints
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

export const SHARED_AUTONOMY_MISSION: MissionBrief = Object.freeze({
  id: 'SHARED-AUTONOMY-EMERGENCY-01',
  name: 'Rough running over St. Louis',
  objective: 'Depart St. Louis Lambert for Chicago Midway, assess the surprise emergency, and return safely to Lambert within ten minutes.',
  start: 'Lined up on St. Louis Lambert runway 12R with the aircraft configured for takeoff.',
  deadlineSeconds: missionProfileFor('full').deadlineSeconds,
  airports: Object.freeze([KSTL_AIRPORT, KMDW_AIRPORT]),
  runways: Object.freeze([KSTL_RUNWAY_12R, KSTL_RUNWAY_30L, KMDW_RUNWAY_31C]),
  assignedRoute: Object.freeze({ plan: 'continue_kmdw', destination: 'KMDW', runway: '31C' }),
  availablePlans: Object.freeze(['return_kstl', 'continue_kmdw'] as const),
  evidenceSources: Object.freeze(['weather', 'cockpit', 'traffic', 'passenger'] as const),
  successConditions: Object.freeze([
    'Take off from St. Louis Lambert runway 12R.',
    'At 170 knots, rotate at approximately 3 degrees per second toward 12.5 degrees initial pitch while holding runway heading.',
    'Retract gear after a positive climb rate, then retract takeoff flaps in the climb.',
    'Read the combined emergency decision context before selecting a route.',
    'Use flaps 10 near 185 knots on base, then gear down and flaps 20 by 155 knots on final.',
    'Reach final with gear down and at least 20 degrees of flaps.',
    'Stabilize near 140 knots and touch down below 155 knots and 600 feet per minute.',
  ]),
})

const NORMAL_DEPARTURE_MISSION: MissionBrief = Object.freeze({
  ...SHARED_AUTONOMY_MISSION,
  name: 'St. Louis Lambert departure',
  objective: 'Depart St. Louis Lambert runway 12R for Chicago Midway, clean up the aircraft, and monitor for an enroute update.',
  availablePlans: Object.freeze(['continue_kmdw'] as const),
  successConditions: Object.freeze([
    'File the Chicago Midway runway 31C route before takeoff.',
    'At 170 knots, rotate at approximately 3 degrees per second toward 12.5 degrees initial pitch on St. Louis Lambert runway 12R.',
    'Retract gear after a positive climb rate.',
    'Retract takeoff flaps after the climb is established.',
    'Monitor for an enroute update before changing the route.',
  ]),
})

const JUDGE_SHARED_AUTONOMY_MISSION: MissionBrief = Object.freeze({
  ...SHARED_AUTONOMY_MISSION,
  name: 'Compact emergency evaluation',
  objective: 'Fly the compact Concorde terminal profile, assess the emergency, and return safely to Lambert before the six-minute hard limit.',
  deadlineSeconds: missionProfileFor('judge').deadlineSeconds,
  successConditions: Object.freeze([
    'Take off from St. Louis Lambert runway 12R in the Concorde.',
    `Call V1 at ${CONCORDE_ENVELOPE.decisionSpeedKt} knots, begin rotation at ${CONCORDE_ENVELOPE.rotateSpeedKt} knots, and reach V2 at ${CONCORDE_ENVELOPE.takeoffSafetySpeedKt} knots; liftoff occurs when aerodynamic lift exceeds aircraft weight.`,
    'Retract the gear after positive rate; the Concorde delta wing has no conventional flaps.',
    'Read the combined emergency context and comply with the resulting ATC clearance.',
    `Fly the compact return near ${CONCORDE_ENVELOPE.emergencyTurnSpeedKt} knots, stabilize near ${CONCORDE_ENVELOPE.approachSpeedKt} knots, and touch down below ${CONCORDE_ENVELOPE.maxTouchdownSpeedKt} knots.`,
  ]),
})

const JUDGE_NORMAL_DEPARTURE_MISSION: MissionBrief = Object.freeze({
  ...NORMAL_DEPARTURE_MISSION,
  name: 'Compact St. Louis Lambert departure',
  objective: 'Fly the compact Concorde departure in the shared real-time world and monitor for an enroute update.',
  deadlineSeconds: missionProfileFor('judge').deadlineSeconds,
  successConditions: Object.freeze([
    'File the Chicago Midway runway 31C route before takeoff.',
    `At ${CONCORDE_ENVELOPE.rotateSpeedKt} knots, rotate at approximately ${CONCORDE_ENVELOPE.rotationRateDegPerSecond} degrees per second toward ${CONCORDE_ENVELOPE.initialClimbPitchDeg} degrees initial pitch; liftoff is determined by lift exceeding weight, not by reaching a pitch gate.`,
    `Reach V2 at ${CONCORDE_ENVELOPE.takeoffSafetySpeedKt} knots, then accelerate clean toward ${CONCORDE_ENVELOPE.initialClimbSpeedKt} knots.`,
    'Retract the landing gear after positive rate; Concorde has no conventional flap detents.',
    'Monitor for an enroute update before changing the filed route.',
  ]),
})

const missionBriefFor = (mode: FlightMode, emergency: boolean) => mode === 'judge'
  ? emergency ? JUDGE_SHARED_AUTONOMY_MISSION : JUDGE_NORMAL_DEPARTURE_MISSION
  : emergency ? SHARED_AUTONOMY_MISSION : NORMAL_DEPARTURE_MISSION

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

const distanceNm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
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

const emergencyTurnIntercepts = (
  origin: { lat: number; lon: number; headingDeg?: number },
  target: { lat: number; lon: number },
  maximumFixes = MAX_EMERGENCY_TURN_FIXES,
  mode: FlightMode = 'full',
  forcedTurnDeg?: number,
  idPrefix = 'KSTL_TURN_',
) => {
  const envelope = flightEnvelopeFor(mode)
  const directBearingDeg = navigationBearingDeg(origin, target)
  const startingHeadingDeg = origin.headingDeg ?? directBearingDeg
  const totalTurnDeg = forcedTurnDeg ?? headingError(directBearingDeg, startingHeadingDeg)
  const turnCount = Math.min(maximumFixes, Math.ceil(Math.abs(totalTurnDeg) / 35))
  const radiusNm = coordinatedTurnRadiusNm(envelope.emergencyTurnSpeedKt, envelope.routeBankDeg)
  const intercepts: RouteWaypoint[] = []
  let position = origin
  let headingDeg = startingHeadingDeg
  for (let index = 0; index < turnCount; index += 1) {
    const turnStepDeg = totalTurnDeg / turnCount
    const chordNm = forcedTurnDeg === undefined
      ? Math.max(0.9, 2 * radiusNm * Math.sin(radians(Math.abs(turnStepDeg)) / 2))
      : 2 * radiusNm * Math.sin(radians(Math.abs(turnStepDeg)) / 2)
    position = offsetPosition(position, normalizeHeading(headingDeg + turnStepDeg / 2), chordNm)
    headingDeg = normalizeHeading(headingDeg + turnStepDeg)
    intercepts.push(waypoint(`${idPrefix}${index + 1}`, `KSTL turn ${index + 1}`, 'enroute', position, 1_500, envelope.emergencyTurnSpeedKt, ROUTE_CAPTURE_FLOOR_NM, forcedTurnDeg === undefined ? undefined : headingDeg))
  }
  return Object.freeze(intercepts)
}

const routeFor = (plan: RoutePlan, origin: { lat: number; lon: number; headingDeg?: number }, _emergencyContinuation = false, mode: FlightMode = 'full'): RouteState => {
  const envelope = flightEnvelopeFor(mode)
  if (plan === 'continue_kmdw') {
    const reciprocalHeading = normalizeHeading(KMDW_RUNWAY_31C.headingDeg + 180)
    const entry = offsetPosition(KMDW_THRESHOLD, reciprocalHeading, 3)
    const base = offsetPosition(entry, normalizeHeading(KMDW_RUNWAY_31C.headingDeg + 90), 2.2)
    const midwayBearing = navigationBearingDeg(KSTL_DEPARTURE_START, KMDW_THRESHOLD)
    return Object.freeze({ plan, destination: 'KMDW', runway: '31C', reason: null, activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), activeLegOrigin: Object.freeze({ lat: origin.lat, lon: origin.lon }), waypoints: Object.freeze([
      waypoint('KSTL_CLIMB', 'Lambert runway 12R climb', 'departure', offsetPosition(KSTL_DEPARTURE_START, KSTL_RUNWAY_12R.headingDeg, 0.65), 1_200, envelope.initialClimbSpeedKt, ROUTE_CAPTURE_FLOOR_NM),
      waypoint('MIDWAY_ENROUTE', 'Chicago Midway enroute', 'enroute', offsetPosition(KSTL_DEPARTURE_START, midwayBearing, mode === 'judge' ? 2.4 : 6.4), 1_800, envelope.enrouteSpeedKt, ROUTE_CAPTURE_FLOOR_NM),
      waypoint('KMDW_BASE', 'Midway runway 31C base', 'base', base, 1_800, envelope.emergencyTurnSpeedKt, ROUTE_CAPTURE_FLOOR_NM),
      waypoint('KMDW_ENTRY', 'Midway runway 31C entry', 'final', entry, 1_250, envelope.finalSpeedKt, ROUTE_CAPTURE_FLOOR_NM),
      waypoint('KMDW_TOUCHDOWN', 'Midway runway 31C', 'touchdown', offsetPosition(KMDW_THRESHOLD, KMDW_RUNWAY_31C.headingDeg, 0.12), KMDW_RUNWAY_31C.elevationFt, envelope.approachSpeedKt, 0.06),
    ]) })
  }
  if (plan === 'return_kstl') {
    const compact = mode === 'judge'
    const reciprocalHeading = normalizeHeading(KSTL_RUNWAY_30L.headingDeg + 180)
    const finalPosition = offsetPosition(KSTL_THRESHOLD, reciprocalHeading, compact ? 1.3 : 3)
    const interceptPosition = offsetPosition(KSTL_THRESHOLD, reciprocalHeading, compact ? 2.05 : 4.5)
    const baseLeg = offsetPosition(
      offsetPosition(KSTL_THRESHOLD, reciprocalHeading, compact ? 2.2 : 3.6),
      normalizeHeading(KSTL_RUNWAY_30L.headingDeg - 90),
      compact ? 0.7 : 2.4,
    )
    const captureRadiusNm = compact ? 0.65 : ROUTE_CAPTURE_FLOOR_NM
    const turnFixes = compact
      ? Object.freeze([
          waypoint('KSTL_COMPACT_TURN_1', 'KSTL outbound gate', 'enroute', offsetPosition(KSTL_THRESHOLD, reciprocalHeading, 3.1), 1_350, 190, 0.55),
          waypoint(
            'KSTL_COMPACT_TURN_2',
            'KSTL base gate',
            'base',
            offsetPosition(offsetPosition(KSTL_THRESHOLD, reciprocalHeading, 4), normalizeHeading(KSTL_RUNWAY_30L.headingDeg - 90), 1.35),
            1_150,
            170,
            0.55,
          ),
          waypoint('KSTL_COMPACT_TURN_3', 'KSTL final intercept', 'base', offsetPosition(KSTL_THRESHOLD, reciprocalHeading, 3.6), 950, 165, 0.5, KSTL_RUNWAY_30L.headingDeg),
        ])
      : emergencyTurnIntercepts(origin, baseLeg, MAX_EMERGENCY_TURN_FIXES, mode).map((fix) => Object.freeze({ ...fix, captureRadiusNm }))
    const baseFixes = compact
      ? Object.freeze([])
      : Object.freeze([
          waypoint('KSTL_BASE', 'Runway 30L base', 'base', baseLeg, 1_800, envelope.baseSpeedKt, captureRadiusNm),
        ])
    const intercepts = compact
      ? Object.freeze([])
      : Object.freeze([
          waypoint('KSTL_INTERCEPT', 'Runway 30L intercept', 'enroute', interceptPosition, 1_800, envelope.baseSpeedKt, captureRadiusNm),
        ])
    return Object.freeze({ plan, destination: 'KSTL', runway: '30L', reason: null, activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), activeLegOrigin: Object.freeze({ lat: origin.lat, lon: origin.lon }), waypoints: Object.freeze([
      ...turnFixes,
      ...baseFixes,
      ...intercepts,
      waypoint('KSTL_FINAL', 'Runway 30L final', 'final', finalPosition, compact ? 950 : 1_600, envelope.finalSpeedKt, compact ? 0.4 : 0.5),
      waypoint('KSTL_TOUCHDOWN', 'Runway 30L touchdown', 'touchdown', offsetPosition(KSTL_THRESHOLD, KSTL_RUNWAY_30L.headingDeg, 0.14), KSTL_ELEVATION, envelope.approachSpeedKt, 0.012),
    ]) })
  }
  return Object.freeze({ plan, destination: null, runway: null, reason: null, activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), activeLegOrigin: Object.freeze({ lat: origin.lat, lon: origin.lon }), waypoints: Object.freeze([]) })
}

const initialAutopilot = (mode: FlightMode): AutopilotState => Object.freeze({ enabled: false, headingDeg: KSTL_RUNWAY_12R.headingDeg, altitudeFt: 1_200, airspeedKt: flightEnvelopeFor(mode).initialClimbSpeedKt, verticalMode: 'climb', lateralMode: 'route' })
const initialRoute = (): RouteState => Object.freeze({ plan: 'unassigned', destination: null, runway: null, waypoints: Object.freeze([]), activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), activeLegOrigin: Object.freeze({ lat: KSTL_DEPARTURE_START.lat, lon: KSTL_DEPARTURE_START.lon }), reason: null })

const configurationProcedureFor = (state: Pick<FlightState, 'mode' | 'aircraftPhase' | 'altitudeFt' | 'airspeedKt' | 'route' | 'gearDown' | 'flapsDeg'>): ConfigurationProcedure => {
  if (state.aircraftPhase === 'landing_roll' || state.aircraftPhase === 'stopped' || state.aircraftPhase === 'crash_slide') {
    return Object.freeze({ stage: 'complete', gearDown: state.gearDown, flapsDeg: state.flapsDeg as 0 | 10 | 20 | 30, compliant: true, instruction: 'Configuration sequence complete.' })
  }
  const envelope = flightEnvelopeFor(state.mode)
  let stage: ConfigurationProcedure['stage'] = 'takeoff'
  let gearDown = true
  let flapsDeg: ConfigurationProcedure['flapsDeg'] = envelope.takeoffFlapsDeg
  let instruction = envelope.hasConventionalFlaps
    ? 'Takeoff: gear down, flaps 10° (CONF 1+F); at 170 kt rotate at 3°/s toward 12.5° initial pitch.'
    : `Takeoff: gear down, clean delta wing. V1 ${envelope.decisionSpeedKt} kt, VR ${envelope.rotateSpeedKt} kt, V2 ${envelope.takeoffSafetySpeedKt} kt.`
  if (state.aircraftPhase === 'airborne') {
    const aglFt = state.altitudeFt - KSTL_RUNWAY_12R.elevationFt
    const activeKind = state.route.waypoints[state.route.activeWaypointIndex]?.kind
    if (activeKind === 'departure' && aglFt < 180) {
      stage = 'positive_rate'
      gearDown = false
      instruction = envelope.hasConventionalFlaps
        ? 'Positive rate: retract the landing gear; hold flaps 10° (CONF 1+F).'
        : `Positive rate: retract the landing gear and accelerate clean through ${envelope.takeoffSafetySpeedKt} kt.`
    } else if ((!activeKind || activeKind === 'departure' || activeKind === 'enroute') && (aglFt < 1_000 || state.airspeedKt < envelope.flapRetractionSpeedKt)) {
      stage = 'positive_rate'
      gearDown = false
      instruction = envelope.hasConventionalFlaps
        ? 'Climb: hold flaps 10° until 1,000 ft AGL and 210 kt while maintaining takeoff power.'
        : `Climb: keep the clean delta wing and accelerate toward ${envelope.initialClimbSpeedKt} kt.`
    } else if (!activeKind || activeKind === 'departure' || activeKind === 'enroute') {
      stage = 'climb_cleanup'
      gearDown = false
      flapsDeg = 0
      instruction = envelope.hasConventionalFlaps
        ? 'Above 1,000 ft AGL and 210 kt: retract flaps to 0° and accelerate toward 230 kt.'
        : `Clean climb: gear up, no flaps, target ${envelope.enrouteSpeedKt} kt.`
    } else if (activeKind === 'base') {
      stage = 'base'
      gearDown = false
      flapsDeg = envelope.hasConventionalFlaps ? 10 : 0
      instruction = envelope.hasConventionalFlaps
        ? 'Base leg near 185 kt: select flaps 10°; keep the gear up.'
        : `Base leg: keep the clean delta wing and gear up near ${envelope.baseSpeedKt} kt.`
    } else if (activeKind === 'final') {
      stage = 'final'
      flapsDeg = envelope.approachFlapsDeg
      instruction = envelope.hasConventionalFlaps
        ? 'Final near 155 kt: gear down, flaps 20° (CONF 3).'
        : `Final: gear down, clean delta wing, target ${envelope.finalSpeedKt} kt before slowing to ${envelope.approachSpeedKt} kt.`
    } else {
      stage = 'landing'
      flapsDeg = envelope.landingFlapsDeg
      instruction = envelope.hasConventionalFlaps
        ? 'Landing: select flaps 30° (FULL), verify gear down, target 140 kt.'
        : `Landing: gear down, no flaps, stabilize near ${envelope.approachSpeedKt} kt.`
    }
  }
  return Object.freeze({ stage, gearDown, flapsDeg, compliant: state.gearDown === gearDown && state.flapsDeg === flapsDeg, instruction })
}

const initialState = (seed: CheckrideSeed, mode: FlightMode = 'full'): FlightState => {
  const start = KSTL_DEPARTURE_START
  const scenario = NORMAL_DEPARTURE_SCENARIO
  const envelope = flightEnvelopeFor(mode)
  const profile = missionProfileFor(mode)
  const autopilot = initialAutopilot(mode)
  // Keep the known preflight state independent from the sealed event matrix.
  // Otherwise fuel endurance becomes an indirect scenario identifier.
  const fuel = 13.5
  const state = {
    mode, ...start, altitudeFt: KSTL_RUNWAY_12R.elevationFt, airspeedKt: 0, verticalSpeedFpm: 0, headingDeg: KSTL_RUNWAY_12R.headingDeg,
    pitchDeg: 0, bankDeg: 0, throttle: 0, flapsDeg: envelope.takeoffFlapsDeg, gearDown: true,
    elapsedSeconds: 0, fuelMinutesRemaining: fuel, controlOwner: 'human', handoffRequested: false,
    agentMode: 'idle', autopilot, route: initialRoute(), atc: Object.freeze({ status: 'none', requestedPlan: null, requestReason: null, clearance: null }), scenario,
    motion: Object.freeze({ longitudinalAccelerationKtPerSecond: 0, verticalAccelerationFpmPerSecond: 0, turnRateDegPerSecond: 0, groundSpeedKt: 0, trackDeg: KSTL_RUNWAY_12R.headingDeg, headwindKt: NORMAL_DEPARTURE_SCENARIO.weather.windSpeedKt, crosswindKt: 0, angleOfAttackDeg: 0, stalled: false, turbulenceLevel: 'none' }),
    impact: null,
    aircraftPhase: 'takeoff_roll',
    approval: Object.freeze({ status: 'none', question: null, requestedAction: null }),
    mission: Object.freeze({ phase: 'preflight', outcome: 'in_progress', nextFix: null, distanceToNextFixNm: null, bearingToNextFixDeg: null, closingRateKt: null, captureRadiusNm: null, minimumTurnRadiusNm: coordinatedTurnRadiusNm(envelope.initialClimbSpeedKt, envelope.routeBankDeg), routeStatus: 'idle', distanceToThresholdNm: distanceNm(start, KMDW_THRESHOLD), centerlineErrorNm: 0, glidepathErrorFt: 0, stableApproach: false, eventRevision: 0 }),
    checkride: Object.freeze({ runId: createRunId(), seed, buildId: BUILD_ID, profileId: profile.id, status: 'armed', objective: missionBriefFor(mode, false).objective, deadlineSeconds: profile.deadlineSeconds, wallClockDeadlineSeconds: profile.wallClockDeadlineSeconds, simulationRate: profile.simulationRate, decisionSecondsRemaining: null, decisionContextRead: false, fuelMinutesRemaining: fuel, alert: null, humanApproval: 'not_required', inspectedSources: Object.freeze([]), score: initialScore(), decision: null }),
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
  private traceId = 1
  private eventRevision = 0
  private impactRevision = 0
  private bounceCount = 0
  private peakTouchdownImpactFpm = 0
  private crashDynamics: CrashDynamics | null = null
  private selectedScenario = scenarios[17]
  private emergencyTriggered = false
  private decisionTimerExpired = false
  private decisionTimerRunning = false
  private atcClearanceDueElapsedSeconds: number | null = null
  private decisionHoldTurnDirection: -1 | 1 = 1
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
      : clamp((renderTimeMs - this.lastFrameMs) / 1_000, 0, MAX_FRAME) * missionProfileFor(this.state.mode).simulationRate
    return clamp((this.accumulator + pendingSeconds) / STEP, 0, 1)
  }
  getSnapshot = () => this.snapshot
  getTrace = () => this.trace
  getEventRevision = () => this.eventRevision
  getMissionBrief = () => {
    const brief = missionBriefFor(this.state.mode, this.emergencyTriggered)
    return Object.freeze({ ...brief, deadlineSeconds: missionProfileFor(this.state.mode).wallClockDeadlineSeconds })
  }
  subscribe = (listener: FlightStateListener) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  start = () => {
    if (this.animationFrame !== null || typeof requestAnimationFrame === 'undefined') return
    this.lastFrameMs = null
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  stop = () => {
    if (this.animationFrame !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.animationFrame)
    this.animationFrame = null
    this.lastFrameMs = null
  }

  reset = (seed: CheckrideSeed = this.state.checkride.seed, mode: FlightMode = this.state.mode) => {
    this.cancelWaiters()
    this.state = initialState(seed, mode)
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
    this.decisionTimerExpired = false
    this.decisionTimerRunning = false
    this.atcClearanceDueElapsedSeconds = null
    this.decisionHoldTurnDirection = 1
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
    this.record('system', 'mission_started', `${mode === 'judge' ? 'Judge' : 'Full'} mission seed ${seed} started`, { mode })
    this.previousState = this.state
    this.publish(this.state)
  }

  inspectEvidence = (source: EvidenceSource): FlightEvidence => {
    if (this.emergencyTriggered) this.decisionTimerRunning = true
    const baseReport = evidenceFor(this.state.scenario)[source]
    const report = source === 'passenger'
      ? Object.freeze({ ...baseReport, detail: `${baseReport.detail} ${this.state.passengerSafety.summary}` })
      : baseReport
    if (!this.state.checkride.inspectedSources.includes(source)) {
      this.state = Object.freeze({ ...this.state, checkride: Object.freeze({ ...this.state.checkride, inspectedSources: Object.freeze([...this.state.checkride.inspectedSources, source]) }) })
      this.record('agent', 'evidence_inspected', report.headline, { source })
      this.publish(this.state)
    }
    return report
  }

  getDecisionContext = (): EmergencyDecisionContext => {
    if (!this.emergencyTriggered) throw new Error('Decision context is sealed until emergency_detected.')
    this.decisionTimerRunning = true
    this.state = Object.freeze({ ...this.state, checkride: Object.freeze({ ...this.state.checkride, decisionContextRead: true }) })
    const evidence = Object.freeze((['weather', 'cockpit', 'traffic', 'passenger'] as const).map((source) => this.inspectEvidence(source)))
    const kstlDistanceNm = distanceNm(this.state, KSTL_THRESHOLD)
    const returnRoute = routeFor('return_kstl', this.state, false, this.state.mode)
    const continueRoute = routeFor('continue_kmdw', this.state, this.emergencyTriggered, this.state.mode)
    const midwayDistanceNm = distanceNm(this.state, KMDW_THRESHOLD)
    const returnRisk = this.state.scenario.weather.visibilityMiles < 2 || this.state.scenario.traffic.delayMinutes >= 3 ? 'moderate' as const : 'low' as const
    const continueRisk = this.state.scenario.engine.health === 'normal' && this.state.scenario.passenger.condition === 'stable' ? 'moderate' as const : 'high' as const
    return Object.freeze({
      evidence,
      decisionSecondsRemaining: this.state.checkride.decisionSecondsRemaining,
      fuelMinutesRemaining: this.state.fuelMinutesRemaining,
      comfortLimits: Object.freeze({ maximumBankDeg: flightEnvelopeFor(this.state.mode).routeBankDeg, warningLoadFactorG: COMFORT_LOAD_WARNING_G, warningJerkGPerSecond: COMFORT_JERK_WARNING_G_PER_SECOND }),
      routeOptions: Object.freeze([
        Object.freeze({ plan: 'return_kstl' as const, destination: 'KSTL' as const, runway: '30L' as const, distanceNm: kstlDistanceNm, estimatedMinutes: routeEstimatedMinutes(returnRoute, this.state, this.state.scenario.traffic.delayMinutes), risk: returnRisk, summary: 'Nearby long runway with emergency priority. Weather and traffic still require a stabilized arrival.', recommended: true }),
        Object.freeze({ plan: 'continue_kmdw' as const, destination: 'KMDW' as const, runway: '31C' as const, distanceNm: midwayDistanceNm, estimatedMinutes: routeEstimatedMinutes(continueRoute, this.state), risk: continueRisk, summary: 'Filed destination is more than 200 NM away. Engine and passenger conditions may deteriorate before arrival.', recommended: false }),
      ]),
    })
  }

  rebuildActiveLeg = (strategy: ActiveLegRebuildStrategy, reason: string, actor: TraceActor = 'agent'): ActionReceipt => {
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
    const route = this.state.route
    const active = route.waypoints[route.activeWaypointIndex]
    if (!active) return this.receipt(false, 'There is no active route leg to rebuild.')
    if (!this.routeProgress.eventSent || this.state.mission.routeStatus !== 'stalled') return this.receipt(false, 'The active leg is still converging. Rebuild is available only after route_progress_stalled.')
    if (this.state.altitudeFt - this.runway(route).elevation < LIFTOFF_CONFIRM_AGL_FT) return this.receipt(false, 'The aircraft must be airborne before rebuilding a route leg.')
    if (active.kind === 'departure') return this.receipt(false, 'The departure leg cannot be rebuilt. Continue the runway-heading climb.')
    if (active.kind === 'touchdown') return this.receipt(false, 'The touchdown checkpoint cannot be rebuilt. Fly the stabilized final approach.')

    let waypoints = route.waypoints
    let completedWaypointIds = route.completedWaypointIds
    let activeWaypointIndex = route.activeWaypointIndex
    if (strategy === 'skip_noncritical') {
      if (active.kind === 'base' || active.kind === 'final') return this.receipt(false, 'Base and final checkpoints are required. Choose a direct intercept or wider pattern.')
      completedWaypointIds = Object.freeze([...completedWaypointIds, active.id])
      activeWaypointIndex = Math.min(activeWaypointIndex + 1, waypoints.length - 1)
    } else {
      const targetBearingDeg = navigationBearingDeg(this.state, active)
      const targetDistanceNm = distanceNm(this.state, active)
      const headingDeltaDeg = headingError(targetBearingDeg, this.state.headingDeg)
      const firstHeadingDeg = strategy === 'wider_pattern'
        ? this.state.headingDeg
        : normalizeHeading(this.state.headingDeg + clamp(headingDeltaDeg, -35, 35) / 2)
      const firstDistanceNm = strategy === 'wider_pattern'
        ? 1.4
        : clamp(targetDistanceNm * 0.45, 0.85, 1.35)
      const envelope = flightEnvelopeFor(this.state.mode)
      const intercept = waypoint(
        `REJOIN_${this.traceId}`,
        strategy === 'wider_pattern' ? 'Wider pattern rejoin' : 'Direct route rejoin',
        'enroute',
        offsetPosition(this.state, firstHeadingDeg, firstDistanceNm),
        clamp(this.state.altitudeFt, 1_300, 1_800),
        clamp(this.state.airspeedKt, envelope.minCommandSpeedKt, envelope.emergencyTurnSpeedKt),
        ROUTE_CAPTURE_FLOOR_NM,
      )
      waypoints = Object.freeze([
        ...waypoints.slice(0, activeWaypointIndex),
        intercept,
        ...waypoints.slice(activeWaypointIndex),
      ])
    }

    const next = waypoints[activeWaypointIndex]
    const autopilot = Object.freeze({ ...this.state.autopilot, enabled: actor === 'agent', lateralMode: 'route' as const, headingDeg: navigationBearingDeg(this.state, next), altitudeFt: next.altitudeFt, airspeedKt: next.airspeedKt })
    const rebuiltRoute = Object.freeze({ ...route, waypoints, activeWaypointIndex, completedWaypointIds, activeLegOrigin: Object.freeze({ lat: this.state.lat, lon: this.state.lon }), reason })
    this.routeProgress = { waypointId: '', bestDistanceNm: Number.POSITIVE_INFINITY, bestHeadingErrorDeg: Number.POSITIVE_INFINITY, secondsWithoutProgress: 0, eventSent: false }
    this.state = Object.freeze({ ...this.state, route: rebuiltRoute, autopilot, mission: Object.freeze({ ...this.state.mission, nextFix: next.id, distanceToNextFixNm: distanceNm(this.state, next), routeStatus: 'tracking' }) })
    this.record(actor, 'active_leg_rebuilt', reason, { strategy, nextFix: next.id })
    this.addDebrief(actor, `Rebuilt route at ${next.name}`)
    this.queueEvent('plan_updated', `Active leg rebuilt. Track ${next.name}; the previous orbit geometry is no longer active.`)
    this.publish(this.state)
    return this.receipt(true, `Active leg rebuilt. Next checkpoint: ${next.name}.`)
  }
  requestAgentHandoff = (actor: TraceActor = 'human', reason = 'Pilot requested copilot') => {
    if (this.state.controlOwner !== 'human' || this.state.handoffRequested) return
    this.state = Object.freeze({ ...this.state, handoffRequested: true, agentMode: 'requested' })
    this.record(actor, 'handoff_requested', reason, {})
    this.queueEvent('handoff_requested', 'The pilot is asking the copilot to take control.')
    this.publish(this.state)
  }

  cancelAgentHandoff = (actor: TraceActor = 'human', reason = 'Pilot canceled handoff') => {
    if (!this.state.handoffRequested) return
    this.state = Object.freeze({ ...this.state, handoffRequested: false, agentMode: 'idle' })
    this.record(actor, 'handoff_canceled', reason, {})
    this.publish(this.state)
  }

  transferControl = (owner: ControlOwner, actor: TraceActor = owner, reason = `${owner} took control`) => {
    this.pilotControls = Object.freeze({ pitchAxis: 0, bankAxis: 0 })
    this.smoothedPilotControls = { pitchAxis: 0, bankAxis: 0 }
    this.manualAttitudeTarget = owner === 'human'
      ? { pitchDeg: this.state.pitchDeg, bankDeg: this.state.bankDeg }
      : { pitchDeg: 0, bankDeg: 0 }
    const autopilot = Object.freeze({ ...this.state.autopilot, enabled: owner === 'agent' })
    this.state = Object.freeze({ ...this.state, controlOwner: owner, handoffRequested: false, agentMode: owner === 'agent' ? 'thinking' : 'idle', autopilot })
    this.record(actor, 'control_transferred', reason, { owner })
    this.addDebrief(actor, owner === 'agent' ? 'Copilot took control' : 'Pilot took control')
    this.publish(this.state)
    this.ensureHumanEmergencyRoute()
  }

  setPilotControls = (input: PilotControls, actor: TraceActor = 'human', reason = 'Pilot controls') => {
    this.takePilotControl(reason)
    this.pilotControls = Object.freeze({ pitchAxis: clamp(input.pitchAxis, -1, 1), bankAxis: clamp(input.bankAxis, -1, 1) })
    this.record(actor, 'pilot_controls', reason, { ...this.pilotControls })
  }

  releasePilotControls = () => {
    this.pilotControls = Object.freeze({ pitchAxis: 0, bankAxis: 0 })
  }

  levelPilotAttitude = (actor: TraceActor = 'human', reason = 'Pilot leveled the aircraft') => {
    if (actor === 'human') this.takePilotControl(reason)
    this.releasePilotControls()
    this.manualAttitudeTarget = { pitchDeg: 0, bankDeg: 0 }
    this.record(actor, 'pilot_attitude_target', reason, { pitchDeg: 0, bankDeg: 0 })
  }

  beginTakeoff = (actor: TraceActor = 'human', reason = 'Takeoff briefing acknowledged') => {
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
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
    if (actor === 'human') this.takePilotControl(reason)
    const throttle = clamp(value, 0, 1)
    if (throttle > 0 && this.state.mission.phase === 'preflight' && this.state.route.plan === 'continue_kmdw') {
      this.beginTakeoff(actor, 'Throttle applied after the preflight route was filed')
    }
    this.state = Object.freeze({ ...this.state, throttle })
    this.record(actor, 'throttle', reason, { value: this.state.throttle })
    this.publish(this.state)
  }

  setFlaps = (degrees: number, actor: TraceActor = 'human', reason = 'Set flaps') => this.configureAircraft({ flapsDeg: clamp(degrees, 0, 30) as 0 | 10 | 20 | 30, reason }, actor)
  setGear = (down: boolean, actor: TraceActor = 'human', reason = 'Set gear') => this.configureAircraft({ gearDown: down, reason }, actor)
  setRoute = (plan: RoutePlan, reason: string, actor: TraceActor = 'agent'): ActionReceipt => {
    if (plan === 'unassigned') return this.receipt(false, 'Choose the assigned preflight route.')
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
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
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
    if (!this.emergencyTriggered || this.state.checkride.status !== 'decision_required') return this.receipt(false, 'No emergency diversion decision is active.')
    if (!this.state.checkride.decisionContextRead) return this.receipt(false, 'Read get_decision_context before requesting a diversion.')
    if (this.state.atc.status !== 'none') return this.receipt(false, `ATC is already ${this.state.atc.status}; continue the current clearance flow.`)
    this.decisionTimerRunning = false
    this.atcClearanceDueElapsedSeconds = this.state.elapsedSeconds + ATC_RESPONSE_WALL_SECONDS * missionProfileFor(this.state.mode).simulationRate
    this.state = Object.freeze({
      ...this.state,
      atc: Object.freeze({ status: 'requested', requestedPlan: plan, requestReason: reason, clearance: null }),
      checkride: Object.freeze({ ...this.state.checkride, alert: 'Diversion requested. Maintain the hold and wait for ATC clearance.' }),
    })
    const requestedRoute = routeFor(plan, this.state, plan === 'continue_kmdw', this.state.mode)
    this.record(actor, 'atc_diversion_requested', reason, { plan, destination: requestedRoute.destination, runway: requestedRoute.runway })
    this.addDebrief(actor, `Requested ${plan.replaceAll('_', ' ')} from ATC`)
    this.publish(this.state)
    return this.receipt(true, 'Diversion request sent. Maintain present guidance and wait for atc_clearance_received.')
  }

  acceptAtcClearance = (clearanceId: string, readback: string, actor: TraceActor = 'agent'): ActionReceipt => {
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
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
    this.queueEvent('atc_clearance_accepted', `Readback correct. ${clearance.instruction}`)
    return this.activateRoute(clearance.plan, readback, false, actor)
  }

  private activateRoute(plan: DiversionPlan, reason: string, filingPreflight: boolean, actor: TraceActor): ActionReceipt {
    const route = Object.freeze({ ...routeFor(plan, this.state, !filingPreflight && plan === 'continue_kmdw', this.state.mode), reason })
    const activeTarget = route.waypoints[route.activeWaypointIndex]
    const activeBearingDeg = activeTarget ? navigationBearingDeg(this.state, activeTarget) : null
    const autopilot = activeTarget ? Object.freeze({ enabled: actor === 'agent', headingDeg: navigationBearingDeg(this.state, activeTarget), altitudeFt: activeTarget.altitudeFt, airspeedKt: activeTarget.airspeedKt, verticalMode: activeTarget.altitudeFt < this.state.altitudeFt ? 'descend' as const : 'climb' as const, lateralMode: 'route' as const }) : this.state.autopilot
    this.routeProgress = { waypointId: '', bestDistanceNm: Number.POSITIVE_INFINITY, bestHeadingErrorDeg: Number.POSITIVE_INFINITY, secondsWithoutProgress: 0, eventSent: false }
    if (this.emergencyTriggered) this.decisionTimerRunning = false
    this.state = Object.freeze({
      ...this.state, route, autopilot,
      agentMode: actor === 'agent' ? (filingPreflight ? 'thinking' : 'flying') : this.state.agentMode,
      mission: Object.freeze({
        ...this.state.mission,
        phase: filingPreflight ? 'preflight' : 'enroute',
        nextFix: activeTarget?.id ?? null,
        distanceToNextFixNm: activeTarget ? distanceNm(this.state, activeTarget) : null,
        bearingToNextFixDeg: activeBearingDeg,
        captureRadiusNm: activeTarget ? checkpointCaptureRadiusNm(activeTarget, this.state.controlOwner) : null,
        routeStatus: activeTarget ? 'tracking' : 'idle',
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

  setAutopilotTargets = (input: AutopilotTargetsInput | Partial<AutopilotState>, actor: TraceActor = 'agent', reason?: string): ActionReceipt => {
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
    const current = this.state.autopilot
    const envelope = flightEnvelopeFor(this.state.mode)
    const autopilot: AutopilotState = Object.freeze({
      enabled: 'enabled' in input && typeof input.enabled === 'boolean' ? input.enabled : true,
      headingDeg: normalizeHeading(input.headingDeg ?? current.headingDeg),
      altitudeFt: clamp(input.altitudeFt ?? current.altitudeFt, KSTL_ELEVATION, 4_000),
      airspeedKt: clamp(input.airspeedKt ?? current.airspeedKt, envelope.minCommandSpeedKt, envelope.maxCommandSpeedKt),
      verticalMode: input.verticalMode ?? current.verticalMode,
      lateralMode: input.lateralMode ?? (input.headingDeg !== undefined ? 'heading' : current.lateralMode),
    })
    this.state = Object.freeze({ ...this.state, autopilot, agentMode: actor === 'agent' ? 'flying' : this.state.agentMode })
    this.record(actor, 'autopilot_targets', reason ?? ('reason' in input ? input.reason : undefined) ?? 'Targets updated', { ...autopilot })
    this.publish(this.state)
    return this.receipt(true, `Targets set: ${Math.round(autopilot.headingDeg)}°, ${Math.round(autopilot.altitudeFt)} ft, ${Math.round(autopilot.airspeedKt)} kt.`)
  }

  configureAircraft = (input: AircraftConfigurationInput, actor: TraceActor = 'agent'): ActionReceipt => {
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
    const required = configurationProcedureFor(this.state)
    if (actor === 'agent' && input.gearDown !== undefined && input.gearDown !== required.gearDown) {
      return this.receipt(false, `${required.instruction} Gear ${required.gearDown ? 'down' : 'up'} is required in this phase.`)
    }
    if (actor === 'agent' && input.flapsDeg !== undefined && input.flapsDeg !== required.flapsDeg) {
      return this.receipt(false, `${required.instruction} Flaps ${required.flapsDeg}° are required in this phase.`)
    }
    if (actor === 'human') this.takePilotControl(input.reason ?? 'Pilot changed configuration')
    const configured = { ...this.state, gearDown: input.gearDown ?? this.state.gearDown, flapsDeg: input.flapsDeg ?? this.state.flapsDeg }
    const procedure = configurationProcedureFor(configured)
    const incorrectHumanConfiguration = actor === 'human'
      && ((input.gearDown !== undefined && input.gearDown !== required.gearDown)
        || (input.flapsDeg !== undefined && input.flapsDeg !== required.flapsDeg))
    const score = incorrectHumanConfiguration
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
    if (incorrectHumanConfiguration) this.addDebrief('system', `−4 points: incorrect ${required.stage.replaceAll('_', ' ')} configuration`)
    if (procedure.compliant && !required.compliant) this.queueEvent('configuration_confirmed', procedure.instruction)
    this.publish(this.state)
    return this.receipt(true, `Gear ${this.state.gearDown ? 'down' : 'up'}, flaps ${this.state.flapsDeg}°. ${procedure.compliant ? 'Configuration check complete.' : procedure.instruction}`)
  }

  requestHumanApproval = (question: string, requestedAction: string, reason: string, actor: TraceActor = 'agent'): ActionReceipt => {
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
    this.state = Object.freeze({
      ...this.state,
      approval: Object.freeze({ status: 'pending', question, requestedAction }),
      agentMode: 'awaiting_approval',
      checkride: Object.freeze({ ...this.state.checkride, status: 'awaiting_human', humanApproval: 'pending' }),
    })
    this.record(actor, 'approval_requested', reason, { requestedAction })
    this.queueEvent('approval_required', question)
    this.publish(this.state)
    return this.receipt(true, 'Pilot approval requested. Current autopilot targets remain active.')
  }

  resolveHumanApproval = (approved: boolean, actor: TraceActor = 'human', reason = approved ? 'Pilot approved' : 'Pilot denied'): ActionReceipt => {
    if (this.state.approval.status !== 'pending') return this.receipt(false, 'No pilot decision is pending.')
    this.state = Object.freeze({
      ...this.state,
      approval: Object.freeze({ ...this.state.approval, status: approved ? 'approved' : 'denied' }),
      agentMode: this.state.controlOwner === 'agent' ? 'flying' : 'idle',
      checkride: Object.freeze({ ...this.state.checkride, status: 'resolved', humanApproval: approved ? 'approved' : 'denied' }),
    })
    this.record(actor, 'approval_resolved', reason, { approved })
    this.queueEvent('approval_resolved', reason)
    this.publish(this.state)
    return this.receipt(true, reason)
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

  private readonly tick = (timeMs: number) => {
    if (this.lastFrameMs === null) this.lastFrameMs = timeMs
    this.accumulator += Math.min((timeMs - this.lastFrameMs) / 1_000, MAX_FRAME) * missionProfileFor(this.state.mode).simulationRate
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
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private advance(dt: number) {
    if (this.state.mission.outcome !== 'in_progress') return
    if (this.state.mission.phase === 'preflight') return
    if (this.crashDynamics) {
      this.advanceCrash(dt)
      return
    }
    const scenario = this.state.scenario
    const dynamicsSeed = this.emergencyTriggered ? this.state.checkride.seed : SEALED_DEPARTURE_DYNAMICS_SEED
    const envelope = flightEnvelopeFor(this.state.mode)
    if (!this.departureGuidanceReleased && this.state.altitudeFt - KSTL_RUNWAY_12R.elevationFt >= envelope.departureHeadingReleaseAglFt) this.departureGuidanceReleased = true
    let { headingDeg: heading, bankDeg: bank, pitchDeg: pitch, throttle, airspeedKt: airspeed, verticalSpeedFpm: verticalSpeed } = this.state

    if (this.state.debrief.landing) {
      const rolloutRunway = this.runway()
      const rolloutFrame = runwayFrame(this.state, rolloutRunway.threshold, rolloutRunway.heading)
      const rolloutTrackDeg = normalizeHeading(rolloutRunway.heading + clamp(rolloutFrame.crossNm * 25, -6, 6))
      heading = normalizeHeading(heading + clamp(headingError(rolloutTrackDeg, heading), -2 * dt, 2 * dt))
      bank = approach(bank, 0, 60 * dt)
      pitch = approach(pitch, 0, 10 * dt)
      throttle = approach(throttle, 0, 1.2 * dt)
      verticalSpeed = 0
    } else if (this.fuelExhausted && this.state.aircraftPhase === 'airborne') {
      throttle = 0
      bank = approach(bank, 0, 12 * dt)
      pitch = approach(pitch, -6, 5 * dt)
      verticalSpeed = approach(verticalSpeed, -1_050, 360 * dt)
    } else if (this.state.controlOwner === 'agent' && this.state.autopilot.enabled) {
      if (this.state.aircraftPhase === 'takeoff_roll') {
        bank = approach(bank, clamp(headingError(KSTL_RUNWAY_12R.headingDeg, heading) * 0.65, -12, 12), 24 * dt)
        throttle = approach(throttle, 1, 0.55 * dt)
        const rotating = airspeed >= envelope.rotateSpeedKt
        verticalSpeed = approach(verticalSpeed, rotating ? envelope.initialClimbVerticalSpeedFpm : 0, 700 * dt)
        pitch = approach(
          pitch,
          rotating ? envelope.initialClimbPitchDeg : 0,
          envelope.rotationRateDegPerSecond * dt,
        )
      } else {
        const target = this.state.autopilot
        const decisionHoldActive = this.state.checkride.status === 'decision_required' && target.lateralMode === 'heading'
        const activeWaypoint = this.state.route.waypoints[this.state.route.activeWaypointIndex]
        const followingWaypoint = this.state.route.waypoints[this.state.route.activeWaypointIndex + 1]
        const touchdownRunway = activeWaypoint?.kind === 'final' || activeWaypoint?.kind === 'touchdown' ? this.runway(this.state.route) : null
        const touchdownFrame = touchdownRunway
          ? runwayFrame(this.state, touchdownRunway.threshold, touchdownRunway.heading)
          : null
        const approachCrossTrackNm = touchdownFrame
          ? touchdownFrame.crossNm - (this.state.mode === 'judge' && this.state.route.destination === 'KSTL' ? 0.025 : 0)
          : 0
        const approachTrackDeg = (activeWaypoint?.kind === 'final' || activeWaypoint?.kind === 'touchdown')
          && touchdownRunway && touchdownFrame
          ? normalizeHeading(touchdownRunway.heading + clamp(
              approachCrossTrackNm * envelope.approachInterceptGainDegPerNm,
              -envelope.maxApproachInterceptAngleDeg,
              envelope.maxApproachInterceptAngleDeg,
            ))
          : null
        const routeTrackDeg = decisionHoldActive
          ? normalizeHeading(heading + this.decisionHoldTurnDirection * DECISION_HOLD_HEADING_LEAD_DEG)
          : activeWaypoint?.captureHeadingDeg !== undefined
            ? activeWaypoint.captureHeadingDeg
          : activeWaypoint && target.lateralMode === 'route'
            ? anticipatedRouteBearingDeg(
                this.state,
                this.state.route.activeLegOrigin,
                activeWaypoint,
                followingWaypoint,
                airspeed,
                envelope.routeBankDeg,
              )
            : target.headingDeg
        const guidanceTrackDeg = !this.departureGuidanceReleased
          ? KSTL_RUNWAY_12R.headingDeg
          : target.lateralMode === 'route' && approachTrackDeg !== null
            ? approachTrackDeg
            : routeTrackDeg
        const guidanceHeadingDeg = windCorrectedHeadingDeg(
          guidanceTrackDeg,
          Math.max(airspeed, 90),
          scenario.weather,
          this.state.elapsedSeconds,
          dynamicsSeed,
        )
        const targetHeadingError = headingError(guidanceHeadingDeg, heading)
        const heightAboveRunwayFt = this.state.altitudeFt - (touchdownRunway?.elevation ?? KSTL_ELEVATION)
        const targetBank = decisionHoldActive
          ? this.decisionHoldTurnDirection * DECISION_HOLD_BANK_DEG
          : activeWaypoint?.id.startsWith('KSTL_TURN_') || activeWaypoint?.id.startsWith('KSTL_COMPACT_TURN_') || activeWaypoint?.id.startsWith('REJOIN_')
            ? clamp(targetHeadingError * 0.48, -envelope.routeBankDeg, envelope.routeBankDeg)
          : activeWaypoint?.kind === 'touchdown'
            ? clamp(targetHeadingError * 0.85, heightAboveRunwayFt < 150 ? -12 : -24, heightAboveRunwayFt < 150 ? 12 : 24)
            : activeWaypoint?.kind === 'final'
              ? clamp(targetHeadingError * 0.75, -24, 24)
            : clamp(targetHeadingError * 0.48, -envelope.routeBankDeg, envelope.routeBankDeg)
        const rollResponse = activeWaypoint?.kind === 'final' || activeWaypoint?.kind === 'touchdown'
          ? 12
          : 8 * controlAuthorityForAirspeed(airspeed, envelope)
        bank = approach(bank, targetBank, rollResponse * dt)
        throttle = approach(throttle, clamp(0.52 + (target.airspeedKt - airspeed) * 0.025, 0.25, 1), 0.35 * dt)
        const altitudeError = target.altitudeFt - this.state.altitudeFt
        let desiredFpm = target.verticalMode === 'approach'
          ? clamp(-target.airspeedKt * 5.3 + altitudeError * 3, -900, 400)
          : target.verticalMode === 'level'
            ? clamp(altitudeError * 2, -400, 400)
            : clamp(altitudeError * 2.5, -850, 700)
        if (activeWaypoint?.kind === 'touchdown' && touchdownFrame) {
          if (this.state.route.destination === 'KSTL' && touchdownFrame.alongNm > -1.4
            && (Math.abs(touchdownFrame.crossNm) > 0.5 || Math.abs(headingError(touchdownRunway!.heading, heading)) > 45)) {
            desiredFpm = Math.max(0, desiredFpm)
          } else if (this.state.route.destination !== 'KSTL' && touchdownFrame.alongNm > -1.5
            && (Math.abs(touchdownFrame.crossNm) > 0.08 || Math.abs(headingError(touchdownRunway!.heading, heading)) > 12)) {
            desiredFpm = Math.max(0, desiredFpm)
          }
        }
        if (activeWaypoint?.kind === 'final' && touchdownFrame && Math.abs(touchdownFrame.crossNm) > 0.4) {
          desiredFpm = Math.max(0, desiredFpm)
        }
        const overTouchdownRunway = touchdownFrame && touchdownRunway
          && touchdownFrame.alongNm >= 0
          && touchdownFrame.alongNm <= touchdownRunway.lengthFt / FEET_PER_NM
          && Math.abs(touchdownFrame.crossNm) <= touchdownRunway.widthFt / 2 / FEET_PER_NM
        const onShortFinal = touchdownFrame
          && touchdownFrame.alongNm >= -0.4
          && Math.abs(touchdownFrame.crossNm) <= 0.16
        if (activeWaypoint?.kind === 'touchdown' && heightAboveRunwayFt < 75 && (overTouchdownRunway || onShortFinal)) {
          desiredFpm = clamp(desiredFpm, -320, -100)
        }
        verticalSpeed = approach(verticalSpeed, desiredFpm, 420 * dt)
        const landingAngleOfAttackDeg = this.state.mode === 'judge'
          && (activeWaypoint?.kind === 'final' || activeWaypoint?.kind === 'touchdown')
          ? 10.5
          : 0
        pitch = approach(pitch, clamp(verticalSpeed / 130 + landingAngleOfAttackDeg, -6, 14), 6 * dt)
      }
    } else {
      const onTakeoffRoll = this.state.aircraftPhase === 'takeoff_roll'
      const controlAuthority = controlAuthorityForAirspeed(airspeed, envelope)
      this.smoothedPilotControls.pitchAxis = damp(this.smoothedPilotControls.pitchAxis, this.pilotControls.pitchAxis, 6, dt)
      this.smoothedPilotControls.bankAxis = damp(this.smoothedPilotControls.bankAxis, this.pilotControls.bankAxis, 5.5, dt)
      this.manualAttitudeTarget.pitchDeg = clamp(
        this.manualAttitudeTarget.pitchDeg + this.smoothedPilotControls.pitchAxis * PILOT_PITCH_TRIM_RATE_DEG_PER_SECOND * controlAuthority * dt,
        onTakeoffRoll ? 0 : -55,
        onTakeoffRoll ? envelope.liftoffPitchDeg : 55,
      )
      this.manualAttitudeTarget.bankDeg = onTakeoffRoll
        ? 0
        : clamp(this.manualAttitudeTarget.bankDeg + this.smoothedPilotControls.bankAxis * PILOT_BANK_TRIM_RATE_DEG_PER_SECOND * controlAuthority * dt, -60, 60)
      const targetPitch = onTakeoffRoll && airspeed < envelope.rotateSpeedKt ? 0 : this.manualAttitudeTarget.pitchDeg
      pitch = approach(
        pitch,
        targetPitch,
        (onTakeoffRoll ? envelope.rotationRateDegPerSecond : PILOT_PITCH_RESPONSE_DEG_PER_SECOND * controlAuthority) * dt,
      )
      bank = approach(bank, this.manualAttitudeTarget.bankDeg, PILOT_BANK_RESPONSE_DEG_PER_SECOND * controlAuthority * dt)
      const activeKind = this.state.route.waypoints[this.state.route.activeWaypointIndex]?.kind
      const landingAngleOfAttackDeg = this.state.mode === 'judge' && (activeKind === 'final' || activeKind === 'touchdown') ? 10.5 : 0
      const targetVerticalSpeed = clamp(airspeed * FEET_PER_NM / 60 * Math.sin(radians(pitch - landingAngleOfAttackDeg)), -4_500, 4_500)
      verticalSpeed = approach(verticalSpeed, targetVerticalSpeed, PILOT_VERTICAL_RESPONSE_FPM_PER_SECOND * dt)
    }

    const turbulence = turbulenceFor(scenario.weather, this.state.elapsedSeconds + dt, dynamicsSeed)
    if (this.state.aircraftPhase === 'airborne' && turbulence.level !== 'none') {
      verticalSpeed += turbulence.verticalAccelerationFpmPerSecond * dt
      bank = clamp(bank + turbulence.rollRateDegPerSecond * dt, -60, 60)
    }

    const power = throttle * scenario.engine.maximumPower
    const publishedConcordeAcceleration = staticThrustAccelerationKtPerSecond(envelope)
    const takeoffThrustAcceleration = this.state.mode === 'judge'
      ? publishedConcordeAcceleration
      : A380_TAKEOFF_ACCELERATION_KT_PER_SECOND
    const airborneThrustAcceleration = this.state.mode === 'judge'
      ? publishedConcordeAcceleration
      : A380_AIRBORNE_ACCELERATION_KT_PER_SECOND
    const activeKind = this.state.route.waypoints[this.state.route.activeWaypointIndex]?.kind
    const landingAngleOfAttackDeg = this.state.mode === 'judge' && (activeKind === 'final' || activeKind === 'touchdown') ? 10.5 : 0
    const gravityAlongFlightPath = -Math.sin(radians(pitch - landingAngleOfAttackDeg)) * 5.5
    const airborneDrag = airborneDragKtPerSecond(airspeed, this.state.flapsDeg, this.state.gearDown, bank, this.state.mode)
    const acceleration = this.fuelExhausted
      ? -airborneDrag + gravityAlongFlightPath
      : this.state.aircraftPhase === 'takeoff_roll'
      ? power * takeoffThrustAcceleration
        - (airspeed > 0.05 || power > 0 ? TAKEOFF_ROLLING_RESISTANCE_KT_PER_SECOND : 0)
        - TAKEOFF_AERO_DRAG_AT_ROTATE_KT_PER_SECOND * (airspeed / envelope.rotateSpeedKt) ** 2
      : power * airborneThrustAcceleration - airborneDrag + gravityAlongFlightPath
    airspeed = clamp(airspeed + acceleration * dt, 0, envelope.maxSimulationSpeedKt)
    const turnRate = airspeed > 20 ? 1_091 * Math.tan(radians(clamp(bank, -60, 60))) / airspeed : 0
    heading = normalizeHeading(heading + turnRate * dt)
    const stall = stallResponseFor(airspeed, pitch, verticalSpeed, bank, this.state.flapsDeg, this.state.mode)
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
    const fuelMinutesRemaining = Math.max(0, this.state.fuelMinutesRemaining - dt / 60 * (0.65 + throttle * 0.55))

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
      const takeoffContactAltitude = KSTL_RUNWAY_12R.elevationFt + groundClearanceFt(pitch, bank, this.state.gearDown, this.state.mode)
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

    const contactAltitude = runway.elevation + groundClearanceFt(pitch, bank, this.state.gearDown, this.state.mode)
    const groundContact = aircraftPhase === 'landing_roll'
      || aircraftPhase === 'stopped'
      || (altitude <= contactAltitude + (onRunway ? 10 : 0) && verticalSpeed <= (onRunway ? 100 : 0))
    if (aircraftPhase !== 'takeoff_roll' && groundContact) {
      altitude = contactAltitude
      const impactFpm = Math.abs(verticalSpeed)
      this.peakTouchdownImpactFpm = Math.max(this.peakTouchdownImpactFpm, impactFpm)
      const safeContact = !this.fuelExhausted
        && onRunway
        && this.state.gearDown
        && (envelope.hasConventionalFlaps ? this.state.flapsDeg >= envelope.approachFlapsDeg : this.state.flapsDeg === 0)
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
        pitch = approach(pitch, 0, 10 * dt)
        if (this.state.controlOwner === 'agent') throttle = approach(throttle, 0, 0.8 * dt)
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
        const destructive = this.fuelExhausted || isDestructiveImpact({
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
      stalled: stall.severity >= 0.18,
      turbulenceLevel: this.state.aircraftPhase === 'airborne' ? turbulence.level : 'none',
    })
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
      ? Math.max(0, (this.state.checkride.decisionSecondsRemaining ?? EMERGENCY_DECISION_SECONDS) - dt / missionProfileFor(this.state.mode).simulationRate)
      : this.state.checkride.decisionSecondsRemaining
    const decisionTimerJustExpired = decisionSecondsRemaining === 0 && !this.decisionTimerExpired && this.state.checkride.status === 'decision_required'
    const partialWithoutProcedure = { ...this.state, ...position, altitudeFt: altitude, airspeedKt: airspeed, verticalSpeedFpm: verticalSpeed, headingDeg: heading, pitchDeg: pitch, bankDeg: bank, throttle, elapsedSeconds, fuelMinutesRemaining, motion, impact, aircraftPhase, route: routeUpdate.route }
    const procedure = configurationProcedureFor(partialWithoutProcedure)
    const partial = { ...partialWithoutProcedure, procedure } as FlightState
    const deadlineExpired = elapsedSeconds >= this.state.checkride.deadlineSeconds && outcome === 'in_progress'
    if (deadlineExpired) {
      outcome = 'timed_out'
      phase = 'failed'
    }
    const mission = this.navigation(partial, phase, outcome, runway)
    const approachJustStabilized = mission.stableApproach && !this.state.mission.stableApproach
    const status = outcome === 'in_progress' ? 'in_progress' : outcome === 'landed' ? 'landed' : 'failed'
    let score = this.state.checkride.score
    if (decisionTimerJustExpired) {
      score = withScoreDeduction(score, 'decision-timeout', elapsedSeconds, 15, 'Emergency route decision exceeded 60 seconds')
    }
    if (deadlineExpired) {
      score = withScoreDeduction(score, 'mission-timeout', elapsedSeconds, 12, `Mission exceeded the ${Math.round(this.state.checkride.wallClockDeadlineSeconds / 60)}-minute operating window`)
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
      checkride: Object.freeze({ ...this.state.checkride, fuelMinutesRemaining, decisionSecondsRemaining, status: status === 'in_progress' ? this.state.checkride.status : 'complete', score }),
      debrief: Object.freeze({ ...this.state.debrief, status, elapsedSeconds, landing }),
      agentMode: status === 'in_progress' ? this.state.agentMode : 'complete',
      autopilot: status === 'in_progress' ? routeUpdate.autopilot : Object.freeze({ ...routeUpdate.autopilot, enabled: false }),
    })
    for (const deduction of newDeductions) this.addDebrief('system', `−${deduction.points} points: ${deduction.reason}`)
    if (!this.emergencyTriggered && aircraftPhase === 'airborne' && elapsedSeconds >= missionProfileFor(this.state.mode).emergencyTriggerSeconds) {
      this.emergencyTriggered = true
      this.decisionHoldTurnDirection = headingError(navigationBearingDeg(this.state, KSTL_THRESHOLD), this.state.headingDeg) < 0 ? -1 : 1
      const humanControlled = this.state.controlOwner === 'human'
      this.decisionTimerRunning = humanControlled
      const decisionHold = Object.freeze({
        ...this.state.autopilot,
        enabled: this.state.controlOwner === 'agent',
        headingDeg: normalizeHeading(this.state.headingDeg + this.decisionHoldTurnDirection * DECISION_HOLD_HEADING_LEAD_DEG),
        altitudeFt: Math.max(1_200, this.state.altitudeFt),
        airspeedKt: envelope.initialClimbSpeedKt,
        verticalMode: 'level' as const,
        lateralMode: 'heading' as const,
      })
      this.state = Object.freeze({
        ...this.state,
        scenario: this.selectedScenario,
        autopilot: decisionHold,
        agentMode: this.state.controlOwner === 'agent' ? 'thinking' : this.state.agentMode,
        checkride: Object.freeze({
          ...this.state.checkride,
          status: 'decision_required',
          decisionSecondsRemaining: EMERGENCY_DECISION_SECONDS,
          decisionContextRead: false,
          objective: missionBriefFor(this.state.mode, true).objective,
          alert: EMERGENCY_ALERT,
          inspectedSources: Object.freeze([]),
        }),
      })
      this.record('system', 'scenario_triggered', EMERGENCY_ALERT, { seed: this.state.checkride.seed })
      this.addDebrief('system', 'Unexpected emergency scenario received')
      this.queueEvent('emergency_detected', `${EMERGENCY_ALERT} Weather: ${this.selectedScenario.weather.summary} Engine: ${this.selectedScenario.engine.summary} Passenger: ${this.selectedScenario.passenger.summary} Traffic: ${this.selectedScenario.traffic.summary} Read get_decision_context once, then request return_kstl or continue_kmdw from ATC within 60 seconds.`)
      if (humanControlled) {
        this.ensureHumanEmergencyRoute()
      }
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
    if (procedure.stage !== this.previousState.procedure.stage && !procedure.compliant) this.queueEvent('configuration_required', procedure.instruction)
    if (routeUpdate.stalled) {
      this.record('system', 'route_progress_stalled', 'The active route leg stopped converging', { nextFix: routeUpdate.next?.id ?? null, distanceNm: routeUpdate.next ? distanceNm(this.state, routeUpdate.next) : null })
      this.queueEvent('route_progress_stalled', `Route progress has stalled near ${routeUpdate.next?.name ?? 'the active checkpoint'}. Call rebuild_active_leg with direct_intercept or wider_pattern instead of continuing to orbit.`)
    }
    if (routeUpdate.reached) {
      const nextMessage = routeUpdate.next && routeUpdate.next.id !== routeUpdate.reached.id
        ? ` Next checkpoint: ${routeUpdate.next.name}.`
        : ' Final route checkpoint captured.'
      this.record(this.state.controlOwner, 'checkpoint_reached', routeUpdate.reached.name, {
        waypointId: routeUpdate.reached.id,
        waypointName: routeUpdate.reached.name,
        nextFix: routeUpdate.next?.name ?? null,
        final: routeUpdate.next === null,
      })
      this.addDebrief(this.state.controlOwner, `Reached ${routeUpdate.reached.name}`)
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
    if (approachJustStabilized) {
      this.record('system', 'approach_stable', `${runway.id} approach is stable`, { runway: runway.id })
      this.queueEvent('approach_stable', `${runway.id} approach is stable.`)
    }
    if (departedJustNow) this.addDebrief(this.state.controlOwner, `Departed ${KSTL_RUNWAY_12R.id}`)
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
    const fuelMinutesRemaining = Math.max(0, this.state.fuelMinutesRemaining - dt / 60 * 0.65)
    const pitch = approach(this.state.pitchDeg, targetPitchDeg, (destructive ? 28 : 14) * dt)
    const bank = approach(this.state.bankDeg, targetBankDeg, (destructive ? 62 : 24) * dt)
    const finished = crash.elapsedSeconds >= CRASH_SLIDE_SECONDS || airspeed < 3
    const outcome: MissionOutcome = finished ? crash.outcome : 'in_progress'
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
      autopilot: Object.freeze({ ...this.state.autopilot, enabled: false }),
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
    const status = finished ? 'failed' : 'in_progress'
    this.state = Object.freeze({
      ...partial,
      mission,
      checkride: Object.freeze({ ...this.state.checkride, fuelMinutesRemaining, status: finished ? 'complete' : this.state.checkride.status }),
      debrief: Object.freeze({ ...this.state.debrief, status, elapsedSeconds }),
      agentMode: finished ? 'complete' : this.state.agentMode,
    })
    if (finished) {
      this.crashDynamics = null
      this.finish(crash.outcome)
    }
  }

  private advanceRoute(position: { lat: number; lon: number }, altitudeFt: number, _headingDeg: number): { route: RouteState; autopilot: AutopilotState; phase: MissionPhase; reached: RouteWaypoint | null; next: RouteWaypoint | null; stalled: boolean } {
    const route = this.state.route
    const active = route.waypoints[route.activeWaypointIndex]
    if (!active) return { route, autopilot: this.state.autopilot, phase: this.state.mission.phase, reached: null, next: null, stalled: false }
    const horizontalDistanceNm = distanceNm(position, active)
    const captureRadiusNm = checkpointCaptureRadiusNm(active, this.state.controlOwner)
    const runwayAlignedFinal = active.kind === 'final' && route.destination === 'KSTL'
      ? horizontalDistanceNm <= captureRadiusNm
        && Math.abs(headingError(KSTL_RUNWAY_30L.headingDeg, _headingDeg)) <= 45
      : false
    const compactFinalFrame = this.state.mode === 'judge' && active.id === 'KSTL_FINAL'
      ? runwayFrame(position, KSTL_THRESHOLD, KSTL_RUNWAY_30L.headingDeg)
      : null
    const compactFinalCorridorCaptured = compactFinalFrame !== null
      && compactFinalFrame.alongNm >= -3.5
      && compactFinalFrame.alongNm <= -0.3
      && Math.abs(compactFinalFrame.crossNm - 0.025) <= 0.35
      && Math.abs(headingError(KSTL_RUNWAY_30L.headingDeg, _headingDeg)) <= 30
    const headingConstraintSatisfied = active.captureHeadingDeg === undefined
      || Math.abs(headingError(active.captureHeadingDeg, _headingDeg)) <= 45
    const directionalGatePassed = active.id.startsWith('KSTL_COMPACT_TURN_')
      && active.captureHeadingDeg !== undefined
      && headingConstraintSatisfied
    const reached = !route.completedWaypointIds.includes(active.id)
      && (active.kind === 'final' && route.destination === 'KSTL'
        ? compactFinalFrame === null ? runwayAlignedFinal : compactFinalCorridorCaptured
        : (horizontalDistanceNm <= captureRadiusNm && headingConstraintSatisfied) || directionalGatePassed)
    const completedWaypointIds = reached
      ? Object.freeze([...route.completedWaypointIds, active.id])
      : route.completedWaypointIds
    const index = reached ? Math.min(route.activeWaypointIndex + 1, route.waypoints.length - 1) : route.activeWaypointIndex
    const activeLegOrigin = reached ? Object.freeze({ lat: active.lat, lon: active.lon }) : route.activeLegOrigin
    const next = route.waypoints[index]
    const following = route.waypoints[index + 1]
    const final = next.kind === 'final' || next.kind === 'touchdown'
    const runway = this.runway(route)
    const distanceBeforeThresholdNm = Math.max(0, -runwayFrame(position, runway.threshold, runway.heading).alongNm)
    const targetAltitude = next.kind === 'touchdown'
      ? Math.min(
          Math.max(runway.elevation, runway.elevation + Math.tan(radians(3)) * distanceBeforeThresholdNm * FEET_PER_NM),
          altitudeFt + next.airspeedKt * 5.3 / 3,
        )
      : next.kind === 'final' && route.destination === 'KSTL'
        ? Math.max(runway.elevation, Math.min(next.altitudeFt, runway.elevation + Math.tan(radians(3)) * distanceBeforeThresholdNm * FEET_PER_NM))
      : next.altitudeFt
    const autopilot = this.state.controlOwner === 'agent' && this.state.checkride.status === 'decision_required' && this.state.autopilot.lateralMode === 'heading'
      ? Object.freeze({ ...this.state.autopilot, headingDeg: normalizeHeading(_headingDeg + this.decisionHoldTurnDirection * DECISION_HOLD_HEADING_LEAD_DEG) })
      : this.state.controlOwner === 'agent' && this.state.autopilot.lateralMode === 'route'
        ? Object.freeze({ enabled: true, headingDeg: anticipatedRouteBearingDeg(position, activeLegOrigin, next, following, this.state.airspeedKt, flightEnvelopeFor(this.state.mode).routeBankDeg), altitudeFt: targetAltitude, airspeedKt: next.airspeedKt, verticalMode: final ? 'approach' as const : targetAltitude < altitudeFt ? 'descend' as const : 'level' as const, lateralMode: 'route' as const })
        : this.state.autopilot
    const updatedRoute = reached
      ? Object.freeze({ ...route, activeWaypointIndex: index, completedWaypointIds, activeLegOrigin })
      : route
    const routeBearingDeg = anticipatedRouteBearingDeg(position, activeLegOrigin, next, following, this.state.airspeedKt, flightEnvelopeFor(this.state.mode).routeBankDeg)
    const routeHeadingErrorDeg = Math.abs(headingError(routeBearingDeg, _headingDeg))
    if (this.routeProgress.waypointId !== next.id || reached) {
      this.routeProgress = { waypointId: next.id, bestDistanceNm: distanceNm(position, next), bestHeadingErrorDeg: routeHeadingErrorDeg, secondsWithoutProgress: 0, eventSent: false }
    } else if (
      horizontalDistanceNm < this.routeProgress.bestDistanceNm - ROUTE_PROGRESS_EPSILON_NM
      || (this.state.autopilot.lateralMode === 'route' && routeHeadingErrorDeg < this.routeProgress.bestHeadingErrorDeg - 1)
    ) {
      this.routeProgress.bestDistanceNm = horizontalDistanceNm
      this.routeProgress.bestHeadingErrorDeg = routeHeadingErrorDeg
      this.routeProgress.secondsWithoutProgress = 0
    } else if (this.state.autopilot.lateralMode === 'route' && routeHeadingErrorDeg > 25) {
      // A transport aircraft can spend well over 20 seconds turning toward a valid leg.
      // Do not call that maneuver a stall; start the convergence clock once the
      // aircraft is broadly tracking the commanded course.
      this.routeProgress.secondsWithoutProgress = 0
    } else {
      this.routeProgress.secondsWithoutProgress += STEP
    }
    const genericRecoveryLeg = active.kind === 'enroute' || active.kind === 'base' || active.kind === 'final'
    const airborne = altitudeFt - this.runway(route).elevation >= LIFTOFF_CONFIRM_AGL_FT
    const stalled = this.state.checkride.status === 'resolved'
      && genericRecoveryLeg
      && airborne
      && this.routeProgress.secondsWithoutProgress >= ROUTE_STALL_SECONDS
      && !this.routeProgress.eventSent
    if (stalled) this.routeProgress.eventSent = true
    return { route: updatedRoute, autopilot, phase: final ? 'approach' : 'enroute', reached: reached ? active : null, next, stalled }
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
    return elevation + Math.tan(radians(3)) * distanceNm(position, threshold) * FEET_PER_NM
  }

  private navigation(state: FlightState, phase: MissionPhase, outcome: MissionOutcome, runway: ReturnType<FlightSimulator['runway']>) {
    const envelope = flightEnvelopeFor(state.mode)
    const active = state.route.waypoints[state.route.activeWaypointIndex]
    const bearingToNextFixDeg = active ? navigationBearingDeg(state, active) : null
    const closingRateKt = active && bearingToNextFixDeg !== null
      ? state.motion.groundSpeedKt * Math.cos(radians(headingError(bearingToNextFixDeg, state.motion.trackDeg)))
      : null
    const frame = runwayFrame(state, runway.threshold, runway.heading)
    const glidepathErrorFt = state.altitudeFt - this.glidepathAltitude(state, runway.threshold, runway.elevation)
    const stableApproach = phase === 'approach' && Math.abs(frame.crossNm) < 0.08 && Math.abs(glidepathErrorFt) < 180 && state.airspeedKt >= envelope.stableApproachMinKt && state.airspeedKt <= envelope.stableApproachMaxKt && state.gearDown && (envelope.hasConventionalFlaps ? state.flapsDeg >= envelope.approachFlapsDeg : state.flapsDeg === 0)
    return Object.freeze({
      phase: outcome === 'in_progress' ? phase : outcome === 'landed' ? 'complete' : 'failed',
      outcome, nextFix: active?.id ?? null,
      distanceToNextFixNm: active ? distanceNm(state, active) : null,
      bearingToNextFixDeg,
      closingRateKt,
      captureRadiusNm: active ? checkpointCaptureRadiusNm(active, state.controlOwner) : null,
      minimumTurnRadiusNm: coordinatedTurnRadiusNm(Math.max(state.airspeedKt, envelope.minCommandSpeedKt), envelope.routeBankDeg),
      routeStatus: active ? (this.routeProgress.eventSent ? 'stalled' : 'tracking') : 'idle',
      distanceToThresholdNm: distanceNm(state, runway.threshold), centerlineErrorNm: frame.crossNm,
      glidepathErrorFt, stableApproach, eventRevision: this.eventRevision,
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

  private takePilotControl(reason: string) {
    if (this.state.controlOwner === 'human') return
    const autopilot = Object.freeze({ ...this.state.autopilot, enabled: false })
    this.releasePilotControls()
    this.manualAttitudeTarget = { pitchDeg: this.state.pitchDeg, bankDeg: this.state.bankDeg }
    this.state = Object.freeze({ ...this.state, controlOwner: 'human', agentMode: 'idle', autopilot })
    this.addDebrief('human', 'Pilot overrode the copilot')
    this.record('human', 'human_override', reason, {})
    this.ensureHumanEmergencyRoute()
  }

  private ensureHumanEmergencyRoute() {
    if (!this.emergencyTriggered || this.state.controlOwner !== 'human' || this.state.checkride.status !== 'decision_required') return
    const reason = 'Request the safest preprogrammed emergency return for the human pilot.'
    this.decisionTimerRunning = false
    this.state = Object.freeze({
      ...this.state,
      atc: Object.freeze({ status: 'requested', requestedPlan: 'return_kstl', requestReason: reason, clearance: null }),
    })
    this.issueAtcClearance()
    const clearance = this.state.atc.clearance
    if (!clearance) return
    this.acceptAtcClearance(
      clearance.id,
      `${clearance.destination} runway ${clearance.runway}, maintain ${clearance.altitudeFt} feet, initial heading ${Math.round(clearance.headingDeg)} degrees.`,
      'system',
    )
  }

  private issueAtcClearance() {
    const plan = this.state.atc.requestedPlan
    if (this.state.atc.status !== 'requested' || !plan) return
    const route = routeFor(plan, this.state, plan === 'continue_kmdw', this.state.mode)
    const initial = route.waypoints[route.activeWaypointIndex]
    if (!initial || !route.destination || !route.runway) return
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
    })
    this.addDebrief('system', `ATC issued ${clearance.id}`)
    this.queueEvent('atc_clearance_received', `${clearance.instruction} Read back clearance ${clearance.id} with destination, runway, altitude, and initial heading.`)
  }

  private addDebrief(actor: TraceActor, summary: string) {
    const event: DebriefEvent = Object.freeze({ elapsedSeconds: this.state.elapsedSeconds, actor, summary })
    this.state = Object.freeze({ ...this.state, debrief: Object.freeze({ ...this.state.debrief, events: Object.freeze([...this.state.debrief.events.slice(-19), event]) }) })
  }

  private receipt(accepted: boolean, summary: string): ActionReceipt {
    return Object.freeze({ accepted, summary, eventRevision: this.eventRevision, state: this.state })
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
