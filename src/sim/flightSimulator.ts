import type {
  ControlOwner,
  FlightCommand,
  FlightCommandInput,
  FlightCommandReceipt,
  FlightDirectorState,
  FlightScenario,
  FlightState,
  FlightStateListener,
  MissionBrief,
  MissionFix,
  MissionFixId,
  MissionLeg,
  MissionNavigationState,
  MissionOutcome,
  MissionPhase,
  PilotInput,
  TraceActor,
  TraceEvent,
} from './types'

const FIXED_STEP_SECONDS = 1 / 60
const SNAPSHOT_INTERVAL_SECONDS = 0.1
const MAX_FRAME_SECONDS = 0.25
const MAX_TRACE_EVENTS = 250
const EARTH_RADIUS_NM = 3_440.065
const FEET_PER_NM = 6_076.12

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const approach = (value: number, target: number, maxChange: number) =>
  value < target
    ? Math.min(value + maxChange, target)
    : Math.max(value - maxChange, target)

const normalizeHeading = (degrees: number) => ((degrees % 360) + 360) % 360

const headingError = (target: number, current: number) =>
  ((target - current + 540) % 360) - 180

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180

const distanceNm = (fromLat: number, fromLon: number, toLat: number, toLon: number) => {
  const latDelta = degreesToRadians(toLat - fromLat)
  const lonDelta = degreesToRadians(toLon - fromLon)
  const fromLatRad = degreesToRadians(fromLat)
  const toLatRad = degreesToRadians(toLat)
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(fromLatRad) * Math.cos(toLatRad) * Math.sin(lonDelta / 2) ** 2

  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const bearingDeg = (fromLat: number, fromLon: number, toLat: number, toLon: number) => {
  const fromLatRad = degreesToRadians(fromLat)
  const toLatRad = degreesToRadians(toLat)
  const lonDelta = degreesToRadians(toLon - fromLon)
  const y = Math.sin(lonDelta) * Math.cos(toLatRad)
  const x =
    Math.cos(fromLatRad) * Math.sin(toLatRad) -
    Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(lonDelta)

  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI)
}

const airport = Object.freeze({
  code: 'KPWK',
  name: 'Chicago Executive Airport',
  lat: 42.1143,
  lon: -87.9015,
  elevationFt: 647,
})

const runwayThreshold = Object.freeze({ lat: 42.1143, lon: -87.91 })
const referenceLatRad = degreesToRadians(runwayThreshold.lat)

const localToPosition = (eastNm: number, northNm: number) =>
  Object.freeze({
    lat: runwayThreshold.lat + northNm / 60,
    lon: runwayThreshold.lon + eastNm / (60 * Math.cos(referenceLatRad)),
  })

const positionToLocal = (lat: number, lon: number) => ({
  eastNm: (lon - runwayThreshold.lon) * 60 * Math.cos(referenceLatRad),
  northNm: (lat - runwayThreshold.lat) * 60,
})

const fix = (
  id: MissionFixId,
  name: string,
  eastNm: number,
  northNm: number,
  altitudeFt: number,
  airspeedKt: number,
): MissionFix => Object.freeze({ id, name, ...localToPosition(eastNm, northNm), altitudeFt, airspeedKt })

const fixes = Object.freeze([
  fix('DEPART', 'Departure gate', 1.25, 0, 1_347, 95),
  fix('CROSSWIND', 'Crosswind turn', 1.35, 1.15, 1_847, 105),
  fix('NORTH_GATE', 'North gate', 0.35, 1.55, 2_147, 112),
  fix('DOWNWIND', 'Downwind gate', -1.1, 1.55, 2_147, 105),
  fix('BASE_GATE', 'Base gate', -1.35, 0.65, 1_497, 90),
  fix('FINAL_GATE', 'Final gate', -0.9, 0, 981, 82),
  fix('TOUCHDOWN', 'Touchdown aim point', 0.16, 0, airport.elevationFt, 72),
] satisfies readonly MissionFix[])

const fixesById = new Map(fixes.map((item) => [item.id, item]))
const runwayStart = Object.freeze({ ...runwayThreshold, altitudeFt: airport.elevationFt, airspeedKt: 0 })

const leg = (
  id: string,
  from: 'RUNWAY_START' | MissionFixId,
  to: MissionFixId,
  phase: MissionPhase,
): MissionLeg => {
  const fromPosition = from === 'RUNWAY_START' ? runwayStart : fixesById.get(from)!
  const toPosition = fixesById.get(to)!
  return Object.freeze({
    id,
    from,
    to,
    phase,
    distanceNm: Number(
      distanceNm(fromPosition.lat, fromPosition.lon, toPosition.lat, toPosition.lon).toFixed(2),
    ),
    altitudeFt: toPosition.altitudeFt,
    airspeedKt: toPosition.airspeedKt,
  })
}

const legs = Object.freeze([
  leg('RUNWAY_TO_DEPART', 'RUNWAY_START', 'DEPART', 'takeoff'),
  leg('DEPART_TO_CROSSWIND', 'DEPART', 'CROSSWIND', 'departure'),
  leg('CROSSWIND_TO_NORTH_GATE', 'CROSSWIND', 'NORTH_GATE', 'crosswind'),
  leg('NORTH_GATE_TO_DOWNWIND', 'NORTH_GATE', 'DOWNWIND', 'downwind'),
  leg('DOWNWIND_TO_BASE', 'DOWNWIND', 'BASE_GATE', 'base'),
  leg('BASE_TO_FINAL', 'BASE_GATE', 'FINAL_GATE', 'final'),
  leg('FINAL_TO_TOUCHDOWN', 'FINAL_GATE', 'TOUCHDOWN', 'final'),
] satisfies readonly MissionLeg[])

const runwayFarEnd = localToPosition(5_000 / FEET_PER_NM, 0)
const routeDistanceNm = Number(legs.reduce((total, item) => total + item.distanceNm, 0).toFixed(1))

export const COMPACT_TRAINING_MISSION: MissionBrief = Object.freeze({
  id: 'KPWK-COMPACT-PATTERN-01',
  name: 'KPWK compact training circuit',
  objective: 'Take off, fly the named pattern, land in the touchdown zone, and stop on the runway.',
  airport,
  runway: Object.freeze({
    id: 'TRAINING-09',
    thresholdLat: runwayThreshold.lat,
    thresholdLon: runwayThreshold.lon,
    farEndLat: runwayFarEnd.lat,
    farEndLon: runwayFarEnd.lon,
    headingDeg: 90,
    lengthFt: 5_000,
    widthFt: 250,
    elevationFt: airport.elevationFt,
    touchdownZoneStartFt: 650,
    touchdownZoneEndFt: 2_700,
  }),
  routeDistanceNm,
  estimatedDurationMinutes: 4.5,
  fixes,
  legs,
  constraints: Object.freeze([
    'Cross DEPART at or above 700 ft AGL.',
    'Capture 1,500 ft AGL and 105 to 120 kt by NORTH_GATE.',
    'Cross BASE_GATE near 90 kt with the gear down.',
    'Use FINAL_GATE to verify centerline, glidepath, speed, gear, and sink rate.',
  ]),
  successConditions: Object.freeze([
    'Touch down within the runway and touchdown zone.',
    'Gear down, bank within 7 degrees, and sink rate no more than 500 fpm at touchdown.',
    'Stay within runway bounds and stop below 5 kt.',
  ]),
  startingCommands: Object.freeze(['takeoff'] satisfies FlightCommand[]),
})

const getFix = (id: MissionFixId): MissionFix => fixesById.get(id)!

const legStart = (item: MissionLeg) =>
  item.from === 'RUNWAY_START' ? runwayStart : getFix(item.from)

const initialNavigation = (): MissionNavigationState => Object.freeze({
  phase: 'preflight',
  outcome: 'in_progress',
  activeLegId: null,
  nextFix: 'DEPART',
  distanceToNextFixNm: legs[0].distanceNm,
  alongTrackNm: 0,
  crossTrackErrorNm: 0,
  distanceToThresholdNm: 0,
  centerlineErrorNm: 0,
  glidepathErrorFt: 0,
  stableApproach: false,
  awaitingCommand: true,
  allowedCommands: Object.freeze(['takeoff'] satisfies FlightCommand[]),
})

const freezeState = (state: FlightState): FlightState =>
  Object.freeze({
    ...state,
    flightDirector: Object.freeze({ ...state.flightDirector }),
    mission: Object.freeze({
      ...state.mission,
      allowedCommands: Object.freeze([...state.mission.allowedCommands]),
    }),
  })

const initialState = (): FlightState =>
  freezeState({
    lat: runwayThreshold.lat,
    lon: runwayThreshold.lon,
    altitudeFt: airport.elevationFt,
    airspeedKt: 0,
    verticalSpeedFpm: 0,
    headingDeg: COMPACT_TRAINING_MISSION.runway.headingDeg,
    pitchDeg: 0,
    bankDeg: 0,
    throttle: 0,
    flapsDeg: 0,
    gearDown: true,
    controlOwner: 'human',
    flightDirector: {
      enabled: false,
      headingDeg: COMPACT_TRAINING_MISSION.runway.headingDeg,
      altitudeFt: getFix('DEPART').altitudeFt,
      airspeedKt: getFix('DEPART').airspeedKt,
    },
    scenario: 'clear',
    mission: initialNavigation(),
  })

interface GuidanceTarget {
  readonly id: MissionFixId
  readonly lat: number
  readonly lon: number
  readonly altitudeFt: number
  readonly airspeedKt: number
}

class FlightSimulator {
  private state = initialState()
  private snapshot = this.state
  private readonly listeners = new Set<FlightStateListener>()
  private trace: readonly TraceEvent[] = Object.freeze([])
  private nextTraceId = 1
  private elapsedSeconds = 0
  private pitchTargetDeg = 0
  private bankTargetDeg = 0
  private airborne = false
  private frameId: number | null = null
  private lastFrameTimeMs = 0
  private accumulatorSeconds = 0
  private snapshotAccumulatorSeconds = 0
  private missionPhase: MissionPhase = 'preflight'
  private missionOutcome: MissionOutcome = 'in_progress'
  private activeLegIndex: number | null = null
  private awaitingCommand = true
  private lastReachedFix: MissionFixId | null = null
  private landingAuthorized = false
  private customTarget: GuidanceTarget | null = null
  private customLegStart: GuidanceTarget | null = null
  private customLegId: string | null = null

  getState = (): FlightState => this.state

  getSnapshot = (): FlightState => this.snapshot

  getTrace = (): readonly TraceEvent[] => this.trace

  getMissionBrief = (): MissionBrief => COMPACT_TRAINING_MISSION

  subscribe = (listener: FlightStateListener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start = (): void => {
    if (this.frameId !== null || typeof requestAnimationFrame === 'undefined') return
    this.lastFrameTimeMs = performance.now()
    this.frameId = requestAnimationFrame(this.tick)
  }

  stop = (): void => {
    if (this.frameId === null) return
    cancelAnimationFrame(this.frameId)
    this.frameId = null
    this.accumulatorSeconds = 0
  }

  applyPilotInput = (
    input: PilotInput,
    actor: TraceActor = 'human',
    reason = 'Manual flight control input',
  ): boolean => {
    if (actor !== 'system' && actor !== this.state.controlOwner) {
      this.record(actor, 'pilot_input_rejected', reason, { controlOwner: this.state.controlOwner })
      this.publish(this.state)
      return false
    }

    const pitchDelta = clamp(input.pitchDelta ?? 0, -8, 8)
    const bankDelta = clamp(input.bankDelta ?? 0, -15, 15)
    this.pitchTargetDeg = clamp(this.pitchTargetDeg + pitchDelta, -12, 15)
    this.bankTargetDeg = clamp(this.bankTargetDeg + bankDelta, -35, 35)
    this.record(actor, 'apply_pilot_input', reason, { pitchDelta, bankDelta })
    this.publish(this.state)
    return true
  }

  setThrottle = (value: number, actor: TraceActor = 'human', reason = 'Set throttle'): void => {
    const throttle = clamp(Number.isFinite(value) ? value : 0, 0, 1)
    this.record(actor, 'set_throttle', reason, { from: this.state.throttle, to: throttle })
    this.publish({ ...this.state, throttle })
  }

  setFlaps = (degrees: number, actor: TraceActor = 'human', reason = 'Set flaps'): void => {
    const flapsDeg = clamp(Number.isFinite(degrees) ? degrees : 0, 0, 40)
    this.record(actor, 'set_flaps', reason, { from: this.state.flapsDeg, to: flapsDeg })
    this.publish({ ...this.state, flapsDeg })
  }

  setGear = (
    down: boolean,
    actor: TraceActor = 'human',
    reason = down ? 'Lower landing gear' : 'Raise landing gear',
  ): void => {
    this.record(actor, 'set_gear', reason, { from: this.state.gearDown, to: down })
    this.publish({ ...this.state, gearDown: down })
  }

  setFlightDirector = (
    targets: Partial<FlightDirectorState>,
    actor: TraceActor = 'agent',
    reason = 'Set flight director targets',
  ): void => {
    const current = this.state.flightDirector
    const flightDirector: FlightDirectorState = {
      enabled: targets.enabled ?? current.enabled,
      headingDeg: normalizeHeading(
        Number.isFinite(targets.headingDeg) ? (targets.headingDeg as number) : current.headingDeg,
      ),
      altitudeFt: clamp(
        Number.isFinite(targets.altitudeFt) ? (targets.altitudeFt as number) : current.altitudeFt,
        airport.elevationFt,
        18_000,
      ),
      airspeedKt: clamp(
        Number.isFinite(targets.airspeedKt) ? (targets.airspeedKt as number) : current.airspeedKt,
        55,
        160,
      ),
    }

    this.record(actor, 'set_flight_director', reason, { ...flightDirector })
    this.publish({ ...this.state, flightDirector })
  }

  transferControl = (
    owner: ControlOwner,
    actor: TraceActor = 'human',
    reason = owner === 'agent' ? 'Your controls' : 'My controls',
  ): void => {
    this.record(actor, 'transfer_control', reason, { from: this.state.controlOwner, to: owner })
    this.publish({
      ...this.state,
      controlOwner: owner,
      flightDirector: { ...this.state.flightDirector, enabled: owner === 'agent' },
    })
  }

  commandFlight = (
    input: FlightCommandInput,
    actor: TraceActor = 'agent',
  ): FlightCommandReceipt => {
    const reason = input.reason?.trim() || `Command ${input.command}`
    if (this.state.controlOwner !== 'agent') {
      return this.rejectCommand(input, actor, reason, 'Transfer control to the agent first.')
    }

    const allowed = this.allowedCommands()
    if (!allowed.includes(input.command)) {
      return this.rejectCommand(
        input,
        actor,
        reason,
        `${input.command} is not available during ${this.missionPhase}.`,
      )
    }

    let summary: string
    switch (input.command) {
      case 'takeoff':
        this.activateLeg(0, 'takeoff')
        this.missionOutcome = 'in_progress'
        summary = 'Takeoff roll started for DEPART.'
        this.publish({ ...this.state, throttle: 1, flapsDeg: 10, gearDown: true })
        break
      case 'proceed_to_fix': {
        const expected = this.lastReachedFix === 'CROSSWIND' ? 'NORTH_GATE' : 'CROSSWIND'
        if (input.target !== expected) {
          return this.rejectCommand(input, actor, reason, `The next required fix is ${expected}.`)
        }
        this.activateLeg(expected === 'CROSSWIND' ? 1 : 2, 'crosswind')
        this.missionOutcome = 'in_progress'
        summary = `Proceeding to ${expected}.`
        break
      }
      case 'enter_downwind':
        this.activateLeg(3, 'downwind')
        summary = 'Turning onto the downwind leg.'
        break
      case 'extend_downwind': {
        const current = positionToLocal(this.state.lat, this.state.lon)
        this.customLegStart = this.positionTarget('DOWNWIND', current.eastNm, current.northNm)
        this.customTarget = this.positionTarget('DOWNWIND', current.eastNm - 0.55, 1.55, 2_147, 105)
        this.customLegId = 'DOWNWIND_EXTENSION'
        this.activeLegIndex = null
        this.awaitingCommand = false
        summary = 'Downwind extended by 0.55 NM.'
        break
      }
      case 'begin_approach':
        this.activateLeg(4, 'base')
        summary = 'Approach started for BASE_GATE and FINAL_GATE.'
        this.publish({ ...this.state, gearDown: true, flapsDeg: 20 })
        break
      case 'land':
        this.activeLegIndex = 6
        this.awaitingCommand = false
        this.landingAuthorized = true
        summary = 'Landing cleared. Tracking the glidepath to the touchdown zone.'
        this.publish({ ...this.state, gearDown: true, flapsDeg: 30 })
        break
      case 'go_around': {
        const current = positionToLocal(this.state.lat, this.state.lon)
        this.customLegStart = this.positionTarget('DEPART', current.eastNm, current.northNm)
        this.customTarget = this.positionTarget('DEPART', 1.25, 0, 1_647, 95)
        this.customLegId = 'GO_AROUND_TO_DEPART'
        this.activeLegIndex = null
        this.awaitingCommand = false
        this.missionPhase = 'go_around'
        this.missionOutcome = 'go_around'
        this.landingAuthorized = false
        summary = 'Go-around started. Climbing toward DEPART.'
        this.publish({ ...this.state, throttle: 1, flapsDeg: 10, gearDown: false })
        break
      }
    }

    this.record(actor, 'command_flight', reason, { command: input.command, target: input.target })
    this.publish(this.state)
    return this.receipt(true, summary)
  }

  triggerScenario = (
    scenario: FlightScenario,
    actor: TraceActor = 'system',
    reason = scenario === 'clear' ? 'Clear active scenario' : 'Engine power is unstable',
  ): void => {
    this.record(actor, 'trigger_scenario', reason, { from: this.state.scenario, to: scenario })
    this.publish({ ...this.state, scenario })
  }

  reset = (): void => {
    this.missionPhase = 'preflight'
    this.missionOutcome = 'in_progress'
    this.activeLegIndex = null
    this.awaitingCommand = true
    this.lastReachedFix = null
    this.landingAuthorized = false
    this.customTarget = null
    this.customLegStart = null
    this.customLegId = null
    this.state = initialState()
    this.snapshot = this.state
    this.trace = Object.freeze([])
    this.nextTraceId = 1
    this.elapsedSeconds = 0
    this.pitchTargetDeg = 0
    this.bankTargetDeg = 0
    this.airborne = false
    this.accumulatorSeconds = 0
    this.snapshotAccumulatorSeconds = 0
    this.record('system', 'reset', 'Reset compact training circuit at KPWK', {
      mission: COMPACT_TRAINING_MISSION.id,
    })
    this.emit()
  }

  private readonly tick = (timeMs: number): void => {
    if (this.frameId === null) return

    const frameSeconds = Math.min((timeMs - this.lastFrameTimeMs) / 1_000, MAX_FRAME_SECONDS)
    this.lastFrameTimeMs = timeMs
    this.accumulatorSeconds += Math.max(0, frameSeconds)

    let advanced = false
    while (this.accumulatorSeconds >= FIXED_STEP_SECONDS) {
      this.advance(FIXED_STEP_SECONDS)
      this.accumulatorSeconds -= FIXED_STEP_SECONDS
      advanced = true
    }

    if (advanced && this.snapshotAccumulatorSeconds >= SNAPSHOT_INTERVAL_SECONDS) {
      this.snapshotAccumulatorSeconds = 0
      this.snapshot = this.state
      this.emit()
    }
    this.frameId = requestAnimationFrame(this.tick)
  }

  private advance(dt: number): void {
    this.elapsedSeconds += dt
    this.snapshotAccumulatorSeconds += dt
    let state = this.state
    let throttle = state.throttle

    const missionTerminal = this.missionPhase === 'complete' || this.missionPhase === 'failed'
    const holdingFinalForDecision = this.activeLegIndex === 6 && this.missionPhase === 'final'
    if (
      !missionTerminal &&
      state.controlOwner === 'agent' &&
      state.flightDirector.enabled &&
      (!this.awaitingCommand || holdingFinalForDecision)
    ) {
      state = this.applyMissionGuidance(state)
    }

    const director = state.flightDirector
    if (!missionTerminal && state.controlOwner === 'agent' && director.enabled) {
      const altitudeError = director.altitudeFt - state.altitudeFt
      this.pitchTargetDeg = clamp(altitudeError / 70, -8, 11)
      this.bankTargetDeg = clamp(headingError(director.headingDeg, state.headingDeg) * 0.65, -28, 28)

      const dragKt = (state.gearDown ? 16 : 0) + state.flapsDeg * 0.72
      const desiredThrottle = clamp(
        (director.airspeedKt + dragKt) / 160 + clamp(altitudeError / 10_000, -0.12, 0.12),
        0.15,
        1,
      )
      throttle = approach(throttle, desiredThrottle, 0.18 * dt)
    }

    if (this.missionPhase === 'takeoff' && !this.airborne) throttle = 1
    if (
      this.missionPhase === 'takeoff' &&
      this.airborne &&
      state.altitudeFt < getFix('DEPART').altitudeFt + 2
    ) {
      this.pitchTargetDeg = Math.max(this.pitchTargetDeg, 1.5)
    }
    if (this.activeLegIndex === 6 && this.missionPhase === 'final') {
      const glidepathErrorFt = director.altitudeFt - state.altitudeFt
      this.pitchTargetDeg = clamp(-3 + glidepathErrorFt / 80, -7, 1.5)
    }
    if (this.missionPhase === 'go_around') throttle = Math.max(throttle, 0.92)
    if (this.missionPhase === 'flare') {
      this.pitchTargetDeg = 1.5
      throttle = approach(throttle, 0.55, 0.8 * dt)
    }
    if (this.missionPhase === 'rollout') {
      this.pitchTargetDeg = 0
      const centerlineErrorNm = positionToLocal(state.lat, state.lon).northNm
      const rolloutHeadingDeg = normalizeHeading(90 + clamp(centerlineErrorNm * 400, -8, 8))
      this.bankTargetDeg = clamp(headingError(rolloutHeadingDeg, state.headingDeg) * 0.65, -8, 8)
      throttle = 0
    }
    if (missionTerminal) {
      this.pitchTargetDeg = 0
      this.bankTargetDeg = 0
      throttle = 0
    }

    const instability =
      state.scenario === 'engine_instability'
        ? clamp(0.52 + Math.sin(this.elapsedSeconds * 2.7) * 0.38, 0.08, 0.9)
        : 1
    const gearDragKt = state.gearDown ? 16 : 0
    const flapDragKt = state.flapsDeg * 0.72
    const targetAirspeedKt = clamp(throttle * 160 * instability - gearDragKt - flapDragKt, 0, 165)
    const airspeedKt = clamp(
      state.airspeedKt + (targetAirspeedKt - state.airspeedKt) * 0.22 * dt,
      0,
      170,
    )

    let pitchDeg = approach(state.pitchDeg, this.pitchTargetDeg, 8 * dt)
    let bankDeg = approach(state.bankDeg, this.bankTargetDeg, 22 * dt)
    if (state.scenario === 'engine_instability') {
      pitchDeg += Math.sin(this.elapsedSeconds * 6.1) * 0.018
      bankDeg += Math.sin(this.elapsedSeconds * 4.3) * 0.025
    }

    const turnRateDegPerSecond = clamp(
      (1_091 * Math.tan(degreesToRadians(bankDeg))) / Math.max(airspeedKt, 60),
      -7,
      7,
    )
    const headingDeg = normalizeHeading(state.headingDeg + turnRateDegPerSecond * dt)
    const liftAvailable = clamp((airspeedKt - 45) / 25, 0, 1)

    if (!this.airborne && airspeedKt > 58 && pitchDeg > 2.5) this.airborne = true

    let verticalSpeedFpm = 0
    let altitudeFt: number = airport.elevationFt
    let touchdownSinkFpm: number | null = null
    if (this.airborne) {
      const geometricClimbFpm =
        airspeedKt * 101.27 * Math.sin(degreesToRadians(pitchDeg)) * liftAvailable
      const lowSpeedSinkFpm = (1 - liftAvailable) * 1_050
      const instabilitySinkFpm = state.scenario === 'engine_instability' ? (1 - instability) * 420 : 0
      let targetVerticalSpeedFpm = clamp(
        geometricClimbFpm - lowSpeedSinkFpm - instabilitySinkFpm,
        -2_200,
        2_200,
      )
      if (this.missionPhase === 'flare') targetVerticalSpeedFpm = -250
      verticalSpeedFpm = approach(state.verticalSpeedFpm, targetVerticalSpeedFpm, 1_200 * dt)
      altitudeFt = clamp(
        state.altitudeFt + (verticalSpeedFpm / 60) * dt,
        airport.elevationFt,
        18_000,
      )

      if (altitudeFt <= airport.elevationFt && verticalSpeedFpm <= 0) {
        touchdownSinkFpm = verticalSpeedFpm
        this.airborne = false
        altitudeFt = airport.elevationFt
        verticalSpeedFpm = 0
        this.pitchTargetDeg = 0
        pitchDeg = Math.max(0, pitchDeg)
      }
    }

    const distanceThisStepNm = (airspeedKt / 3_600) * dt
    const headingRad = degreesToRadians(headingDeg)
    const lat = clamp(state.lat + (Math.cos(headingRad) * distanceThisStepNm) / 60, -90, 90)
    const lonDelta =
      (Math.sin(headingRad) * distanceThisStepNm) /
      Math.max(0.01, 60 * Math.cos(degreesToRadians(state.lat)))
    const lon = ((state.lon + lonDelta + 540) % 360) - 180

    state = {
      ...state,
      lat,
      lon,
      altitudeFt,
      airspeedKt,
      verticalSpeedFpm,
      headingDeg,
      pitchDeg: clamp(pitchDeg, -15, 18),
      bankDeg: clamp(bankDeg, -40, 40),
      throttle,
    }

    if (touchdownSinkFpm !== null) this.evaluateTouchdown(state, touchdownSinkFpm)
    this.updateMissionProgress(state)
    this.state = freezeState({ ...state, mission: this.navigationFor(state) })
  }

  private applyMissionGuidance(state: FlightState): FlightState {
    const target = this.guidanceTarget()
    if (!target) return state

    let altitudeFt = target.altitudeFt
    let airspeedKt = target.airspeedKt
    let headingDeg = bearingDeg(state.lat, state.lon, target.lat, target.lon)
    let flapsDeg = state.flapsDeg
    let gearDown = state.gearDown

    if (this.activeLegIndex === 4) {
      gearDown = true
      flapsDeg = 20
    } else if (this.activeLegIndex === 5) {
      gearDown = true
      flapsDeg = 30
    } else if (this.activeLegIndex === 6) {
      const local = positionToLocal(state.lat, state.lon)
      const touchdownAimNm = COMPACT_TRAINING_MISSION.runway.touchdownZoneStartFt / FEET_PER_NM
      const glideDistanceNm = Math.max(0, touchdownAimNm - local.eastNm)
      altitudeFt = airport.elevationFt + glideDistanceNm * FEET_PER_NM * Math.tan(degreesToRadians(3))
      airspeedKt = this.missionPhase === 'flare' ? 68 : 76
      headingDeg = normalizeHeading(90 + clamp(local.northNm * 55, -25, 25))
      gearDown = true
      flapsDeg = 30
    } else if (this.missionPhase === 'go_around') {
      gearDown = false
      flapsDeg = 10
    } else if (this.airborne && this.missionPhase !== 'takeoff') {
      gearDown = false
      flapsDeg = 10
    }

    if (this.activeLegIndex === 0) {
      const item = legs[this.activeLegIndex]
      const segment = this.navigationSegment(state, target)
      if (segment.alongTrackNm >= item.distanceNm - 0.1) {
        const start = legStart(item)
        headingDeg = bearingDeg(start.lat, start.lon, target.lat, target.lon)
      }
    }

    return {
      ...state,
      flapsDeg,
      gearDown,
      flightDirector: {
        enabled: true,
        headingDeg,
        altitudeFt,
        airspeedKt,
      },
    }
  }

  private updateMissionProgress(state: FlightState): void {
    if (this.missionPhase === 'rollout') {
      const local = positionToLocal(state.lat, state.lon)
      const runwayLengthNm = COMPACT_TRAINING_MISSION.runway.lengthFt / FEET_PER_NM
      const halfWidthNm = COMPACT_TRAINING_MISSION.runway.widthFt / FEET_PER_NM / 2
      if (local.eastNm > runwayLengthNm || Math.abs(local.northNm) > halfWidthNm) {
        this.finishMission('failed', 'runway_excursion', 'Aircraft left the runway during rollout.')
      } else if (state.airspeedKt < 5) {
        this.finishMission('complete', 'landed', 'Aircraft stopped on the runway.')
      }
      return
    }

    if (this.activeLegIndex === 6 && this.landingAuthorized && this.airborne) {
      const local = positionToLocal(state.lat, state.lon)
      const aglFt = state.altitudeFt - airport.elevationFt
      if (local.eastNm > -0.12 && aglFt < 60) this.missionPhase = 'flare'
    }

    if (
      this.activeLegIndex === 6 &&
      !this.landingAuthorized &&
      !this.awaitingCommand &&
      this.navigationFor(state).stableApproach
    ) {
      this.awaitingCommand = true
      this.record('system', 'mission_gate', 'Final is stable. Land or go around.', {
        fix: 'FINAL_GATE',
      })
      return
    }

    if (this.awaitingCommand) return
    const target = this.guidanceTarget()
    if (!target || !this.gateSatisfied(state, target)) return

    if (this.customTarget) {
      if (this.missionPhase === 'go_around') {
        this.completeGate('departure', 'DEPART', 'Go-around climb complete at DEPART.')
      } else {
        this.completeGate('downwind', 'DOWNWIND', 'Downwind extension complete.')
      }
      return
    }

    switch (this.activeLegIndex) {
      case 0:
        this.completeGate('departure', 'DEPART', 'DEPART reached. Choose the crosswind turn.')
        break
      case 1:
        this.completeGate('crosswind', 'CROSSWIND', 'CROSSWIND reached. Continue to NORTH_GATE.')
        break
      case 2:
        this.completeGate('crosswind', 'NORTH_GATE', 'NORTH_GATE reached. Choose when to enter downwind.')
        break
      case 3:
        this.completeGate('downwind', 'DOWNWIND', 'DOWNWIND reached. Begin or extend the approach.')
        break
      case 4:
        this.activeLegIndex = 5
        this.missionPhase = 'final'
        this.lastReachedFix = 'BASE_GATE'
        this.record('system', 'mission_gate', 'BASE_GATE reached', { nextFix: 'FINAL_GATE' })
        break
      case 5:
        this.activeLegIndex = 6
        this.missionPhase = 'final'
        this.lastReachedFix = 'FINAL_GATE'
        this.record('system', 'mission_gate', 'FINAL_GATE reached. Stabilizing on final.', {
          nextFix: 'TOUCHDOWN',
        })
        break
    }
  }

  private gateSatisfied(state: FlightState, target: GuidanceTarget): boolean {
    const segment = this.navigationSegment(state, target)
    const legDistanceNm =
      this.activeLegIndex === null ? distanceNm(state.lat, state.lon, target.lat, target.lon) : legs[this.activeLegIndex].distanceNm
    if (
      segment.alongTrackNm < legDistanceNm - 0.12 ||
      Math.abs(segment.crossTrackErrorNm) > 0.16
    ) {
      return false
    }
    const altitudeErrorFt = state.altitudeFt - target.altitudeFt
    switch (this.activeLegIndex) {
      case 0:
        return altitudeErrorFt >= 0
      case 1:
        return altitudeErrorFt >= -125
      case 2:
      case 3:
        return Math.abs(altitudeErrorFt) <= 175
      case 4:
        return altitudeErrorFt <= 175 && state.gearDown
      default:
        return true
    }
  }

  private evaluateTouchdown(state: FlightState, sinkFpm: number): void {
    if (!this.landingAuthorized || (this.missionPhase !== 'final' && this.missionPhase !== 'flare')) return

    const local = positionToLocal(state.lat, state.lon)
    const runway = COMPACT_TRAINING_MISSION.runway
    const halfWidthNm = runway.widthFt / FEET_PER_NM / 2
    const zoneStartNm = runway.touchdownZoneStartFt / FEET_PER_NM
    const zoneEndNm = runway.touchdownZoneEndFt / FEET_PER_NM
    const safe =
      local.eastNm >= zoneStartNm &&
      local.eastNm <= zoneEndNm &&
      Math.abs(local.northNm) <= halfWidthNm &&
      state.gearDown &&
      Math.abs(state.bankDeg) <= 7 &&
      sinkFpm >= -500

    this.landingAuthorized = false
    this.activeLegIndex = null
    this.awaitingCommand = false
    if (safe) {
      this.missionPhase = 'rollout'
      this.record('system', 'touchdown', 'Safe touchdown in the marked zone', {
        sinkRateFpm: Math.round(sinkFpm),
        centerlineErrorFt: Math.round(Math.abs(local.northNm) * FEET_PER_NM),
        distancePastThresholdFt: Math.round(local.eastNm * FEET_PER_NM),
      })
    } else {
      this.record('system', 'touchdown_rejected', 'Touchdown limits exceeded', {
        sinkRateFpm: Math.round(sinkFpm),
        bankDeg: Number(state.bankDeg.toFixed(1)),
        centerlineErrorFt: Math.round(Math.abs(local.northNm) * FEET_PER_NM),
        distancePastThresholdFt: Math.round(local.eastNm * FEET_PER_NM),
        gearDown: state.gearDown,
      })
      this.finishMission('failed', 'unsafe_touchdown', 'Touchdown did not meet the landing limits.')
    }
  }

  private finishMission(phase: MissionPhase, outcome: MissionOutcome, reason: string): void {
    if (this.missionPhase === phase && this.missionOutcome === outcome) return
    this.missionPhase = phase
    this.missionOutcome = outcome
    this.activeLegIndex = null
    this.awaitingCommand = true
    this.customTarget = null
    this.customLegStart = null
    this.customLegId = null
    this.record('system', 'mission_result', reason, { outcome })
  }

  private completeGate(phase: MissionPhase, fixId: MissionFixId, reason: string): void {
    this.missionPhase = phase
    this.activeLegIndex = null
    this.awaitingCommand = true
    this.lastReachedFix = fixId
    this.customTarget = null
    this.customLegStart = null
    this.customLegId = null
    this.record('system', 'mission_gate', reason, { fix: fixId })
  }

  private activateLeg(index: number, phase: MissionPhase): void {
    this.activeLegIndex = index
    this.missionPhase = phase
    this.awaitingCommand = false
    this.customTarget = null
    this.customLegStart = null
    this.customLegId = null
  }

  private guidanceTarget(): GuidanceTarget | null {
    if (this.customTarget) return this.customTarget
    if (this.activeLegIndex === null) return null
    return getFix(legs[this.activeLegIndex].to)
  }

  private positionTarget(
    id: MissionFixId,
    eastNm: number,
    northNm: number,
    altitudeFt = this.state.altitudeFt,
    airspeedKt = this.state.airspeedKt,
  ): GuidanceTarget {
    return { id, ...localToPosition(eastNm, northNm), altitudeFt, airspeedKt }
  }

  private allowedCommands(): readonly FlightCommand[] {
    if (this.missionPhase === 'preflight' && this.awaitingCommand) return Object.freeze(['takeoff'])
    if (this.missionPhase === 'departure' && this.awaitingCommand) return Object.freeze(['proceed_to_fix'])
    if (this.missionPhase === 'crosswind' && this.awaitingCommand) {
      return Object.freeze([this.lastReachedFix === 'NORTH_GATE' ? 'enter_downwind' : 'proceed_to_fix'])
    }
    if (this.missionPhase === 'downwind' && this.awaitingCommand) {
      return Object.freeze(['begin_approach', 'extend_downwind', 'go_around'])
    }
    if (this.missionPhase === 'final' && this.awaitingCommand) return Object.freeze(['land', 'go_around'])
    if (this.missionPhase === 'base' || this.missionPhase === 'final' || this.missionPhase === 'flare') {
      return Object.freeze(['go_around'])
    }
    return Object.freeze([])
  }

  private suggestedNextFix(): MissionFixId | null {
    const active = this.guidanceTarget()
    if (active) return active.id
    if (this.missionPhase === 'preflight') return 'DEPART'
    if (this.missionPhase === 'departure') return 'CROSSWIND'
    if (this.missionPhase === 'crosswind') {
      return this.lastReachedFix === 'NORTH_GATE' ? 'DOWNWIND' : 'NORTH_GATE'
    }
    if (this.missionPhase === 'downwind') return 'BASE_GATE'
    if (this.missionPhase === 'base') return 'FINAL_GATE'
    if (this.missionPhase === 'final' || this.missionPhase === 'flare') return 'TOUCHDOWN'
    return null
  }

  private navigationFor(state: FlightState): MissionNavigationState {
    const nextFix = this.suggestedNextFix()
    const target = this.guidanceTarget() ?? (nextFix ? getFix(nextFix) : null)
    const segment = this.navigationSegment(state, target)
    const local = positionToLocal(state.lat, state.lon)
    const thresholdDistanceNm = distanceNm(
      state.lat,
      state.lon,
      runwayThreshold.lat,
      runwayThreshold.lon,
    )
    const touchdownAimNm = COMPACT_TRAINING_MISSION.runway.touchdownZoneStartFt / FEET_PER_NM
    const glideDistanceNm = Math.max(0, touchdownAimNm - local.eastNm)
    const glidepathAltitudeFt =
      airport.elevationFt + glideDistanceNm * FEET_PER_NM * Math.tan(degreesToRadians(3))
    const glidepathErrorFt = state.altitudeFt - glidepathAltitudeFt
    const stableApproach =
      (this.missionPhase === 'final' || this.missionPhase === 'flare') &&
      state.gearDown &&
      state.flapsDeg >= 20 &&
      Math.abs(local.northNm) <= 0.06 &&
      Math.abs(glidepathErrorFt) <= 140 &&
      Math.abs(headingError(90, state.headingDeg)) <= 15 &&
      Math.abs(state.bankDeg) <= 12 &&
      state.airspeedKt >= 65 &&
      state.airspeedKt <= 100 &&
      state.verticalSpeedFpm >= -700 &&
      state.verticalSpeedFpm <= 250 &&
      (local.eastNm < -0.2 || (this.missionPhase === 'final' && this.awaitingCommand))

    return Object.freeze({
      phase: this.missionPhase,
      outcome: this.missionOutcome,
      activeLegId: this.customLegId ?? (this.activeLegIndex === null ? null : legs[this.activeLegIndex].id),
      nextFix,
      distanceToNextFixNm: target
        ? Number(distanceNm(state.lat, state.lon, target.lat, target.lon).toFixed(2))
        : null,
      alongTrackNm: Number(segment.alongTrackNm.toFixed(2)),
      crossTrackErrorNm: Number(segment.crossTrackErrorNm.toFixed(3)),
      distanceToThresholdNm: Number(thresholdDistanceNm.toFixed(2)),
      centerlineErrorNm: Number(local.northNm.toFixed(3)),
      glidepathErrorFt: Math.round(glidepathErrorFt),
      stableApproach,
      awaitingCommand: this.awaitingCommand,
      allowedCommands: this.allowedCommands(),
    })
  }

  private navigationSegment(
    state: FlightState,
    target: GuidanceTarget | null,
  ): { alongTrackNm: number; crossTrackErrorNm: number } {
    if (!target) return { alongTrackNm: 0, crossTrackErrorNm: 0 }

    let start: { lat: number; lon: number }
    if (this.customLegStart) {
      start = this.customLegStart
    } else if (this.activeLegIndex !== null) {
      start = legStart(legs[this.activeLegIndex])
    } else if (this.lastReachedFix) {
      start = getFix(this.lastReachedFix)
    } else {
      start = runwayStart
    }

    const meanLatRad = degreesToRadians((start.lat + target.lat) / 2)
    const endX = (target.lon - start.lon) * 60 * Math.cos(meanLatRad)
    const endY = (target.lat - start.lat) * 60
    const positionX = (state.lon - start.lon) * 60 * Math.cos(meanLatRad)
    const positionY = (state.lat - start.lat) * 60
    const length = Math.hypot(endX, endY)
    if (length < 0.001) return { alongTrackNm: 0, crossTrackErrorNm: 0 }

    return {
      alongTrackNm: (positionX * endX + positionY * endY) / length,
      crossTrackErrorNm: (positionX * endY - positionY * endX) / length,
    }
  }

  private rejectCommand(
    input: FlightCommandInput,
    actor: TraceActor,
    reason: string,
    summary: string,
  ): FlightCommandReceipt {
    this.record(actor, 'command_flight_rejected', reason, {
      command: input.command,
      target: input.target,
      phase: this.missionPhase,
      summary,
    })
    this.publish(this.state)
    return this.receipt(false, summary)
  }

  private receipt(accepted: boolean, summary: string): FlightCommandReceipt {
    const state = this.state
    return Object.freeze({
      accepted,
      summary,
      phase: state.mission.phase,
      nextFix: state.mission.nextFix,
      distanceNm: state.mission.distanceToNextFixNm,
      configuration: Object.freeze({ gearDown: state.gearDown, flapsDeg: state.flapsDeg }),
      allowedCommands: state.mission.allowedCommands,
      state,
    })
  }

  private record(
    actor: TraceActor,
    action: string,
    reason: string,
    details: Record<string, unknown>,
  ): void {
    const elapsedSeconds = Number(this.elapsedSeconds.toFixed(2))
    const event: TraceEvent = Object.freeze({
      id: this.nextTraceId++,
      time: elapsedSeconds,
      elapsedSeconds,
      actor,
      action,
      reason,
      details: Object.freeze({ ...details }),
    })
    this.trace = Object.freeze([...this.trace.slice(-(MAX_TRACE_EVENTS - 1)), event])
  }

  private publish(state: FlightState): void {
    this.state = freezeState({ ...state, mission: this.navigationFor(state) })
    this.snapshot = this.state
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const flightSimulator = new FlightSimulator()
