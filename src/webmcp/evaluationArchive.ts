import type { FlightState } from '../sim/types'
import type { WebMcpActivity } from './useWebMcp'

const INDEX_KEY = 'flightdeck:evaluations:index'
const MAX_ARCHIVED_RUNS = 12

export function persistEvaluationEvidence(activities: readonly WebMcpActivity[], state: FlightState) {
  if (typeof window === 'undefined' || activities.length === 0) return
  const key = `flightdeck:evaluation:${state.checkride.runId}`
  const terminal = state.mission.outcome !== 'in_progress'
  const payload = {
    schemaVersion: 'flightdeck-evaluation-archive-v1',
    runId: state.checkride.runId,
    buildId: state.checkride.buildId,
    profileId: state.checkride.profileId,
    mode: state.mode,
    updatedAt: new Date().toISOString(),
    terminal,
    outcome: state.mission.outcome,
    score: state.checkride.score.total,
    seed: terminal ? state.checkride.seed : null,
    activities,
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(payload))
    const currentIndex = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? '[]') as string[]
    const nextIndex = [key, ...currentIndex.filter((candidate) => candidate !== key)].slice(0, MAX_ARCHIVED_RUNS)
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(nextIndex))
    for (const staleKey of currentIndex.filter((candidate) => !nextIndex.includes(candidate))) window.localStorage.removeItem(staleKey)
  } catch {
    // The terminal in-page exports remain authoritative when storage is unavailable.
  }
}
