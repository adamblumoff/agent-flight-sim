import '@fontsource-variable/sora'
import '@fontsource-variable/kode-mono'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Eye, Glasses, MapPin, Orbit, Plane, Timer, Trophy, Volume2, VolumeX, Wind } from 'lucide-react'
import {
  CopilotPanel,
  type CopilotDebrief,
  type CopilotObservation,
} from './components/copilot-panel'
import {
  OwnershipControl,
  type OwnershipMode,
} from './components/ownership-control'
import { Button } from './components/ui/button'
import { Slider } from './components/ui/slider'
import { FlightMinimap } from './components/flight-minimap'
import { FlightCompass } from './components/flight-compass'
import { A380_ENVELOPE } from './sim/a380Envelope'
import { flightAudio } from './audio/flightAudio'
import { flightSimulator } from './sim/flightSimulator'
import type { FlightState, RoutePlan } from './sim/types'
import { useWebMcp } from './webmcp/useWebMcp'
import type { FlightCameraMode, FlightWorldStatus } from './world/FlightWorld'

const FlightWorld = lazy(() => import('./world/FlightWorld'))
const flapSettings = [0, 10, 20, 30] as const

const cameraOptions: ReadonlyArray<{
  mode: FlightCameraMode
  label: string
  icon: typeof Eye
}> = [
  { mode: 'chase', label: 'Chase view', icon: Eye },
  { mode: 'cockpit', label: 'Cockpit view', icon: Glasses },
  { mode: 'free', label: 'Free camera', icon: Orbit },
]

const routePlanLabels: Record<RoutePlan, string> = {
  unassigned: 'Route pending',
  continue_klak: 'Lakeside Municipal',
  return_kpwk: 'Return to KPWK',
}

const formatLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase())

const formatElapsed = (seconds: number) => {
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

const formatAngleMagnitude = (degrees: number) => (Math.abs(degrees) < 0.05 ? 0 : Math.abs(degrees)).toFixed(1)

const pitchDirection = (degrees: number) => degrees > 0.05 ? '° UP' : degrees < -0.05 ? '° DN' : '° LVL'
const bankDirection = (degrees: number) => degrees > 0.05 ? '° R' : degrees < -0.05 ? '° L' : '° LVL'

const deductionLabel = (id: string) => {
  if (id === 'mission-overtime') return 'overtime'
  if (id === 'decision-timeout') return 'late decision'
  if (id.startsWith('configuration-')) return 'configuration'
  if (id.startsWith('high-g-')) return 'high G'
  if (id.startsWith('jerk-')) return 'abrupt input'
  if (id === 'hard-landing') return 'hard landing'
  if (id === 'off-center-landing') return 'off center'
  return id.replaceAll('-', ' ')
}

function deriveObservations(state: FlightState): readonly CopilotObservation[] {
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

function deriveRecommendation(state: FlightState): string {
  if (state.mission.phase === 'preflight') return state.route.plan === 'unassigned'
    ? 'File the Lakeside Municipal runway 22 route before beginning the takeoff roll.'
    : 'The Lakeside route is filed. Apply power when you are ready to begin the takeoff roll.'
  if (state.mission.phase === 'takeoff') return 'Climb through 1,000 feet, clean up the aircraft, then decide who flies the arrival.'
  if (!state.procedure.compliant) return state.procedure.instruction
  if (state.mission.routeStatus === 'stalled') return 'The active leg is no longer converging. Rebuild it from the current position instead of continuing the orbit.'
  if (state.checkride.status === 'armed') return 'Departure is normal. Maintain the climb and monitor for changes.'
  if (state.controlOwner === 'human' && state.route.plan === 'return_kpwk') {
    return 'The safest emergency route was loaded automatically. Fly the active checkpoints to KPWK runway 16.'
  }
  if (state.approval.status === 'pending') {
    return state.approval.requestedAction ?? 'Hold the current flight path until you decide.'
  }
  if (state.route.reason) return state.route.reason
  if (state.agentMode === 'requested' || state.agentMode === 'thinking') {
    return 'Check the current conditions before changing the route or aircraft configuration.'
  }
  if (state.scenario.engine.health === 'failing' || state.scenario.passenger.condition === 'critical') {
    return 'Commit to the nearby runway promptly and configure early for landing.'
  }
  return 'Verify that the nearby runway remains usable, then commit to the return.'
}

function derivePlan(state: FlightState): readonly string[] {
  if (state.mission.phase === 'preflight' || state.mission.phase === 'takeoff') {
    return [
      'File and fly the Lakeside Municipal runway 22 route, about ten minutes away.',
      'Take off from North Field runway 18, clean up the aircraft, and monitor for changes.',
    ]
  }
  if (state.route.plan === 'unassigned') {
    if (state.checkride.status === 'armed') {
      return [
        'Complete the normal departure and clean up the aircraft.',
        'Maintain the climb while monitoring for new conditions.',
      ]
    }
    return [
      'Read the combined emergency context and compare the two usable routes.',
      'Commit to one route, then configure the aircraft for the selected runway.',
    ]
  }

  if (state.mission.routeStatus === 'stalled') {
    return [
      'Rebuild the active leg with a direct intercept or wider pattern.',
      'Resume route guidance after the new checkpoint is loaded.',
    ]
  }

  if (!state.procedure.compliant) {
    return [
      state.procedure.instruction,
      'Verify the configuration, then continue to the active route fix.',
    ]
  }

  const remainingWaypoints = state.route.waypoints.slice(state.route.activeWaypointIndex)
  if (remainingWaypoints.length > 0) {
    return remainingWaypoints.slice(0, 3).map((waypoint) =>
      `${waypoint.name} · ${waypoint.altitudeFt.toLocaleString()} ft · ${waypoint.airspeedKt} kt`
    )
  }

  return [
    `${routePlanLabels[state.route.plan]}${state.route.runway ? ` for runway ${state.route.runway}` : ''}.`,
  ]
}

function deriveAction(state: FlightState): string {
  if (state.mission.phase === 'preflight') return state.route.plan === 'unassigned' ? 'Waiting for the preflight route.' : 'Preflight route filed; ready for takeoff.'
  if (state.mission.phase === 'takeoff' && state.aircraftPhase === 'takeoff_roll') return `Accelerating on runway 18. Rotate near ${A380_ENVELOPE.rotateSpeedKt} knots.`
  if (state.approval.status === 'pending') {
    return `Maintaining ${Math.round(state.headingDeg).toString().padStart(3, '0')}° while you decide.`
  }
  if (state.checkride.status === 'armed') return 'Normal departure. Monitoring the aircraft and surrounding conditions.'
  if (state.mission.routeStatus === 'stalled') return 'Route progress stalled. Waiting for a leg rebuild.'
  if (state.controlOwner === 'human' && state.route.plan === 'return_kpwk') {
    const waypoint = state.route.waypoints[state.route.activeWaypointIndex]
    return waypoint
      ? `You are flying. Follow the active route to ${waypoint.name}.`
      : 'You are flying the emergency return to KPWK runway 16.'
  }
  if (state.agentMode === 'requested' || state.agentMode === 'thinking') {
    return 'Reading the emergency context and comparing the available routes.'
  }
  if (!state.procedure.compliant) return state.procedure.instruction
  if (state.controlOwner === 'agent' && state.autopilot.enabled) {
    const waypoint = state.route.waypoints[state.route.activeWaypointIndex]
    const target = waypoint?.name ?? state.route.destination ?? 'assigned route'
    return `Tracking ${target} at ${Math.round(state.autopilot.headingDeg).toString().padStart(3, '0')}°, ${Math.round(state.autopilot.altitudeFt).toLocaleString()} ft, ${Math.round(state.autopilot.airspeedKt)} kt.`
  }
  if (state.controlOwner === 'agent') return 'Holding the current flight path while the next action is selected.'
  return 'Monitoring the aircraft and emergency conditions while you fly.'
}

function deriveHeadline(state: FlightState): string {
  if (state.mission.phase === 'preflight') return 'Preflight route required'
  if (state.mission.phase === 'takeoff') return 'Departing runway 18'
  if (state.checkride.status === 'armed') return 'Normal departure'
  if (state.approval.status === 'pending') return 'Holding for your decision'
  if (state.agentMode === 'requested' || state.agentMode === 'thinking') return 'Assessing the emergency'
  if (state.agentMode === 'flying') {
    return state.route.destination ? `Flying to ${state.route.destination}` : 'Managing the flight'
  }
  return state.scenario.engine.health === 'normal' ? 'Ready when you are' : 'Emergency in progress'
}

function deriveDebrief(state: FlightState): CopilotDebrief | null {
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
    elapsed: formatElapsed(state.debrief.elapsedSeconds),
    score: `${state.checkride.score.total}/100`,
    decision: routePlanLabels[state.debrief.decision],
    summary: landingSummary,
    events: state.debrief.events.slice(-4).map((event) => event.summary),
    deductions: state.checkride.score.deductions.map((deduction) => ({
      elapsed: formatElapsed(deduction.elapsedSeconds),
      label: deductionLabel(deduction.id),
      points: deduction.points,
      reason: deduction.reason,
    })),
  }
}

function deriveOwnershipMode(state: FlightState, webMcpReady: boolean): OwnershipMode {
  if (state.controlOwner === 'agent') {
    if (state.agentMode === 'complete') return 'complete'
    return state.agentMode === 'thinking' ? 'thinking' : 'flying'
  }
  if (state.handoffRequested || state.agentMode === 'requested') return 'handoff_pending'
  return webMcpReady ? 'human' : 'unavailable'
}

function InstrumentStat({
  label,
  value,
  unit,
}: {
  readonly label: string
  readonly value: string
  readonly unit: string
}) {
  return (
    <div className="instrument-stat">
      <span>{label}</span>
      <div className="instrument-value">
        <strong>{value}</strong>
        <small>{unit}</small>
      </div>
    </div>
  )
}

export default function App() {
  const compassRef = useRef<HTMLDivElement>(null)
  const state = useSyncExternalStore(
    flightSimulator.subscribe,
    flightSimulator.getSnapshot,
    flightSimulator.getSnapshot,
  )
  const { status: webMcpStatus, activities } = useWebMcp()
  const [cameraMode, setCameraMode] = useState<FlightCameraMode>('chase')
  const [audioVolume, setAudioVolume] = useState(50)
  const lastAudibleVolumeRef = useRef(50)
  const [showTakeoffBrief, setShowTakeoffBrief] = useState(true)
  const [worldStatus, setWorldStatus] = useState<FlightWorldStatus>({
    kind: 'loading',
    message: 'Loading the flight world.',
  })

  useEffect(() => {
    flightSimulator.start()
    flightAudio.start()
    return () => {
      flightAudio.stop()
      flightSimulator.stop()
    }
  }, [])

  const toggleHandoff = useCallback(() => {
    const current = flightSimulator.getState()
    if (current.controlOwner === 'agent') {
      flightSimulator.transferControl('human', 'human', 'Pilot took back control')
    } else if (current.handoffRequested) {
      flightSimulator.cancelAgentHandoff('human', 'Pilot canceled the copilot handoff')
    } else {
      flightSimulator.requestAgentHandoff('human', 'Pilot asked the copilot to take control')
    }
  }, [])

  const resolveApproval = useCallback((approved: boolean) => {
    flightSimulator.resolveHumanApproval(
      approved,
      'human',
      approved ? 'Pilot approved the requested action' : 'Pilot declined the requested action',
    )
  }, [])

  const resetScenario = useCallback(() => {
    flightSimulator.reset()
    setShowTakeoffBrief(true)
  }, [])

  const changeAudioVolume = useCallback((volume: number) => {
    const nextVolume = Math.max(0, Math.min(100, Math.round(volume)))
    if (nextVolume > 0) lastAudibleVolumeRef.current = nextVolume
    setAudioVolume(nextVolume)
    flightAudio.setVolume(nextVolume / 100)
  }, [])

  const toggleAudio = useCallback(() => {
    changeAudioVolume(audioVolume === 0 ? lastAudibleVolumeRef.current : 0)
  }, [audioVolume, changeAudioVolume])

  const filePreflightRoute = useCallback(() => {
    flightSimulator.setRoute('continue_klak', 'Pilot filed the normal route to Lakeside Municipal runway 22 before departure.', 'human')
    setShowTakeoffBrief(false)
  }, [])

  useEffect(() => {
    if (state.mission.phase !== 'preflight') setShowTakeoffBrief(false)
  }, [state.mission.phase])

  useEffect(() => {
    const heldFlightKeys = new Set<string>()

    const updatePilotControls = () => {
      if (flightSimulator.getState().controlOwner !== 'human') {
        heldFlightKeys.clear()
        flightSimulator.releasePilotControls()
        return
      }
      flightSimulator.setPilotControls({
        pitchAxis: Number(heldFlightKeys.has('w')) - Number(heldFlightKeys.has('s')),
        bankAxis: Number(heldFlightKeys.has('d')) - Number(heldFlightKeys.has('a')),
      }, 'human', 'Pilot held controls')
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (showTakeoffBrief) return
      const target = event.target
      if (target instanceof HTMLElement && target.matches('input:not([type="range"]), textarea, select, [contenteditable="true"]')) return

      const current = flightSimulator.getState()
      const key = event.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'w', 'a', 's', 'd', 'f', 'g', 't', 'x'].includes(key)) event.preventDefault()

      if (current.controlOwner === 'human') {
        if (['w', 'a', 's', 'd'].includes(key) && !event.repeat) {
          heldFlightKeys.add(key)
          updatePilotControls()
        }
        if (key === 'arrowup') flightSimulator.setThrottle(current.throttle + 0.05, 'human', 'Pilot throttle input')
        if (key === 'arrowdown') flightSimulator.setThrottle(current.throttle - 0.05, 'human', 'Pilot throttle input')
        if (key === 'g') flightSimulator.setGear(!current.gearDown, 'human', 'Pilot gear command')
        if (key === 'x') flightSimulator.levelPilotAttitude('human', 'Pilot pressed the level-flight shortcut')
        if (key === 'f') {
          const index = flapSettings.indexOf(current.flapsDeg as (typeof flapSettings)[number])
          flightSimulator.setFlaps(flapSettings[(index + 1) % flapSettings.length], 'human', 'Pilot flap command')
        }
      }

      if (key === 't' && (current.controlOwner === 'agent' || webMcpStatus === 'ready')) toggleHandoff()
    }

    function handleKeyUp(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      if (!heldFlightKeys.delete(key)) return
      updatePilotControls()
    }

    function releasePilotControls() {
      heldFlightKeys.clear()
      flightSimulator.releasePilotControls()
    }

    function releaseHiddenControls() {
      if (document.visibilityState === 'hidden') releasePilotControls()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releasePilotControls)
    document.addEventListener('visibilitychange', releaseHiddenControls)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releasePilotControls)
      document.removeEventListener('visibilitychange', releaseHiddenControls)
      flightSimulator.releasePilotControls()
    }
  }, [showTakeoffBrief, toggleHandoff, webMcpStatus])

  const webMcpLabels = {
    registering: 'Connecting',
    ready: 'Ready',
    unsupported: 'Unavailable',
    error: 'Connection failed',
  } as const
  const ownershipMode = deriveOwnershipMode(state, webMcpStatus === 'ready')
  const destination = state.route.destination ?? 'Route pending'
  const routeDetail = state.route.destination === null
    ? 'Decision needed'
    : state.mission.nextFix && state.mission.distanceToNextFixNm !== null
      ? `${state.mission.nextFix} · ${state.mission.distanceToNextFixNm.toFixed(1)} NM`
      : state.route.runway
        ? `Runway ${state.route.runway}`
        : routePlanLabels[state.route.plan]
  const missionSecondsRemaining = state.checkride.deadlineSeconds - state.elapsedSeconds
  const missionOvertime = missionSecondsRemaining < 0
  const lastDeduction = state.checkride.score.deductions.at(-1)
  const windDirection = state.scenario.weather.windDirectionDeg.toString().padStart(3, '0')
  const longitudinalWind = state.motion.headwindKt >= 0
    ? `${Math.round(state.motion.headwindKt)} kt headwind`
    : `${Math.round(Math.abs(state.motion.headwindKt))} kt tailwind`
  const windTitle = `Wind from ${windDirection}° at ${state.scenario.weather.windSpeedKt} kt · ${longitudinalWind} · ${Math.round(Math.abs(state.motion.crosswindKt))} kt crosswind${state.motion.turbulenceLevel === 'none' ? '' : ` · ${state.motion.turbulenceLevel} turbulence`}`

  return (
    <main className="app-shell">
      <Suspense fallback={<div className="flight-world world-loading" />}>
        <FlightWorld cameraMode={cameraMode} compassRef={compassRef} onStatusChange={setWorldStatus} />
      </Suspense>
      <div className="scene-shade" />

      {showTakeoffBrief && state.mission.phase === 'preflight' ? (
        <section
          className="takeoff-briefing"
          role="dialog"
          aria-modal="true"
          aria-labelledby="takeoff-briefing-title"
          aria-describedby="takeoff-briefing-copy"
        >
          <div className="takeoff-briefing-card">
            <p>Flight briefing</p>
            <h1 id="takeoff-briefing-title">Fly the North Field departure.</h1>
            <p id="takeoff-briefing-copy">
              You are lined up on North Field runway 18. First file the normal route to Lakeside Municipal runway 22, about ten minutes away. Conditions may force the route to change after departure.
            </p>
            <ol>
              <li><kbd>↑</kbd><span>Hold to set full power, or drag Power to 100%.</span></li>
              <li><kbd>W</kbd><span>Near {A380_ENVELOPE.rotateSpeedKt} knots, rotate smoothly and keep takeoff power set while accelerating toward {A380_ENVELOPE.initialClimbSpeedKt} knots.</span></li>
              <li><kbd>G</kbd><span>Retract the gear after liftoff. Use <kbd>F</kbd> for flaps and <kbd>X</kbd> to level.</span></li>
            </ol>
            <div className="takeoff-briefing-actions">
              <span>Filing arms the departure. Apply power when you are ready to roll.</span>
              <Button autoFocus onClick={filePreflightRoute}>File route</Button>
            </div>
          </div>
        </section>
      ) : null}

      <header className="flight-header">
        <div className="flight-brand">
          <span className="flight-brand-mark" aria-hidden="true"><Plane /></span>
          <div>
            <strong>Flightdeck</strong>
            <span>N380FS · Wide-body departure</span>
          </div>
        </div>

        <div className="route-summary" aria-label={`Route ${destination}, ${routeDetail}`}>
          <MapPin aria-hidden="true" />
          <strong>{destination}</strong>
          <span>{routeDetail}</span>
          <i className="route-divider" aria-hidden="true" />
          <span>{formatLabel(state.mission.phase)}</span>
        </div>

        <OwnershipControl mode={ownershipMode} onClick={toggleHandoff} />
      </header>

      <div className="flight-status-strip">
        <div className="flight-clock" data-urgent={missionSecondsRemaining <= 30} role="timer" aria-label={`${formatElapsed(state.elapsedSeconds)} elapsed, ${formatElapsed(Math.abs(missionSecondsRemaining))} ${missionOvertime ? 'overtime' : 'remaining'}`}>
          <Timer aria-hidden="true" />
          <span>Elapsed</span>
          <strong>{formatElapsed(state.elapsedSeconds)}</strong>
          <i aria-hidden="true" />
          <span>{missionOvertime ? 'Overtime' : 'Remaining'}</span>
          <strong>{formatElapsed(Math.abs(missionSecondsRemaining))}</strong>
        </div>
        <div className="score-meter" title={lastDeduction ? `Last deduction: −${lastDeduction.points} · ${lastDeduction.reason}` : 'No deductions'}>
          <Trophy aria-hidden="true" />
          <span>Score</span>
          <strong>{state.checkride.score.total}</strong>
          {lastDeduction ? <small>−{lastDeduction.points} {deductionLabel(lastDeduction.id)}</small> : null}
        </div>
        <div className="wind-meter" title={windTitle} aria-label={windTitle} data-turbulence={state.motion.turbulenceLevel}>
          <Wind aria-hidden="true" />
          <span>Wind</span>
          <strong>{windDirection}° / {state.scenario.weather.windSpeedKt} kt</strong>
          {state.motion.turbulenceLevel !== 'none' ? <small>{state.motion.turbulenceLevel}</small> : null}
        </div>
        {state.checkride.decisionSecondsRemaining !== null ? (
          <div className="emergency-timer" data-urgent={state.checkride.decisionSecondsRemaining <= 30} role="timer" aria-live="polite">
            <Timer aria-hidden="true" />
            <span>Route decision</span>
            <strong>{formatElapsed(Math.ceil(state.checkride.decisionSecondsRemaining))}</strong>
          </div>
        ) : null}
      </div>

      <FlightMinimap state={state} />
      <FlightCompass ref={compassRef} />

      <nav className="camera-switcher" aria-label="Camera view">
        {cameraOptions.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            className="camera-button"
            aria-label={label}
            aria-pressed={cameraMode === mode}
            title={label}
            onClick={() => setCameraMode(mode)}
          >
            <Icon aria-hidden="true" />
          </button>
        ))}
        <span className="camera-divider" aria-hidden="true" />
        <button
          type="button"
          className="camera-button"
          aria-label={audioVolume === 0 ? 'Turn flight audio on' : 'Mute flight audio'}
          aria-pressed={audioVolume === 0}
          title={audioVolume === 0 ? 'Flight audio off' : `Flight audio ${audioVolume}%`}
          onClick={toggleAudio}
        >
          {audioVolume === 0 ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
        <label className="audio-volume">
          <span className="sr-only">Flight audio volume</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={audioVolume}
            aria-label={`Flight audio volume ${audioVolume}%`}
            onChange={(event) => changeAudioVolume(event.currentTarget.valueAsNumber)}
          />
          <small aria-hidden="true">{audioVolume}%</small>
        </label>
      </nav>

      <section className="instrument-console" aria-label="Flight instruments and controls">
        <div className="instrument-readings">
          <InstrumentStat label="Airspeed" value={Math.round(state.airspeedKt).toString()} unit="KT" />
          <InstrumentStat label="Altitude" value={Math.round(state.altitudeFt).toLocaleString()} unit="FT" />
          <InstrumentStat label="Pitch" value={formatAngleMagnitude(state.pitchDeg)} unit={pitchDirection(state.pitchDeg)} />
          <InstrumentStat label="Bank" value={formatAngleMagnitude(state.bankDeg)} unit={bankDirection(state.bankDeg)} />
          <InstrumentStat label="Vertical" value={Math.round(state.verticalSpeedFpm).toString()} unit="FPM" />
          <InstrumentStat label="Heading" value={Math.round(state.headingDeg).toString().padStart(3, '0')} unit="MAG" />
        </div>

        <div className="manual-controls">
          <Button
            variant="outline"
            size="sm"
            disabled={state.controlOwner === 'agent'}
            aria-keyshortcuts="G"
            onClick={() => flightSimulator.setGear(!state.gearDown, 'human', 'Cockpit gear control')}
          >
            <span className="control-label">Gear <kbd className="control-shortcut">(G)</kbd></span>
            <span className="control-value">{state.gearDown ? 'Down' : 'Up'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={state.controlOwner === 'agent'}
            aria-keyshortcuts="F"
            onClick={() => {
              const index = flapSettings.indexOf(state.flapsDeg as (typeof flapSettings)[number])
              flightSimulator.setFlaps(flapSettings[(index + 1) % flapSettings.length], 'human', 'Cockpit flap control')
            }}
          >
            <span className="control-label">Flaps <kbd className="control-shortcut">(F)</kbd></span>
            <span className="control-value">{state.flapsDeg}°</span>
          </Button>
          <label className="throttle-control">
            <span>Power</span>
            <Slider
              aria-label="Engine power"
              min={0}
              max={100}
              step={1}
              value={[state.throttle * 100]}
              disabled={state.controlOwner === 'agent'}
              onValueChange={(value) =>
                flightSimulator.setThrottle(
                  (typeof value === 'number' ? value : value[0]) / 100,
                  'human',
                  'Cockpit throttle control',
                )
              }
            />
            <strong>{Math.round(state.throttle * 100)}%</strong>
          </label>
        </div>
      </section>

      <CopilotPanel
        phase={formatLabel(state.mission.phase)}
        headline={deriveHeadline(state)}
        observations={deriveObservations(state)}
        recommendation={deriveRecommendation(state)}
        plan={derivePlan(state)}
        action={deriveAction(state)}
        approvalPending={state.approval.status === 'pending'}
        approvalPrompt={state.approval.question ?? 'Approve the copilot’s requested action?'}
        debrief={deriveDebrief(state)}
        diagnostics={{
          world: worldStatus.message,
          webMcp: webMcpLabels[webMcpStatus],
          missionRevision: state.mission.eventRevision,
          scenarioId: `Seed ${state.checkride.seed}`,
          recentTools: activities.slice(-4).reverse().map((activity) => `${activity.title} · ${activity.status}`),
        }}
        onApprove={() => resolveApproval(true)}
        onDeny={() => resolveApproval(false)}
        onReset={resetScenario}
      />
    </main>
  )
}
