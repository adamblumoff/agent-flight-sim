import type { ControlOwner, RouteWaypoint } from './types'

const HUMAN_CHECKPOINT_RADIUS_NM = 0.16
const HUMAN_TOUCHDOWN_RADIUS_NM = 0.1
const AGENT_ENROUTE_RADIUS_NM = 0.8

export const checkpointCaptureRadiusNm = (waypoint: RouteWaypoint, controlOwner: ControlOwner) =>
  controlOwner === 'human'
    ? Math.max(waypoint.captureRadiusNm, waypoint.kind === 'touchdown' ? HUMAN_TOUCHDOWN_RADIUS_NM : HUMAN_CHECKPOINT_RADIUS_NM)
    : Math.max(waypoint.captureRadiusNm, waypoint.kind === 'enroute' ? AGENT_ENROUTE_RADIUS_NM : 0)
