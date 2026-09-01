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
  id: 'concorde-emergency-v1',
  label: '6-minute flight',
  deadlineSeconds: 6 * 60,
  wallClockDeadlineSeconds: 6 * 60,
  simulationRate: 1,
  emergencyTriggerSeconds: 35,
  targetCompletionSeconds: 4.75 * 60,
} satisfies MissionProfile)
