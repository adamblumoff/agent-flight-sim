import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three'
import { checkpointCaptureRadiusNm } from '../sim/checkpoints'
import type { FlightState } from '../sim/types'
import { NM_TO_METERS, waypointToWorldVector } from './coordinates'

export function createCheckpointOrb() {
  const root = new Group()
  root.name = 'Active checkpoint'
  root.renderOrder = 2

  const shellGeometry = new SphereGeometry(1, 28, 18)
  const shell = new Mesh(shellGeometry, new MeshBasicMaterial({
    color: 0xf2c75c,
    depthWrite: false,
    opacity: 0.18,
    side: DoubleSide,
    transparent: true,
  }))
  root.add(shell)

  const position = new Vector3()

  return {
    root,
    update(state: FlightState, elapsedSeconds: number) {
      const waypoint = state.route.waypoints[state.route.activeWaypointIndex]
      const complete = !waypoint || state.route.completedWaypointIds.includes(waypoint.id)
      root.visible = !complete && state.mission.phase !== 'complete' && state.mission.phase !== 'failed'
      if (!root.visible || !waypoint) return

      waypointToWorldVector(waypoint, position)
      root.position.copy(position)
      const radiusMeters = checkpointCaptureRadiusNm(waypoint, state.controlOwner) * NM_TO_METERS
      const pulse = 1 + Math.sin(elapsedSeconds * 1.5) * 0.015
      root.scale.setScalar(radiusMeters * pulse)
    },
  }
}
