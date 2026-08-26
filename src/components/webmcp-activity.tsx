import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react'
import { Button } from './ui/button'
import type { CheckrideState, ControlOwner } from '../sim/types'
import type { WebMcpActivity as WebMcpActivityItem, WebMcpStatus } from '../webmcp/useWebMcp'

export interface WebMcpActivityProps {
  readonly status: WebMcpStatus
  readonly controlOwner: ControlOwner
  readonly activities: readonly WebMcpActivityItem[]
  readonly checkride: CheckrideState
  readonly onResolveHumanApproval: (approved: boolean) => void
  readonly mission: {
    readonly phase: string
    readonly eventRevision: number
  }
}

const statusDetails = {
  registering: {
    label: 'Connecting tools',
    description: 'Registering the flight controls with this browser.',
    icon: LoaderCircle,
  },
  ready: {
    label: 'WebMCP ready',
    description: 'The browser agent can discover and call the registered flight tools.',
    icon: CheckCircle2,
  },
  unsupported: {
    label: 'WebMCP unavailable',
    description: 'This browser cannot discover the tools. Manual flight controls still work.',
    icon: AlertTriangle,
  },
  error: {
    label: 'Tool connection failed',
    description: 'The page could not register its flight tools with this browser.',
    icon: AlertTriangle,
  },
} as const

const promptExamples = [
  'Start checkride seed 42, brief it, and take the controls.',
  'Use wait_for_flight_event instead of polling for the next decision.',
  'Inspect the evidence, explain your risk call, and finish the mission.',
] as const

const formatMissionLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase())

function ActivityReceipt({ activity }: { readonly activity: WebMcpActivityItem }) {
  const completed = activity.status === 'completed'
  const ActivityIcon = completed ? CheckCircle2 : AlertTriangle
  const timestamp = new Date(activity.timestamp)

  return (
    <li className={`webmcp-receipt webmcp-receipt-${activity.status}`}>
      <div className="webmcp-receipt-icon" aria-hidden="true">
        <ActivityIcon />
      </div>
      <div className="webmcp-receipt-body">
        <div className="webmcp-receipt-heading">
          <strong>{activity.title}</strong>
          <time dateTime={timestamp.toISOString()}>
            {timestamp.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </time>
        </div>
        <p>{activity.summary}</p>
        <code className="webmcp-receipt-tool">{activity.tool}</code>
      </div>
    </li>
  )
}

export function WebMcpActivityPanel({
  status,
  controlOwner,
  activities,
  checkride,
  mission,
  onResolveHumanApproval,
}: WebMcpActivityProps) {
  const currentStatus = statusDetails[status]
  const StatusIcon = currentStatus.icon
  const recentActivities = activities.slice(-5).reverse()

  return (
    <section className="webmcp-activity" aria-label="WebMCP activity">
      <header className="webmcp-activity-header">
        <div className="webmcp-activity-title">
          <Bot aria-hidden="true" />
          <h1>Browser agent</h1>
        </div>
        <span
          className={`webmcp-status webmcp-status-${status}`}
          role="status"
          aria-live="polite"
        >
          <StatusIcon aria-hidden="true" />
          {currentStatus.label}
        </span>
      </header>

      <p className="webmcp-explainer">
        Your browser agent calls the flight tools registered by this page. The simulator runs each
        call locally and shows the result here.
      </p>
      <p className="webmcp-status-description">{currentStatus.description}</p>

      <div className="webmcp-control-owner">
        <span>Flight control</span>
        <strong>{controlOwner === 'agent' ? 'Browser agent' : 'Human pilot'}</strong>
      </div>

      <dl className="mission-evidence" aria-label="Mission status">
        <div>
          <dt>Phase</dt>
          <dd>{formatMissionLabel(mission.phase)}</dd>
        </div>
        <div>
          <dt>Event revision</dt>
          <dd>{mission.eventRevision}</dd>
        </div>
        <div>
          <dt>Fuel endurance</dt>
          <dd>{checkride.fuelMinutesRemaining.toFixed(1)} min</dd>
        </div>
        <div>
          <dt>Score</dt>
          <dd className={checkride.score.total >= 80 ? 'evidence-good' : undefined}>
            {checkride.score.total} / 100
          </dd>
        </div>
      </dl>

      {checkride.alert ? (
        <section className="checkride-alert" aria-live="polite">
          <div className="checkride-alert-heading">
            <span>Seed {checkride.seed}</span>
            <strong>{formatMissionLabel(checkride.status)}</strong>
          </div>
          <p>{checkride.alert}</p>
          <div className="checkride-alert-meta">
            <span>{checkride.inspectedSources.length}/4 sources checked</span>
            {checkride.decision ? <span>Decision: {formatMissionLabel(checkride.decision)}</span> : null}
          </div>
          {checkride.humanApproval === 'pending' ? (
            <div className="human-approval" aria-label="Human authority decision">
              <div>
                <ShieldCheck aria-hidden="true" />
                <span>The agent requests a risky priority approach.</span>
              </div>
              <div>
                <Button size="sm" onClick={() => onResolveHumanApproval(true)}>Approve</Button>
                <Button variant="outline" size="sm" onClick={() => onResolveHumanApproval(false)}>Deny</Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="webmcp-receipts">
        <div className="webmcp-section-heading">
          <h2>Recent tool calls</h2>
          <span>{recentActivities.length}</span>
        </div>
        {recentActivities.length > 0 ? (
          <ol className="webmcp-receipt-list">
            {recentActivities.map((activity) => (
              <ActivityReceipt key={activity.id} activity={activity} />
            ))}
          </ol>
        ) : (
          <p className="webmcp-empty-receipts">No tool calls yet.</p>
        )}
      </section>

      <section className="webmcp-prompts">
        <h2>Try in your browser agent</h2>
        <ul>
          {promptExamples.map((prompt) => (
            <li key={prompt}>
              <code>{prompt}</code>
            </li>
          ))}
        </ul>
      </section>
    </section>
  )
}
