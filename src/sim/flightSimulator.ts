import type {
  ActionReceipt, AircraftConfigurationInput, AutopilotState, AutopilotTargetsInput,
  CheckrideSeed, ConfigurationProcedure, ControlOwner, DebriefEvent, EvidenceSource, FlightEvent,
  FlightEventType, FlightEventWaitInput, FlightEventWaitResult, FlightEvidence,
  FlightState, FlightStateListener, MissionBrief, MissionOutcome, MissionPhase,
  PilotControls, RoutePlan, RouteState, RouteWaypoint, ScenarioConditions, TraceActor,
  TraceEvent,
} from './types'
import {
  KPWK_AIRPORT,
  KPWK_RUNWAY_16,
  LAKESIDE_AIRPORT,
  LAKESIDE_RUNWAY_22,
  NORTH_FIELD_AIRPORT,
  NORTH_FIELD_RUNWAY_18,
  NORTH_FIELD_START,
  offsetPosition,
} from './airfields.ts'

const STEP = 1 / 60
const SNAPSHOT_INTERVAL = 0.1
const MAX_FRAME = 0.25
const MAX_WAIT_MS = 15_000
const EARTH_RADIUS_NM = 3_440.065
const FEET_PER_NM = 6_076.12
const KPWK_ELEVATION = KPWK_RUNWAY_16.elevationFt
const MAX_SAFE_TOUCHDOWN_FPM = 600
const BOUNCE_THRESHOLD_FPM = 240
const MAX_TOUCHDOWN_BANK_DEG = 18
const MAX_TOUCHDOWN_SPEED_KT = 90
const MAX_BOUNCES = 2
const CRASH_SLIDE_SECONDS = 2.5
const ROTATE_SPEED_KT = 55
const TAKEOFF_POWER_ACCEL_KT_PER_SECOND = 5.8
const TAKEOFF_ROLLING_RESISTANCE_KT_PER_SECOND = 0.2
const TAKEOFF_AERO_DRAG_AT_ROTATE_KT_PER_SECOND = 0.65
const MAX_GROUND_PITCH_DEG = 10
const EMERGENCY_TRIGGER_SECONDS = 45
const EMERGENCY_DECISION_SECONDS = 45
const PASSENGER_INJURY_DRAW: Readonly<Record<CheckrideSeed, number>> = Object.freeze({ 17: 0.72, 42: 0.56, 81: 0.42 })

const isDestructiveImpact = ({
  onRunway,
  gearDown,
  impactFpm,
  airspeedKt,
  bankDeg,
  pitchDeg,
}: {
  onRunway: boolean
  gearDown: boolean
  impactFpm: number
  airspeedKt: number
  bankDeg: number
  pitchDeg: number
}) => !onRunway
  || impactFpm > 900
  || airspeedKt > 110
  || Math.abs(bankDeg) > 32
  || pitchDeg < -12
  || (!gearDown && (impactFpm > 350 || airspeedKt > 70))

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const approach = (value: number, target: number, change: number) => value < target ? Math.min(value + change, target) : Math.max(value - change, target)
const radians = (degrees: number) => degrees * Math.PI / 180
const normalizeHeading = (degrees: number) => ((degrees % 360) + 360) % 360
const headingError = (target: number, current: number) => ((target - current + 540) % 360) - 180

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

// A compact airframe envelope keeps Three mesh details out of the fixed-step simulator.
const collisionHull = Object.freeze([
  Object.freeze({ x: 0, y: 0.8, z: -4.8 }),
  Object.freeze({ x: 0, y: 1.1, z: 3.5 }),
  Object.freeze({ x: -5.4, y: 1.25, z: -0.55 }),
  Object.freeze({ x: 5.4, y: 1.25, z: -0.55 }),
  Object.freeze({ x: 0, y: 0.7, z: 0 }),
])
const extendedGearContactPoints = Object.freeze([
  Object.freeze({ x: -1.45, y: 0, z: 0.35 }),
  Object.freeze({ x: 1.45, y: 0, z: 0.35 }),
  Object.freeze({ x: 0, y: 0, z: -2.8 }),
])
const collisionPoints = Object.freeze([...collisionHull, ...extendedGearContactPoints])

const groundClearanceFt = (pitchDeg: number, bankDeg: number, gearDown: boolean) => {
  const pitch = radians(pitchDeg)
  const roll = radians(-bankDeg)
  let lowestMeters = 0
  const pointCount = gearDown ? collisionPoints.length : collisionHull.length
  for (let index = 0; index < pointCount; index += 1) {
    const point = collisionPoints[index]
    const pitchedY = point.y * Math.cos(pitch) - point.z * Math.sin(pitch)
    const rotatedY = point.x * Math.sin(roll) + pitchedY * Math.cos(roll)
    lowestMeters = Math.min(lowestMeters, rotatedY)
  }
  return -lowestMeters / 0.3048
}

const KPWK_THRESHOLD = Object.freeze({ lat: KPWK_RUNWAY_16.thresholdLat, lon: KPWK_RUNWAY_16.thresholdLon })
const LAKESIDE_THRESHOLD = Object.freeze({ lat: LAKESIDE_RUNWAY_22.thresholdLat, lon: LAKESIDE_RUNWAY_22.thresholdLon })

export const SHARED_AUTONOMY_MISSION: MissionBrief = Object.freeze({
  id: 'SHARED-AUTONOMY-EMERGENCY-01',
  name: 'Rough running over Wheeling',
  objective: 'Depart North Field, assess the emergency, and land at Chicago Executive within five minutes.',
  start: 'Lined up on North Field runway 18 with the aircraft configured for takeoff.',
  deadlineSeconds: 300,
  airports: Object.freeze([NORTH_FIELD_AIRPORT, LAKESIDE_AIRPORT, KPWK_AIRPORT]),
  runways: Object.freeze([NORTH_FIELD_RUNWAY_18, LAKESIDE_RUNWAY_22, KPWK_RUNWAY_16]),
  availablePlans: Object.freeze(['return_kpwk'] as const),
  evidenceSources: Object.freeze(['weather', 'cockpit', 'traffic', 'passenger'] as const),
  successConditions: Object.freeze([
    'Take off from North Field runway 18.',
    'Retract gear after a positive climb rate, then retract takeoff flaps in the climb.',
    'Check at least two evidence sources before selecting a route.',
    'Use flaps 10 on base, then gear down and flaps 20 on final.',
    'Reach final with gear down and at least 20 degrees of flaps.',
    'Touch down below 90 knots and 600 feet per minute.',
  ]),
})

const NORMAL_DEPARTURE_MISSION: MissionBrief = Object.freeze({
  ...SHARED_AUTONOMY_MISSION,
  name: 'North Field departure',
  objective: 'Depart North Field runway 18, clean up the aircraft, and monitor for an enroute update.',
  availablePlans: Object.freeze(['continue_klak'] as const),
  successConditions: Object.freeze([
    'File the Lakeside Municipal runway 22 route before takeoff.',
    'Take off from North Field runway 18.',
    'Retract gear after a positive climb rate.',
    'Retract takeoff flaps after the climb is established.',
    'Monitor for an enroute update before changing the route.',
  ]),
})

const scenarios: Readonly<Record<CheckrideSeed, ScenarioConditions>> = Object.freeze({
  17: Object.freeze({
    weather: Object.freeze({ visibilityMiles: 4, ceilingFt: 1_800, windDirectionDeg: 190, windSpeedKt: 12, summary: 'Rain. KPWK remains above minimums with a 9 knot crosswind.' }),
    engine: Object.freeze({ health: 'rough' as const, maximumPower: 0.72, summary: 'Cylinder temperatures are uneven. Available power is falling.' }),
    passenger: Object.freeze({ condition: 'urgent' as const, summary: 'The passenger is conscious but has chest pain.' }),
    traffic: Object.freeze({ delayMinutes: 0, priorityAvailable: true, summary: 'KPWK can clear a direct return to runway 16.' }),
  }),
  42: Object.freeze({
    weather: Object.freeze({ visibilityMiles: 1.5, ceilingFt: 850, windDirectionDeg: 250, windSpeedKt: 18, summary: 'Reported heavy rain puts runway 16 near approach minimums.' }),
    engine: Object.freeze({ health: 'rough' as const, maximumPower: 0.78, summary: 'The engine is rough but temperatures remain stable.' }),
    passenger: Object.freeze({ condition: 'stable' as const, summary: 'The passenger is uncomfortable but stable.' }),
    traffic: Object.freeze({ delayMinutes: 3, priorityAvailable: true, summary: 'KPWK reports a three minute delay unless the flight requests priority.' }),
  }),
  81: Object.freeze({
    weather: Object.freeze({ visibilityMiles: 3, ceilingFt: 1_300, windDirectionDeg: 170, windSpeedKt: 8, summary: 'Light rain. Both airports remain usable.' }),
    engine: Object.freeze({ health: 'failing' as const, maximumPower: 0.58, summary: 'Oil pressure is dropping. Continued power is not assured.' }),
    passenger: Object.freeze({ condition: 'critical' as const, summary: 'The passenger is intermittently unresponsive.' }),
    traffic: Object.freeze({ delayMinutes: 1, priorityAvailable: true, summary: 'Emergency priority is available at KPWK.' }),
  }),
})

const NORMAL_DEPARTURE_SCENARIO: ScenarioConditions = Object.freeze({
  weather: Object.freeze({ visibilityMiles: 10, ceilingFt: 6_500, windDirectionDeg: 180, windSpeedKt: 6, summary: 'Good visibility and light winds for departure.' }),
  engine: Object.freeze({ health: 'normal' as const, maximumPower: 1, summary: 'Engine indications are normal.' }),
  passenger: Object.freeze({ condition: 'stable' as const, summary: 'The cabin is secure and the passenger is comfortable.' }),
  traffic: Object.freeze({ delayMinutes: 0, priorityAvailable: false, summary: 'No traffic conflicts are reported.' }),
})

const EMERGENCY_ALERT = 'A new engine, weather, traffic, and passenger scenario has developed. Reassess the flight and build a route now.'

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

const bearingDeg = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
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
  captureRadiusNm = 0.15,
): RouteWaypoint => Object.freeze({ id, name, kind, ...position, altitudeFt, airspeedKt, captureRadiusNm })

const routeFor = (plan: RoutePlan, origin: { lat: number; lon: number }): RouteState => {
  if (plan === 'continue_klak') {
    const reciprocalHeading = normalizeHeading(LAKESIDE_RUNWAY_22.headingDeg + 180)
    const entry = offsetPosition(LAKESIDE_THRESHOLD, reciprocalHeading, 2.1)
    return Object.freeze({ plan, destination: 'KLAK', runway: '22', reason: null, activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), waypoints: Object.freeze([
      waypoint('NORTH_FIELD_CLIMB', 'North Field climb', 'departure', offsetPosition(NORTH_FIELD_START, NORTH_FIELD_RUNWAY_18.headingDeg, 0.65), 1_200, 82),
      waypoint('LAKESIDE_ENROUTE', 'Lakeside enroute', 'enroute', offsetPosition(origin, 28, 6.4), 1_800, 95, 0.22),
      waypoint('LAKESIDE_ENTRY', 'Lakeside runway 22 entry', 'final', entry, 1_250, 80, 0.18),
      waypoint('LAKESIDE_TOUCHDOWN', 'Lakeside runway 22', 'touchdown', offsetPosition(LAKESIDE_THRESHOLD, LAKESIDE_RUNWAY_22.headingDeg, 0.12), LAKESIDE_RUNWAY_22.elevationFt, 68, 0.08),
    ]) })
  }
  if (plan === 'return_kpwk') {
    const reciprocalHeading = normalizeHeading(KPWK_RUNWAY_16.headingDeg + 180)
    const baseLeg = offsetPosition(
      offsetPosition(KPWK_THRESHOLD, reciprocalHeading, 1.45),
      normalizeHeading(KPWK_RUNWAY_16.headingDeg - 90),
      0.55,
    )
    const intercept = distanceNm(origin, baseLeg) > 0.45
      ? waypoint('KPWK_DIVERT', 'KPWK emergency intercept', 'enroute', offsetPosition(origin, bearingDeg(origin, baseLeg), Math.min(0.65, distanceNm(origin, baseLeg) * 0.45)), 1_050, 82, 0.16)
      : null
    return Object.freeze({ plan, destination: 'KPWK', runway: '16', reason: null, activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), waypoints: Object.freeze([
      ...(intercept ? [intercept] : []),
      waypoint('KPWK_BASE', 'Runway 16 base', 'base', baseLeg, 1_050, 82),
      waypoint('KPWK_FINAL', 'Runway 16 final', 'final', offsetPosition(KPWK_THRESHOLD, reciprocalHeading, 1.05), 980, 78),
      waypoint('KPWK_TOUCHDOWN', 'Runway 16 touchdown', 'touchdown', offsetPosition(KPWK_THRESHOLD, KPWK_RUNWAY_16.headingDeg, 0.14), KPWK_ELEVATION, 70, 0.08),
    ]) })
  }
  return Object.freeze({ plan, destination: null, runway: null, reason: null, activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), waypoints: Object.freeze([]) })
}

const initialAutopilot = (): AutopilotState => Object.freeze({ enabled: false, headingDeg: NORTH_FIELD_RUNWAY_18.headingDeg, altitudeFt: 1_200, airspeedKt: 82, verticalMode: 'climb' })
const initialRoute = (): RouteState => Object.freeze({ plan: 'unassigned', destination: null, runway: null, waypoints: Object.freeze([]), activeWaypointIndex: 0, completedWaypointIds: Object.freeze([]), reason: null })

const configurationProcedureFor = (state: Pick<FlightState, 'aircraftPhase' | 'altitudeFt' | 'route' | 'gearDown' | 'flapsDeg'>): ConfigurationProcedure => {
  if (state.aircraftPhase === 'landing_roll' || state.aircraftPhase === 'stopped' || state.aircraftPhase === 'crash_slide') {
    return Object.freeze({ stage: 'complete', gearDown: state.gearDown, flapsDeg: state.flapsDeg as 0 | 10 | 20 | 30, compliant: true, instruction: 'Configuration sequence complete.' })
  }
  let stage: ConfigurationProcedure['stage'] = 'takeoff'
  let gearDown = true
  let flapsDeg: ConfigurationProcedure['flapsDeg'] = 10
  let instruction = 'Takeoff: gear down, flaps 10°.'
  if (state.aircraftPhase === 'airborne') {
    const aglFt = state.altitudeFt - NORTH_FIELD_RUNWAY_18.elevationFt
    const activeKind = state.route.waypoints[state.route.activeWaypointIndex]?.kind
    if (activeKind === 'departure' && aglFt < 180) {
      stage = 'positive_rate'
      gearDown = false
      instruction = 'Positive rate: retract the landing gear; hold flaps 10°.'
    } else if (!activeKind || activeKind === 'departure' || activeKind === 'enroute') {
      stage = 'climb_cleanup'
      gearDown = false
      flapsDeg = 0
      instruction = 'Climb established: retract flaps to 0°.'
    } else if (activeKind === 'base') {
      stage = 'base'
      gearDown = false
      flapsDeg = 10
      instruction = 'Base leg: select flaps 10°; keep the gear up.'
    } else if (activeKind === 'final') {
      stage = 'final'
      flapsDeg = 20
      instruction = 'Final approach: gear down, flaps 20°.'
    } else {
      stage = 'landing'
      flapsDeg = 30
      instruction = 'Landing: select flaps 30° and verify gear down.'
    }
  }
  return Object.freeze({ stage, gearDown, flapsDeg, compliant: state.gearDown === gearDown && state.flapsDeg === flapsDeg, instruction })
}

const initialState = (seed: CheckrideSeed): FlightState => {
  const start = NORTH_FIELD_START
  const scenario = NORMAL_DEPARTURE_SCENARIO
  const autopilot = initialAutopilot()
  const fuel = seed === 81 ? 6.5 : 8.5
  const state = {
    ...start, altitudeFt: NORTH_FIELD_RUNWAY_18.elevationFt, airspeedKt: 0, verticalSpeedFpm: 0, headingDeg: NORTH_FIELD_RUNWAY_18.headingDeg,
    pitchDeg: 0, bankDeg: 0, throttle: 0, flapsDeg: 10 as const, gearDown: true,
    elapsedSeconds: 0, fuelMinutesRemaining: fuel, controlOwner: 'human', handoffRequested: false,
    agentMode: 'idle', autopilot, route: initialRoute(), scenario,
    motion: Object.freeze({ longitudinalAccelerationKtPerSecond: 0, verticalAccelerationFpmPerSecond: 0, turnRateDegPerSecond: 0 }),
    impact: null,
    aircraftPhase: 'takeoff_roll',
    approval: Object.freeze({ status: 'none', question: null, requestedAction: null }),
    mission: Object.freeze({ phase: 'preflight', outcome: 'in_progress', nextFix: null, distanceToNextFixNm: null, distanceToThresholdNm: distanceNm(start, LAKESIDE_THRESHOLD), centerlineErrorNm: 0, glidepathErrorFt: 0, stableApproach: false, eventRevision: 0 }),
    checkride: Object.freeze({ seed, status: 'armed', objective: NORMAL_DEPARTURE_MISSION.objective, deadlineSeconds: 300, decisionSecondsRemaining: null, fuelMinutesRemaining: fuel, alert: null, humanApproval: 'not_required', inspectedSources: Object.freeze([]), score: Object.freeze({ total: 100 }), decision: null }),
    passengerSafety: Object.freeze({ loadFactorG: 1, jerkGPerSecond: 0, distress: 0, injuryProbability: 0, status: 'comfortable', summary: 'Cabin motion is smooth.' }),
    debrief: Object.freeze({ status: 'in_progress', elapsedSeconds: 0, decision: 'unassigned', decisionReason: null, events: Object.freeze([]), landing: null }),
  } satisfies Omit<FlightState, 'procedure'>
  return Object.freeze({ ...state, procedure: configurationProcedureFor(state) }) satisfies FlightState
}

interface EventWaiter { readonly afterRevision: number; readonly events: ReadonlySet<FlightEventType>; readonly resolve: (result: FlightEventWaitResult) => void; readonly timeout: ReturnType<typeof setTimeout> }
interface CrashDynamics { elapsedSeconds: number; readonly outcome: 'unsafe_touchdown' | 'crashed' | 'fuel_exhausted'; readonly rollDirection: -1 | 1 }

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
  private fuelExhausted = false
  private passengerInjuryDraw = PASSENGER_INJURY_DRAW[17]
  private pilotControls: PilotControls = Object.freeze({ pitchAxis: 0, bankAxis: 0 })
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
      : clamp((renderTimeMs - this.lastFrameMs) / 1_000, 0, MAX_FRAME)
    return clamp((this.accumulator + pendingSeconds) / STEP, 0, 1)
  }
  getSnapshot = () => this.snapshot
  getTrace = () => this.trace
  getEventRevision = () => this.eventRevision
  getMissionBrief = () => this.emergencyTriggered ? SHARED_AUTONOMY_MISSION : NORMAL_DEPARTURE_MISSION
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

  reset = (seed: CheckrideSeed = this.state.checkride.seed) => {
    this.cancelWaiters()
    this.state = initialState(seed)
    this.snapshot = this.state
    this.events = Object.freeze([])
    this.trace = Object.freeze([])
    this.accumulator = 0
    this.impactRevision = 0
    this.bounceCount = 0
    this.peakTouchdownImpactFpm = 0
    this.crashDynamics = null
    this.selectedScenario = scenarios[seed]
    this.emergencyTriggered = false
    this.decisionTimerExpired = false
    this.fuelExhausted = false
    this.passengerInjuryDraw = PASSENGER_INJURY_DRAW[seed]
    this.pilotControls = Object.freeze({ pitchAxis: 0, bankAxis: 0 })
    this.manualAttitudeTarget = { pitchDeg: 0, bankDeg: 0 }
    this.record('system', 'mission_started', `Normal departure seed ${seed} started`, {})
    this.previousState = this.state
    this.publish(this.state)
  }

  inspectEvidence = (source: EvidenceSource): FlightEvidence => {
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
    this.manualAttitudeTarget = owner === 'human'
      ? { pitchDeg: this.state.pitchDeg, bankDeg: this.state.bankDeg }
      : { pitchDeg: 0, bankDeg: 0 }
    const autopilot = Object.freeze({ ...this.state.autopilot, enabled: owner === 'agent' })
    this.state = Object.freeze({ ...this.state, controlOwner: owner, handoffRequested: false, agentMode: owner === 'agent' ? 'thinking' : 'idle', autopilot })
    this.record(actor, 'control_transferred', reason, { owner })
    this.addDebrief(actor, owner === 'agent' ? 'Copilot took control' : 'Pilot took control')
    this.publish(this.state)
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
    if (this.state.mission.phase !== 'preflight') return this.receipt(false, 'Takeoff has already started.')
    if (this.state.route.plan !== 'continue_klak') return this.receipt(false, 'File the Lakeside Municipal runway 22 route before takeoff.')
    this.state = Object.freeze({
      ...this.state,
      mission: Object.freeze({ ...this.state.mission, phase: 'takeoff' }),
    })
    this.record(actor, 'takeoff_started', reason, { runway: NORTH_FIELD_RUNWAY_18.id })
    this.publish(this.state)
    return this.receipt(true, `Cleared for takeoff on ${NORTH_FIELD_RUNWAY_18.id}.`)
  }

  setThrottle = (value: number, actor: TraceActor = 'human', reason = 'Set throttle') => {
    if (actor === 'human') this.takePilotControl(reason)
    this.state = Object.freeze({ ...this.state, throttle: clamp(value, 0, 1) })
    this.record(actor, 'throttle', reason, { value: this.state.throttle })
    this.publish(this.state)
  }

  setFlaps = (degrees: number, actor: TraceActor = 'human', reason = 'Set flaps') => this.configureAircraft({ flapsDeg: clamp(degrees, 0, 30) as 0 | 10 | 20 | 30, reason }, actor)
  setGear = (down: boolean, actor: TraceActor = 'human', reason = 'Set gear') => this.configureAircraft({ gearDown: down, reason }, actor)
  setRoute = (plan: RoutePlan, reason: string, actor: TraceActor = 'agent'): ActionReceipt => {
    if (plan === 'unassigned') return this.receipt(false, 'Choose continue_klak before departure or return_kpwk after the emergency.')
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
    const filingPreflight = this.state.mission.phase === 'preflight'
    if (filingPreflight && plan !== 'continue_klak') return this.receipt(false, 'The preflight route is continue_klak to Lakeside Municipal runway 22.')
    if (!filingPreflight && !this.emergencyTriggered) return this.receipt(false, 'The Lakeside route is active. Wait for a new scenario before changing it.')
    if (this.emergencyTriggered && plan !== 'return_kpwk') return this.receipt(false, 'The changed conditions require a new return_kpwk decision.')
    if (this.emergencyTriggered && actor === 'agent' && this.state.checkride.inspectedSources.length < 2) return this.receipt(false, 'Inspect at least two evidence sources before choosing the emergency route.')
    const route = Object.freeze({ ...routeFor(plan, this.state), reason })
    const target = route.waypoints[0]
    const autopilot = target ? Object.freeze({ enabled: actor === 'agent', headingDeg: bearingDeg(this.state, target), altitudeFt: target.altitudeFt, airspeedKt: target.airspeedKt, verticalMode: target.altitudeFt < this.state.altitudeFt ? 'descend' as const : 'climb' as const }) : this.state.autopilot
    this.state = Object.freeze({
      ...this.state, route, autopilot,
      agentMode: actor === 'agent' ? (filingPreflight ? 'thinking' : 'flying') : this.state.agentMode,
      mission: Object.freeze({ ...this.state.mission, phase: filingPreflight ? 'preflight' : 'enroute', nextFix: target?.id ?? null, distanceToNextFixNm: target ? distanceNm(this.state, target) : null }),
      checkride: Object.freeze({ ...this.state.checkride, status: filingPreflight ? 'armed' : 'resolved', decisionSecondsRemaining: null, decision: filingPreflight ? null : plan }),
      debrief: Object.freeze({ ...this.state.debrief, decision: plan, decisionReason: reason }),
    })
    this.record(actor, filingPreflight ? 'preflight_route_filed' : 'route_selected', reason, { plan })
    this.addDebrief(actor, filingPreflight ? 'Filed Lakeside Municipal runway 22 route' : `Selected ${plan.replaceAll('_', ' ')}`)
    this.queueEvent('plan_updated', filingPreflight ? 'Preflight route to Lakeside Municipal runway 22 filed.' : `${plan.replaceAll('_', ' ')} route loaded.`)
    this.publish(this.state)
    if (filingPreflight) this.beginTakeoff(actor, 'Preflight route filed; takeoff roll started')
    return this.receipt(true, `${route.destination ?? 'Holding'} route loaded.`)
  }

  setAutopilotTargets = (input: AutopilotTargetsInput | Partial<AutopilotState>, actor: TraceActor = 'agent', reason?: string): ActionReceipt => {
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
    const current = this.state.autopilot
    const autopilot: AutopilotState = Object.freeze({
      enabled: 'enabled' in input && typeof input.enabled === 'boolean' ? input.enabled : true,
      headingDeg: normalizeHeading(input.headingDeg ?? current.headingDeg),
      altitudeFt: clamp(input.altitudeFt ?? current.altitudeFt, KPWK_ELEVATION, 4_000),
      airspeedKt: clamp(input.airspeedKt ?? current.airspeedKt, 65, 140),
      verticalMode: input.verticalMode ?? current.verticalMode,
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
    this.state = Object.freeze({ ...configured, procedure })
    this.record(actor, 'aircraft_configured', input.reason ?? 'Aircraft configuration updated', { gearDown: this.state.gearDown, flapsDeg: this.state.flapsDeg })
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
    const existing = this.events.find((event) => event.revision > input.afterRevision && input.events.includes(event.type))
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
    for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
      this.previousState = this.state
      this.advance(STEP)
    }
    this.snapshot = this.state
    this.emit()
  }

  private readonly tick = (timeMs: number) => {
    if (this.lastFrameMs === null) this.lastFrameMs = timeMs
    this.accumulator += Math.min((timeMs - this.lastFrameMs) / 1_000, MAX_FRAME)
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
    let { headingDeg: heading, bankDeg: bank, pitchDeg: pitch, throttle, airspeedKt: airspeed, verticalSpeedFpm: verticalSpeed } = this.state

    if (this.state.debrief.landing) {
      bank = approach(bank, 0, 60 * dt)
      pitch = approach(pitch, 0, 10 * dt)
      throttle = 0
      verticalSpeed = 0
    } else if (this.fuelExhausted && this.state.aircraftPhase === 'airborne') {
      throttle = 0
      bank = approach(bank, 0, 12 * dt)
      pitch = approach(pitch, -6, 5 * dt)
      verticalSpeed = approach(verticalSpeed, -1_050, 360 * dt)
    } else if (this.state.controlOwner === 'agent' && this.state.autopilot.enabled) {
      if (this.state.aircraftPhase === 'takeoff_roll') {
        bank = approach(bank, clamp(headingError(NORTH_FIELD_RUNWAY_18.headingDeg, heading) * 0.65, -12, 12), 24 * dt)
        throttle = approach(throttle, 1, 0.55 * dt)
        const rotating = airspeed >= ROTATE_SPEED_KT
        verticalSpeed = approach(verticalSpeed, rotating ? 650 : 0, 520 * dt)
        pitch = approach(pitch, rotating ? 7 : 0, 7 * dt)
      } else {
        const target = this.state.autopilot
        bank = approach(bank, clamp(headingError(target.headingDeg, heading) * 0.65, -25, 25), 18 * dt)
        throttle = approach(throttle, clamp(0.52 + (target.airspeedKt - airspeed) * 0.025, 0.25, 1), 0.35 * dt)
        const altitudeError = target.altitudeFt - this.state.altitudeFt
        const desiredFpm = target.verticalMode === 'approach'
          ? clamp(-target.airspeedKt * 5.3 + altitudeError * 3, -700, 400)
          : target.verticalMode === 'level'
            ? clamp(altitudeError * 2, -400, 400)
            : clamp(altitudeError * 2.5, -850, 700)
        verticalSpeed = approach(verticalSpeed, desiredFpm, 420 * dt)
        pitch = approach(pitch, clamp(verticalSpeed / 130, -6, 7), 6 * dt)
      }
    } else {
      const onTakeoffRoll = this.state.aircraftPhase === 'takeoff_roll'
      this.manualAttitudeTarget.pitchDeg = clamp(
        this.manualAttitudeTarget.pitchDeg + this.pilotControls.pitchAxis * 32 * dt,
        onTakeoffRoll ? 0 : -55,
        onTakeoffRoll ? MAX_GROUND_PITCH_DEG : 55,
      )
      this.manualAttitudeTarget.bankDeg = onTakeoffRoll
        ? 0
        : clamp(this.manualAttitudeTarget.bankDeg + this.pilotControls.bankAxis * 70 * dt, -60, 60)
      const targetPitch = onTakeoffRoll && airspeed < ROTATE_SPEED_KT ? 0 : this.manualAttitudeTarget.pitchDeg
      pitch = approach(pitch, targetPitch, 32 * dt)
      bank = approach(bank, this.manualAttitudeTarget.bankDeg, 70 * dt)
      const targetVerticalSpeed = clamp(airspeed * FEET_PER_NM / 60 * Math.sin(radians(pitch)), -4_500, 4_500)
      verticalSpeed = approach(verticalSpeed, targetVerticalSpeed, 1_200 * dt)
    }

    const drag = 0.36 + this.state.flapsDeg * 0.008 + (this.state.gearDown ? 0.12 : 0)
    const power = throttle * scenario.engine.maximumPower
    const gravityAlongFlightPath = -Math.sin(radians(pitch)) * 5.5
    const acceleration = this.fuelExhausted
      ? (78 - airspeed) * 0.22
      : this.state.aircraftPhase === 'takeoff_roll'
      ? power * TAKEOFF_POWER_ACCEL_KT_PER_SECOND
        - (airspeed > 0.05 || power > 0 ? TAKEOFF_ROLLING_RESISTANCE_KT_PER_SECOND : 0)
        - TAKEOFF_AERO_DRAG_AT_ROTATE_KT_PER_SECOND * (airspeed / ROTATE_SPEED_KT) ** 2
      : power * 8.5 - drag * 5.8 + gravityAlongFlightPath
    airspeed = clamp(airspeed + acceleration * dt, 0, 150)
    const turnRate = airspeed > 20 ? 1_091 * Math.tan(radians(clamp(bank, -60, 60))) / airspeed : 0
    heading = normalizeHeading(heading + turnRate * dt)
    const position = offsetPosition(this.state, heading, airspeed * dt / 3_600)
    let altitude = this.state.altitudeFt + verticalSpeed * dt / 60
    const elapsedSeconds = this.state.elapsedSeconds + dt
    const fuelMinutesRemaining = Math.max(0, this.state.fuelMinutesRemaining - dt / 60 * (0.65 + throttle * 0.55))

    const routeUpdate = this.advanceRoute(position, altitude)
    const runway = this.runway()
    const frame = runwayFrame(position, runway.threshold, runway.heading)
    const onRunway = frame.alongNm >= 0 && frame.alongNm <= runway.lengthFt / FEET_PER_NM && Math.abs(frame.crossNm) <= 75 / FEET_PER_NM
    let phase = routeUpdate.phase
    let outcome: MissionOutcome = 'in_progress'
    let landing = this.state.debrief.landing
    let impact = this.state.impact
    let touchdownJustOccurred = false
    let aircraftPhase = this.state.aircraftPhase
    let departedJustNow = false

    if (aircraftPhase === 'takeoff_roll') {
      phase = 'takeoff'
      const takeoffContactAltitude = NORTH_FIELD_RUNWAY_18.elevationFt + groundClearanceFt(pitch, bank, this.state.gearDown)
      if (airspeed < ROTATE_SPEED_KT || pitch <= 1) {
        altitude = takeoffContactAltitude
        verticalSpeed = 0
      } else if (altitude > NORTH_FIELD_RUNWAY_18.elevationFt + 5) {
        aircraftPhase = 'airborne'
        phase = routeUpdate.route.plan === 'unassigned' ? 'planning' : 'enroute'
        departedJustNow = true
      }
    }

    const contactAltitude = runway.elevation + groundClearanceFt(pitch, bank, this.state.gearDown)
    const groundContact = aircraftPhase === 'landing_roll'
      || aircraftPhase === 'stopped'
      || (altitude <= contactAltitude && verticalSpeed <= 0)
    if (aircraftPhase !== 'takeoff_roll' && groundContact) {
      altitude = contactAltitude
      const impactFpm = Math.abs(verticalSpeed)
      this.peakTouchdownImpactFpm = Math.max(this.peakTouchdownImpactFpm, impactFpm)
      const safeContact = !this.fuelExhausted
        && onRunway
        && this.state.gearDown
        && this.state.flapsDeg >= 20
        && airspeed <= MAX_TOUCHDOWN_SPEED_KT
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
        airspeed = Math.max(0, airspeed - (3.5 + (1 - throttle) * 7) * dt)
        if (!landing) {
          landing = Object.freeze({ runway: runway.id, sinkRateFpm: Math.round(this.peakTouchdownImpactFpm), airspeedKt: Math.round(airspeed), centerlineErrorFt: Math.round(Math.abs(frame.crossNm) * FEET_PER_NM), touchdownDistanceFt: Math.round(frame.alongNm * FEET_PER_NM), bounces: this.bounceCount, onRunway: true, safe: true })
          touchdownJustOccurred = true
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
        })
        landing = Object.freeze({ runway: runway.id, sinkRateFpm: Math.round(impactFpm), airspeedKt: Math.round(airspeed), centerlineErrorFt: Math.round(Math.abs(frame.crossNm) * FEET_PER_NM), touchdownDistanceFt: Math.round(frame.alongNm * FEET_PER_NM), bounces: this.bounceCount, onRunway, safe: false })
        this.impactRevision += 1
        this.crashDynamics = { elapsedSeconds: 0, outcome: crashOutcome, rollDirection }
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
        throttle = 0
        verticalSpeed = 0
        phase = 'failed'
      }
    }
    const fuelJustExhausted = fuelMinutesRemaining <= 0 && !this.fuelExhausted
    if (fuelJustExhausted) this.fuelExhausted = true

    const motion = Object.freeze({
      longitudinalAccelerationKtPerSecond: (airspeed - this.state.airspeedKt) / dt,
      verticalAccelerationFpmPerSecond: (verticalSpeed - this.state.verticalSpeedFpm) / dt,
      turnRateDegPerSecond: turnRate,
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
    const decisionSecondsRemaining = this.state.checkride.status === 'decision_required'
      ? Math.max(0, (this.state.checkride.decisionSecondsRemaining ?? EMERGENCY_DECISION_SECONDS) - dt)
      : this.state.checkride.decisionSecondsRemaining
    const decisionTimerJustExpired = decisionSecondsRemaining === 0 && !this.decisionTimerExpired && this.state.checkride.status === 'decision_required'
    const partialWithoutProcedure = { ...this.state, ...position, altitudeFt: altitude, airspeedKt: airspeed, verticalSpeedFpm: verticalSpeed, headingDeg: heading, pitchDeg: pitch, bankDeg: bank, throttle, elapsedSeconds, fuelMinutesRemaining, motion, impact, aircraftPhase, route: routeUpdate.route }
    const procedure = configurationProcedureFor(partialWithoutProcedure)
    const partial = { ...partialWithoutProcedure, procedure } as FlightState
    const mission = this.navigation(partial, phase, outcome, runway)
    const approachJustStabilized = mission.stableApproach && !this.state.mission.stableApproach
    const status = outcome === 'in_progress' ? 'in_progress' : outcome === 'landed' ? 'landed' : 'failed'
    const score = status === 'in_progress'
      ? this.state.checkride.score
      : Object.freeze({ total: status === 'landed' ? 100 : 35 })
    this.state = Object.freeze({
      ...partial,
      autopilot: routeUpdate.autopilot, mission, passengerSafety,
      checkride: Object.freeze({ ...this.state.checkride, fuelMinutesRemaining, decisionSecondsRemaining, status: status === 'in_progress' ? this.state.checkride.status : 'complete', score: decisionTimerJustExpired ? Object.freeze({ total: Math.max(0, score.total - 15) }) : score }),
      debrief: Object.freeze({ ...this.state.debrief, status, elapsedSeconds, landing }),
      agentMode: status === 'in_progress' ? this.state.agentMode : 'complete',
    })
    if (!this.emergencyTriggered && aircraftPhase === 'airborne' && elapsedSeconds >= EMERGENCY_TRIGGER_SECONDS) {
      this.emergencyTriggered = true
      this.state = Object.freeze({
        ...this.state,
        scenario: this.selectedScenario,
        agentMode: this.state.controlOwner === 'agent' ? 'thinking' : this.state.agentMode,
        checkride: Object.freeze({
          ...this.state.checkride,
          status: 'decision_required',
          decisionSecondsRemaining: EMERGENCY_DECISION_SECONDS,
          objective: SHARED_AUTONOMY_MISSION.objective,
          alert: EMERGENCY_ALERT,
          inspectedSources: Object.freeze([]),
        }),
      })
      this.record('system', 'scenario_triggered', EMERGENCY_ALERT, { seed: this.state.checkride.seed })
      this.addDebrief('system', 'Unexpected emergency scenario received')
      this.queueEvent('emergency_detected', EMERGENCY_ALERT)
    }
    if (decisionTimerJustExpired) {
      this.decisionTimerExpired = true
      this.state = Object.freeze({ ...this.state, checkride: Object.freeze({ ...this.state.checkride, alert: 'The emergency decision window expired. Choose and execute a route immediately.' }) })
      this.record('system', 'decision_timer_expired', 'Emergency route decision took longer than 45 seconds', {})
      this.queueEvent('decision_timer_expired', 'The 45 second emergency decision window expired. Commit to a route immediately.')
    }
    if (fuelJustExhausted && outcome === 'in_progress') {
      this.record('system', 'fuel_exhausted', 'The engine stopped after fuel exhaustion', {})
      this.addDebrief('system', 'Fuel exhausted; engine-out descent began')
      this.queueEvent('emergency_detected', 'Fuel exhausted. The engine has stopped; the aircraft is descending.')
    }
    if (procedure.stage !== this.previousState.procedure.stage && !procedure.compliant) this.queueEvent('configuration_required', procedure.instruction)
    if (routeUpdate.reached) {
      const nextMessage = routeUpdate.next && routeUpdate.next.id !== routeUpdate.reached.id
        ? ` Next checkpoint: ${routeUpdate.next.name}.`
        : ' Final route checkpoint captured.'
      this.record(this.state.controlOwner, 'checkpoint_reached', routeUpdate.reached.name, { waypointId: routeUpdate.reached.id })
      this.addDebrief(this.state.controlOwner, `Reached ${routeUpdate.reached.name}`)
      this.queueEvent('checkpoint_reached', `Reached checkpoint ${routeUpdate.reached.name}.${nextMessage}`)
    }
    if (passengerStatusChanged && (passengerSafety.status === 'distressed' || passengerSafety.status === 'injured')) {
      this.record('system', 'passenger_safety_update', passengerSafety.summary, { loadFactorG: passengerSafety.loadFactorG, jerkGPerSecond: passengerSafety.jerkGPerSecond, injuryProbability: passengerSafety.injuryProbability })
      this.addDebrief('system', passengerSafety.summary)
      this.queueEvent('passenger_safety_update', `${passengerSafety.summary} Current load ${passengerSafety.loadFactorG.toFixed(2)} G; jerk ${passengerSafety.jerkGPerSecond.toFixed(2)} G/s.`)
    }
    if (approachJustStabilized) this.queueEvent('approach_stable', `${runway.id} approach is stable.`)
    if (departedJustNow) this.addDebrief(this.state.controlOwner, `Departed ${NORTH_FIELD_RUNWAY_18.id}`)
    if (touchdownJustOccurred) this.queueEvent('touchdown', `Touchdown on ${runway.id}.`)
    if (outcome !== 'in_progress') this.finish(outcome)
  }

  private advanceCrash(dt: number) {
    const crash = this.crashDynamics!
    crash.elapsedSeconds += dt
    const runway = this.runway()
    const airspeed = Math.max(0, this.state.airspeedKt - 64 * dt)
    const heading = normalizeHeading(this.state.headingDeg + crash.rollDirection * 12 * dt)
    const position = offsetPosition(this.state, heading, airspeed * dt / 3_600)
    const elapsedSeconds = this.state.elapsedSeconds + dt
    const fuelMinutesRemaining = Math.max(0, this.state.fuelMinutesRemaining - dt / 60 * 0.65)
    const pitch = approach(this.state.pitchDeg, -14, 28 * dt)
    const bank = approach(this.state.bankDeg, crash.rollDirection * 68, 62 * dt)
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
        turnRateDegPerSecond: crash.rollDirection * 12,
      }),
    } as FlightState
    const mission = this.navigation(partial, 'failed', outcome, runway)
    const status = finished ? 'failed' : 'in_progress'
    this.state = Object.freeze({
      ...partial,
      mission,
      checkride: Object.freeze({ ...this.state.checkride, fuelMinutesRemaining, status: finished ? 'complete' : this.state.checkride.status, score: finished ? Object.freeze({ total: 35 }) : this.state.checkride.score }),
      debrief: Object.freeze({ ...this.state.debrief, status, elapsedSeconds }),
      agentMode: finished ? 'complete' : this.state.agentMode,
    })
    if (finished) {
      this.crashDynamics = null
      this.finish(crash.outcome)
    }
  }

  private advanceRoute(position: { lat: number; lon: number }, altitudeFt: number): { route: RouteState; autopilot: AutopilotState; phase: MissionPhase; reached: RouteWaypoint | null; next: RouteWaypoint | null } {
    const route = this.state.route
    const active = route.waypoints[route.activeWaypointIndex]
    if (!active) return { route, autopilot: this.state.autopilot, phase: this.state.mission.phase, reached: null, next: null }
    const reached = !route.completedWaypointIds.includes(active.id) && distanceNm(position, active) < active.captureRadiusNm
    const index = reached ? Math.min(route.activeWaypointIndex + 1, route.waypoints.length - 1) : route.activeWaypointIndex
    const next = route.waypoints[index]
    const final = next.kind === 'final' || next.kind === 'touchdown'
    const runway = this.runway()
    const targetAltitude = next.kind === 'touchdown' && route.destination === 'KPWK'
      ? runway.elevation + Math.tan(radians(3)) * distanceNm(position, next) * FEET_PER_NM
      : next.altitudeFt
    const autopilot = this.state.controlOwner === 'agent'
      ? Object.freeze({ enabled: true, headingDeg: bearingDeg(position, next), altitudeFt: targetAltitude, airspeedKt: next.airspeedKt, verticalMode: final ? 'approach' as const : targetAltitude < altitudeFt ? 'descend' as const : 'level' as const })
      : this.state.autopilot
    const updatedRoute = reached
      ? Object.freeze({ ...route, activeWaypointIndex: index, completedWaypointIds: Object.freeze([...route.completedWaypointIds, active.id]) })
      : route
    return { route: updatedRoute, autopilot, phase: final ? 'approach' : 'enroute', reached: reached ? active : null, next }
  }

  private runway() {
    return {
      threshold: KPWK_THRESHOLD,
      heading: KPWK_RUNWAY_16.headingDeg,
      elevation: KPWK_RUNWAY_16.elevationFt,
      lengthFt: KPWK_RUNWAY_16.lengthFt,
      id: 'KPWK 16',
    }
  }

  private glidepathAltitude(position: { lat: number; lon: number }, threshold: { lat: number; lon: number }, elevation: number) {
    return elevation + Math.tan(radians(3)) * distanceNm(position, threshold) * FEET_PER_NM
  }

  private navigation(state: FlightState, phase: MissionPhase, outcome: MissionOutcome, runway: ReturnType<FlightSimulator['runway']>) {
    const active = state.route.waypoints[state.route.activeWaypointIndex]
    const frame = runwayFrame(state, runway.threshold, runway.heading)
    const glidepathErrorFt = state.altitudeFt - this.glidepathAltitude(state, runway.threshold, runway.elevation)
    const stableApproach = phase === 'approach' && Math.abs(frame.crossNm) < 0.08 && Math.abs(glidepathErrorFt) < 180 && state.airspeedKt >= 65 && state.airspeedKt <= 90 && state.gearDown && state.flapsDeg >= 20
    return Object.freeze({
      phase: outcome === 'in_progress' ? phase : outcome === 'landed' ? 'complete' : 'failed',
      outcome, nextFix: active?.id ?? null,
      distanceToNextFixNm: active ? distanceNm(state, active) : null,
      distanceToThresholdNm: distanceNm(state, state.route.destination === 'KLAK' ? LAKESIDE_THRESHOLD : runway.threshold), centerlineErrorNm: frame.crossNm,
      glidepathErrorFt, stableApproach, eventRevision: this.eventRevision,
    })
  }

  private finish(outcome: MissionOutcome) {
    if (this.events.some((event) => event.type === 'mission_complete' || event.type === 'mission_failed')) return
    const success = outcome === 'landed'
    this.addDebrief('system', success ? 'Aircraft stopped safely' : `Mission ended: ${outcome.replaceAll('_', ' ')}`)
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
