import type { CheckrideSeed } from './types'

export interface MissionProfile {
  readonly id: string
  readonly label: string
  readonly deadlineSeconds: number
  readonly wallClockDeadlineSeconds: number
  readonly simulationRate: number
  readonly emergencyTriggerSeconds: number
  readonly targetCompletionSeconds: number
}

export const CHECKRIDE_SEEDS = [17, 42, 81] as const satisfies readonly CheckrideSeed[]

export const randomCheckrideSeed = (): CheckrideSeed => {
  const randomIndex = typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
    ? crypto.getRandomValues(new Uint32Array(1))[0] % CHECKRIDE_SEEDS.length
    : Math.floor(Math.random() * CHECKRIDE_SEEDS.length)
  return CHECKRIDE_SEEDS[randomIndex]
}

export const MISSION_PROFILE = Object.freeze({
  id: 'wide-body-twinjet-emergency-v1',
  label: '8-minute flight',
  deadlineSeconds: 8 * 60 * 2,
  wallClockDeadlineSeconds: 8 * 60,
  simulationRate: 2,
  emergencyTriggerSeconds: 30 * 2,
  targetCompletionSeconds: 6.5 * 60 * 2,
} satisfies MissionProfile)
