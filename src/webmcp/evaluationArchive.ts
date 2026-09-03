import type { FlightRunExport } from './runExport'

const INDEX_KEY = 'agent-flight:evaluations:index'
const MAX_ARCHIVED_RUNS = 12
const DATABASE_NAME = 'agent-flight-evaluations'
const DATABASE_VERSION = 1
const RUN_STORE = 'runs'

export interface EvidencePersistenceResult {
  readonly serverPath: string | null
}

const archiveInBrowser = (run: FlightRunExport, staleRunIds: readonly string[]) => new Promise<void>((resolve, reject) => {
  if (!window.indexedDB) {
    reject(new Error('IndexedDB is unavailable'))
    return
  }
  const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(RUN_STORE)) request.result.createObjectStore(RUN_STORE, { keyPath: 'run.runId' })
  }
  request.onerror = () => reject(request.error ?? new Error('Could not open the evidence database'))
  request.onsuccess = () => {
    const database = request.result
    const transaction = database.transaction(RUN_STORE, 'readwrite')
    const store = transaction.objectStore(RUN_STORE)
    store.put(run)
    for (const runId of staleRunIds) store.delete(runId)
    transaction.oncomplete = () => {
      database.close()
      resolve()
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error ?? new Error('Could not archive the run'))
    }
  }
})

export async function persistEvaluationEvidence(run: FlightRunExport): Promise<EvidencePersistenceResult> {
  if (typeof window === 'undefined') return { serverPath: null }

  const key = `agent-flight:evaluation:${run.run.runId}`
  let staleRunIds: readonly string[] = []
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
    const staleKeys = currentIndex.filter((candidate) => !nextIndex.includes(candidate))
    staleRunIds = staleKeys.map((staleKey) => staleKey.slice('agent-flight:evaluation:'.length))
    for (const staleKey of staleKeys) window.localStorage.removeItem(staleKey)
  } catch {
    // IndexedDB remains the full browser-side archive.
  }

  try { await archiveInBrowser(run, staleRunIds) } catch { /* The downloadable terminal export remains available. */ }

  try {
    const response = await fetch('/__agent-flight/evidence', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(run),
    })
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return { serverPath: null }
    const result = await response.json() as { readonly path?: unknown }
    return { serverPath: typeof result.path === 'string' ? result.path : null }
  } catch {
    return { serverPath: null }
  }
}

let queuedRun: FlightRunExport | null = null
let persistenceWorker: Promise<void> | null = null

export function queueEvaluationEvidence(run: FlightRunExport): Promise<void> {
  queuedRun = run
  if (!persistenceWorker) {
    persistenceWorker = (async () => {
      while (queuedRun) {
        const next = queuedRun
        queuedRun = null
        await persistEvaluationEvidence(next)
      }
    })().finally(() => { persistenceWorker = null })
  }
  return persistenceWorker
}
