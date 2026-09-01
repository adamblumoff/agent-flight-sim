import type { FlightMode } from './types'

export interface MissionProfile {
  readonly id: string
  readonly label: string
  readonly deadlineSeconds: number
  readonly wallClockDeadlineSeconds: number
  readonly simulationRate: number
  readonly emergencyTriggerSeconds: number
  readonly targetCompletionSeconds: number
}

export const MISSION_PROFILES = Object.freeze({
  full: Object.freeze({
    id: 'full-kstl-kmdw-v1',
    label: '10-minute operational run',
    deadlineSeconds: 10 * 60,
    wallClockDeadlineSeconds: 10 * 60,
    simulationRate: 1,
    emergencyTriggerSeconds: 45,
    targetCompletionSeconds: 9 * 60,
  }),
  judge: Object.freeze({
    id: 'judge-kstl-return-v2',
    label: '6-minute Concorde evaluation',
    deadlineSeconds: 6 * 60,
    wallClockDeadlineSeconds: 6 * 60,
    simulationRate: 1,
    emergencyTriggerSeconds: 35,
    targetCompletionSeconds: 4.75 * 60,
  }),
} satisfies Record<FlightMode, MissionProfile>)

export const missionProfileFor = (mode: FlightMode) => MISSION_PROFILES[mode]
