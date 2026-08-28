import type { ControlOwner, RouteWaypoint } from './types'

const HUMAN_CHECKPOINT_RADIUS_NM = 0.12
const HUMAN_TOUCHDOWN_RADIUS_NM = 0.08

export const checkpointCaptureRadiusNm = (waypoint: RouteWaypoint, controlOwner: ControlOwner) =>
  controlOwner === 'human'
    ? Math.max(waypoint.captureRadiusNm, waypoint.kind === 'touchdown' ? HUMAN_TOUCHDOWN_RADIUS_NM : HUMAN_CHECKPOINT_RADIUS_NM)
    : waypoint.captureRadiusNm
