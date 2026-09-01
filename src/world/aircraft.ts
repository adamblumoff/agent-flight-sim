import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'

export interface AircraftBreakawayPart {
  readonly name: 'left-wing' | 'right-wing' | 'left-tail' | 'right-tail' | 'fin'
    | 'left-engine' | 'right-engine'
  readonly root: Group
}

export interface AircraftRig {
  readonly root: Group
  readonly landingGear: readonly Group[]
  readonly flaps: readonly Group[]
  readonly breakawayParts: readonly AircraftBreakawayPart[]
  readonly view: AircraftViewProfile
}

export interface AircraftViewProfile {
  readonly chaseOffset: readonly [number, number, number]
  readonly chaseLookAhead: readonly [number, number, number]
  readonly cockpitOffset: readonly [number, number, number]
  readonly cockpitLookAhead: readonly [number, number, number]
  readonly crashOrigin: readonly [number, number, number]
  readonly speedFovBoostDeg: number
  readonly speedCameraDropMeters: number
}

const dreamlinerView = Object.freeze({
  chaseOffset: Object.freeze([0, 24, 90] as const),
  chaseLookAhead: Object.freeze([0, -5, -155] as const),
  cockpitOffset: Object.freeze([0, 7.5, -25.5] as const),
  cockpitLookAhead: Object.freeze([0, 6.8, -235] as const),
  crashOrigin: Object.freeze([0, 4.1, -8] as const),
  speedFovBoostDeg: 6,
  speedCameraDropMeters: 5,
}) satisfies AircraftViewProfile

const bodyMaterial = new MeshPhysicalMaterial({
  color: 0xf5f8f7,
  metalness: 0.08,
  roughness: 0.3,
  clearcoat: 0.8,
  clearcoatRoughness: 0.2,
  side: DoubleSide,
})
const accentMaterial = new MeshStandardMaterial({ color: 0x123b58, metalness: 0.15, roughness: 0.32 })
const windowMaterial = new MeshBasicMaterial({ color: 0x071c29, side: DoubleSide })
const liveryMaterial = new MeshBasicMaterial({ color: 0x176b91, side: DoubleSide })
const doorMaterial = new MeshBasicMaterial({ color: 0x7f989d, side: DoubleSide, transparent: true, opacity: 0.72 })
const rubberMaterial = new MeshStandardMaterial({ color: 0x0d1011, roughness: 0.9 })
const metalMaterial = new MeshStandardMaterial({ color: 0x98a5aa, metalness: 0.82, roughness: 0.24 })
const fanMaterial = new MeshStandardMaterial({ color: 0x172329, metalness: 0.7, roughness: 0.3, side: DoubleSide })

function mesh(geometry: ConstructorParameters<typeof Mesh>[0], material: ConstructorParameters<typeof Mesh>[1]) {
  const result = new Mesh(geometry, material)
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function slabGeometry(points: readonly (readonly [number, number])[], thickness: number) {
  const half = thickness / 2
  const positions = points.flatMap(([x, z]) => [x, half, z, x, -half, z])
  const indices: number[] = []
  for (let index = 1; index < points.length - 1; index += 1) {
    indices.push(0, index * 2, (index + 1) * 2)
    indices.push(1, (index + 1) * 2 + 1, index * 2 + 1)
  }
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length
    indices.push(index * 2, index * 2 + 1, next * 2)
    indices.push(next * 2, index * 2 + 1, next * 2 + 1)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function verticalSlabGeometry(points: readonly (readonly [number, number])[], thickness: number) {
  const half = thickness / 2
  const positions = points.flatMap(([y, z]) => [half, y, z, -half, y, z])
  const indices: number[] = []
  for (let index = 1; index < points.length - 1; index += 1) {
    indices.push(0, (index + 1) * 2, index * 2)
    indices.push(1, index * 2 + 1, (index + 1) * 2 + 1)
  }
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length
    indices.push(index * 2, next * 2, index * 2 + 1)
    indices.push(next * 2, next * 2 + 1, index * 2 + 1)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function taperedTubeGeometry(stations: readonly (readonly [number, number])[], radialSegments = 40) {
  const positions: number[] = []
  const indices: number[] = []
  for (const [z, radius] of stations) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = segment / radialSegments * Math.PI * 2
      positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z)
    }
  }
  for (let station = 0; station < stations.length - 1; station += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments
      const a = station * radialSegments + segment
      const b = station * radialSegments + next
      const c = (station + 1) * radialSegments + segment
      const d = (station + 1) * radialSegments + next
      indices.push(a, c, b, b, c, d)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function sidePanel(width: number, height: number, x: number, y: number, z: number, side: -1 | 1, material = doorMaterial) {
  const panel = new Mesh(new PlaneGeometry(width, height), material)
  panel.position.set(side * x, y, z)
  panel.rotation.y = side * Math.PI / 2
  return panel
}

function wheel(x: number, z: number, radius: number) {
  const tire = mesh(new TorusGeometry(radius, radius * 0.31, 10, 24), rubberMaterial)
  tire.rotation.y = Math.PI / 2
  tire.position.set(x, radius, z)
  const hub = mesh(new CylinderGeometry(radius * 0.22, radius * 0.22, radius * 0.42, 14), metalMaterial)
  hub.rotation.z = Math.PI / 2
  hub.position.copy(tire.position)
  return [tire, hub]
}

function bogie(name: string, x: number, z: number, axleCount: number, topY: number, radius = 0.58) {
  const assembly = new Group()
  assembly.name = name
  assembly.position.set(x, 0, z)
  const axleSpacing = 1.45
  const wheelTrack = 1.02
  for (let axle = 0; axle < axleCount; axle += 1) {
    const axleZ = (axle - (axleCount - 1) / 2) * axleSpacing
    for (const side of [-1, 1]) assembly.add(...wheel(side * wheelTrack / 2, axleZ, radius))
    const axleBeam = mesh(new CylinderGeometry(0.1, 0.1, wheelTrack + 0.42, 10), metalMaterial)
    axleBeam.rotation.z = Math.PI / 2
    axleBeam.position.set(0, radius, axleZ)
    assembly.add(axleBeam)
  }
  const bogieBeam = mesh(new BoxGeometry(0.22, 0.2, Math.max(0.8, (axleCount - 1) * axleSpacing + 0.5)), metalMaterial)
  bogieBeam.position.y = radius + 0.25
  const strutLength = topY - radius - 0.2
  const strut = mesh(new CylinderGeometry(0.14, 0.14, strutLength, 12), metalMaterial)
  strut.position.y = radius + 0.3 + strutLength / 2
  const braceLeft = mesh(new CylinderGeometry(0.07, 0.07, strutLength * 0.72, 10), metalMaterial)
  braceLeft.position.set(-0.42, radius + strutLength * 0.55, 0)
  braceLeft.rotation.z = -0.28
  const braceRight = braceLeft.clone()
  braceRight.position.x = 0.42
  braceRight.rotation.z = 0.28
  assembly.add(bogieBeam, strut, braceLeft, braceRight)
  return assembly
}

function dreamlinerWindows() {
  const zPositions = Array.from({ length: 53 }, (_, index) => -21.5 + index * 0.86)
  const windows = new InstancedMesh(new PlaneGeometry(0.28, 0.19), windowMaterial, zPositions.length * 2)
  const transform = new Object3D()
  let index = 0
  for (const side of [-1, 1]) {
    for (const z of zPositions) {
      transform.position.set(side * 2.88, 7.25, z)
      transform.rotation.set(0, side * Math.PI / 2, 0)
      transform.updateMatrix()
      windows.setMatrixAt(index, transform.matrix)
      index += 1
    }
  }
  windows.instanceMatrix.needsUpdate = true
  return windows
}

function dreamlinerWing(side: -1 | 1, flaps: Group[]) {
  const assembly = new Group()
  assembly.name = side < 0 ? 'Left swept wing' : 'Right swept wing'
  assembly.position.y = 5.5
  assembly.add(mesh(slabGeometry([
    [side * 1.1, -9.2],
    [side * 30.05, 4.7],
    [side * 28.6, 7.5],
    [side * 1.2, 11.1],
  ], 0.42), bodyMaterial))

  const flap = new Group()
  flap.name = side < 0 ? 'Left trailing-edge flap' : 'Right trailing-edge flap'
  flap.position.set(side * 8.6, -0.12, 8.7)
  flap.rotation.y = side * -0.08
  flap.add(mesh(new BoxGeometry(11.8, 0.28, 2.1), bodyMaterial))
  flaps.push(flap)

  const navigationLight = new Mesh(
    new SphereGeometry(0.18, 10, 7),
    new MeshStandardMaterial({
      color: side < 0 ? 0xd93630 : 0x32b66d,
      emissive: side < 0 ? 0xd93630 : 0x32b66d,
      emissiveIntensity: 2.4,
    }),
  )
  navigationLight.position.set(side * 29.45, 0.08, 5.7)
  assembly.add(flap, navigationLight)
  return assembly
}

function dreamlinerTailplane(side: -1 | 1) {
  const assembly = new Group()
  assembly.name = side < 0 ? 'Left horizontal stabilizer' : 'Right horizontal stabilizer'
  assembly.position.y = 7.1
  assembly.add(mesh(slabGeometry([
    [side * 0.8, 19.3],
    [side * 10.4, 25.2],
    [side * 9.1, 28.1],
    [side * 0.8, 26.7],
  ], 0.3), bodyMaterial))
  return assembly
}

function dreamlinerFin() {
  const assembly = new Group()
  assembly.name = 'Dreamliner vertical stabilizer'
  assembly.position.set(0, 6.2, 21.5)
  assembly.add(
    mesh(verticalSlabGeometry([
      [0, -1.5],
      [10.8, 3.6],
      [10.5, 6.2],
      [0.4, 8.4],
    ], 0.48), bodyMaterial),
    mesh(verticalSlabGeometry([
      [2.2, 0.8],
      [10.2, 4.1],
      [10, 5.9],
      [2, 7.5],
    ], 0.51), liveryMaterial),
  )
  return assembly
}

function dreamlinerEngine(name: AircraftBreakawayPart['name'], x: number) {
  const assembly = new Group()
  assembly.name = name
  // The GEnx-1B fan is 111.1 in (2.82 m) across. The nacelle is wider than
  // the fan but remains far smaller than the 787's 5.8 m-wide fuselage.
  assembly.position.set(x, 2.45, -0.5)
  const nacelle = mesh(new CylinderGeometry(1.48, 1.78, 5.75, 36, 1, true), bodyMaterial)
  nacelle.rotation.x = Math.PI / 2
  const intakeLip = mesh(new TorusGeometry(1.53, 0.15, 10, 36), metalMaterial)
  intakeLip.position.z = -2.88
  const fan = mesh(new CylinderGeometry(1.41, 1.41, 0.16, 28), fanMaterial)
  fan.rotation.x = Math.PI / 2
  fan.position.z = -2.8
  const exhaust = mesh(new CylinderGeometry(0.82, 1.08, 0.26, 24), accentMaterial)
  exhaust.rotation.x = Math.PI / 2
  exhaust.position.z = 2.9
  const pylon = mesh(new BoxGeometry(0.82, 2.25, 3.75), accentMaterial)
  pylon.position.set(0, 1.8, 0.3)
  assembly.add(nacelle, intakeLip, fan, exhaust, pylon)
  return assembly
}

function createDreamlinerAircraft(): AircraftRig {
  const aircraft = new Group()
  aircraft.name = 'N787FD'
  const flaps: Group[] = []
  const leftWing = dreamlinerWing(-1, flaps)
  const rightWing = dreamlinerWing(1, flaps)
  const leftTail = dreamlinerTailplane(-1)
  const rightTail = dreamlinerTailplane(1)
  const finAssembly = dreamlinerFin()
  const engines = [
    dreamlinerEngine('left-engine', -9.6),
    dreamlinerEngine('right-engine', 9.6),
  ]
  const landingGearAssemblies = [
    bogie('Nose gear', 0, -22.2, 1, 4.65, 0.46),
    bogie('Left main gear', -5.7, 7.6, 2, 5.2, 0.62),
    bogie('Right main gear', 5.7, 7.6, 2, 5.2, 0.62),
  ]

  const fuselage = mesh(taperedTubeGeometry([
    [-31.4, 0.08],
    [-30.6, 1.05],
    [-27.8, 2.45],
    [-23.5, 2.9],
    [20.5, 2.9],
    [26.8, 2.25],
    [30.7, 0.7],
    [31.4, 0.08],
  ], 48), bodyMaterial)
  fuselage.position.y = 6.1

  const details = new Group()
  details.name = 'Dreamliner fuselage details'
  details.add(dreamlinerWindows())
  for (const side of [-1, 1] as const) {
    details.add(sidePanel(51, 0.18, 2.89, 5.72, -0.5, side, liveryMaterial))
    for (const z of [-20.5, -11.5, 8.5, 17.5]) details.add(sidePanel(1.15, 2.25, 2.91, 6.05, z, side, doorMaterial))
    const cockpitWindow = sidePanel(3.2, 0.92, 2.42, 7.35, -25.8, side, windowMaterial)
    cockpitWindow.rotation.z = side * -0.11
    details.add(cockpitWindow)
  }
  const windscreen = mesh(slabGeometry([[-1.65, -28.7], [1.65, -28.7], [1.25, -26.4], [-1.25, -26.4]], 0.06), windowMaterial)
  windscreen.position.y = 7.75
  details.add(windscreen)

  aircraft.add(fuselage, details, leftWing, rightWing, leftTail, rightTail, finAssembly, ...engines, ...landingGearAssemblies)
  return {
    root: aircraft,
    landingGear: landingGearAssemblies,
    flaps,
    view: dreamlinerView,
    breakawayParts: [
      { name: 'left-wing', root: leftWing },
      { name: 'right-wing', root: rightWing },
      { name: 'left-tail', root: leftTail },
      { name: 'right-tail', root: rightTail },
      { name: 'fin', root: finAssembly },
      { name: 'left-engine', root: engines[0] },
      { name: 'right-engine', root: engines[1] },
    ],
  }
}

export function createAircraft(): AircraftRig {
  return createDreamlinerAircraft()
}

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0
    return value / 4_294_967_296
  }
}

export function createCrashEffects() {
  const root = new Group()
  root.name = 'Crash effects'
  root.visible = false

  const fireballs = [0xfff1a8, 0xff9b2f, 0xd84415].map((color, index) => {
    const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false })
    const fireball = new Mesh(new SphereGeometry(0.7 + index * 0.18, 12, 8), material)
    fireball.position.set((index - 1) * 0.55, 0.7 + index * 0.28, index * 0.32)
    root.add(fireball)
    return fireball
  })

  const random = seededRandom(41_783)
  const smoke = Array.from({ length: 10 }, (_, index) => {
    const material = new MeshBasicMaterial({
      color: index < 3 ? 0x4b423b : 0x252a29,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    })
    const puff = new Mesh(new SphereGeometry(0.55 + random() * 0.35, 8, 6), material)
    puff.userData.delay = index * 0.32
    puff.userData.driftX = (random() - 0.5) * 1.6
    puff.userData.driftZ = (random() - 0.5) * 1.2
    root.add(puff)
    return puff
  })

  const debrisMaterial = new MeshStandardMaterial({ color: 0x252827, metalness: 0.35, roughness: 0.82 })
  const debris = Array.from({ length: 16 }, (_, index) => {
    const fragment = new Mesh(new BoxGeometry(0.12 + random() * 0.3, 0.08 + random() * 0.12, 0.2 + random() * 0.55), debrisMaterial)
    fragment.castShadow = true
    fragment.userData.velocity = new Vector3((random() - 0.5) * 16, 4 + random() * 10, (random() - 0.5) * 15 - 2)
    fragment.userData.initialVelocity = (fragment.userData.velocity as Vector3).clone()
    fragment.userData.spin = new Vector3((random() - 0.5) * 9, (random() - 0.5) * 11, (random() - 0.5) * 10)
    fragment.userData.index = index
    root.add(fragment)
    return fragment
  })

  const flash = new PointLight(0xff8a2a, 0, 65, 2)
  flash.position.y = 2
  root.add(flash)
  let ageSeconds = -1

  const reset = () => {
    ageSeconds = -1
    root.visible = false
    flash.intensity = 0
  }

  const start = (position: Vector3) => {
    ageSeconds = 0
    root.visible = true
    root.position.copy(position)
    fireballs.forEach((fireball) => {
      fireball.scale.setScalar(0.2)
      ;(fireball.material as MeshBasicMaterial).opacity = 0
    })
    smoke.forEach((puff) => {
      puff.position.set(0, 0.5, 0)
      puff.scale.setScalar(0.15)
      ;(puff.material as MeshBasicMaterial).opacity = 0
    })
    debris.forEach((fragment) => {
      const index = fragment.userData.index as number
      fragment.position.set((index % 4 - 1.5) * 0.25, 0.65 + Math.floor(index / 4) * 0.08, (index % 3 - 1) * 0.22)
      fragment.rotation.set(0, 0, 0)
      ;(fragment.userData.velocity as Vector3).copy(fragment.userData.initialVelocity as Vector3)
      fragment.visible = true
    })
  }

  const update = (deltaSeconds: number, groundY: number) => {
    if (ageSeconds < 0 || !root.visible) return
    ageSeconds += deltaSeconds
    const fireOpacity = ageSeconds < 0.12
      ? ageSeconds / 0.12
      : Math.max(0, 1 - (ageSeconds - 0.12) / 1.05)
    fireballs.forEach((fireball, index) => {
      fireball.scale.setScalar(0.25 + ageSeconds * (5.8 - index * 0.75))
      ;(fireball.material as MeshBasicMaterial).opacity = fireOpacity * (1 - index * 0.14)
    })
    flash.intensity = Math.max(0, 95 * (1 - ageSeconds / 0.7))

    smoke.forEach((puff) => {
      const elapsedSmokeAge = ageSeconds - (puff.userData.delay as number)
      if (elapsedSmokeAge <= 0) return
      const smokeLifetime = 4.2
      const smokeAge = elapsedSmokeAge % smokeLifetime
      puff.position.set(
        (puff.userData.driftX as number) * smokeAge * 0.65,
        0.45 + smokeAge * 1.8,
        (puff.userData.driftZ as number) * smokeAge * 0.65,
      )
      puff.scale.setScalar(0.25 + smokeAge * 1.1)
      ;(puff.material as MeshBasicMaterial).opacity = Math.min(0.78, smokeAge * 2.4) * Math.max(0, 1 - smokeAge / smokeLifetime)
    })

    const localGroundY = groundY - root.position.y
    debris.forEach((fragment) => {
      const velocity = fragment.userData.velocity as Vector3
      const spin = fragment.userData.spin as Vector3
      if (fragment.position.y > localGroundY + 0.06 || velocity.y > 0) {
        velocity.y -= 9.81 * deltaSeconds
        fragment.position.addScaledVector(velocity, deltaSeconds)
        fragment.rotation.x += spin.x * deltaSeconds
        fragment.rotation.y += spin.y * deltaSeconds
        fragment.rotation.z += spin.z * deltaSeconds
      }
      if (fragment.position.y < localGroundY + 0.06) {
        fragment.position.y = localGroundY + 0.06
        velocity.x *= 0.82
        velocity.y = Math.abs(velocity.y) * 0.18
        velocity.z *= 0.82
      }
    })
    if (ageSeconds > 12) root.visible = false
  }

  return { root, start, update, reset }
}
