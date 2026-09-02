import type { FlightRunExport } from './runExport'

const INDEX_KEY = 'agent-flight:evaluations:index'
const MAX_ARCHIVED_RUNS = 12

export interface EvidencePersistenceResult {
  readonly serverPath: string | null
}

export async function persistEvaluationEvidence(run: FlightRunExport): Promise<EvidencePersistenceResult> {
  if (typeof window === 'undefined') return { serverPath: null }

  const key = `agent-flight:evaluation:${run.run.runId}`
  try {
    const summary = {
      schemaVersion: 'agent-flight-evaluation-archive-v3',
      runId: run.run.runId,
      buildId: run.run.buildId,
      profileId: run.run.profileId,
      updatedAt: run.generatedAt,
      terminal: run.run.outcome !== 'in_progress',
      outcome: run.run.outcome,
      score: run.run.score.total,
      calls: run.calls.length,
    }
    window.localStorage.setItem(key, JSON.stringify(summary))
    const currentIndex = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? '[]') as string[]
    const nextIndex = [key, ...currentIndex.filter((candidate) => candidate !== key)].slice(0, MAX_ARCHIVED_RUNS)
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(nextIndex))
    for (const staleKey of currentIndex.filter((candidate) => !nextIndex.includes(candidate))) window.localStorage.removeItem(staleKey)
  } catch {
    // The filesystem archive is the durable source when browser storage is unavailable.
  }

  try {
    const response = await fetch('/__agent-flight/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(run),
    })
    if (!response.ok) return { serverPath: null }
    const result = await response.json() as { readonly path?: unknown }
    return { serverPath: typeof result.path === 'string' ? result.path : null }
  } catch {
    return { serverPath: null }
  }
}
