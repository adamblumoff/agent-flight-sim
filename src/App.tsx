import '@fontsource-variable/atkinson-hyperlegible-next'
import '@fontsource-variable/kode-mono'
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Eye, Glasses, MapPin, Orbit, Timer, Trophy, Volume2, VolumeX, Wind } from 'lucide-react'
import { CopilotPanel } from './components/copilot-panel'
import { FlightModeBadge } from './components/flight-mode-badge'
import { Button } from './components/ui/button'
import { Slider } from './components/ui/slider'
import { FlightMinimap } from './components/flight-minimap'
import { FlightCompass } from './components/flight-compass'
import { WIDE_BODY_TWINJET_ENVELOPE } from './sim/aircraftEnvelope'
import { DEFAULT_ENVIRONMENT_VOLUME, DEFAULT_RADIO_VOLUME, flightAudio } from './audio/flightAudio'
import { flightSimulator } from './sim/flightSimulator'
import { randomCheckrideSeed } from './sim/missionProfiles'
import { useWebMcp } from './webmcp/useWebMcp'
import { createFlightRunExport } from './webmcp/runExport'
import type { FlightCameraMode, FlightWorldStatus } from './world/FlightWorld'
import { cn } from './lib/utils'
import { eyebrow, flightPanel, iconButton } from './components/flight-ui'
import {
  bankDirection,
  deductionLabel,
  deriveAction,
  deriveDebrief,
  deriveHeadline,
  deriveObservations,
  derivePlan,
  deriveRecommendation,
  formatAngleMagnitude,
  formatElapsed,
  formatLabel,
  pitchDirection,
  routePlanLabels,
} from './presentation/flightPresentation'

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
    <div className="min-w-0 border-r border-[#f4efde]/10 px-3 py-2 last:border-r-0 max-[760px]:[&:nth-child(n+5)]:hidden">
      <span className="font-mono text-[7px] font-semibold uppercase tracking-[0.12em] text-[#b9b3a3]">{label}</span>
      <div className="mt-0.5 flex items-baseline gap-1">
        <strong className="font-mono text-lg font-medium tabular-nums text-[#f4efde]">{value}</strong>
        <small className="font-mono text-[7px] uppercase text-[#b9b3a3]">{unit}</small>
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
  const [environmentVolume, setEnvironmentVolume] = useState(DEFAULT_ENVIRONMENT_VOLUME * 100)
  const [radioVolume, setRadioVolume] = useState(DEFAULT_RADIO_VOLUME * 100)
  const [audioMuted, setAudioMuted] = useState(false)
  const [captionsVisible, setCaptionsVisible] = useState(true)
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

  const startManualFlight = useCallback(() => {
    if (!flightSimulator.startFlight('human')) return
    flightSimulator.setRoute('continue_kmdw', 'Pilot filed the normal route to Chicago Midway runway 31C before departure.', 'human')
    setShowTakeoffBrief(false)
  }, [])

  const startAgentFlight = useCallback(() => {
    if (!flightSimulator.startFlight('agent', randomCheckrideSeed())) return
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

  const initiateHumanGoAround = useCallback(() => {
    flightSimulator.initiateGoAround('Pilot initiated a go-around after the approach became unsafe.', 'human')
  }, [])

  useEffect(() => {
    if (state.mission.phase !== 'preflight') setShowTakeoffBrief(false)
  }, [state.mission.phase])

  useEffect(() => {
    if (state.flightMode === 'agent') setShowTakeoffBrief(false)
  }, [state.flightMode])

  useEffect(() => {
    const heldFlightKeys = new Set<string>()

    const updatePilotControls = () => {
      if (flightSimulator.getState().flightMode !== 'human') {
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
      if (['arrowup', 'arrowdown', 'w', 'a', 's', 'd', 'f', 'g', 'x'].includes(key)) event.preventDefault()

      if (current.flightMode === 'human') {
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
  }, [showTakeoffBrief])

  const webMcpLabels = {
    registering: 'Connecting',
    ready: 'Ready',
    unsupported: 'Unavailable',
    error: 'Connection failed',
  } as const
  const destination = state.route.destination ?? 'Route pending'
  const routeDetail = state.route.destination === null
    ? 'Decision needed'
    : state.mission.nextFix && state.mission.distanceToNextFixNm !== null
      ? `${state.mission.nextFix} · ${state.mission.distanceToNextFixNm.toFixed(1)} NM`
      : state.route.runway
        ? `Runway ${state.route.runway}`
        : routePlanLabels[state.route.plan]
  const missionElapsedSeconds = state.elapsedSeconds / state.checkride.simulationRate
  const missionSecondsRemaining = state.checkride.wallClockSecondsRemaining ?? state.checkride.wallClockDeadlineSeconds
  const missionOvertime = state.mission.outcome === 'timed_out'
  const lastDeduction = state.checkride.score.deductions.at(-1)
  const windDirection = state.scenario.weather.windDirectionDeg.toString().padStart(3, '0')
  const longitudinalWind = state.motion.headwindKt >= 0
    ? `${Math.round(state.motion.headwindKt)} kt headwind`
    : `${Math.round(Math.abs(state.motion.headwindKt))} kt tailwind`
  const windTitle = `Wind from ${windDirection}° at ${state.scenario.weather.windSpeedKt} kt · ${longitudinalWind} · ${Math.round(Math.abs(state.motion.crosswindKt))} kt crosswind${state.motion.turbulenceLevel === 'none' ? '' : ` · ${state.motion.turbulenceLevel} turbulence`}`
  const crewActions = state.flightMode !== 'human'
    ? []
    : state.mission.goAroundRequired
      ? [{
          id: 'go-around',
          label: 'Go around',
          description: 'Abandon this approach, climb ahead, and receive a new outbound course reversal and final.',
          onSelect: initiateHumanGoAround,
        }]
      : state.checkride.status !== 'decision_required'
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
  const crewActionStatus = state.flightMode !== 'human' || state.mission.goAroundRequired || state.checkride.status !== 'decision_required'
    ? null
    : state.atc.status === 'requested'
      ? 'Diversion requested. Maintain control while ATC prepares the clearance.'
      : state.atc.status === 'accepted'
        ? 'Clearance accepted. The active route and next checkpoint are updated.'
        : null

  return (
    <main className="fixed inset-0 isolate min-w-[320px] overflow-hidden bg-[#151710] font-['Atkinson_Hyperlegible_Next_Variable',sans-serif] text-[#f4efde] antialiased">
      <Suspense fallback={<div className="absolute inset-0 -z-30 bg-[radial-gradient(circle_at_50%_35%,rgb(74_85_62/35%),transparent_32%),linear-gradient(#2d3428,#171a14)]" />}>
        <FlightWorld cameraMode={cameraMode} compassRef={compassRef} onStatusChange={setWorldStatus} />
      </Suspense>
      <div className="pointer-events-none absolute inset-0 -z-20 bg-[linear-gradient(180deg,rgb(10_12_9/62%)_0%,transparent_22%,transparent_60%,rgb(8_9_7/52%)_100%),linear-gradient(90deg,rgb(8_10_7/22%)_0%,transparent_28%,transparent_62%,rgb(8_10_7/38%)_100%)]" />

      {showTakeoffBrief && state.mission.phase === 'preflight' ? (
        <section
          className="absolute inset-0 z-20 grid place-items-center overflow-y-auto bg-[#080a08]/65 p-6 backdrop-blur-[7px] max-[480px]:p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="takeoff-briefing-title"
          aria-describedby="takeoff-briefing-copy"
        >
          <div className={cn(flightPanel, 'max-h-[calc(100dvh-48px)] w-full max-w-[520px] overflow-y-auto rounded-[18px] bg-[#171815]/96 p-7 shadow-[0_28px_90px_rgb(0_0_0/46%)] max-[480px]:max-h-[calc(100dvh-24px)] max-[480px]:p-[21px_18px]')}>
            <p className={eyebrow}>Flight briefing</p>
            <h1 className="my-2 text-[clamp(24px,4vw,34px)] font-semibold tracking-[-0.045em]" id="takeoff-briefing-title">Choose who flies this run.</h1>
            <p className="text-xs leading-relaxed text-[#b9b3a3]" id="takeoff-briefing-copy">
              The aircraft is lined up on St. Louis Lambert runway 12R for Chicago Midway runway 31C. The selected pilot keeps control until the run ends.
            </p>
            <ol className="my-5 grid list-none gap-2 p-0 text-xs leading-relaxed text-[#d7d1c0] [&_li]:grid [&_li]:grid-cols-[28px_1fr] [&_li]:items-start [&_li]:gap-3 [&_kbd]:grid [&_kbd]:h-7 [&_kbd]:min-w-7 [&_kbd]:place-items-center [&_kbd]:rounded-md [&_kbd]:border [&_kbd]:border-[#f4efde]/15 [&_kbd]:bg-[#f4efde]/5 [&_kbd]:font-mono [&_kbd]:text-[9px] [&_kbd]:font-bold [&_kbd]:text-[#f4efde]">
              <li><kbd>↑</kbd><span>Advance both engines to takeoff thrust; flaps 10° are already set.</span></li>
              <li><kbd>W</kbd><span>At {WIDE_BODY_TWINJET_ENVELOPE.rotateSpeedKt} knots, rotate at about {WIDE_BODY_TWINJET_ENVELOPE.rotationRateDegPerSecond}°/s toward {WIDE_BODY_TWINJET_ENVELOPE.initialClimbPitchDeg}°. Rotation is guidance; the aircraft lifts off only when its aerodynamic lift exceeds its weight.</span></li>
              <li><kbd>G</kbd><span>Retract gear after positive rate. Use <kbd className="inline-grid! h-5! min-w-5!">F</kbd> to retract flaps on schedule and <kbd className="inline-grid! h-5! min-w-5!">X</kbd> to level.</span></li>
            </ol>
            <div className="flex items-center justify-between gap-4 border-t border-[#f4efde]/10 pt-4 max-sm:flex-col max-sm:items-stretch">
              <span className="text-[10px] leading-normal text-[#b9b3a3]">{webMcpStatus === 'ready' ? 'Choose once for this run. Reset the flight to change pilots.' : 'WebMCP is unavailable here, but manual flight still works.'}</span>
              <div className="flex shrink-0 gap-2 max-sm:[&>button]:flex-1">
                <Button variant="outline" disabled={webMcpStatus !== 'ready'} onClick={startAgentFlight}>Use agent</Button>
                <Button autoFocus onClick={startManualFlight}>Fly manually</Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <header className="pointer-events-none absolute right-5 top-4 z-10 flex min-h-11 items-center gap-2 max-[760px]:right-3 max-[760px]:top-3">
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-[#f4efde]/12 bg-[#171815]/80 px-3 py-2 text-[9px] backdrop-blur-xl max-sm:hidden" aria-label={`Route ${destination}, ${routeDetail}`}>
          <MapPin className="size-3.5 shrink-0 text-[#8bc49b]" aria-hidden="true" />
          <strong className="truncate font-semibold text-[#f4efde]">{destination}</strong>
          <span className="max-w-48 truncate text-[#b9b3a3] max-xl:hidden">{routeDetail}</span>
          <i className="h-4 w-px bg-[#f4efde]/12" aria-hidden="true" />
          <span className="font-mono uppercase tracking-[0.1em] text-[#b9b3a3]">{formatLabel(state.mission.phase)}</span>
        </div>

        <FlightModeBadge mode={state.flightMode} />
      </header>

      <div className="absolute left-5 top-4 z-10 flex items-stretch gap-2 max-[760px]:left-3 max-[760px]:top-28 max-[760px]:max-w-[calc(100vw-24px)]">
        <div className={cn(flightPanel, 'flex items-center gap-2 rounded-lg px-3 py-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#b9b3a3] data-[urgent=true]:border-[#e78068]/45 data-[urgent=true]:text-[#e78068]')} data-urgent={missionSecondsRemaining <= 30} role="timer" aria-label={`${formatElapsed(missionElapsedSeconds)} elapsed, ${formatElapsed(Math.abs(missionSecondsRemaining))} ${missionOvertime ? 'overtime' : 'remaining'}`}>
          <Timer className="size-3.5 text-[#8bc49b]" aria-hidden="true" />
          <span className="max-sm:hidden">Elapsed</span>
          <strong className="text-[11px] tabular-nums text-[#f4efde]">{formatElapsed(missionElapsedSeconds)}</strong>
          <i className="h-4 w-px bg-[#f4efde]/12" aria-hidden="true" />
          <span className="max-sm:hidden">{missionOvertime ? 'Overtime' : 'Remaining'}</span>
          <strong className="text-[11px] tabular-nums text-[#f4efde]">{formatElapsed(Math.abs(missionSecondsRemaining))}</strong>
        </div>
        <div className={cn(flightPanel, 'flex items-center gap-2 rounded-lg px-3 py-2')} title={lastDeduction ? `Last deduction: −${lastDeduction.points} · ${lastDeduction.reason}` : 'No deductions'}>
          <Trophy className="size-3.5 text-[#e2b76f]" aria-hidden="true" />
          <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#b9b3a3] max-sm:hidden">Score</span>
          <strong className="font-mono text-sm tabular-nums">{state.checkride.score.total}</strong>
          {lastDeduction ? <small className="font-mono text-[7px] uppercase text-[#e78068] max-xl:hidden">−{lastDeduction.points} {deductionLabel(lastDeduction.id)}</small> : null}
        </div>
        <div className={cn(flightPanel, 'flex items-center gap-2 rounded-lg px-3 py-2 max-xl:hidden data-[turbulence=moderate]:border-[#e2b76f]/45')} title={windTitle} aria-label={windTitle} data-turbulence={state.motion.turbulenceLevel}>
          <Wind className="size-3.5 text-sky-300" aria-hidden="true" />
          <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#b9b3a3]">Wind</span>
          <strong className="font-mono text-[10px] tabular-nums">{windDirection}° / {state.scenario.weather.windSpeedKt} kt</strong>
          {state.motion.turbulenceLevel !== 'none' ? <small className="font-mono text-[7px] uppercase text-[#e2b76f]">{state.motion.turbulenceLevel}</small> : null}
        </div>
        {state.checkride.decisionSecondsRemaining !== null ? (
          <div className={cn(flightPanel, 'flex items-center gap-2 rounded-lg border-[#e78068]/35 px-3 py-2 text-[#e78068] data-[urgent=true]:animate-pulse motion-reduce:animate-none')} data-urgent={state.checkride.decisionSecondsRemaining <= 30} role="timer" aria-live="polite">
            <Timer className="size-3.5" aria-hidden="true" />
            <span className="font-mono text-[8px] uppercase tracking-[0.1em] max-xl:hidden">Route decision</span>
            <strong className="font-mono text-xs tabular-nums">{formatElapsed(Math.ceil(state.checkride.decisionSecondsRemaining))}</strong>
          </div>
        ) : null}
      </div>

      <FlightMinimap state={state} />
      <FlightCompass ref={compassRef} />
      <nav className={cn(flightPanel, 'absolute bottom-[112px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg p-1 max-[760px]:bottom-auto max-[760px]:left-auto max-[760px]:right-3 max-[760px]:top-[66px] max-[760px]:translate-x-0')} aria-label="Camera view">
        {cameraOptions.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            className={iconButton}
            aria-label={label}
            aria-pressed={cameraMode === mode}
            title={label}
            onClick={() => setCameraMode(mode)}
          >
            <Icon aria-hidden="true" />
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[#f4efde]/12 max-[760px]:hidden" aria-hidden="true" />
        <button
          type="button"
          className={iconButton}
          aria-label={audioMuted ? 'Turn flight audio on' : 'Mute flight audio'}
          aria-pressed={audioMuted}
          title={audioMuted ? 'Flight audio off' : 'Mute flight audio'}
          onClick={() => changeAudioMuted(!audioMuted)}
        >
          {audioMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
      </nav>

      <section className={cn(flightPanel, 'absolute bottom-5 left-5 right-[380px] z-[7] flex min-h-[76px] overflow-hidden rounded-xl max-xl:right-[350px] max-[760px]:bottom-auto max-[760px]:left-3 max-[760px]:right-auto max-[760px]:top-[66px] max-[760px]:min-h-[78px] max-[760px]:w-[min(520px,calc(100%-172px))] max-[480px]:w-[calc(100%-72px)]')} aria-label="Flight instruments and controls">
        <div className="grid min-w-0 flex-1 grid-cols-6 max-lg:grid-cols-3 max-[760px]:grid-cols-2">
          <InstrumentStat label="Airspeed" value={Math.round(state.airspeedKt).toString()} unit="KT" />
          <InstrumentStat label="Altitude" value={Math.round(state.altitudeFt).toLocaleString()} unit="FT" />
          <InstrumentStat label="Pitch" value={formatAngleMagnitude(state.pitchDeg)} unit={pitchDirection(state.pitchDeg)} />
          <InstrumentStat label="Bank" value={formatAngleMagnitude(state.bankDeg)} unit={bankDirection(state.bankDeg)} />
          <InstrumentStat label="Vertical" value={Math.round(state.verticalSpeedFpm).toString()} unit="FPM" />
          <InstrumentStat label="Heading" value={Math.round(state.headingDeg).toString().padStart(3, '0')} unit="MAG" />
        </div>

        <div className="grid w-[260px] shrink-0 grid-cols-2 gap-2 border-l border-[#f4efde]/10 p-3 max-xl:w-[190px] max-[760px]:w-[150px] max-[760px]:p-[9px] max-[480px]:hidden">
          <Button
            variant="outline"
            size="sm"
            disabled={state.flightMode !== 'human'}
            aria-keyshortcuts="G"
            onClick={() => flightSimulator.setGear(!state.gearDown, 'human', 'Cockpit gear control')}
          >
            <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#b9b3a3]">Gear <kbd className="text-[#8bc49b]">(G)</kbd></span>
            <span className="font-mono text-[9px] uppercase text-[#f4efde]">{state.gearDown ? 'Down' : 'Up'}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={state.flightMode !== 'human'}
            aria-keyshortcuts="F"
            onClick={() => {
              const index = flapSettings.indexOf(state.flapsDeg as (typeof flapSettings)[number])
              flightSimulator.setFlaps(flapSettings[(index + 1) % flapSettings.length], 'human', 'Cockpit flap control')
            }}
          >
            <span className="font-mono text-[8px] uppercase tracking-[0.1em] text-[#b9b3a3]">Flaps <kbd className="text-[#8bc49b]">(F)</kbd></span>
            <span className="font-mono text-[9px] uppercase text-[#f4efde]">{state.flapsDeg}°</span>
          </Button>
          <label className="col-span-2 grid grid-cols-[42px_1fr_32px] items-center gap-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#b9b3a3] max-[760px]:hidden">
            <span>Power</span>
            <Slider
              aria-label="Engine power"
              min={0}
              max={100}
              step={1}
              value={[state.throttle * 100]}
              disabled={state.flightMode !== 'human'}
              onValueChange={(value) =>
                flightSimulator.setThrottle(
                  (typeof value === 'number' ? value : value[0]) / 100,
                  'human',
                  'Cockpit throttle control',
                )
              }
            />
            <strong className="text-right text-[9px] tabular-nums text-[#f4efde]">{Math.round(state.throttle * 100)}%</strong>
          </label>
        </div>
      </section>

      <CopilotPanel
        radio={{
          cues: radio.cues,
          activeCueId: radio.activeCueId,
          captionsVisible,
          audioMuted,
          environmentVolume,
          radioVolume,
          onCaptionsVisibleChange: setCaptionsVisible,
          onAudioMutedChange: changeAudioMuted,
          onEnvironmentVolumeChange: changeEnvironmentVolume,
          onRadioVolumeChange: changeRadioVolume,
        }}
        phase={formatLabel(state.mission.phase)}
        headline={deriveHeadline(state)}
        observations={deriveObservations(state)}
        recommendation={deriveRecommendation(state)}
        plan={derivePlan(state)}
        action={deriveAction(state)}
        crewActions={crewActions}
        crewActionStatus={crewActionStatus}
        debrief={deriveDebrief(state)}
        webMcpActivities={activities}
        runExport={state.debrief.status === 'in_progress' ? null : createFlightRunExport(activities, state, flightSimulator.getMissionBrief(), flightSimulator.getTrace())}
        diagnostics={{
          world: worldStatus.message,
          webMcp: webMcpLabels[webMcpStatus],
          missionRevision: state.mission.eventRevision,
          scenarioId: state.debrief.status === 'in_progress' ? 'Sealed until debrief' : `Seed ${state.checkride.seed}`,
          buildId: state.checkride.buildId,
          profileId: state.checkride.profileId,
          recentTools: activities.slice(-4).reverse().map((activity) => `${activity.title} · ${activity.status}`),
        }}
        onReset={resetScenario}
      />
    </main>
  )
}
