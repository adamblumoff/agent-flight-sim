import '@fontsource-variable/sora'
import '@fontsource-variable/kode-mono'
import { lazy, Suspense, useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleStop,
  Eye,
  Gauge,
  Glasses,
  LoaderCircle,
  Orbit,
  Plane,
  RefreshCw,
  Route,
  ShieldAlert,
  UserRound,
} from 'lucide-react'
import { WebMcpActivityPanel } from './components/webmcp-activity'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Slider } from './components/ui/slider'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import { flightSimulator } from './sim/flightSimulator'
import { useWebMcp } from './webmcp/useWebMcp'
import type { FlightCameraMode, FlightWorldStatus } from './world/FlightWorld'

const FlightWorld = lazy(() => import('./world/FlightWorld'))
const flapSettings = [0, 10, 20, 30]

const formatMissionLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase())

const cameraOptions: ReadonlyArray<{
  mode: FlightCameraMode
  label: string
  icon: typeof Eye
}> = [
  { mode: 'chase', label: 'Chase camera', icon: Eye },
  { mode: 'cockpit', label: 'Cockpit camera', icon: Glasses },
  { mode: 'free', label: 'Free camera', icon: Orbit },
]

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="min-w-0 border-r border-white/10 px-3 first:pl-0 last:border-r-0 last:pr-0">
      <span className="block truncate text-[9px] font-medium tracking-[0.16em] text-white/42 uppercase">{label}</span>
      <div className="mt-1.5 flex items-end gap-1.5">
        <strong className="truncate font-mono text-[clamp(18px,2vw,27px)] font-medium leading-none tracking-[-0.06em] text-white">{value}</strong>
        <small className="pb-0.5 font-mono text-[8px] text-white/38">{unit}</small>
      </div>
    </div>
  )
}

function StatusBadge({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'ready' | 'waiting' | 'failed' | 'agent' | 'neutral'
  icon: typeof CheckCircle2
  children: string
}) {
  return (
    <Badge variant="outline" className={`status-badge status-${tone}`}>
      <Icon data-icon="inline-start" />
      {children}
    </Badge>
  )
}

export default function App() {
  const state = useSyncExternalStore(
    flightSimulator.subscribe,
    flightSimulator.getSnapshot,
    flightSimulator.getSnapshot,
  )
  const { status: webMcpStatus, activities: webMcpActivities } = useWebMcp()
  const [cameraMode, setCameraMode] = useState<FlightCameraMode>('chase')
  const [worldStatus, setWorldStatus] = useState<FlightWorldStatus>({
    kind: 'loading',
    message: 'Loading the KPWK training circuit.',
  })

  useEffect(() => {
    flightSimulator.start()
    return () => flightSimulator.stop()
  }, [])

  const takeControls = useCallback(() => {
    flightSimulator.transferControl('human', 'human', 'My controls')
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return

      const current = flightSimulator.getState()
      const key = event.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'w', 'a', 's', 'd', 'f', 'g', 't'].includes(key)) event.preventDefault()

      if (current.controlOwner === 'human') {
        if (key === 'w') flightSimulator.applyPilotInput({ pitchDelta: 1 }, 'human', 'Pilot input')
        if (key === 's') flightSimulator.applyPilotInput({ pitchDelta: -1 }, 'human', 'Pilot input')
        if (key === 'a') flightSimulator.applyPilotInput({ bankDelta: -3 }, 'human', 'Pilot input')
        if (key === 'd') flightSimulator.applyPilotInput({ bankDelta: 3 }, 'human', 'Pilot input')
        if (key === 'arrowup') flightSimulator.setThrottle(current.throttle + 0.05, 'human', 'Pilot throttle input')
        if (key === 'arrowdown') flightSimulator.setThrottle(current.throttle - 0.05, 'human', 'Pilot throttle input')
        if (key === 'g') flightSimulator.setGear(!current.gearDown, 'human', 'Pilot gear command')
        if (key === 'f') {
          const index = flapSettings.indexOf(current.flapsDeg)
          flightSimulator.setFlaps(flapSettings[(index + 1) % flapSettings.length], 'human', 'Pilot flap command')
        }
      }

      if (key === 't') {
        if (current.controlOwner === 'agent') {
          flightSimulator.transferControl('human', 'human', 'My controls')
        } else if (webMcpStatus === 'ready') {
          flightSimulator.transferControl('agent', 'human', 'Your controls')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [webMcpStatus])

  const webMcp = {
    registering: { label: 'Connecting tools', tone: 'waiting' as const, icon: LoaderCircle },
    ready: { label: 'WebMCP ready', tone: 'ready' as const, icon: CheckCircle2 },
    unsupported: { label: 'WebMCP unavailable', tone: 'waiting' as const, icon: ShieldAlert },
    error: { label: 'WebMCP error', tone: 'failed' as const, icon: AlertTriangle },
  }[webMcpStatus]
  const worldTone = worldStatus.kind === 'ready' ? 'ready' : worldStatus.kind === 'error' ? 'failed' : 'waiting'
  const WorldIcon = worldStatus.kind === 'ready' ? CheckCircle2 : worldStatus.kind === 'error' ? AlertTriangle : LoaderCircle

  return (
    <TooltipProvider>
      <main className="app-shell">
        <Suspense fallback={<div className="flight-world world-loading" />}>
          <FlightWorld cameraMode={cameraMode} onStatusChange={setWorldStatus} />
        </Suspense>
        <div className="scene-shade" />

        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white text-black">
              <Plane className="size-4 -rotate-12" strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <strong className="block truncate text-[13px] font-semibold tracking-[-0.02em]">Flightdeck</strong>
              <span className="block truncate font-mono text-[8px] tracking-[0.16em] text-white/38 uppercase">KPWK compact circuit · N417FS</span>
            </div>
          </div>

          <div
            className="mission-progress"
            aria-label={`Mission phase ${formatMissionLabel(state.mission.phase)}`}
          >
            <span>Phase</span>
            <strong>{formatMissionLabel(state.mission.phase)}</strong>
            <i aria-hidden="true" />
            <span>Next</span>
            <strong>
              {state.mission.nextFix ? formatMissionLabel(state.mission.nextFix) : 'Full stop'}
            </strong>
            <small>
              {state.mission.nextFix && state.mission.distanceToNextFixNm !== null
                ? `${state.mission.distanceToNextFixNm.toFixed(1)} NM`
                : state.mission.outcome !== 'in_progress'
                  ? formatMissionLabel(state.mission.outcome)
                  : state.mission.awaitingCommand
                    ? 'Awaiting command'
                    : 'En route'}
            </small>
          </div>

          <div className="flex items-center justify-end gap-1.5">
            <StatusBadge tone={worldTone} icon={WorldIcon}>{worldStatus.kind === 'setup' ? 'World setup' : worldStatus.kind}</StatusBadge>
            <StatusBadge tone={webMcp.tone} icon={webMcp.icon}>{webMcp.label}</StatusBadge>
          </div>
        </header>

        <nav className="camera-rail" aria-label="Camera mode">
          {cameraOptions.map(({ mode, label, icon: Icon }) => (
            <Tooltip key={mode}>
              <TooltipTrigger
                render={
                  <Button
                    variant={cameraMode === mode ? 'default' : 'ghost'}
                    size="icon"
                    aria-label={label}
                    aria-pressed={cameraMode === mode}
                    onClick={() => setCameraMode(mode)}
                  />
                }
              >
                <Icon />
              </TooltipTrigger>
              <TooltipContent side="right">{label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>

        <div className="owner-control">
          {state.controlOwner === 'agent' ? (
            <StatusBadge tone="agent" icon={Bot}>Agent flying</StatusBadge>
          ) : (
            <StatusBadge tone="neutral" icon={UserRound}>You are flying</StatusBadge>
          )}
          {state.controlOwner === 'agent' ? (
            <Button className="take-controls" size="sm" onClick={takeControls}>
              <CircleStop data-icon="inline-start" /> My controls
            </Button>
          ) : null}
        </div>

        <section className="instrument-deck" aria-label="Flight controls and instruments">
          <div className="instrument-grid">
            <Stat label="Airspeed" value={Math.round(state.airspeedKt).toString()} unit="KT" />
            <Stat label="Altitude" value={Math.round(state.altitudeFt).toLocaleString()} unit="FT" />
            <Stat label="Vertical" value={Math.round(state.verticalSpeedFpm).toString()} unit="FPM" />
            <Stat label="Heading" value={Math.round(state.headingDeg).toString().padStart(3, '0')} unit="MAG" />
          </div>

          <div className="configuration-controls">
            <Button
              variant="outline"
              size="sm"
              disabled={state.controlOwner === 'agent'}
              onClick={() => flightSimulator.setGear(!state.gearDown, 'human', 'Cockpit gear control')}
            >
              Gear <span className="font-mono text-[10px] text-white/60">{state.gearDown ? 'DOWN' : 'UP'}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={state.controlOwner === 'agent'}
              onClick={() => {
                const index = flapSettings.indexOf(state.flapsDeg)
                flightSimulator.setFlaps(flapSettings[(index + 1) % flapSettings.length], 'human', 'Cockpit flap control')
              }}
            >
              Flaps <span className="font-mono text-[10px] text-white/60">{state.flapsDeg}°</span>
            </Button>
            <label className="throttle-control">
              <span>Throttle</span>
              <Slider
                aria-label="Throttle"
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

        <aside className="right-rail">
          <WebMcpActivityPanel
            status={webMcpStatus}
            activities={webMcpActivities}
            controlOwner={state.controlOwner}
            mission={state.mission}
          />

          <div className="right-rail-actions">
            <Button
              variant={state.controlOwner === 'human' ? 'default' : 'outline'}
              className={state.controlOwner === 'agent' ? 'take-controls' : ''}
              disabled={state.controlOwner === 'human' && webMcpStatus !== 'ready'}
              onClick={() =>
                flightSimulator.transferControl(
                  state.controlOwner === 'human' ? 'agent' : 'human',
                  'human',
                  state.controlOwner === 'human' ? 'Your controls' : 'My controls',
                )
              }
            >
              {state.controlOwner === 'human' ? (
                webMcpStatus === 'ready' ? <Bot data-icon="inline-start" /> : <ShieldAlert data-icon="inline-start" />
              ) : (
                <CircleStop data-icon="inline-start" />
              )}
              {state.controlOwner === 'human'
                ? webMcpStatus === 'ready'
                  ? 'Give agent controls'
                  : 'WebMCP required'
                : 'My controls'}
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Toggle flight director"
                    onClick={() =>
                      flightSimulator.setFlightDirector(
                        { enabled: !state.flightDirector.enabled },
                        'human',
                        'Cockpit flight-director toggle',
                      )
                    }
                  />
                }
              >
                <Gauge className={state.flightDirector.enabled ? 'text-blue-400' : ''} />
              </TooltipTrigger>
              <TooltipContent>Flight director {state.flightDirector.enabled ? 'engaged' : 'standby'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={state.scenario === 'clear' ? 'Inject engine instability' : 'Clear engine instability'}
                    onClick={() =>
                      flightSimulator.triggerScenario(
                        state.scenario === 'clear' ? 'engine_instability' : 'clear',
                        'human',
                        state.scenario === 'clear' ? 'Start abnormal training event' : 'Clear training event',
                      )
                    }
                  />
                }
              >
                <AlertTriangle className={state.scenario === 'clear' ? '' : 'text-amber-400'} />
              </TooltipTrigger>
              <TooltipContent>{state.scenario === 'clear' ? 'Inject engine instability' : 'Clear active scenario'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="outline" size="icon" aria-label="Reset flight" onClick={() => flightSimulator.reset()} />}
              >
                <RefreshCw />
              </TooltipTrigger>
              <TooltipContent>Reset at KPWK</TooltipContent>
            </Tooltip>
          </div>
        </aside>

        <div className="control-hints" aria-label="Keyboard controls">
          <Route className="size-3" />
          <span><kbd>W</kbd><kbd>S</kbd> pitch</span>
          <span><kbd>A</kbd><kbd>D</kbd> bank</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> power</span>
          {webMcpStatus === 'ready' ? <span><kbd>T</kbd> handoff</span> : null}
        </div>
      </main>
    </TooltipProvider>
  )
}
