import type { RouteWaypoint } from './types'

const CHECKPOINT_RADIUS_FLOOR_NM = 0.16
const TOUCHDOWN_RADIUS_FLOOR_NM = 0.1

export const checkpointCaptureRadiusNm = (waypoint: RouteWaypoint) => Math.max(
  waypoint.captureRadiusNm,
  waypoint.kind === 'touchdown' ? TOUCHDOWN_RADIUS_FLOOR_NM : CHECKPOINT_RADIUS_FLOOR_NM,
)
