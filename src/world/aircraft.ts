import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
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
    | 'left-outer-engine' | 'left-inner-engine' | 'right-inner-engine' | 'right-outer-engine'
  readonly root: Group
}

export interface AircraftRig {
  readonly root: Group
  readonly landingGear: readonly Group[]
  readonly flaps: readonly Group[]
  readonly breakawayParts: readonly AircraftBreakawayPart[]
}

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

interface FuselageStation {
  readonly z: number
  readonly radiusX: number
  readonly radiusY: number
  readonly centerY: number
}

const fuselageStations: readonly FuselageStation[] = [
  { z: -36.35, radiusX: 0.08, radiusY: 0.08, centerY: 6.85 },
  { z: -35.95, radiusX: 0.72, radiusY: 0.58, centerY: 6.95 },
  { z: -35.35, radiusX: 1.45, radiusY: 1.2, centerY: 7.08 },
  { z: -34.55, radiusX: 2.15, radiusY: 1.95, centerY: 7.2 },
  { z: -33.45, radiusX: 2.82, radiusY: 2.75, centerY: 7.32 },
  { z: -31.85, radiusX: 3.35, radiusY: 3.42, centerY: 7.4 },
  { z: -29.2, radiusX: 3.55, radiusY: 3.68, centerY: 7.42 },
  { z: -14, radiusX: 3.56, radiusY: 3.68, centerY: 7.4 },
  { z: 14, radiusX: 3.56, radiusY: 3.66, centerY: 7.38 },
  { z: 23.5, radiusX: 3.48, radiusY: 3.5, centerY: 7.48 },
  { z: 29.5, radiusX: 2.92, radiusY: 3.05, centerY: 7.65 },
  { z: 33.6, radiusX: 1.65, radiusY: 1.75, centerY: 7.8 },
  { z: 36.35, radiusX: 0.08, radiusY: 0.08, centerY: 7.9 },
]

function fuselageGeometry() {
  const radialSegments = 48
  const positions: number[] = []
  const indices: number[] = []
  for (const station of fuselageStations) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = segment / radialSegments * Math.PI * 2
      positions.push(
        Math.cos(angle) * station.radiusX,
        station.centerY + Math.sin(angle) * station.radiusY,
        station.z,
      )
    }
  }
  for (let station = 0; station < fuselageStations.length - 1; station += 1) {
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

function trapezoidPanelGeometry(widthTop: number, widthBottom: number, height: number) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([
    -widthBottom / 2, -height / 2, 0,
    widthBottom / 2, -height / 2, 0,
    widthTop / 2, height / 2, 0,
    -widthTop / 2, height / 2, 0,
  ], 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  return geometry
}

function passengerWindows() {
  const zPositions = Array.from({ length: 64 }, (_, index) => -27.2 + index * 0.84)
  const rows = [
    { y: 6.7, x: 3.49, doors: [-27.2, -11.7, 7.8, 24.2] },
    { y: 9.05, x: 3.08, doors: [-25.8, -8.5, 10.5, 22.8] },
  ]
  const rowPositions = rows.map((row) => zPositions.filter(
    (z) => row.doors.every((doorZ) => Math.abs(z - doorZ) > 0.7),
  ))
  const instanceCount = rowPositions.reduce((count, positions) => count + positions.length * 2, 0)
  const windows = new InstancedMesh(new PlaneGeometry(0.42, 0.25), windowMaterial, instanceCount)
  const transform = new Object3D()
  let index = 0
  for (const side of [-1, 1]) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      for (const z of rowPositions[rowIndex]) {
        transform.position.set(side * row.x, row.y, z)
        transform.rotation.set(0, side * Math.PI / 2, 0)
        transform.updateMatrix()
        windows.setMatrixAt(index, transform.matrix)
        index += 1
      }
    }
  }
  windows.instanceMatrix.needsUpdate = true
  return windows
}

function sidePanel(width: number, height: number, x: number, y: number, z: number, side: -1 | 1, material = doorMaterial) {
  const panel = new Mesh(new PlaneGeometry(width, height), material)
  panel.position.set(side * x, y, z)
  panel.rotation.y = side * Math.PI / 2
  return panel
}

function fuselageDetails() {
  const details = new Group()
  details.name = 'Flush fuselage details'
  details.add(passengerWindows())

  for (const side of [-1, 1] as const) {
    details.add(sidePanel(51, 0.12, 3.535, 7.7, -0.8, side, liveryMaterial))
    for (const z of [-27.2, -11.7, 7.8, 24.2]) details.add(sidePanel(0.78, 1.62, 3.545, 6.85, z, side))
    for (const z of [-25.8, -8.5, 10.5, 22.8]) details.add(sidePanel(0.7, 1.35, 3.02, 9.15, z, side))

    const frontWindow = new Mesh(trapezoidPanelGeometry(1.05, 1.35, 0.68), windowMaterial)
    frontWindow.position.set(side * 0.72, 9.05, -34.72)
    frontWindow.rotation.set(-0.06, side * -0.2, side * -0.08)
    const sideWindow = sidePanel(1.2, 0.58, 2.74, 9.18, -32.55, side, windowMaterial)
    sideWindow.rotation.z = side * -0.05
    details.add(frontWindow, sideWindow)
  }

  return details
}

function engine(name: AircraftBreakawayPart['name'], x: number, y: number, z: number) {
  const assembly = new Group()
  assembly.name = name
  assembly.position.set(x, y, z)

  const nacelle = mesh(taperedTubeGeometry([
    [-2.52, 1.62],
    [-2.28, 1.72],
    [-1.15, 1.68],
    [0.45, 1.5],
    [1.55, 1.2],
    [2.35, 0.88],
  ]), bodyMaterial)
  const intake = mesh(new TorusGeometry(1.54, 0.16, 10, 32), metalMaterial)
  intake.position.z = -2.34
  const fan = new Mesh(new CircleGeometry(1.38, 32), fanMaterial)
  fan.position.z = -2.36
  const spinner = mesh(new CylinderGeometry(0.06, 0.27, 0.55, 18), metalMaterial)
  spinner.rotation.x = Math.PI / 2
  spinner.position.z = -2.48
  const exhaust = mesh(new CylinderGeometry(0.58, 0.9, 1.2, 24), metalMaterial)
  exhaust.rotation.x = Math.PI / 2
  exhaust.position.z = 2.45
  const pylon = mesh(slabGeometry([
    [-0.35, -1.4],
    [0.35, -1.4],
    [0.28, 1.15],
    [-0.22, 1.5],
  ], 0.34), accentMaterial)
  pylon.rotation.z = Math.PI / 2
  pylon.position.y = 2.05

  const fanBlades = new Group()
  fanBlades.position.z = -2.39
  for (let blade = 0; blade < 14; blade += 1) {
    const bladeMesh = new Mesh(new BoxGeometry(0.08, 1.05, 0.035), metalMaterial)
    bladeMesh.position.y = 0.52
    bladeMesh.rotation.z = blade / 14 * Math.PI * 2
    fanBlades.add(bladeMesh)
  }

  assembly.add(nacelle, intake, fan, fanBlades, spinner, exhaust, pylon)
  return assembly
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

function wing(side: -1 | 1, flaps: Group[]) {
  const assembly = new Group()
  assembly.name = side < 0 ? 'Left wing' : 'Right wing'
  assembly.position.y = 6.7
  const panel = mesh(slabGeometry([
    [side * 2.75, -13.2],
    [side * 39.9, 8.3],
    [side * 39.45, 10.85],
    [side * 6.2, 6.4],
    [side * 2.8, 3.9],
  ], 0.54), bodyMaterial)

  const flapPivot = new Group()
  flapPivot.name = 'Flap'
  flapPivot.position.set(side * 19.2, -0.2, 4.9)
  flapPivot.rotation.y = side * -0.48
  const flapPanel = mesh(new BoxGeometry(22.5, 0.3, 2.15), bodyMaterial)
  flapPanel.position.z = 0.7
  flapPivot.add(flapPanel)
  flaps.push(flapPivot)

  const fence = mesh(new BoxGeometry(0.18, 1.45, 2.3), accentMaterial)
  fence.position.set(side * 39.35, 0.76, 9.5)
  fence.rotation.z = side * -0.12

  const fairings = [7.5, 14.5, 21.5, 28.5].map((distance, index) => {
    const fairing = mesh(new CylinderGeometry(0.16, 0.31, 2.9 - index * 0.2, 12), bodyMaterial)
    fairing.rotation.x = Math.PI / 2
    fairing.position.set(side * distance, -0.6, 6.15 + index * 0.48)
    return fairing
  })
  const navigationLight = new Mesh(
    new SphereGeometry(0.24, 12, 8),
    new MeshStandardMaterial({
      color: side < 0 ? 0xd93630 : 0x32b66d,
      emissive: side < 0 ? 0xd93630 : 0x32b66d,
      emissiveIntensity: 2.4,
    }),
  )
  navigationLight.position.set(side * 39.5, 0.25, 9.3)

  assembly.add(panel, flapPivot, fence, navigationLight, ...fairings)
  return assembly
}

function tailplane(side: -1 | 1) {
  const assembly = new Group()
  assembly.name = side < 0 ? 'Left tailplane' : 'Right tailplane'
  assembly.position.set(0, 9.25, 28)
  assembly.add(mesh(slabGeometry([
    [side * 2.1, -2.2],
    [side * 15.1, 3.7],
    [side * 14.2, 6.7],
    [side * 2.3, 3.4],
  ], 0.38), bodyMaterial))
  return assembly
}

function verticalTail() {
  const assembly = new Group()
  assembly.name = 'Fin'
  assembly.position.set(0, 8.65, 24.4)
  const fin = mesh(verticalSlabGeometry([
    [0, 0],
    [15.45, 4.1],
    [15.05, 6.15],
    [0.75, 11.5],
  ], 0.5), bodyMaterial)
  const accent = mesh(verticalSlabGeometry([
    [2.7, 2.1],
    [14.75, 4.95],
    [14.15, 6.05],
    [2.2, 10.35],
  ], 0.53), liveryMaterial)
  assembly.add(fin, accent)
  return assembly
}

export function createAircraft(): AircraftRig {
  const aircraft = new Group()
  aircraft.name = 'N380FS'

  const flaps: Group[] = []
  const wingAssemblies = [wing(-1, flaps), wing(1, flaps)]
  const tailAssemblies = [tailplane(-1), tailplane(1)]
  const finAssembly = verticalTail()
  const engines = [
    engine('left-outer-engine', -25.2, 3.75, 0.2),
    engine('left-inner-engine', -11.7, 3.62, -5),
    engine('right-inner-engine', 11.7, 3.62, -5),
    engine('right-outer-engine', 25.2, 3.75, 0.2),
  ]
  const landingGearAssemblies = [
    bogie('Nose gear', 0, -25.4, 1, 5.1, 0.52),
    bogie('Left wing gear', -10.2, 2.6, 2, 6.25),
    bogie('Right wing gear', 10.2, 2.6, 2, 6.25),
    bogie('Left body gear', -3.15, 7.1, 3, 5.7),
    bogie('Right body gear', 3.15, 7.1, 3, 5.7),
  ]
  const wingBodyFairing = mesh(new SphereGeometry(1, 32, 18), bodyMaterial)
  wingBodyFairing.name = 'Wing-body fairing'
  wingBodyFairing.position.set(0, 4.55, 4.2)
  wingBodyFairing.scale.set(4.05, 1.15, 13.4)

  aircraft.add(
    mesh(fuselageGeometry(), bodyMaterial),
    wingBodyFairing,
    fuselageDetails(),
    ...wingAssemblies,
    ...tailAssemblies,
    finAssembly,
    ...engines,
    ...landingGearAssemblies,
  )

  return {
    root: aircraft,
    landingGear: landingGearAssemblies,
    flaps,
    breakawayParts: [
      { name: 'left-wing', root: wingAssemblies[0] },
      { name: 'right-wing', root: wingAssemblies[1] },
      { name: 'left-tail', root: tailAssemblies[0] },
      { name: 'right-tail', root: tailAssemblies[1] },
      { name: 'fin', root: finAssembly },
      { name: 'left-outer-engine', root: engines[0] },
      { name: 'left-inner-engine', root: engines[1] },
      { name: 'right-inner-engine', root: engines[2] },
      { name: 'right-outer-engine', root: engines[3] },
    ],
  }
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
