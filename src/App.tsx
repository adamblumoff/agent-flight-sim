import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  CircleGauge,
  MapPin,
  Plane,
  RefreshCw,
  UserRound,
} from 'lucide-react'
import { flightSimulator } from './sim/flightSimulator'
import type { TraceEvent } from './sim/types'
import { useWebMcp } from './webmcp/useWebMcp'

const FlightWorld = lazy(() => import('./world/FlightWorld'))

const flapSettings = [0, 10, 20, 30]

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes.toString().padStart(2, '0')}:${remainder.toString().padStart(2, '0')}`
}

function formatTraceAction(event: TraceEvent) {
  return event.action.replaceAll('_', ' ')
}

function Instrument({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="instrument">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{unit}</small>
    </div>
  )
}

export default function App() {
  const state = useSyncExternalStore(
    flightSimulator.subscribe,
    flightSimulator.getSnapshot,
    flightSimulator.getSnapshot,
  )
  const webMcpStatus = useWebMcp()
  const trace = flightSimulator.getTrace()

  useEffect(() => {
    flightSimulator.start()
    return () => flightSimulator.stop()
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const current = flightSimulator.getState()
      const key = event.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'w', 'a', 's', 'd', 'f', 'g', 't'].includes(key)) {
        event.preventDefault()
      }

      if (current.controlOwner === 'human') {
        if (key === 'w') flightSimulator.applyPilotInput({ pitchDelta: 1 }, 'human', 'Pilot input')
        if (key === 's') flightSimulator.applyPilotInput({ pitchDelta: -1 }, 'human', 'Pilot input')
        if (key === 'a') flightSimulator.applyPilotInput({ bankDelta: -3 }, 'human', 'Pilot input')
        if (key === 'd') flightSimulator.applyPilotInput({ bankDelta: 3 }, 'human', 'Pilot input')
      }

      if (key === 'arrowup') {
        flightSimulator.setThrottle(current.throttle + 0.05, 'human', 'Pilot throttle input')
      }
      if (key === 'arrowdown') {
        flightSimulator.setThrottle(current.throttle - 0.05, 'human', 'Pilot throttle input')
      }
      if (key === 'g') {
        flightSimulator.setGear(!current.gearDown, 'human', 'Pilot gear command')
      }
      if (key === 'f') {
        const index = flapSettings.indexOf(current.flapsDeg)
        const next = flapSettings[(index + 1) % flapSettings.length]
        flightSimulator.setFlaps(next, 'human', 'Pilot flap command')
      }
      if (key === 't') {
        const owner = current.controlOwner === 'human' ? 'agent' : 'human'
        flightSimulator.transferControl(owner, 'human', 'Explicit cockpit handoff')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const webMcpLabel = {
    registering: 'Connecting tools',
    ready: 'WebMCP live',
    unsupported: 'WebMCP preview',
    error: 'Tool connection failed',
  }[webMcpStatus]

  const copilotMessage =
    state.scenario === 'engine_instability'
      ? 'RPM is unstable. Hold 92 knots. I can manage the checklist while you keep the wings level.'
      : state.controlOwner === 'agent'
        ? `I have the aircraft. Holding ${Math.round(state.flightDirector.altitudeFt).toLocaleString()} feet and heading ${Math.round(state.flightDirector.headingDeg).toString().padStart(3, '0')}.`
        : 'Your aircraft. I am monitoring the route, configuration, and approach gates.'

  return (
    <main className="app-shell">
      <Suspense fallback={<div className="flight-world world-loading" />}>
        <FlightWorld />
      </Suspense>
      <div className="scene-shade" />

      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark"><Plane size={17} strokeWidth={1.7} /></span>
          <div>
            <strong>Agent Flight Sim</strong>
            <span>Shared cockpit prototype</span>
          </div>
        </div>

        <div className="route-summary" aria-label="Route progress">
          <div><span>PWK</span><small>Chicago Exec</small></div>
          <div className="route-line">
            <i style={{ width: `${Math.max(3, state.routeProgress * 100)}%` }} />
            <Plane size={13} style={{ left: `${Math.min(96, state.routeProgress * 100)}%` }} />
          </div>
          <div><span>MDW</span><small>Chicago Midway</small></div>
        </div>

        <div className={`connection-status ${webMcpStatus}`}>
          <i />
          {webMcpLabel}
        </div>
      </header>

      <section className="flight-hud" aria-label="Primary flight display">
        <div
          className="horizon-grid"
          style={{
            transform: `translateY(${state.pitchDeg * 4}px) rotate(${-state.bankDeg}deg)`,
          }}
        >
          <span /><span /><span /><span /><span />
        </div>
        <div className="flight-path-marker"><i /><b /></div>
        <div className="heading-bug">{Math.round(state.headingDeg).toString().padStart(3, '0')}°</div>
      </section>

      <div className="control-owner">
        {state.controlOwner === 'human' ? <UserRound size={14} /> : <Bot size={14} />}
        <span>{state.controlOwner === 'human' ? 'You have control' : 'Copilot has control'}</span>
      </div>

      <section className="instrument-deck" aria-label="Flight instruments">
        <div className="primary-instruments">
          <Instrument label="Airspeed" value={Math.round(state.airspeedKt).toString()} unit="KT" />
          <Instrument label="Altitude" value={Math.round(state.altitudeFt).toLocaleString()} unit="FT" />
          <Instrument label="Vertical" value={Math.round(state.verticalSpeedFpm).toString()} unit="FPM" />
          <Instrument label="Heading" value={Math.round(state.headingDeg).toString().padStart(3, '0')} unit="MAG" />
        </div>

        <div className="aircraft-config">
          <button
            type="button"
            onClick={() => flightSimulator.setGear(!state.gearDown, 'human', 'Cockpit gear control')}
          >
            <span>Gear</span>
            <strong>{state.gearDown ? 'Down' : 'Up'}</strong>
          </button>
          <button
            type="button"
            onClick={() => {
              const index = flapSettings.indexOf(state.flapsDeg)
              flightSimulator.setFlaps(
                flapSettings[(index + 1) % flapSettings.length],
                'human',
                'Cockpit flap control',
              )
            }}
          >
            <span>Flaps</span>
            <strong>{state.flapsDeg}°</strong>
          </button>
          <label>
            <span>Throttle</span>
            <input
              aria-label="Throttle"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={state.throttle}
              onChange={(event) =>
                flightSimulator.setThrottle(
                  Number(event.target.value),
                  'human',
                  'Cockpit throttle control',
                )
              }
            />
            <strong>{Math.round(state.throttle * 100)}%</strong>
          </label>
        </div>
      </section>

      <aside className="copilot-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow"><Bot size={13} /> AI copilot</span>
            <h1>Shared flight</h1>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Reset flight"
            title="Reset flight"
            onClick={() => flightSimulator.reset()}
          >
            <RefreshCw size={15} />
          </button>
        </div>

        <div className="copilot-message">
          <span className="speaker"><Bot size={14} /></span>
          <p>{copilotMessage}</p>
        </div>

        <button
          type="button"
          className={`handoff-button ${state.controlOwner}`}
          onClick={() => {
            const owner = state.controlOwner === 'human' ? 'agent' : 'human'
            flightSimulator.transferControl(owner, 'human', 'Explicit cockpit handoff')
          }}
        >
          <span>{state.controlOwner === 'human' ? 'Give copilot control' : 'I have control'}</span>
          <ChevronRight size={16} />
        </button>

        <section className="flight-director">
          <div className="section-title">
            <span><CircleGauge size={14} /> Flight director</span>
            <button
              type="button"
              className={state.flightDirector.enabled ? 'active' : ''}
              onClick={() =>
                flightSimulator.setFlightDirector(
                  { enabled: !state.flightDirector.enabled },
                  'human',
                  'Flight-director toggle',
                )
              }
            >
              {state.flightDirector.enabled ? 'Engaged' : 'Standby'}
            </button>
          </div>
          <div className="director-targets">
            <div><span>ALT</span><strong>{Math.round(state.flightDirector.altitudeFt).toLocaleString()}</strong><small>FT</small></div>
            <div><span>HDG</span><strong>{Math.round(state.flightDirector.headingDeg).toString().padStart(3, '0')}</strong><small>°</small></div>
            <div><span>IAS</span><strong>{Math.round(state.flightDirector.airspeedKt)}</strong><small>KT</small></div>
          </div>
        </section>

        <button
          type="button"
          className={`scenario-button ${state.scenario !== 'clear' ? 'active' : ''}`}
          onClick={() =>
            flightSimulator.triggerScenario(
              state.scenario === 'clear' ? 'engine_instability' : 'clear',
              'human',
              state.scenario === 'clear' ? 'Start abnormal training event' : 'Clear training event',
            )
          }
        >
          <AlertTriangle size={14} />
          {state.scenario === 'clear' ? 'Inject engine instability' : 'Clear engine instability'}
        </button>

        <section className="flight-recorder">
          <div className="section-title">
            <span><MapPin size={14} /> Flight recorder</span>
            <small>{trace.length} events</small>
          </div>
          <div className="trace-list">
            {trace.slice(-5).reverse().map((event) => (
              <article key={event.id}>
                <time>{formatElapsed(event.elapsedSeconds)}</time>
                <i className={event.actor} />
                <div>
                  <strong>{formatTraceAction(event)}</strong>
                  <p>{event.reason}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="control-hints">
          <span><kbd>W</kbd><kbd>S</kbd> Pitch</span>
          <span><kbd>A</kbd><kbd>D</kbd> Bank</span>
          <span><kbd>↑</kbd><kbd>↓</kbd> Power</span>
          <span><kbd>T</kbd> Handoff</span>
        </div>
      </aside>
    </main>
  )
}
