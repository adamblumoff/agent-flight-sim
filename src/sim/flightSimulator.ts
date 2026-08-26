import type {
  ControlOwner,
  FlightDirectorState,
  FlightRoute,
  FlightScenario,
  FlightState,
  FlightStateListener,
  PilotInput,
  TraceActor,
  TraceEvent,
} from './types'

const FIXED_STEP_SECONDS = 1 / 60
const SNAPSHOT_INTERVAL_SECONDS = 0.1
const MAX_FRAME_SECONDS = 0.25
const MAX_TRACE_EVENTS = 250

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
  const earthRadiusNm = 3_440.065
  const latDelta = degreesToRadians(toLat - fromLat)
  const lonDelta = degreesToRadians(toLon - fromLon)
  const fromLatRad = degreesToRadians(fromLat)
  const toLatRad = degreesToRadians(toLat)
  const a =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(fromLatRad) * Math.cos(toLatRad) * Math.sin(lonDelta / 2) ** 2

  return earthRadiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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

const departure = Object.freeze({
  code: 'KPWK',
  name: 'Chicago Executive Airport',
  lat: 42.1143,
  lon: -87.9015,
  elevationFt: 647,
})

const arrival = Object.freeze({
  code: 'KMDW',
  name: 'Chicago Midway International Airport',
  lat: 41.7868,
  lon: -87.7522,
  elevationFt: 620,
})

export const KPWK_TO_KMDW_ROUTE: FlightRoute = Object.freeze({
  departure,
  arrival,
  distanceNm: distanceNm(departure.lat, departure.lon, arrival.lat, arrival.lon),
  initialHeadingDeg: bearingDeg(departure.lat, departure.lon, arrival.lat, arrival.lon),
})

const freezeState = (state: FlightState): FlightState =>
  Object.freeze({
    ...state,
    flightDirector: Object.freeze({ ...state.flightDirector }),
  })

const initialState = (): FlightState =>
  freezeState({
    lat: departure.lat,
    lon: departure.lon,
    altitudeFt: departure.elevationFt,
    airspeedKt: 0,
    verticalSpeedFpm: 0,
    headingDeg: KPWK_TO_KMDW_ROUTE.initialHeadingDeg,
    pitchDeg: 0,
    bankDeg: 0,
    throttle: 0,
    flapsDeg: 0,
    gearDown: true,
    controlOwner: 'human',
    flightDirector: {
      enabled: false,
      headingDeg: KPWK_TO_KMDW_ROUTE.initialHeadingDeg,
      altitudeFt: 3_000,
      airspeedKt: 115,
    },
    scenario: 'clear',
    routeProgress: 0,
  })

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

  getState = (): FlightState => this.state

  getSnapshot = (): FlightState => this.snapshot

  getTrace = (): readonly TraceEvent[] => this.trace

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
      this.record(actor, 'pilot_input_rejected', reason, {
        controlOwner: this.state.controlOwner,
      })
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

  setThrottle = (
    value: number,
    actor: TraceActor = 'human',
    reason = 'Set throttle',
  ): void => {
    const throttle = clamp(Number.isFinite(value) ? value : 0, 0, 1)
    this.record(actor, 'set_throttle', reason, { from: this.state.throttle, to: throttle })
    this.publish({ ...this.state, throttle })
  }

  setFlaps = (
    degrees: number,
    actor: TraceActor = 'human',
    reason = 'Set flaps',
  ): void => {
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
        Number.isFinite(targets.headingDeg)
          ? (targets.headingDeg as number)
          : current.headingDeg,
      ),
      altitudeFt: clamp(
        Number.isFinite(targets.altitudeFt)
          ? (targets.altitudeFt as number)
          : current.altitudeFt,
        arrival.elevationFt,
        18_000,
      ),
      airspeedKt: clamp(
        Number.isFinite(targets.airspeedKt)
          ? (targets.airspeedKt as number)
          : current.airspeedKt,
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
    this.record(actor, 'transfer_control', reason, {
      from: this.state.controlOwner,
      to: owner,
    })
    this.publish({
      ...this.state,
      controlOwner: owner,
      flightDirector:
        owner === 'agent'
          ? { ...this.state.flightDirector, enabled: true }
          : this.state.flightDirector,
    })
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
    this.record('system', 'reset', 'Reset flight at KPWK', { route: 'KPWK-KMDW' })
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
    const state = this.state
    const director = state.flightDirector
    let throttle = state.throttle

    if (state.controlOwner === 'agent' && director.enabled) {
      const altitudeError = director.altitudeFt - state.altitudeFt
      const desiredPitch = clamp(altitudeError / 230, -8, 11)
      this.pitchTargetDeg = desiredPitch
      this.bankTargetDeg = clamp(headingError(director.headingDeg, state.headingDeg) * 0.65, -28, 28)

      const desiredThrottle = clamp(
        director.airspeedKt / 155 + clamp(altitudeError / 10_000, -0.12, 0.12),
        0.15,
        1,
      )
      throttle = approach(throttle, desiredThrottle, 0.18 * dt)
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
    const progressBeforeMove = this.routeProgress(state.lat, state.lon)
    const groundElevationFt = this.groundElevation(progressBeforeMove)
    const liftAvailable = clamp((airspeedKt - 45) / 25, 0, 1)

    if (!this.airborne && airspeedKt > 58 && pitchDeg > 2.5) this.airborne = true

    let verticalSpeedFpm = 0
    let altitudeFt = groundElevationFt
    if (this.airborne) {
      const geometricClimbFpm =
        airspeedKt * 101.27 * Math.sin(degreesToRadians(pitchDeg)) * liftAvailable
      const lowSpeedSinkFpm = (1 - liftAvailable) * 1_050
      const instabilitySinkFpm = state.scenario === 'engine_instability' ? (1 - instability) * 420 : 0
      const targetVerticalSpeedFpm = clamp(
        geometricClimbFpm - lowSpeedSinkFpm - instabilitySinkFpm,
        -2_200,
        2_200,
      )
      verticalSpeedFpm = approach(
        state.verticalSpeedFpm,
        targetVerticalSpeedFpm,
        1_200 * dt,
      )
      altitudeFt = clamp(
        state.altitudeFt + (verticalSpeedFpm / 60) * dt,
        groundElevationFt,
        18_000,
      )

      if (altitudeFt <= groundElevationFt && verticalSpeedFpm <= 0) {
        this.airborne = false
        altitudeFt = groundElevationFt
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
    const routeProgress = this.routeProgress(lat, lon)

    this.state = freezeState({
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
      routeProgress,
    })
  }

  private routeProgress(lat: number, lon: number): number {
    const meanLatRad = degreesToRadians((departure.lat + arrival.lat) / 2)
    const routeX = (arrival.lon - departure.lon) * Math.cos(meanLatRad)
    const routeY = arrival.lat - departure.lat
    const positionX = (lon - departure.lon) * Math.cos(meanLatRad)
    const positionY = lat - departure.lat
    const routeLengthSquared = routeX * routeX + routeY * routeY

    return clamp((positionX * routeX + positionY * routeY) / routeLengthSquared, 0, 1)
  }

  private groundElevation(progress: number): number {
    return departure.elevationFt + (arrival.elevationFt - departure.elevationFt) * progress
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
    this.trace = Object.freeze([
      ...this.trace.slice(-(MAX_TRACE_EVENTS - 1)),
      event,
    ])
  }

  private publish(state: FlightState): void {
    this.state = freezeState(state)
    this.snapshot = this.state
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const flightSimulator = new FlightSimulator()
