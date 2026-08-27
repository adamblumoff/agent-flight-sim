import type {
  ActionReceipt, AircraftConfigurationInput, AutopilotState, AutopilotTargetsInput,
  CheckrideSeed, ControlOwner, DebriefEvent, EvidenceSource, FlightEvent,
  FlightEventType, FlightEventWaitInput, FlightEventWaitResult, FlightEvidence,
  FlightState, FlightStateListener, MissionBrief, MissionOutcome, MissionPhase,
  PilotInput, RoutePlan, RouteState, RouteWaypoint, ScenarioConditions, TraceActor,
  TraceEvent,
} from './types'

const STEP = 1 / 60
const SNAPSHOT_INTERVAL = 0.1
const MAX_FRAME = 0.25
const MAX_WAIT_MS = 15_000
const EARTH_RADIUS_NM = 3_440.065
const FEET_PER_NM = 6_076.12
const RUNWAY_HEADING = 159
const KPWK_ELEVATION = 645

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const approach = (value: number, target: number, change: number) => value < target ? Math.min(value + change, target) : Math.max(value - change, target)
const radians = (degrees: number) => degrees * Math.PI / 180
const normalizeHeading = (degrees: number) => ((degrees % 360) + 360) % 360
const headingError = (target: number, current: number) => ((target - current + 540) % 360) - 180

const KPWK = Object.freeze({ code: 'KPWK' as const, name: 'Chicago Executive Airport', lat: 42.11255, lon: -87.89998, elevationFt: KPWK_ELEVATION })
const KPWK_THRESHOLD = Object.freeze({ lat: 42.123329, lon: -87.907126 })
const KPWK_FAR_END = Object.freeze({ lat: 42.110552, lon: -87.900405 })

export const SHARED_AUTONOMY_MISSION: MissionBrief = Object.freeze({
  id: 'SHARED-AUTONOMY-EMERGENCY-01',
  name: 'Rough running over Wheeling',
  objective: 'Assess the emergency, choose a safe airport, and land within five minutes.',
  start: 'Airborne on the runway 16 arrival at 1,700 feet and 105 knots.',
  deadlineSeconds: 300,
  airports: Object.freeze([KPWK]),
  runways: Object.freeze([
    Object.freeze({ id: 'KPWK-16', airport: 'KPWK' as const, thresholdLat: KPWK_THRESHOLD.lat, thresholdLon: KPWK_THRESHOLD.lon, farEndLat: KPWK_FAR_END.lat, farEndLon: KPWK_FAR_END.lon, headingDeg: 159, lengthFt: 5_001, widthFt: 150, elevationFt: KPWK_ELEVATION }),
  ]),
  availablePlans: Object.freeze(['return_kpwk'] as const),
  evidenceSources: Object.freeze(['weather', 'cockpit', 'traffic', 'passenger'] as const),
  successConditions: Object.freeze([
    'Check at least two evidence sources before selecting a route.',
    'Reach final with gear down and at least 20 degrees of flaps.',
    'Touch down below 90 knots and 600 feet per minute.',
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

const evidenceFor = (scenario: ScenarioConditions): Readonly<Record<EvidenceSource, FlightEvidence>> => Object.freeze({
  weather: Object.freeze({ source: 'weather', headline: 'Airport weather', detail: scenario.weather.summary, reliability: 'current' }),
  cockpit: Object.freeze({ source: 'cockpit', headline: 'Engine indications', detail: scenario.engine.summary, reliability: 'current' }),
  traffic: Object.freeze({ source: 'traffic', headline: 'Arrival traffic', detail: scenario.traffic.summary, reliability: 'current' }),
  passenger: Object.freeze({ source: 'passenger', headline: 'Cabin report', detail: scenario.passenger.summary, reliability: 'current' }),
})

const offsetPosition = (origin: { lat: number; lon: number }, bearing: number, distanceNm: number) => {
  const angular = distanceNm / EARTH_RADIUS_NM
  const bearingRad = radians(bearing)
  const lat1 = radians(origin.lat)
  const lon1 = radians(origin.lon)
  const lat = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearingRad))
  const lon = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat))
  return Object.freeze({ lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI })
}

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

const waypoint = (id: string, name: string, position: { lat: number; lon: number }, altitudeFt: number, airspeedKt: number): RouteWaypoint => Object.freeze({ id, name, ...position, altitudeFt, airspeedKt })

const routeFor = (plan: RoutePlan): RouteState => {
  if (plan === 'return_kpwk') {
    return Object.freeze({ plan, destination: 'KPWK', runway: '16', reason: null, activeWaypointIndex: 0, waypoints: Object.freeze([
      waypoint('KPWK_FINAL', 'Runway 16 final', offsetPosition(KPWK_THRESHOLD, 339, 1.5), 1_165, 82),
      waypoint('KPWK_TOUCHDOWN', 'Runway 16 touchdown', offsetPosition(KPWK_THRESHOLD, 159, 0.14), KPWK_ELEVATION, 70),
    ]) })
  }
  return Object.freeze({ plan, destination: null, runway: null, reason: null, activeWaypointIndex: 0, waypoints: Object.freeze([]) })
}

const initialAutopilot = (): AutopilotState => Object.freeze({ enabled: false, headingDeg: 159, altitudeFt: 1_700, airspeedKt: 105, verticalMode: 'level' })
const initialRoute = (): RouteState => Object.freeze({ plan: 'unassigned', destination: null, runway: null, waypoints: Object.freeze([]), activeWaypointIndex: 0, reason: null })

const initialState = (seed: CheckrideSeed): FlightState => {
  const start = offsetPosition(KPWK_THRESHOLD, 339, 3)
  const scenario = scenarios[seed]
  const autopilot = initialAutopilot()
  const fuel = seed === 81 ? 6.5 : 8.5
  return Object.freeze({
    ...start, altitudeFt: 1_700, airspeedKt: 105, verticalSpeedFpm: 0, headingDeg: 159,
    pitchDeg: 0, bankDeg: 0, throttle: 0.62, flapsDeg: 0, gearDown: false,
    elapsedSeconds: 0, fuelMinutesRemaining: fuel, controlOwner: 'human', handoffRequested: false,
    agentMode: 'idle', autopilot, route: initialRoute(), scenario,
    approval: Object.freeze({ status: 'none', question: null, requestedAction: null }),
    mission: Object.freeze({ phase: 'planning', outcome: 'in_progress', nextFix: null, distanceToNextFixNm: null, distanceToThresholdNm: distanceNm(start, KPWK_THRESHOLD), centerlineErrorNm: 0, glidepathErrorFt: 0, stableApproach: false, eventRevision: 0 }),
    checkride: Object.freeze({ seed, status: 'decision_required', objective: SHARED_AUTONOMY_MISSION.objective, deadlineSeconds: 300, fuelMinutesRemaining: fuel, alert: 'The engine is running rough. Weather, traffic, and a passenger problem complicate the return.', humanApproval: 'not_required', inspectedSources: Object.freeze([]), score: Object.freeze({ total: 100 }), decision: null }),
    debrief: Object.freeze({ status: 'in_progress', elapsedSeconds: 0, decision: 'unassigned', decisionReason: null, events: Object.freeze([]), landing: null }),
  })
}

interface EventWaiter { readonly afterRevision: number; readonly events: ReadonlySet<FlightEventType>; readonly resolve: (result: FlightEventWaitResult) => void; readonly timeout: ReturnType<typeof setTimeout> }

class FlightSimulator {
  private state = initialState(17)
  private snapshot = this.state
  private accumulator = 0
  private lastFrameMs: number | null = null
  private snapshotClock = 0
  private animationFrame: number | null = null
  private traceId = 1
  private eventRevision = 0
  private readonly listeners = new Set<FlightStateListener>()
  private readonly waiters = new Set<EventWaiter>()
  private trace: readonly TraceEvent[] = Object.freeze([])
  private events: readonly FlightEvent[] = Object.freeze([])

  getState = () => this.state
  getSnapshot = () => this.snapshot
  getTrace = () => this.trace
  getEventRevision = () => this.eventRevision
  getMissionBrief = () => SHARED_AUTONOMY_MISSION
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
    this.record('system', 'mission_started', `Emergency seed ${seed} started`, {})
    this.queueEvent('emergency_detected', this.state.checkride.alert!)
    this.publish(this.state)
  }

  inspectEvidence = (source: EvidenceSource): FlightEvidence => {
    const report = evidenceFor(this.state.scenario)[source]
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
    const autopilot = Object.freeze({ ...this.state.autopilot, enabled: owner === 'agent' })
    this.state = Object.freeze({ ...this.state, controlOwner: owner, handoffRequested: false, agentMode: owner === 'agent' ? 'thinking' : 'idle', autopilot })
    this.record(actor, 'control_transferred', reason, { owner })
    this.addDebrief(actor, owner === 'agent' ? 'Copilot took control' : 'Pilot took control')
    this.publish(this.state)
  }

  applyPilotInput = (input: PilotInput, actor: TraceActor = 'human', reason = 'Pilot input') => {
    this.takePilotControl(reason)
    this.state = Object.freeze({ ...this.state, pitchDeg: clamp(this.state.pitchDeg + (input.pitchDelta ?? 0), -12, 12), bankDeg: clamp(this.state.bankDeg + (input.bankDelta ?? 0), -35, 35) })
    this.record(actor, 'pilot_input', reason, { ...input })
    this.publish(this.state)
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
    if (plan === 'unassigned') return this.receipt(false, 'Choose return_kpwk.')
    if (actor === 'agent' && this.state.controlOwner !== 'agent') return this.receipt(false, 'The copilot does not have control.')
    if (actor === 'agent' && this.state.checkride.inspectedSources.length < 2) return this.receipt(false, 'Inspect at least two evidence sources before choosing a route.')
    const route = Object.freeze({ ...routeFor(plan), reason })
    const target = route.waypoints[0]
    const autopilot = target ? Object.freeze({ enabled: true, headingDeg: bearingDeg(this.state, target), altitudeFt: target.altitudeFt, airspeedKt: target.airspeedKt, verticalMode: target.altitudeFt < this.state.altitudeFt ? 'descend' as const : 'level' as const }) : this.state.autopilot
    this.state = Object.freeze({
      ...this.state, route, autopilot,
      agentMode: actor === 'agent' ? 'flying' : this.state.agentMode,
      mission: Object.freeze({ ...this.state.mission, phase: 'enroute', nextFix: target?.id ?? null, distanceToNextFixNm: target ? distanceNm(this.state, target) : null }),
      checkride: Object.freeze({ ...this.state.checkride, status: 'resolved', decision: plan }),
      debrief: Object.freeze({ ...this.state.debrief, decision: plan, decisionReason: reason }),
    })
    this.record(actor, 'route_selected', reason, { plan })
    this.addDebrief(actor, `Selected ${plan.replaceAll('_', ' ')}`)
    this.queueEvent('plan_updated', `${plan.replaceAll('_', ' ')} route loaded.`)
    this.publish(this.state)
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
    if (actor === 'human') this.takePilotControl(input.reason ?? 'Pilot changed configuration')
    this.state = Object.freeze({ ...this.state, gearDown: input.gearDown ?? this.state.gearDown, flapsDeg: input.flapsDeg ?? this.state.flapsDeg })
    this.record(actor, 'aircraft_configured', input.reason ?? 'Aircraft configuration updated', { gearDown: this.state.gearDown, flapsDeg: this.state.flapsDeg })
    this.publish(this.state)
    return this.receipt(true, `Gear ${this.state.gearDown ? 'down' : 'up'}, flaps ${this.state.flapsDeg}°.`)
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
    for (let elapsed = 0; elapsed < seconds; elapsed += STEP) this.advance(STEP)
    this.snapshot = this.state
    this.emit()
  }

  private readonly tick = (timeMs: number) => {
    if (this.lastFrameMs === null) this.lastFrameMs = timeMs
    this.accumulator += Math.min((timeMs - this.lastFrameMs) / 1_000, MAX_FRAME)
    this.lastFrameMs = timeMs
    while (this.accumulator >= STEP) {
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
    const scenario = this.state.scenario
    let { headingDeg: heading, bankDeg: bank, pitchDeg: pitch, throttle, airspeedKt: airspeed, verticalSpeedFpm: verticalSpeed } = this.state

    if (this.state.debrief.landing) {
      bank = approach(bank, 0, 60 * dt)
      pitch = approach(pitch, 0, 10 * dt)
      throttle = 0
      verticalSpeed = 0
    } else if (this.state.controlOwner === 'agent' && this.state.autopilot.enabled) {
      const target = this.state.autopilot
      bank = approach(bank, clamp(headingError(target.headingDeg, heading) * 0.65, -25, 25), 18 * dt)
      throttle = approach(throttle, clamp(0.52 + (target.airspeedKt - airspeed) * 0.025, 0.25, 1), 0.35 * dt)
      const altitudeError = target.altitudeFt - this.state.altitudeFt
      const desiredFpm = target.verticalMode === 'approach'
        ? clamp(-target.airspeedKt * 5.3 + altitudeError * 3, -700, -120)
        : target.verticalMode === 'level'
          ? clamp(altitudeError * 2, -400, 400)
          : clamp(altitudeError * 2.5, -850, 700)
      verticalSpeed = approach(verticalSpeed, desiredFpm, 420 * dt)
      pitch = approach(pitch, clamp(verticalSpeed / 130, -6, 7), 6 * dt)
    } else {
      verticalSpeed = approach(verticalSpeed, pitch * 110, 300 * dt)
      bank = approach(bank, 0, 3 * dt)
    }

    const drag = 0.36 + this.state.flapsDeg * 0.008 + (this.state.gearDown ? 0.12 : 0)
    const power = throttle * scenario.engine.maximumPower
    airspeed = clamp(airspeed + (power * 8.5 - drag * 5.8 - Math.max(0, pitch) * 0.08) * dt, 0, 150)
    const turnRate = airspeed > 20 ? 1_091 * Math.tan(radians(bank)) / airspeed : 0
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
    let touchdownJustOccurred = false

    if (altitude <= runway.elevation && verticalSpeed <= 0) {
      altitude = runway.elevation
      if (onRunway && this.state.gearDown && airspeed <= 90 && Math.abs(verticalSpeed) <= 600) {
        phase = 'rollout'
        verticalSpeed = 0
        pitch = approach(pitch, 0, 10 * dt)
        airspeed = Math.max(0, airspeed - (3.5 + (1 - throttle) * 7) * dt)
        if (!landing) {
          landing = Object.freeze({ runway: runway.id, sinkRateFpm: Math.round(Math.abs(this.state.verticalSpeedFpm)), airspeedKt: Math.round(this.state.airspeedKt), centerlineErrorFt: Math.round(Math.abs(frame.crossNm) * FEET_PER_NM), touchdownDistanceFt: Math.round(frame.alongNm * FEET_PER_NM), safe: true })
          touchdownJustOccurred = true
        }
        if (airspeed < 5) outcome = 'landed'
      } else outcome = onRunway ? 'unsafe_touchdown' : 'crashed'
    }
    if ((fuelMinutesRemaining <= 0 || elapsedSeconds >= SHARED_AUTONOMY_MISSION.deadlineSeconds) && outcome === 'in_progress') outcome = 'fuel_exhausted'

    const partial = { ...this.state, ...position, altitudeFt: altitude, airspeedKt: airspeed, verticalSpeedFpm: verticalSpeed, headingDeg: heading, pitchDeg: pitch, bankDeg: bank, throttle, elapsedSeconds, fuelMinutesRemaining, route: routeUpdate.route } as FlightState
    const mission = this.navigation(partial, phase, outcome, runway)
    const approachJustStabilized = mission.stableApproach && !this.state.mission.stableApproach
    const status = outcome === 'in_progress' ? 'in_progress' : outcome === 'landed' ? 'landed' : 'failed'
    this.state = Object.freeze({
      ...partial,
      autopilot: routeUpdate.autopilot, mission,
      checkride: Object.freeze({ ...this.state.checkride, fuelMinutesRemaining, status: status === 'in_progress' ? this.state.checkride.status : 'complete', score: Object.freeze({ total: status === 'landed' ? 100 : status === 'failed' ? 35 : this.state.checkride.score.total }) }),
      debrief: Object.freeze({ ...this.state.debrief, status, elapsedSeconds, landing }),
      agentMode: status === 'in_progress' ? this.state.agentMode : 'complete',
    })
    if (approachJustStabilized) this.queueEvent('approach_stable', `${runway.id} approach is stable.`)
    if (touchdownJustOccurred) this.queueEvent('touchdown', `Touchdown on ${runway.id}.`)
    if (outcome !== 'in_progress') this.finish(outcome)
  }

  private advanceRoute(position: { lat: number; lon: number }, altitudeFt: number): { route: RouteState; autopilot: AutopilotState; phase: MissionPhase } {
    const route = this.state.route
    const active = route.waypoints[route.activeWaypointIndex]
    if (!active || this.state.controlOwner !== 'agent') return { route, autopilot: this.state.autopilot, phase: this.state.mission.phase }
    const reached = distanceNm(position, active) < (active.id.includes('TOUCHDOWN') ? 0.06 : 0.12)
    const index = reached ? Math.min(route.activeWaypointIndex + 1, route.waypoints.length - 1) : route.activeWaypointIndex
    const next = route.waypoints[index]
    const final = next.id.includes('FINAL') || next.id.includes('TOUCHDOWN')
    const runway = this.runway()
    const targetAltitude = next.id.includes('TOUCHDOWN')
      ? runway.elevation + Math.tan(radians(3)) * distanceNm(position, next) * FEET_PER_NM
      : next.altitudeFt
    const autopilot = Object.freeze({ enabled: true, headingDeg: bearingDeg(position, next), altitudeFt: targetAltitude, airspeedKt: next.airspeedKt, verticalMode: final ? 'approach' as const : targetAltitude < altitudeFt ? 'descend' as const : 'level' as const })
    return { route: index === route.activeWaypointIndex ? route : Object.freeze({ ...route, activeWaypointIndex: index }), autopilot, phase: final ? 'approach' : 'enroute' }
  }

  private runway() {
    return { threshold: KPWK_THRESHOLD, heading: RUNWAY_HEADING, elevation: KPWK_ELEVATION, lengthFt: 5_001, id: 'KPWK 16' }
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
      distanceToThresholdNm: distanceNm(state, runway.threshold), centerlineErrorNm: frame.crossNm,
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
