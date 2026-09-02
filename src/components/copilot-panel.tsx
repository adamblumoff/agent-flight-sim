import { useEffect, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  RotateCcw,
} from 'lucide-react'
import { Button } from './ui/button'
import type { WebMcpActivity } from '../webmcp/useWebMcp'
import type { FlightRunExport } from '../webmcp/runExport'
import { RadioTranscript, type RadioTranscriptProps } from './radio-transcript'

export interface CopilotObservation {
  readonly label: string
  readonly value: string
  readonly tone?: 'normal' | 'caution' | 'critical'
}

export interface CopilotDebrief {
  readonly title: string
  readonly outcome: string
  readonly elapsed: string
  readonly score: string
  readonly decision: string
  readonly summary: string
  readonly events: readonly string[]
  readonly deductions: readonly {
    readonly elapsed: string
    readonly label: string
    readonly points: number
    readonly reason: string
  }[]
}

export interface CopilotDiagnostics {
  readonly world: string
  readonly webMcp: string
  readonly missionRevision: number
  readonly scenarioId: string
  readonly buildId: string
  readonly profileId: string
  readonly recentTools: readonly string[]
}

export interface CopilotCrewAction {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly onSelect: () => void
}

export interface CopilotPanelProps {
  readonly radio: RadioTranscriptProps
  readonly phase: string
  readonly headline: string
  readonly observations: readonly CopilotObservation[]
  readonly recommendation: string
  readonly plan: readonly string[]
  readonly action: string
  readonly crewActions: readonly CopilotCrewAction[]
  readonly crewActionStatus: string | null
  readonly debrief: CopilotDebrief | null
  readonly diagnostics: CopilotDiagnostics
  readonly webMcpActivities: readonly WebMcpActivity[]
  readonly runExport: FlightRunExport | null
  readonly onReset: () => void
}

function MissionDebrief({
  debrief,
  runExport,
  onReset,
}: {
  readonly debrief: CopilotDebrief
  readonly runExport: FlightRunExport | null
  readonly onReset: () => void
}) {
  const landed = debrief.outcome === 'Landed'
  const DebriefIcon = landed ? Check : CircleAlert
  const [runExportHref, setRunExportHref] = useState<string | null>(null)

  useEffect(() => {
    if (!runExport) {
      setRunExportHref(null)
      return
    }
    const href = URL.createObjectURL(new Blob([JSON.stringify(runExport, null, 2)], { type: 'application/json' }))
    setRunExportHref(href)
    return () => URL.revokeObjectURL(href)
  }, [runExport])

  return (
    <div className="mission-debrief">
      <div className={`debrief-mark${landed ? '' : ' debrief-mark-failed'}`} aria-hidden="true">
        <DebriefIcon />
      </div>
      <p className="panel-eyebrow">Flight debrief</p>
      <h2>{debrief.title}</h2>
      <p className="debrief-summary">{debrief.summary}</p>

      <dl className="debrief-facts">
        <div>
          <dt>Outcome</dt>
          <dd>{debrief.outcome}</dd>
        </div>
        <div>
          <dt>Elapsed</dt>
          <dd>{debrief.elapsed}</dd>
        </div>
        <div>
          <dt>Decision</dt>
          <dd>{debrief.decision}</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd>{debrief.score}</dd>
        </div>
      </dl>

      <section className="debrief-score" aria-labelledby="score-breakdown-title">
        <div className="debrief-score-heading">
          <h3 id="score-breakdown-title">Score breakdown</h3>
          <span>Started at 100</span>
        </div>
        {debrief.deductions.length > 0 ? (
          <ol>
            {debrief.deductions.map((deduction, index) => (
              <li key={`${index}-${deduction.elapsed}-${deduction.label}`}>
                <time>{deduction.elapsed}</time>
                <div>
                  <strong>{deduction.reason}</strong>
                  <span>{deduction.label}</span>
                </div>
                <b>−{deduction.points}</b>
              </li>
            ))}
          </ol>
        ) : (
          <p>No points deducted on this run.</p>
        )}
      </section>

      {debrief.events.length > 0 ? (
        <ol className="debrief-events" aria-label="Key flight events">
          {debrief.events.map((event, index) => <li key={`${index}-${event}`}>{event}</li>)}
        </ol>
      ) : null}

      {runExportHref ? (
        <section className="debrief-export" aria-labelledby="run-export-title">
          <div>
            <h3 id="run-export-title">Complete run export</h3>
            <p>{runExport?.calls.length ?? 0} WebMCP calls · results, telemetry, rewards, radio, trace, and final state</p>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href={runExportHref} download={`flightdeck-run-${runExport?.run.runId ?? 'export'}.json`} />}
          >
            <Download data-icon="inline-start" /> Export JSON
          </Button>
        </section>
      ) : null}

      <Button variant="outline" className="debrief-reset" onClick={onReset}>
        <RotateCcw data-icon="inline-start" /> Fly again
      </Button>
    </div>
  )
}

export function CopilotPanel({
  radio,
  phase,
  headline,
  observations,
  recommendation,
  plan,
  action,
  crewActions,
  crewActionStatus,
  debrief,
  diagnostics,
  webMcpActivities,
  runExport,
  onReset,
}: CopilotPanelProps) {
  return (
    <aside className="copilot-panel" aria-label="Flight copilot">
      <header className="copilot-header">
        <span className="copilot-avatar" aria-hidden="true"><Bot /></span>
        <div>
          <p className="panel-eyebrow">Copilot</p>
          <h1>{debrief ? 'Mission complete' : headline}</h1>
        </div>
        <span className="phase-label">{phase}</span>
      </header>

      <RadioTranscript {...radio} maxRecent={1} />

      {debrief ? (
        <MissionDebrief debrief={debrief} runExport={runExport} onReset={onReset} />
      ) : (
        <div className="copilot-body">
          <section className="panel-section observation-section" aria-labelledby="observations-title">
            <h2 id="observations-title">What I see</h2>
            <dl className="observation-list">
              {observations.map((observation) => (
                <div key={observation.label} data-tone={observation.tone ?? 'normal'}>
                  <dt>{observation.label}</dt>
                  <dd>{observation.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="panel-section recommendation-section" aria-labelledby="recommendation-title">
            <h2 id="recommendation-title">Recommendation</h2>
            <p>{recommendation}</p>
          </section>

          <section className="panel-section plan-section" aria-labelledby="plan-title">
            <h2 id="plan-title">Plan</h2>
            <ol>
              {plan.map((step, index) => (
                <li key={step}>
                  <span>{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="copilot-action" aria-live="polite">
            <span>Now</span>
            <strong>{action}</strong>
          </section>

          {crewActions.length > 0 || crewActionStatus ? (
            <section className="crew-decision" aria-labelledby="crew-decision-title" aria-live="polite">
              <h2 id="crew-decision-title">Flight crew decision</h2>
              {crewActionStatus ? <p>{crewActionStatus}</p> : null}
              {crewActions.length > 0 ? (
                <div className="crew-decision-actions">
                  {crewActions.map((crewAction) => (
                    <Button key={crewAction.id} variant="outline" onClick={crewAction.onSelect}>
                      <span>{crewAction.label}</span>
                      <small>{crewAction.description}</small>
                    </Button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {webMcpActivities.length > 0 ? (
            <section className="agent-trace" aria-labelledby="agent-trace-title" aria-live="polite">
              <div className="agent-trace-heading">
                <h2 id="agent-trace-title">Live WebMCP trace</h2>
                <span>{webMcpActivities.length} calls</span>
              </div>
              <ol>
                {webMcpActivities.slice(-4).reverse().map((activity) => {
                  const reason = typeof activity.arguments.reason === 'string'
                    ? activity.arguments.reason
                    : typeof activity.arguments.requested_action === 'string'
                      ? activity.arguments.requested_action
                      : null
                  return (
                    <li key={activity.id} data-status={activity.status}>
                      <div>
                        <strong>{activity.tool}</strong>
                        <span>{activity.status === 'running' ? 'thinking…' : `${activity.latencyMs ?? 0} ms · ${activity.rewardDelta && activity.rewardDelta !== 0 ? `${activity.rewardDelta > 0 ? '+' : ''}${activity.rewardDelta} reward` : 'no score change'}`}</span>
                      </div>
                      {reason ? <p>{reason}</p> : null}
                      <small>{activity.summary}</small>
                    </li>
                  )
                })}
              </ol>
            </section>
          ) : null}

        </div>
      )}

      <details className="debug-disclosure">
        <summary>
          <CircleAlert aria-hidden="true" />
          Diagnostics
          <ChevronDown className="debug-chevron" aria-hidden="true" />
        </summary>
        <dl>
          <div><dt>World</dt><dd>{diagnostics.world}</dd></div>
          <div><dt>WebMCP</dt><dd>{diagnostics.webMcp}</dd></div>
          <div><dt>Revision</dt><dd>{diagnostics.missionRevision}</dd></div>
          <div><dt>Scenario</dt><dd>{diagnostics.scenarioId}</dd></div>
          <div><dt>Build</dt><dd>{diagnostics.buildId}</dd></div>
          <div><dt>Profile</dt><dd>{diagnostics.profileId}</dd></div>
        </dl>
        {diagnostics.recentTools.length > 0 ? (
          <div className="debug-tools">
            <span>Recent tools</span>
            <ul>{diagnostics.recentTools.map((tool, index) => <li key={`${index}-${tool}`}>{tool}</li>)}</ul>
          </div>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw data-icon="inline-start" /> Reset scenario
        </Button>
      </details>
    </aside>
  )
}
