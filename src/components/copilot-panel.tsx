import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import { Button } from './ui/button'

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
}

export interface CopilotDiagnostics {
  readonly world: string
  readonly webMcp: string
  readonly missionRevision: number
  readonly scenarioId: string
  readonly recentTools: readonly string[]
}

export interface CopilotPanelProps {
  readonly phase: string
  readonly headline: string
  readonly observations: readonly CopilotObservation[]
  readonly recommendation: string
  readonly plan: readonly string[]
  readonly action: string
  readonly approvalPending: boolean
  readonly approvalPrompt: string
  readonly debrief: CopilotDebrief | null
  readonly diagnostics: CopilotDiagnostics
  readonly onApprove: () => void
  readonly onDeny: () => void
  readonly onReset: () => void
}

function MissionDebrief({
  debrief,
  onReset,
}: {
  readonly debrief: CopilotDebrief
  readonly onReset: () => void
}) {
  const landed = debrief.outcome === 'Landed'
  const DebriefIcon = landed ? Check : CircleAlert

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

      {debrief.events.length > 0 ? (
        <ol className="debrief-events" aria-label="Key flight events">
          {debrief.events.map((event, index) => <li key={`${index}-${event}`}>{event}</li>)}
        </ol>
      ) : null}

      <Button variant="outline" className="debrief-reset" onClick={onReset}>
        <RotateCcw data-icon="inline-start" /> Fly again
      </Button>
    </div>
  )
}

export function CopilotPanel({
  phase,
  headline,
  observations,
  recommendation,
  plan,
  action,
  approvalPending,
  approvalPrompt,
  debrief,
  diagnostics,
  onApprove,
  onDeny,
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

      {debrief ? (
        <MissionDebrief debrief={debrief} onReset={onReset} />
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

          {approvalPending ? (
            <section className="approval-request" role="alert" aria-labelledby="approval-title">
              <div className="approval-heading">
                <ShieldCheck aria-hidden="true" />
                <h2 id="approval-title">Your decision</h2>
              </div>
              <p>{approvalPrompt}</p>
              <div className="approval-actions">
                <Button onClick={onApprove}>Approve</Button>
                <Button variant="outline" onClick={onDeny}>Decline</Button>
              </div>
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
