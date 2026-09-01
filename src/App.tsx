import '@fontsource-variable/atkinson-hyperlegible-next'
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
import { RadioTranscript } from './components/radio-transcript'
import { DREAMLINER_787_9_ENVELOPE } from './sim/aircraftEnvelope'
import { flightAudio } from './audio/flightAudio'
import { radioVoiceClipFor } from './audio/radioVoicePack'
import { flightSimulator } from './sim/flightSimulator'
import { MISSION_PROFILE } from './sim/missionProfiles'
import type { FlightState, RoutePlan } from './sim/types'
import { useWebMcp } from './webmcp/useWebMcp'
import { createFlightTrajectory } from './webmcp/trajectory'
import { persistEvaluationEvidence } from './webmcp/evaluationArchive'
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
  continue_kmdw: 'Chicago Midway',
  return_kstl: 'Return to KSTL',
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
  if (id === 'mission-timeout') return 'time limit'
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
    ? 'File the Chicago Midway runway 31C route before beginning the takeoff roll.'
    : 'The Chicago Midway route is filed. Apply power when you are ready to begin the takeoff roll.'
  if (state.mission.phase === 'takeoff') return 'Climb through 1,000 feet, clean up the aircraft, then decide who flies the arrival.'
  if (!state.procedure.compliant) return state.procedure.instruction
  if (state.mission.routeStatus === 'stalled') return 'The active leg is no longer converging. Rebuild it from the current position instead of continuing the orbit.'
  if (state.checkride.status === 'armed') return 'Departure is normal. Maintain the climb and monitor for changes.'
  if (state.checkride.status === 'decision_required') {
    if (state.atc.status === 'requested') return 'Maintain the current hold while ATC prepares the diversion clearance.'
    if (state.atc.status === 'cleared') return `Read back and accept clearance ${state.atc.clearance?.id ?? ''} before changing course.`
    return 'Review the emergency evidence, choose a diversion, and request clearance from ATC.'
  }
  if (state.controlOwner === 'human' && state.route.plan === 'return_kstl') {
    return 'The safest emergency route was loaded automatically. Fly the active checkpoints to KSTL runway 30L.'
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
      'File the Chicago Midway runway 31C route before departure.',
      'Take off from St. Louis Lambert runway 12R, clean up the aircraft, and monitor for changes.',
    ]
  }
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
  if (state.mission.phase === 'takeoff' && state.aircraftPhase === 'takeoff_roll') {
    return `Accelerating on Lambert runway 12R. At ${DREAMLINER_787_9_ENVELOPE.rotateSpeedKt} knots, rotate toward ${DREAMLINER_787_9_ENVELOPE.initialClimbPitchDeg}°.`
  }
  if (state.approval.status === 'pending') {
    return `Maintaining ${Math.round(state.headingDeg).toString().padStart(3, '0')}° while you decide.`
  }
  if (state.checkride.status === 'armed') return 'Normal departure. Monitoring the aircraft and surrounding conditions.'
  if (state.checkride.status === 'decision_required') {
    if (state.atc.status === 'requested') return 'Diversion requested. Holding while ATC prepares the clearance.'
    if (state.atc.status === 'cleared') return `ATC clearance ${state.atc.clearance?.id ?? ''} is awaiting readback.`
    return 'Assessing the emergency before requesting a diversion clearance.'
  }
  if (state.mission.routeStatus === 'stalled') return 'Route progress stalled. Waiting for a leg rebuild.'
  if (state.controlOwner === 'human' && state.route.plan === 'return_kstl') {
    const waypoint = state.route.waypoints[state.route.activeWaypointIndex]
    return waypoint
      ? `You are flying. Follow the active route to ${waypoint.name}.`
      : 'You are flying the emergency return to KSTL runway 30L.'
  }
  if (state.agentMode === 'requested' || state.agentMode === 'thinking') {
    return 'Reading the emergency context and comparing the available routes.'
  }
  if (!state.procedure.compliant) return state.procedure.instruction
  if (state.controlOwner === 'agent') return 'The agent has the flight controls and is selecting its next input.'
  return 'Monitoring the aircraft and emergency conditions while you fly.'
}

function deriveHeadline(state: FlightState): string {
  if (state.mission.phase === 'preflight') return 'Preflight route required'
  if (state.mission.phase === 'takeoff') return 'Departing Lambert runway 12R'
  if (state.checkride.status === 'armed') return 'Normal departure'
  if (state.checkride.status === 'decision_required') {
    if (state.atc.status === 'requested') return 'Waiting for ATC clearance'
    if (state.atc.status === 'cleared') return 'ATC clearance received'
    return 'Diversion decision required'
  }
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
  const { status: webMcpStatus, activities, clearActivities: clearWebMcpActivities } = useWebMcp()
  const radio = useSyncExternalStore(
    flightAudio.subscribeRadio,
    flightAudio.getRadioSnapshot,
    flightAudio.getRadioSnapshot,
  )
  const [cameraMode, setCameraMode] = useState<FlightCameraMode>('chase')
  const [environmentVolume, setEnvironmentVolume] = useState(50)
  const [radioVolume, setRadioVolume] = useState(34)
  const [audioMuted, setAudioMuted] = useState(false)
  const [captionsVisible, setCaptionsVisible] = useState(true)
  const [showTakeoffBrief, setShowTakeoffBrief] = useState(true)
  const [worldStatus, setWorldStatus] = useState<FlightWorldStatus>({
    kind: 'loading',
    message: 'Loading the flight world.',
  })
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('mode')) {
      url.searchParams.delete('mode')
      window.history.replaceState(null, '', url)
    }
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
    clearWebMcpActivities()
    setShowTakeoffBrief(true)
  }, [clearWebMcpActivities])

  const changeEnvironmentVolume = useCallback((volume: number) => {
    const nextVolume = Math.max(0, Math.min(100, Math.round(volume)))
    setEnvironmentVolume(nextVolume)
    flightAudio.setEnvironmentVolume(nextVolume / 100)
  }, [])

  const changeRadioVolume = useCallback((volume: number) => {
    const nextVolume = Math.max(0, Math.min(100, Math.round(volume)))
    setRadioVolume(nextVolume)
    flightAudio.setRadioVolume(nextVolume / 100)
  }, [])

  const changeAudioMuted = useCallback((muted: boolean) => {
    setAudioMuted(muted)
    flightAudio.setMuted(muted)
  }, [])

  const filePreflightRoute = useCallback(() => {
    flightSimulator.setRoute('continue_kmdw', 'Pilot filed the normal route to Chicago Midway runway 31C before departure.', 'human')
    setShowTakeoffBrief(false)
  }, [])

  const requestHumanDiversion = useCallback((plan: 'return_kstl' | 'continue_kmdw') => {
    const context = flightSimulator.getDecisionContext('human')
    const option = context.routeOptions.find((routeOption) => routeOption.plan === plan)
    flightSimulator.requestDiversion(
      plan,
      option?.summary ?? `Pilot requested ${plan.replaceAll('_', ' ')} after reviewing the emergency context.`,
      'human',
    )
  }, [])

  const acceptHumanClearance = useCallback(() => {
    const clearance = flightSimulator.getState().atc.clearance
    if (!clearance) return
    flightSimulator.acceptAtcClearance(
      clearance.id,
      `${clearance.destination} runway ${clearance.runway}, heading ${Math.round(clearance.headingDeg)}, altitude ${clearance.altitudeFt}`,
      'human',
    )
  }, [])

  useEffect(() => {
    if (state.mission.phase !== 'preflight') setShowTakeoffBrief(false)
  }, [state.mission.phase])

  useEffect(() => {
    persistEvaluationEvidence(activities, state)
  }, [activities, state.checkride.runId, state.debrief.status])

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
      if (target instanceof HTMLElement && target.matches('textarea, select, [contenteditable="true"], input:not([type="range"]):not([type="button"]):not([type="submit"])')) return

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
        if (key === 'f') {
          const index = flapSettings.indexOf(current.flapsDeg as (typeof flapSettings)[number])
          flightSimulator.setFlaps(flapSettings[(index + 1) % flapSettings.length], 'human', 'Pilot flap command')
        }
        if (key === 'x') flightSimulator.levelPilotAttitude('human', 'Pilot pressed the level-flight shortcut')
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
  const missionElapsedSeconds = state.elapsedSeconds / state.checkride.simulationRate
  const missionSecondsRemaining = state.checkride.wallClockDeadlineSeconds - missionElapsedSeconds
  const missionOvertime = missionSecondsRemaining < 0
  const lastDeduction = state.checkride.score.deductions.at(-1)
  const windDirection = state.scenario.weather.windDirectionDeg.toString().padStart(3, '0')
  const longitudinalWind = state.motion.headwindKt >= 0
    ? `${Math.round(state.motion.headwindKt)} kt headwind`
    : `${Math.round(Math.abs(state.motion.headwindKt))} kt tailwind`
  const windTitle = `Wind from ${windDirection}° at ${state.scenario.weather.windSpeedKt} kt · ${longitudinalWind} · ${Math.round(Math.abs(state.motion.crosswindKt))} kt crosswind${state.motion.turbulenceLevel === 'none' ? '' : ` · ${state.motion.turbulenceLevel} turbulence`}`
  const crewActions = state.controlOwner !== 'human' || state.checkride.status !== 'decision_required'
    ? []
    : state.atc.status === 'none'
      ? [
          {
            id: 'return-kstl',
            label: 'Return to Lambert',
            description: 'Request priority handling to KSTL runway 30L.',
            onSelect: () => requestHumanDiversion('return_kstl'),
          },
          {
            id: 'continue-kmdw',
            label: 'Continue to Midway',
            description: 'Request clearance to continue to KMDW runway 31C.',
            onSelect: () => requestHumanDiversion('continue_kmdw'),
          },
        ]
      : state.atc.status === 'cleared'
        ? [{
            id: 'accept-clearance',
            label: 'Read back clearance',
            description: state.atc.clearance?.instruction ?? 'Accept the current ATC routing.',
            onSelect: acceptHumanClearance,
          }]
        : []
  const crewActionStatus = state.controlOwner !== 'human' || state.checkride.status !== 'decision_required'
    ? null
    : state.atc.status === 'requested'
      ? 'Diversion requested. Maintain control while ATC prepares the clearance.'
      : state.atc.status === 'accepted'
        ? 'Clearance accepted. The active route and next checkpoint are updated.'
        : null

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
            <h1 id="takeoff-briefing-title">Fly the St. Louis Lambert departure.</h1>
            <p id="takeoff-briefing-copy">
              You are lined up on St. Louis Lambert runway 12R for Chicago Midway runway 31C. File that route before departure.
            </p>
            <ol>
              <li><kbd>↑</kbd><span>Advance both GEnx engines to takeoff thrust; flaps 10° are already set.</span></li>
              <li><kbd>W</kbd><span>At {DREAMLINER_787_9_ENVELOPE.rotateSpeedKt} knots, rotate at about {DREAMLINER_787_9_ENVELOPE.rotationRateDegPerSecond}°/s toward {DREAMLINER_787_9_ENVELOPE.initialClimbPitchDeg}°. Rotation is guidance; the aircraft lifts off only when its aerodynamic lift exceeds its weight.</span></li>
              <li><kbd>G</kbd><span>Retract gear after positive rate. Use <kbd>F</kbd> to retract flaps on schedule and <kbd>X</kbd> to level.</span></li>
            </ol>
            <div className="takeoff-briefing-actions">
              <span>{MISSION_PROFILE.label}. Filing arms the departure; apply power when ready.</span>
              <Button autoFocus onClick={filePreflightRoute}>Fly route</Button>
            </div>
          </div>
        </section>
      ) : null}

      <header className="flight-header">
        <div className="flight-brand">
          <span className="flight-brand-mark" aria-hidden="true"><Plane /></span>
          <div>
            <strong>Flightdeck</strong>
            <span>N787FD · Boeing 787-9</span>
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
        <div className="flight-clock" data-urgent={missionSecondsRemaining <= 30} role="timer" aria-label={`${formatElapsed(missionElapsedSeconds)} elapsed, ${formatElapsed(Math.abs(missionSecondsRemaining))} ${missionOvertime ? 'overtime' : 'remaining'}`}>
          <Timer aria-hidden="true" />
          <span>Elapsed</span>
          <strong>{formatElapsed(missionElapsedSeconds)}</strong>
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
      <RadioTranscript
        className="flight-radio"
        cues={radio.cues}
        activeCueId={radio.activeCueId}
        captionsVisible={captionsVisible}
        audioMuted={audioMuted}
        environmentVolume={environmentVolume}
        radioVolume={radioVolume}
        onCaptionsVisibleChange={setCaptionsVisible}
        onAudioMutedChange={changeAudioMuted}
        onEnvironmentVolumeChange={changeEnvironmentVolume}
        onRadioVolumeChange={changeRadioVolume}
      />

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
          aria-label={audioMuted ? 'Turn flight audio on' : 'Mute flight audio'}
          aria-pressed={audioMuted}
          title={audioMuted ? 'Flight audio off' : 'Mute flight audio'}
          onClick={() => changeAudioMuted(!audioMuted)}
        >
          {audioMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
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
        crewActions={crewActions}
        crewActionStatus={crewActionStatus}
        approvalPending={state.approval.status === 'pending'}
        approvalPrompt={state.approval.question ?? 'Approve the copilot’s requested action?'}
        debrief={deriveDebrief(state)}
        webMcpCalls={activities.filter((activity) => activity.status !== 'running').map((activity) => ({
          tool: activity.tool,
          arguments: activity.arguments,
          radio: activity.radioCues.map((cue) => ({
            id: cue.id,
            speaker: cue.speaker,
            text: cue.text,
            priority: cue.priority,
            audioClip: radioVoiceClipFor(cue)?.key ?? null,
          })),
        }))}
        webMcpActivities={activities}
        trajectory={state.debrief.status === 'in_progress' ? null : createFlightTrajectory(activities, state)}
        diagnostics={{
          world: worldStatus.message,
          webMcp: webMcpLabels[webMcpStatus],
          missionRevision: state.mission.eventRevision,
          scenarioId: state.debrief.status === 'in_progress' ? 'Sealed until debrief' : `Seed ${state.checkride.seed}`,
          buildId: state.checkride.buildId,
          profileId: state.checkride.profileId,
          recentTools: activities.slice(-4).reverse().map((activity) => `${activity.title} · ${activity.status}`),
        }}
        onApprove={() => resolveApproval(true)}
        onDeny={() => resolveApproval(false)}
        onReset={resetScenario}
      />
    </main>
  )
}
