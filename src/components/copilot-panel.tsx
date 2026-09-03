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
import { cn } from '../lib/utils'
import { eyebrow, flightPanel, sectionTitle } from './flight-ui'
import type { CopilotDebrief, CopilotObservation } from '../presentation/flightPresentation'

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
    <div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-color:rgb(244_239_222/20%)_transparent] [scrollbar-width:thin]">
      <div className={cn('mb-4 grid size-10 place-items-center rounded-full border border-[#8bc49b]/25 bg-[#8bc49b]/12 text-[#8bc49b] [&_svg]:size-5', !landed && 'border-[#e78068]/25 bg-[#e78068]/12 text-[#e78068]')} aria-hidden="true">
        <DebriefIcon />
      </div>
      <p className={eyebrow}>Flight debrief</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">{debrief.title}</h2>
      <p className="mt-2 text-xs leading-relaxed text-[#b9b3a3]">{debrief.summary}</p>

      <dl className="my-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[#f4efde]/10 bg-[#f4efde]/10 [&>div]:bg-[#171815] [&>div]:p-3 [&_dt]:font-mono [&_dt]:text-[7px] [&_dt]:uppercase [&_dt]:tracking-[0.1em] [&_dt]:text-[#b9b3a3] [&_dd]:mt-1 [&_dd]:text-xs [&_dd]:font-semibold">
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

      <section className="border-t border-[#f4efde]/10 py-4" aria-labelledby="score-breakdown-title">
        <div className="flex items-center justify-between gap-3">
          <h3 className={sectionTitle} id="score-breakdown-title">Score breakdown</h3>
          <span className="font-mono text-[7px] uppercase text-[#b9b3a3]">Started at 100</span>
        </div>
        {debrief.deductions.length > 0 ? (
          <ol className="mt-3 grid list-none gap-2">
            {debrief.deductions.map((deduction, index) => (
              <li className="grid grid-cols-[36px_1fr_auto] items-start gap-2 rounded-md bg-[#f4efde]/5 p-2 text-[10px]" key={`${index}-${deduction.elapsed}-${deduction.label}`}>
                <time className="font-mono text-[8px] text-[#b9b3a3]">{deduction.elapsed}</time>
                <div className="grid gap-0.5">
                  <strong className="font-medium leading-snug">{deduction.reason}</strong>
                  <span className="font-mono text-[7px] uppercase text-[#b9b3a3]">{deduction.label}</span>
                </div>
                <b className="font-mono text-[#e78068]">−{deduction.points}</b>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-[11px] text-[#b9b3a3]">No points deducted on this run.</p>
        )}
      </section>

      {debrief.events.length > 0 ? (
        <ol className="grid list-decimal gap-1 border-t border-[#f4efde]/10 py-4 pl-5 text-[10px] leading-relaxed text-[#b9b3a3]" aria-label="Key flight events">
          {debrief.events.map((event, index) => <li key={`${index}-${event}`}>{event}</li>)}
        </ol>
      ) : null}

      {runExportHref ? (
        <section className="flex items-center justify-between gap-3 rounded-lg border border-[#8bc49b]/15 bg-[#8bc49b]/5 p-3" aria-labelledby="run-export-title">
          <div>
            <h3 className="text-xs font-semibold" id="run-export-title">Complete run export</h3>
            <p className="mt-1 text-[9px] leading-snug text-[#b9b3a3]">{runExport?.calls.length ?? 0} WebMCP calls · results, telemetry, rewards, radio, trace, and final state</p>
          </div>
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href={runExportHref} download={`agent-flight-run-${runExport?.run.runId ?? 'export'}.json`} />}
          >
            <Download data-icon="inline-start" /> Export JSON
          </Button>
        </section>
      ) : null}

      <Button variant="outline" className="mt-4 w-full" onClick={onReset}>
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
    <aside className={cn(flightPanel, 'absolute bottom-5 right-5 top-[76px] z-[9] flex w-[340px] flex-col overflow-hidden rounded-2xl max-xl:w-[310px] max-md:bottom-3 max-md:left-3 max-md:right-3 max-md:top-auto max-md:h-[min(49vh,430px)] max-md:w-auto max-[480px]:h-[min(52vh,440px)]')} aria-label="Flight copilot">
      <header className="grid min-h-[64px] grid-cols-[34px_1fr_auto] items-center gap-2.5 border-b border-[#f4efde]/12 px-3.5 py-3 max-[480px]:min-h-[58px] max-[480px]:py-2">
        <span className="grid size-[34px] place-items-center rounded-lg bg-[#8bc49b]/15 text-[#8bc49b] [&_svg]:size-4" aria-hidden="true"><Bot /></span>
        <div className="min-w-0">
          <p className={eyebrow}>Copilot</p>
          <h1 className="mt-1 truncate text-sm font-semibold tracking-[-0.02em]">{debrief ? 'Mission complete' : headline}</h1>
        </div>
        <span className="font-mono text-[7px] font-semibold uppercase tracking-[0.1em] text-[#b9b3a3]">{phase}</span>
      </header>

      <RadioTranscript {...radio} maxRecent={1} />

      {debrief ? (
        <MissionDebrief debrief={debrief} runExport={runExport} onReset={onReset} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgb(244_239_222/20%)_transparent] [scrollbar-width:thin]">
          <section className="border-b border-[#f4efde]/10 px-4 py-4 max-[480px]:py-3.5" aria-labelledby="observations-title">
            <h2 className={sectionTitle} id="observations-title">What I see</h2>
            <dl className="mt-3 grid gap-2.5">
              {observations.map((observation) => (
                <div className="group grid grid-cols-[64px_1fr] gap-2 text-[10px] leading-snug" key={observation.label} data-tone={observation.tone ?? 'normal'}>
                  <dt className="font-mono text-[8px] font-semibold uppercase tracking-[0.06em] text-[#b9b3a3]">{observation.label}</dt>
                  <dd className="text-[#f4efde]/75 group-data-[tone=caution]:text-[#e2b76f] group-data-[tone=critical]:text-[#e78068]">{observation.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="border-b border-[#f4efde]/10 px-4 py-4 max-[480px]:py-3.5" aria-labelledby="recommendation-title">
            <h2 className={sectionTitle} id="recommendation-title">Recommendation</h2>
            <p className="mt-2 text-[11px] font-medium leading-relaxed">{recommendation}</p>
          </section>

          <section className="border-b border-[#f4efde]/10 px-4 py-4 max-[480px]:py-3.5" aria-labelledby="plan-title">
            <h2 className={sectionTitle} id="plan-title">Plan</h2>
            <ol className="mt-3 grid list-none gap-2">
              {plan.map((step, index) => (
                <li className="grid grid-cols-[22px_1fr] gap-2 text-[10px] leading-snug text-[#f4efde]/75" key={step}>
                  <span className="grid size-[18px] place-items-center rounded-full border border-[#8bc49b]/25 font-mono text-[7px] text-[#8bc49b]">{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="mx-4 my-3 grid grid-cols-[38px_1fr] gap-2 border-l-2 border-[#8bc49b] bg-[#8bc49b]/10 p-3" aria-live="polite">
            <span className="font-mono text-[8px] font-bold uppercase tracking-[0.11em] text-[#8bc49b]">Now</span>
            <strong className="text-[11px] font-medium leading-snug">{action}</strong>
          </section>

          {crewActions.length > 0 || crewActionStatus ? (
            <section className="border-t border-[#f4efde]/10 px-4 py-4" aria-labelledby="crew-decision-title" aria-live="polite">
              <h2 className={sectionTitle} id="crew-decision-title">Flight crew decision</h2>
              {crewActionStatus ? <p className="mt-2 text-[10px] leading-relaxed text-[#b9b3a3]">{crewActionStatus}</p> : null}
              {crewActions.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {crewActions.map((crewAction) => (
                    <Button className="h-auto items-start justify-start px-3 py-2.5 text-left whitespace-normal" key={crewAction.id} variant="outline" onClick={crewAction.onSelect}>
                      <span className="grid gap-0.5"><strong>{crewAction.label}</strong><small className="font-normal leading-snug text-[#b9b3a3]">{crewAction.description}</small></span>
                    </Button>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {webMcpActivities.length > 0 ? (
            <section className="border-t border-[#f4efde]/10 px-4 py-4" aria-labelledby="agent-trace-title" aria-live="polite">
              <div className="flex items-center justify-between gap-3">
                <h2 className={sectionTitle} id="agent-trace-title">Live WebMCP trace</h2>
                <span className="font-mono text-[7px] uppercase text-[#b9b3a3]">{webMcpActivities.length} calls</span>
              </div>
              <ol className="mt-3 grid list-none gap-2">
                {webMcpActivities.slice(-4).reverse().map((activity) => {
                  const reason = typeof activity.arguments.reason === 'string'
                    ? activity.arguments.reason
                    : typeof activity.arguments.requested_action === 'string'
                      ? activity.arguments.requested_action
                      : null
                  return (
                    <li className="rounded-md border border-[#f4efde]/10 bg-[#f4efde]/5 p-2.5 data-[status=running]:border-[#8bc49b]/25" key={activity.id} data-status={activity.status}>
                      <div className="flex items-center justify-between gap-2">
                        <strong className="font-mono text-[8px] text-[#8bc49b]">{activity.tool}</strong>
                        <span className="font-mono text-[7px] text-[#b9b3a3]">{activity.status === 'running' ? 'thinking…' : `${activity.latencyMs ?? 0} ms · ${activity.rewardDelta && activity.rewardDelta !== 0 ? `${activity.rewardDelta > 0 ? '+' : ''}${activity.rewardDelta} reward` : 'no score change'}`}</span>
                      </div>
                      {reason ? <p className="mt-1 text-[9px] leading-snug text-[#f4efde]/70">{reason}</p> : null}
                      <small className="mt-1 block text-[8px] leading-snug text-[#b9b3a3]">{activity.summary}</small>
                    </li>
                  )
                })}
              </ol>
            </section>
          ) : null}

        </div>
      )}

      <details className="group shrink-0 border-t border-[#f4efde]/10 text-[#b9b3a3]">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 font-mono text-[8px] font-semibold uppercase tracking-[0.1em] hover:text-[#f4efde] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#f4efde] [&::-webkit-details-marker]:hidden">
          <CircleAlert className="size-3" aria-hidden="true" />
          Diagnostics
          <ChevronDown className="ml-auto size-3 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <dl className="grid gap-1 px-4 pb-3 font-mono text-[8px] [&>div]:grid [&>div]:grid-cols-[62px_1fr] [&_dt]:uppercase [&_dt]:tracking-[0.06em] [&_dd]:overflow-hidden [&_dd]:text-ellipsis [&_dd]:text-[#f4efde]/65">
          <div><dt>World</dt><dd>{diagnostics.world}</dd></div>
          <div><dt>WebMCP</dt><dd>{diagnostics.webMcp}</dd></div>
          <div><dt>Revision</dt><dd>{diagnostics.missionRevision}</dd></div>
          <div><dt>Scenario</dt><dd>{diagnostics.scenarioId}</dd></div>
          <div><dt>Build</dt><dd>{diagnostics.buildId}</dd></div>
          <div><dt>Profile</dt><dd>{diagnostics.profileId}</dd></div>
        </dl>
        {diagnostics.recentTools.length > 0 ? (
          <div className="px-4 pb-3 font-mono text-[8px]">
            <span className="uppercase tracking-[0.06em]">Recent tools</span>
            <ul className="mt-1.5 grid list-none gap-1 text-[#f4efde]/65">{diagnostics.recentTools.map((tool, index) => <li key={`${index}-${tool}`}>{tool}</li>)}</ul>
          </div>
        ) : null}
        <Button className="mx-3 mb-3" variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw data-icon="inline-start" /> Reset scenario
        </Button>
      </details>
    </aside>
  )
}
