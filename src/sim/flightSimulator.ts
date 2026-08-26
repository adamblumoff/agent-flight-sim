import type {
  CheckrideDecision,
  CheckrideDecisionReceipt,
  CheckrideEvidence,
  CheckrideEvidenceSource,
  CheckrideSeed,
  CheckrideState,
  ControlOwner,
  FlightCommand,
  FlightCommandInput,
  FlightCommandReceipt,
  FlightEvent,
  FlightEventType,
  FlightEventWaitInput,
  FlightEventWaitResult,
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
const MAX_FLIGHT_EVENTS = 40
const MAX_EVENT_WAIT_MS = 15_000
const AGENT_FLIGHT_TIME_SCALE = 4
const EARTH_RADIUS_NM = 3_440.065
const FEET_PER_NM = 6_076.12

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

const totalScore = (safety: number, judgment: number, fuel: number) =>
  Math.round(safety * 0.5 + judgment * 0.3 + fuel * 0.2)

const approach = (value: number, target: number, maxChange: number) =>
  value < target
    ? Math.min(value + maxChange, target)
    : Math.max(value - maxChange, target)

const normalizeHeading = (degrees: number) => ((degrees % 360) + 360) % 360

const headingError = (target: number, current: number) =>
  ((target - current + 540) % 360) - 180

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180

const wallClockNowMs = () =>
  typeof performance === 'undefined' ? Date.now() : performance.now()

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
  lat: 42.11255,
  lon: -87.89998,
  elevationFt: 645,
})

const runwayHeadingDeg = 159
const runwayHeadingRad = degreesToRadians(runwayHeadingDeg)
const runwayThreshold = Object.freeze({
  lat: 42.12332888888889,
  lon: -87.90712641666667,
})
const referenceLatRad = degreesToRadians(runwayThreshold.lat)

const localToPosition = (alongNm: number, crossNm: number) => {
  const worldEastNm =
    alongNm * Math.sin(runwayHeadingRad) - crossNm * Math.cos(runwayHeadingRad)
  const worldNorthNm =
    alongNm * Math.cos(runwayHeadingRad) + crossNm * Math.sin(runwayHeadingRad)
  return Object.freeze({
    lat: runwayThreshold.lat + worldNorthNm / 60,
    lon: runwayThreshold.lon + worldEastNm / (60 * Math.cos(referenceLatRad)),
  })
}

const positionToLocal = (lat: number, lon: number) => {
  const worldEastNm = (lon - runwayThreshold.lon) * 60 * Math.cos(referenceLatRad)
  const worldNorthNm = (lat - runwayThreshold.lat) * 60
  return {
    alongNm:
      worldEastNm * Math.sin(runwayHeadingRad) + worldNorthNm * Math.cos(runwayHeadingRad),
    crossNm:
      -worldEastNm * Math.cos(runwayHeadingRad) + worldNorthNm * Math.sin(runwayHeadingRad),
  }
}

const fix = (
  id: MissionFixId,
  name: string,
  alongNm: number,
  crossNm: number,
  altitudeFt: number,
  airspeedKt: number,
): MissionFix =>
  Object.freeze({ id, name, ...localToPosition(alongNm, crossNm), altitudeFt, airspeedKt })

const fixes = Object.freeze([
  fix('DEPART', 'Initial climb gate', 0.08, 0, 845, 75),
  fix('CROSSWIND', 'Crosswind turn', 0.22, 0.17, 900, 105),
  fix('NORTH_GATE', 'North gate', 0.08, 0.25, 950, 112),
  fix('DOWNWIND', 'Downwind gate', -0.4, 0.25, 950, 105),
  fix('BASE_GATE', 'Base gate', -0.32, 0.08, 850, 90),
  fix('FINAL_GATE', 'Final gate', -0.25, 0, 759, 82),
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

const runwayFarEnd = Object.freeze({
  lat: 42.11055175,
  lon: -87.90040494444445,
})
const routeDistanceNm = Number(legs.reduce((total, item) => total + item.distanceNm, 0).toFixed(1))

const CHECKRIDE_OBJECTIVE =
  'Get the aircraft safely on the ground within 12 minutes. Fuel is limited and a passenger may need medical attention.'

interface CheckrideScenario {
  readonly alert: string
  readonly decisions: readonly CheckrideDecision[]
  readonly bestDecision: CheckrideDecision
  readonly requiresHumanApproval: boolean
  readonly evidence: Readonly<Record<CheckrideEvidenceSource, CheckrideEvidence>>
}

const checkrideScenarios: Readonly<Record<CheckrideSeed, CheckrideScenario>> = Object.freeze({
  17: Object.freeze({
    alert: 'Destination weather has fallen below approach minimums.',
    decisions: Object.freeze(['divert', 'hold', 'continue'] satisfies CheckrideDecision[]),
    bestDecision: 'divert',
    requiresHumanApproval: false,
    evidence: Object.freeze({
      weather: Object.freeze({
        source: 'weather',
        headline: 'KPWK below minimums',
        detail: 'Visibility is 1/2 mile and falling. KUGN remains open with 5 miles visibility.',
        reliability: 'current',
      }),
      cockpit: Object.freeze({
        source: 'cockpit',
        headline: 'Power fluctuations detected',
        detail: 'Engine output is cycling between 52 and 90 percent of commanded power.',
        reliability: 'current',
      }),
      traffic: Object.freeze({
        source: 'traffic',
        headline: 'Direct diversion available',
        detail: 'Traffic can clear a direct northbound turn to KUGN now.',
        reliability: 'current',
      }),
      passenger: Object.freeze({
        source: 'passenger',
        headline: 'Passenger stable for now',
        detail: 'The passenger is conscious. Ground medical support can meet either airport.',
        reliability: 'stale',
      }),
    }),
  }),
  42: Object.freeze({
    alert: 'The passenger condition is worsening as a crosswind runway reopens.',
    decisions: Object.freeze(['request_priority', 'divert', 'hold'] satisfies CheckrideDecision[]),
    bestDecision: 'request_priority',
    requiresHumanApproval: true,
    evidence: Object.freeze({
      weather: Object.freeze({
        source: 'weather',
        headline: 'Strong crosswind at KPWK',
        detail: 'Runway 09 is open with a 19 knot crosswind. Conditions remain above minimums.',
        reliability: 'current',
      }),
      cockpit: Object.freeze({
        source: 'cockpit',
        headline: 'Aircraft systems normal',
        detail: 'No active faults. Fuel supports one approach and a nearby alternate.',
        reliability: 'current',
      }),
      traffic: Object.freeze({
        source: 'traffic',
        headline: 'Priority approach available',
        detail: 'Traffic can clear an immediate approach if the flight accepts the crosswind.',
        reliability: 'current',
      }),
      passenger: Object.freeze({
        source: 'passenger',
        headline: 'Medical urgency increased',
        detail: 'The passenger is now intermittently unresponsive. Minutes matter.',
        reliability: 'current',
      }),
    }),
  }),
  81: Object.freeze({
    alert: 'Fuel flow has risen while traffic adds a four minute arrival delay.',
    decisions: Object.freeze(['declare_minimum_fuel', 'hold', 'continue'] satisfies CheckrideDecision[]),
    bestDecision: 'declare_minimum_fuel',
    requiresHumanApproval: false,
    evidence: Object.freeze({
      weather: Object.freeze({
        source: 'weather',
        headline: 'KPWK remains legal',
        detail: 'Visibility is 3 miles and trending down. No runway closure is reported.',
        reliability: 'current',
      }),
      cockpit: Object.freeze({
        source: 'cockpit',
        headline: 'Fuel burn above plan',
        detail: 'Measured burn is 1.9 times planned. Current endurance is under 10 minutes.',
        reliability: 'current',
      }),
      traffic: Object.freeze({
        source: 'traffic',
        headline: 'Four minute sequence delay',
        detail: 'Two arrivals are ahead. Minimum fuel traffic can receive priority.',
        reliability: 'current',
      }),
      passenger: Object.freeze({
        source: 'passenger',
        headline: 'Passenger unchanged',
        detail: 'The passenger remains conscious and reports no new symptoms.',
        reliability: 'stale',
      }),
    }),
  }),
})

const initialCheckride = (seed: CheckrideSeed): CheckrideState => Object.freeze({
  seed,
  status: 'armed',
  objective: CHECKRIDE_OBJECTIVE,
  deadlineSeconds: 12 * 60,
  fuelMinutesRemaining: seed === 81 ? 10.5 : 13.5,
  alert: null,
  allowedDecisions: Object.freeze([]),
  decision: null,
  humanApproval: 'not_required',
  inspectedSources: Object.freeze([]),
  score: Object.freeze({
    total: 100,
    safety: 100,
    judgment: 100,
    fuel: 100,
    interventions: 0,
    recognitionSeconds: null,
  }),
})

export const COMPACT_TRAINING_MISSION: MissionBrief = Object.freeze({
  id: 'KPWK-DETERIORATING-ARRIVAL-01',
  name: 'The deteriorating arrival',
  objective: CHECKRIDE_OBJECTIVE,
  airport,
  runway: Object.freeze({
    id: 'TRAINING-16',
    thresholdLat: runwayThreshold.lat,
    thresholdLon: runwayThreshold.lon,
    farEndLat: runwayFarEnd.lat,
    farEndLon: runwayFarEnd.lon,
    headingDeg: runwayHeadingDeg,
    lengthFt: 5_001,
    widthFt: 150,
    elevationFt: airport.elevationFt,
    touchdownZoneStartFt: 650,
    touchdownZoneEndFt: 2_700,
  }),
  routeDistanceNm,
  estimatedDurationMinutes: 2,
  fixes,
  legs,
  constraints: Object.freeze([
    'Cross DEPART airborne and in a positive climb.',
    'Capture 300 ft AGL and 105 to 120 kt by NORTH_GATE.',
    'Cross BASE_GATE near 90 kt with the gear down.',
    'Use FINAL_GATE to verify centerline, glidepath, speed, gear, and sink rate.',
  ]),
  successConditions: Object.freeze([
    'Touch down within the runway and touchdown zone.',
    'Gear down, bank within 7 degrees, and sink rate no more than 500 fpm at touchdown.',
    'Stay within runway bounds and stop below 5 kt.',
  ]),
  startingCommands: Object.freeze(['takeoff'] satisfies FlightCommand[]),
  evidenceSources: Object.freeze([
    'weather',
    'cockpit',
    'traffic',
    'passenger',
  ] satisfies CheckrideEvidenceSource[]),
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
  eventRevision: 0,
})

const freezeState = (state: FlightState): FlightState =>
  Object.freeze({
    ...state,
    flightDirector: Object.freeze({ ...state.flightDirector }),
    mission: Object.freeze({
      ...state.mission,
      allowedCommands: Object.freeze([...state.mission.allowedCommands]),
    }),
    checkride: Object.freeze({
      ...state.checkride,
      allowedDecisions: Object.freeze([...state.checkride.allowedDecisions]),
      inspectedSources: Object.freeze([...state.checkride.inspectedSources]),
      score: Object.freeze({ ...state.checkride.score }),
    }),
  })

const initialState = (checkride = initialCheckride(17)): FlightState =>
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
    checkride,
  })

interface GuidanceTarget {
  readonly id: MissionFixId
  readonly lat: number
  readonly lon: number
  readonly altitudeFt: number
  readonly airspeedKt: number
}

interface PendingFlightEvent {
  readonly type: FlightEventType
  readonly message: string
}

interface FlightEventWaiter {
  readonly input: FlightEventWaitInput
  readonly resolve: (result: FlightEventWaitResult) => void
  readonly timeoutId: ReturnType<typeof setTimeout>
}

class FlightSimulator {
  private checkride = initialCheckride(17)
  private state = initialState(this.checkride)
  private snapshot = this.state
  private readonly listeners = new Set<FlightStateListener>()
  private readonly eventWaiters = new Set<FlightEventWaiter>()
  private trace: readonly TraceEvent[] = Object.freeze([])
  private flightEvents: readonly FlightEvent[] = Object.freeze([])
  private pendingFlightEvents: readonly PendingFlightEvent[] = Object.freeze([])
  private nextTraceId = 1
  private eventRevision = 0
  private elapsedSeconds = 0
  private checkrideFlightSeconds = 0
  private checkrideAlertWallTimeMs: number | null = null
  private physicalScenario: FlightScenario = 'clear'
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

  getEventRevision = (): number => this.eventRevision

  getMissionBrief = (): MissionBrief => COMPACT_TRAINING_MISSION

  inspectCheckrideEvidence = (source: CheckrideEvidenceSource): CheckrideEvidence => {
    if (this.checkride.status === 'armed') {
      throw new Error('No checkride alert is active. Wait for a system_alert event.')
    }
    const evidence = checkrideScenarios[this.checkride.seed].evidence[source]
    if (!evidence) throw new TypeError(`Unknown evidence source: ${source}`)

    if (!this.checkride.inspectedSources.includes(source)) {
      this.checkride = Object.freeze({
        ...this.checkride,
        inspectedSources: Object.freeze([...this.checkride.inspectedSources, source]),
      })
      this.record('agent', 'inspect_evidence', `Inspected ${source} evidence`, {
        source,
        reliability: evidence.reliability,
      })
      this.publish(this.state)
    }
    return evidence
  }

  waitForFlightEvent = (input: FlightEventWaitInput): Promise<FlightEventWaitResult> => {
    const afterRevision = Math.max(0, Math.floor(input.afterRevision))
    const timeoutMs = clamp(Math.floor(input.timeoutMs), 1_000, MAX_EVENT_WAIT_MS)
    const normalized = { ...input, afterRevision, timeoutMs }
    const available = this.flightEvents.find(
      (event) => event.revision > afterRevision && normalized.events.includes(event.type),
    )
    if (available) return Promise.resolve(this.eventResult(available))

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        const waiter = [...this.eventWaiters].find((candidate) => candidate.timeoutId === timeoutId)
        if (waiter) this.eventWaiters.delete(waiter)
        resolve(this.timeoutResult())
      }, timeoutMs)
      this.eventWaiters.add({ input: normalized, resolve, timeoutId })
    })
  }

  decideCheckride = (
    decision: CheckrideDecision,
    actor: TraceActor = 'agent',
    reason = `Choose ${decision}`,
  ): CheckrideDecisionReceipt => {
    const scenario = checkrideScenarios[this.checkride.seed]
    if (this.checkride.status !== 'decision_required') {
      return this.decisionReceipt(false, decision, 'No checkride decision is waiting.')
    }
    if (!this.checkride.allowedDecisions.includes(decision)) {
      return this.decisionReceipt(false, decision, `${decision} is not available for this event.`)
    }

    const correct = decision === scenario.bestDecision
    const alertWallTimeMs = this.checkrideAlertWallTimeMs ?? wallClockNowMs()
    const recognitionSeconds = Math.max(0, Number((
      (wallClockNowMs() - alertWallTimeMs) / 1_000
    ).toFixed(1)))
    const safety = correct ? 100 : decision === 'hold' ? 55 : 35
    const judgment = correct ? 100 : 45
    const fuel = Math.round(clamp((this.checkride.fuelMinutesRemaining / 10) * 100, 0, 100))
    const score = Object.freeze({
      total: totalScore(safety, judgment, fuel),
      safety,
      judgment,
      fuel,
      interventions: this.checkride.score.interventions,
      recognitionSeconds,
    })

    this.checkride = Object.freeze({
      ...this.checkride,
      status: correct && scenario.requiresHumanApproval ? 'awaiting_human' : 'resolved',
      allowedDecisions: Object.freeze([]),
      decision,
      humanApproval: correct && scenario.requiresHumanApproval ? 'pending' : 'not_required',
      fuelMinutesRemaining: decision === 'hold'
        ? Math.max(0, this.checkride.fuelMinutesRemaining - 2)
        : this.checkride.fuelMinutesRemaining,
      score,
    })
    this.record(actor, 'checkride_decision', reason, {
      seed: this.checkride.seed,
      decision,
      expected: scenario.bestDecision,
      correct,
      recognitionSeconds,
    })

    if (correct && scenario.requiresHumanApproval) {
      this.queueFlightEvent(
        'human_approval_required',
        'The agent requests priority handling for a risky crosswind approach. The human must approve or deny it.',
      )
    } else if (correct && decision === 'divert') {
      const current = positionToLocal(this.state.lat, this.state.lon)
      this.customLegStart = this.positionTarget(
        'DIVERSION_EXIT',
        current.alongNm,
        current.crossNm,
      )
      this.customTarget = this.positionTarget(
        'DIVERSION_EXIT',
        current.alongNm + 0.35,
        current.crossNm + 1,
        Math.max(this.state.altitudeFt, airport.elevationFt + 900),
        95,
      )
      this.customLegId = 'DIVERSION_EXIT'
      this.activeLegIndex = null
      this.awaitingCommand = false
      this.missionPhase = 'diversion'
      this.landingAuthorized = false
    } else {
      if (!correct && this.checkride.seed === 17) this.physicalScenario = 'engine_instability'
      this.queueFlightEvent(
        'decision_resolved',
        correct
          ? 'The decision is recorded. Continue the flight.'
          : 'The decision carries added risk. Continue the flight and manage the consequences.',
      )
      if (this.awaitingCommand) {
        this.queueFlightEvent('command_required', 'The decision is resolved. Continue to the next gate.')
      }
    }

    this.publish(this.state)
    return this.decisionReceipt(
      true,
      decision,
      correct ? 'Decision accepted.' : 'Decision accepted with a score penalty.',
    )
  }

  resolveHumanApproval = (
    approved: boolean,
    actor: TraceActor = 'human',
    reason = approved ? 'Approve priority approach' : 'Deny priority approach',
  ): boolean => {
    if (this.checkride.status !== 'awaiting_human') return false

    const score = Object.freeze({
      ...this.checkride.score,
      interventions: this.checkride.score.interventions + 1,
    })
    this.checkride = Object.freeze({
      ...this.checkride,
      status: approved ? 'resolved' : 'complete',
      humanApproval: approved ? 'approved' : 'denied',
      score: Object.freeze({ ...score, total: Math.max(0, score.total - 5) }),
    })
    this.record(actor, 'human_authority', reason, { approved })

    if (approved) {
      this.queueFlightEvent('human_approval_resolved', 'The human approved the priority approach.')
      if (this.awaitingCommand) {
        this.queueFlightEvent('command_required', 'The priority approach is approved. Continue to the next gate.')
      }
    } else {
      this.finishMission('complete', 'safe_diversion', 'The human denied the risky approach. The flight diverted.')
    }
    this.publish(this.state)
    return true
  }

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
    if (
      actor === 'human' &&
      this.state.controlOwner === 'human' &&
      this.missionPhase === 'preflight' &&
      throttle > 0
    ) {
      this.activateLeg(0, 'takeoff')
      this.missionOutcome = 'in_progress'
    }
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
        this.customLegStart = this.positionTarget('DOWNWIND', current.alongNm, current.crossNm)
        this.customTarget = this.positionTarget(
          'DOWNWIND',
          current.alongNm - 0.55,
          1.55,
          airport.elevationFt + 1_500,
          105,
        )
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
        this.customLegStart = this.positionTarget('DEPART', current.alongNm, current.crossNm)
        this.customTarget = this.positionTarget(
          'DEPART',
          1.25,
          0,
          airport.elevationFt + 1_000,
          95,
        )
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

  reset = (seed: CheckrideSeed = this.checkride.seed): void => {
    this.cancelEventWaiters()
    this.missionPhase = 'preflight'
    this.missionOutcome = 'in_progress'
    this.activeLegIndex = null
    this.awaitingCommand = true
    this.lastReachedFix = null
    this.landingAuthorized = false
    this.customTarget = null
    this.customLegStart = null
    this.customLegId = null
    this.checkride = initialCheckride(seed)
    this.state = initialState(this.checkride)
    this.snapshot = this.state
    this.trace = Object.freeze([])
    this.flightEvents = Object.freeze([])
    this.pendingFlightEvents = Object.freeze([])
    this.nextTraceId = 1
    this.eventRevision = 0
    this.elapsedSeconds = 0
    this.checkrideFlightSeconds = 0
    this.checkrideAlertWallTimeMs = null
    this.physicalScenario = 'clear'
    this.pitchTargetDeg = 0
    this.bankTargetDeg = 0
    this.airborne = false
    this.accumulatorSeconds = 0
    this.snapshotAccumulatorSeconds = 0
    this.record('system', 'reset', `Start checkride seed ${seed} at KPWK`, {
      mission: COMPACT_TRAINING_MISSION.id,
      seed,
    })
    this.queueFlightEvent('command_required', 'Checkride ready. Brief the mission, transfer control, and take off.')
    this.flushFlightEvents()
  }

  private readonly tick = (timeMs: number): void => {
    if (this.frameId === null) return

    const frameSeconds = Math.min((timeMs - this.lastFrameTimeMs) / 1_000, MAX_FRAME_SECONDS)
    this.lastFrameTimeMs = timeMs
    this.accumulatorSeconds += Math.max(0, frameSeconds)

    let advanced = false
    while (this.accumulatorSeconds >= FIXED_STEP_SECONDS) {
      const timeScale = this.state.controlOwner === 'agent' && !this.awaitingCommand
        ? AGENT_FLIGHT_TIME_SCALE
        : 1
      this.advance(FIXED_STEP_SECONDS * timeScale)
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
    if (this.shouldPauseForAgent()) return
    const missionTerminal = this.missionPhase === 'complete' || this.missionPhase === 'failed'
    if (missionTerminal) return

    this.elapsedSeconds += dt
    this.snapshotAccumulatorSeconds += dt
    const agentIsThinking = this.agentIsThinking()
    if (!agentIsThinking) this.checkrideFlightSeconds += dt
    let state = this.state
    let throttle = state.throttle

    if (this.checkride.status !== 'complete' && !agentIsThinking) {
      const highBurn = this.checkride.seed === 81 && this.checkride.status !== 'armed'
      const fuelMinutesRemaining = Math.max(
        0,
        this.checkride.fuelMinutesRemaining - (dt / 60) * (highBurn ? 1.9 : 1),
      )
      this.checkride = Object.freeze({ ...this.checkride, fuelMinutesRemaining })
      if (fuelMinutesRemaining <= 0) {
        this.finishMission('failed', 'unsafe_decision', 'The aircraft exhausted its usable fuel.')
      } else if (this.checkrideFlightSeconds >= this.checkride.deadlineSeconds) {
        this.finishMission('failed', 'unsafe_decision', 'The 12 minute checkride limit expired.')
      }
    }

    const holdingFinalForDecision = this.activeLegIndex === 6 && this.missionPhase === 'final'
    if (
      state.controlOwner === 'agent' &&
      state.flightDirector.enabled &&
      (!this.awaitingCommand || holdingFinalForDecision)
    ) {
      state = this.applyMissionGuidance(state)
    }

    const director = state.flightDirector
    if (state.controlOwner === 'agent' && director.enabled) {
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
      const centerlineErrorNm = positionToLocal(state.lat, state.lon).crossNm
      const rolloutHeadingDeg = normalizeHeading(
        runwayHeadingDeg + clamp(centerlineErrorNm * 400, -8, 8),
      )
      this.bankTargetDeg = clamp(headingError(rolloutHeadingDeg, state.headingDeg) * 0.65, -8, 8)
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
    if (
      this.checkride.status === 'armed' &&
      this.missionPhase === 'takeoff' &&
      airspeedKt >= 45
    ) {
      this.activateCheckrideAlert()
    }

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
    this.state = freezeState({
      ...state,
      scenario: this.physicalScenario,
      checkride: this.checkride,
      mission: this.navigationFor(state),
    })
    this.flushFlightEvents()
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
      const glideDistanceNm = Math.max(0, touchdownAimNm - local.alongNm)
      altitudeFt = airport.elevationFt + glideDistanceNm * FEET_PER_NM * Math.tan(degreesToRadians(3))
      airspeedKt = this.missionPhase === 'flare' ? 68 : 76
      headingDeg = normalizeHeading(
        runwayHeadingDeg + clamp(local.crossNm * 400, -25, 25),
      )
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
      if (local.alongNm > runwayLengthNm || Math.abs(local.crossNm) > halfWidthNm) {
        this.finishMission('failed', 'runway_excursion', 'Aircraft left the runway during rollout.')
      } else if (state.airspeedKt < 5) {
        this.finishMission('complete', 'landed', 'Aircraft stopped on the runway.')
      }
      return
    }

    if (this.activeLegIndex === 6 && this.landingAuthorized && this.airborne) {
      const local = positionToLocal(state.lat, state.lon)
      const aglFt = state.altitudeFt - airport.elevationFt
      if (local.alongNm > -0.12 && aglFt < 60) this.missionPhase = 'flare'
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
      this.queueFlightEvent('command_required', 'Final is stable. Land or go around.')
      return
    }

    if (this.awaitingCommand) return
    const target = this.guidanceTarget()
    if (!target || !this.gateSatisfied(state, target)) return

    if (this.customTarget) {
      if (this.missionPhase === 'go_around') {
        this.completeGate('departure', 'DEPART', 'Go-around climb complete at DEPART.')
      } else if (this.missionPhase === 'diversion') {
        this.finishMission('complete', 'safe_diversion', 'The aircraft crossed the diversion exit safely.')
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
        this.awaitingCommand = true
        this.record('system', 'mission_gate', 'FINAL_GATE reached. Land or go around.', {
          nextFix: 'TOUCHDOWN',
        })
        this.queueFlightEvent('command_required', 'FINAL_GATE reached. Land or go around.')
        break
    }
  }

  private gateSatisfied(state: FlightState, target: GuidanceTarget): boolean {
    const segment = this.navigationSegment(state, target)
    const legDistanceNm = this.customLegStart
      ? distanceNm(this.customLegStart.lat, this.customLegStart.lon, target.lat, target.lon)
      : this.activeLegIndex === null
        ? distanceNm(state.lat, state.lon, target.lat, target.lon)
        : legs[this.activeLegIndex].distanceNm
    if (
      segment.alongTrackNm < legDistanceNm - 0.12 ||
      Math.abs(segment.crossTrackErrorNm) > 0.16
    ) {
      return false
    }
    const altitudeErrorFt = state.altitudeFt - target.altitudeFt
    switch (this.activeLegIndex) {
      case 0:
        return this.airborne
      case 1:
        return altitudeErrorFt >= -175
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
      local.alongNm >= zoneStartNm &&
      local.alongNm <= zoneEndNm &&
      Math.abs(local.crossNm) <= halfWidthNm &&
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
        centerlineErrorFt: Math.round(Math.abs(local.crossNm) * FEET_PER_NM),
        distancePastThresholdFt: Math.round(local.alongNm * FEET_PER_NM),
      })
      this.queueFlightEvent('touchdown', 'Safe touchdown in the marked zone.')
    } else {
      this.record('system', 'touchdown_rejected', 'Touchdown limits exceeded', {
        sinkRateFpm: Math.round(sinkFpm),
        bankDeg: Number(state.bankDeg.toFixed(1)),
        centerlineErrorFt: Math.round(Math.abs(local.crossNm) * FEET_PER_NM),
        distancePastThresholdFt: Math.round(local.alongNm * FEET_PER_NM),
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
    const fuel = Math.round(clamp((this.checkride.fuelMinutesRemaining / 10) * 100, 0, 100))
    this.checkride = Object.freeze({
      ...this.checkride,
      status: 'complete',
      allowedDecisions: Object.freeze([]),
      score: Object.freeze({
        ...this.checkride.score,
        fuel,
        total: totalScore(
          this.checkride.score.safety,
          this.checkride.score.judgment,
          fuel,
        ),
      }),
    })
    this.record('system', 'mission_result', reason, { outcome })
    this.queueFlightEvent('mission_complete', reason)
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
    if (
      this.checkride.status === 'decision_required' ||
      this.checkride.status === 'awaiting_human'
    ) {
      return
    }
    this.queueFlightEvent('command_required', reason)
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
    alongNm: number,
    crossNm: number,
    altitudeFt = this.state.altitudeFt,
    airspeedKt = this.state.airspeedKt,
  ): GuidanceTarget {
    return { id, ...localToPosition(alongNm, crossNm), altitudeFt, airspeedKt }
  }

  private allowedCommands(): readonly FlightCommand[] {
    if (
      this.checkride.status === 'decision_required' ||
      this.checkride.status === 'awaiting_human' ||
      this.checkride.status === 'complete'
    ) {
      return Object.freeze([])
    }
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
    const glideDistanceNm = Math.max(0, touchdownAimNm - local.alongNm)
    const glidepathAltitudeFt =
      airport.elevationFt + glideDistanceNm * FEET_PER_NM * Math.tan(degreesToRadians(3))
    const glidepathErrorFt = state.altitudeFt - glidepathAltitudeFt
    const runwayHalfWidthNm = COMPACT_TRAINING_MISSION.runway.widthFt / FEET_PER_NM / 2
    const stableApproach =
      (this.missionPhase === 'final' || this.missionPhase === 'flare') &&
      state.gearDown &&
      state.flapsDeg >= 20 &&
      Math.abs(local.crossNm) <= runwayHalfWidthNm &&
      Math.abs(glidepathErrorFt) <= 140 &&
      Math.abs(headingError(runwayHeadingDeg, state.headingDeg)) <= 15 &&
      Math.abs(state.bankDeg) <= 12 &&
      state.airspeedKt >= 65 &&
      state.airspeedKt <= 100 &&
      state.verticalSpeedFpm >= -700 &&
      state.verticalSpeedFpm <= 250 &&
      (local.alongNm < -0.08 || (this.missionPhase === 'final' && this.awaitingCommand))

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
      centerlineErrorNm: Number(local.crossNm.toFixed(3)),
      glidepathErrorFt: Math.round(glidepathErrorFt),
      stableApproach,
      awaitingCommand: this.awaitingCommand,
      allowedCommands: this.allowedCommands(),
      eventRevision: this.eventRevision,
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

  private activateCheckrideAlert(): void {
    const scenario = checkrideScenarios[this.checkride.seed]
    this.checkrideAlertWallTimeMs = wallClockNowMs()
    this.checkride = Object.freeze({
      ...this.checkride,
      status: 'decision_required',
      alert: scenario.alert,
      allowedDecisions: scenario.decisions,
    })
    if (this.checkride.seed === 17) this.physicalScenario = 'engine_instability'
    this.record('system', 'checkride_alert', scenario.alert, { seed: this.checkride.seed })
    this.queueFlightEvent('system_alert', scenario.alert)
  }

  private shouldPauseForAgent(): boolean {
    if (this.missionPhase === 'preflight') return true
    if (this.missionPhase === 'complete' || this.missionPhase === 'failed') return false
    return this.state.controlOwner === 'agent' && this.awaitingCommand
  }

  private agentIsThinking(): boolean {
    if (this.state.controlOwner !== 'agent') return false
    return this.checkride.status === 'decision_required' ||
      this.checkride.status === 'awaiting_human'
  }

  private decisionReceipt(
    accepted: boolean,
    decision: CheckrideDecision,
    summary: string,
  ): CheckrideDecisionReceipt {
    return Object.freeze({
      accepted,
      summary,
      decision,
      humanApproval: this.checkride.humanApproval,
      score: this.checkride.score,
      eventRevision: this.eventRevision,
      state: this.state,
    })
  }

  private queueFlightEvent(type: FlightEventType, message: string): void {
    this.pendingFlightEvents = Object.freeze([...this.pendingFlightEvents, { type, message }])
  }

  private flushFlightEvents(): boolean {
    if (this.pendingFlightEvents.length === 0) return false

    const emitted = this.pendingFlightEvents.map(({ type, message }) => Object.freeze({
      revision: ++this.eventRevision,
      type,
      elapsedSeconds: Number(this.elapsedSeconds.toFixed(2)),
      message,
      phase: this.missionPhase,
      allowedCommands: this.allowedCommands(),
      allowedDecisions: this.checkride.allowedDecisions,
    } satisfies FlightEvent))
    this.pendingFlightEvents = Object.freeze([])
    this.flightEvents = Object.freeze([
      ...this.flightEvents,
      ...emitted,
    ].slice(-MAX_FLIGHT_EVENTS))
    this.state = freezeState({
      ...this.state,
      scenario: this.physicalScenario,
      checkride: this.checkride,
      mission: this.navigationFor(this.state),
    })
    this.snapshot = this.state

    for (const event of emitted) {
      for (const waiter of this.eventWaiters) {
        if (
          event.revision <= waiter.input.afterRevision ||
          !waiter.input.events.includes(event.type)
        ) {
          continue
        }
        clearTimeout(waiter.timeoutId)
        this.eventWaiters.delete(waiter)
        waiter.resolve(this.eventResult(event))
      }
    }
    this.emit()
    return true
  }

  private eventResult(event: FlightEvent): FlightEventWaitResult {
    return Object.freeze({
      revision: event.revision,
      event: event.type,
      message: event.message,
      phase: event.phase,
      allowedCommands: event.allowedCommands,
      allowedDecisions: event.allowedDecisions,
      state: this.state,
    })
  }

  private timeoutResult(): FlightEventWaitResult {
    return Object.freeze({
      revision: this.eventRevision,
      event: 'timeout',
      message: 'No matching flight event arrived before the bounded wait expired.',
      phase: this.missionPhase,
      allowedCommands: this.allowedCommands(),
      allowedDecisions: this.checkride.allowedDecisions,
      state: this.state,
    })
  }

  private cancelEventWaiters(): void {
    for (const waiter of this.eventWaiters) {
      clearTimeout(waiter.timeoutId)
      waiter.resolve(this.timeoutResult())
    }
    this.eventWaiters.clear()
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
      eventRevision: this.eventRevision,
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
    this.state = freezeState({
      ...state,
      scenario: this.physicalScenario,
      checkride: this.checkride,
      mission: this.navigationFor(state),
    })
    this.snapshot = this.state
    if (!this.flushFlightEvents()) this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const flightSimulator = new FlightSimulator()
