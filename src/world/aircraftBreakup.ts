import { Group, Quaternion, Vector3 } from 'three'
import type { ImpactState } from '../sim/types'
import type { AircraftBreakawayPart } from './aircraft'

interface DetachedPart {
  readonly part: AircraftBreakawayPart
  readonly parent: Group
  readonly position: Vector3
  readonly quaternion: Quaternion
  readonly scale: Vector3
  readonly velocity: Vector3
  readonly spin: Vector3
  detached: boolean
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const seededRandom = (seed: number) => {
  let value = seed >>> 0
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0
    return value / 0x1_0000_0000
  }
}

export function createAircraftBreakup(aircraft: Group, parts: readonly AircraftBreakawayPart[]) {
  const root = new Group()
  root.name = 'Aircraft wreckage'
  const detachedParts: DetachedPart[] = parts.map((part) => ({
    part,
    parent: part.root.parent as Group,
    position: part.root.position.clone(),
    quaternion: part.root.quaternion.clone(),
    scale: part.root.scale.clone(),
    velocity: new Vector3(),
    spin: new Vector3(),
    detached: false,
  }))
  const localVelocity = new Vector3()
  let active = false
  let ageSeconds = 0

  const reset = () => {
    for (const detached of detachedParts) {
      detached.parent.add(detached.part.root)
      detached.part.root.position.copy(detached.position)
      detached.part.root.quaternion.copy(detached.quaternion)
      detached.part.root.scale.copy(detached.scale)
      detached.part.root.visible = true
      detached.detached = false
      detached.velocity.set(0, 0, 0)
      detached.spin.set(0, 0, 0)
    }
    active = false
    ageSeconds = 0
  }

  const start = (impact: ImpactState) => {
    reset()
    const random = seededRandom(impact.revision * 7_919 + Math.round(impact.sinkRateFpm))
    const intensity = clamp(
      impact.sinkRateFpm / 1_150 + impact.airspeedKt / 160 + Math.abs(impact.bankDeg) / 80,
      0.55,
      1,
    )
    const impactWing = impact.rollDirection < 0 ? 'left-wing' : 'right-wing'
    const oppositeWing = impact.rollDirection < 0 ? 'right-wing' : 'left-wing'
    const order = [impactWing, 'propeller', 'fin', oppositeWing, 'left-tail', 'right-tail']
    const partCount = Math.min(order.length, Math.max(3, Math.ceil(intensity * order.length)))
    const forwardSpeedMetersPerSecond = impact.airspeedKt * 0.514_444

    for (const name of order.slice(0, partCount)) {
      const detached = detachedParts.find((candidate) => candidate.part.name === name)
      if (!detached) continue
      root.attach(detached.part.root)
      detached.detached = true
      const side = detached.part.name.includes('left') ? -1 : detached.part.name.includes('right') ? 1 : impact.rollDirection
      localVelocity.set(
        side * (2.5 + random() * 5.5) * intensity,
        2.5 + random() * 6.5 * intensity,
        -forwardSpeedMetersPerSecond * (0.45 + random() * 0.25) + (random() - 0.5) * 5,
      ).applyQuaternion(aircraft.quaternion)
      detached.velocity.copy(localVelocity)
      detached.spin.set(
        (random() - 0.5) * 9,
        (random() - 0.5) * 12,
        (random() - 0.5) * 10,
      ).multiplyScalar(0.75 + intensity * 0.55)
    }
    active = true
    ageSeconds = 0
  }

  const update = (deltaSeconds: number, groundY: number) => {
    if (!active) return
    ageSeconds += deltaSeconds
    for (const detached of detachedParts) {
      if (!detached.detached) continue
      detached.velocity.y -= 9.81 * deltaSeconds
      detached.part.root.position.addScaledVector(detached.velocity, deltaSeconds)
      detached.part.root.rotateX(detached.spin.x * deltaSeconds)
      detached.part.root.rotateY(detached.spin.y * deltaSeconds)
      detached.part.root.rotateZ(detached.spin.z * deltaSeconds)
      if (detached.part.root.position.y <= groundY + 0.12) {
        detached.part.root.position.y = groundY + 0.12
        detached.velocity.x *= 0.84
        detached.velocity.y = Math.abs(detached.velocity.y) * 0.16
        detached.velocity.z *= 0.84
        detached.spin.multiplyScalar(0.8)
      }
    }
    if (ageSeconds > 10) active = false
  }

  const setVisible = (visible: boolean) => {
    root.visible = visible
  }

  return { root, start, update, reset, setVisible }
}
