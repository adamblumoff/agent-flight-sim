import {
  DoubleSide,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three'
import { checkpointCaptureRadiusNm } from '../sim/checkpoints'
import type { FlightState } from '../sim/types'
import { NM_TO_METERS, waypointToWorldVector } from './coordinates'

export function createCheckpointOrb() {
  const root = new Group()
  root.name = 'Active checkpoint'
  root.renderOrder = 2

  const shellGeometry = new CylinderGeometry(1, 1, 4_000, 32, 1, true)
  const shell = new Mesh(shellGeometry, new MeshStandardMaterial({
    color: 0xf2c75c,
    depthWrite: false,
    emissive: 0x5e4712,
    emissiveIntensity: 0.7,
    fog: false,
    opacity: 0.17,
    roughness: 0.58,
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
      root.position.set(position.x, 0, position.z)
      const radiusMeters = checkpointCaptureRadiusNm(waypoint, state.controlOwner) * NM_TO_METERS
      const pulse = 1 + Math.sin(elapsedSeconds * 1.5) * 0.025
      root.scale.set(radiusMeters * pulse, 1, radiusMeters * pulse)
    },
  }
}
