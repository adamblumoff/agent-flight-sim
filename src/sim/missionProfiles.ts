export interface MissionProfile {
  readonly id: string
  readonly label: string
  readonly deadlineSeconds: number
  readonly wallClockDeadlineSeconds: number
  readonly simulationRate: number
  readonly emergencyTriggerSeconds: number
  readonly targetCompletionSeconds: number
}

export const MISSION_PROFILE = Object.freeze({
  id: 'dreamliner-787-9-emergency-v1',
  label: '8-minute flight',
  deadlineSeconds: 8 * 60 * 2,
  wallClockDeadlineSeconds: 8 * 60,
  simulationRate: 2,
  emergencyTriggerSeconds: 30 * 2,
  targetCompletionSeconds: 6.5 * 60 * 2,
} satisfies MissionProfile)
