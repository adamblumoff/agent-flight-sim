import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
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
  color: 0xe8eceb,
  metalness: 0.18,
  roughness: 0.42,
  clearcoat: 0.55,
  clearcoatRoughness: 0.3,
  side: DoubleSide,
})
const accentMaterial = new MeshStandardMaterial({ color: 0x13354b, metalness: 0.12, roughness: 0.38 })
const glassMaterial = new MeshPhysicalMaterial({
  color: 0x203744,
  metalness: 0.25,
  roughness: 0.18,
  transparent: true,
  opacity: 0.82,
})
const rubberMaterial = new MeshStandardMaterial({ color: 0x111314, roughness: 0.88 })
const metalMaterial = new MeshStandardMaterial({ color: 0x9fa9ac, metalness: 0.78, roughness: 0.25 })

function mesh(geometry: ConstructorParameters<typeof Mesh>[0], material: ConstructorParameters<typeof Mesh>[1]) {
  const result = new Mesh(geometry, material)
  result.castShadow = true
  return result
}

function curvedWindow(radius: number, length: number, y: number, z: number, thetaStart: number, thetaLength: number) {
  const window = mesh(new CylinderGeometry(radius, radius, length, 24, 1, true, thetaStart, thetaLength), glassMaterial)
  window.rotation.x = Math.PI / 2
  window.position.set(0, y, z)
  return window
}

function landingGear(x: number, z: number, scale = 1, twin = false) {
  const assembly = new Group()
  assembly.name = 'Landing gear'
  const tireCenterY = 0.54 * scale
  const strutLength = 1.35 * scale
  const wheelOffsets = twin ? [-0.32, 0.32] : [0]
  for (const wheelOffset of wheelOffsets) {
    const tire = mesh(new TorusGeometry(0.41 * scale, 0.13 * scale, 8, 20), rubberMaterial)
    tire.rotation.y = Math.PI / 2
    tire.position.set(x + wheelOffset * scale, tireCenterY, z)
    assembly.add(tire)
  }
  const strut = mesh(new CylinderGeometry(0.06, 0.06, strutLength, 10), metalMaterial)
  strut.position.set(x, tireCenterY + strutLength / 2, z)
  assembly.add(strut)
  return assembly
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

function engine(name: AircraftBreakawayPart['name'], x: number, z: number) {
  const assembly = new Group()
  assembly.name = name
  assembly.position.set(x, 1.35, z)
  const nacelle = mesh(new CylinderGeometry(0.62, 0.78, 2.15, 20, 1, false), bodyMaterial)
  nacelle.rotation.x = Math.PI / 2
  const intake = mesh(new TorusGeometry(0.66, 0.1, 8, 24), metalMaterial)
  intake.position.z = -1.08
  const fan = new Mesh(new CircleGeometry(0.55, 24), new MeshStandardMaterial({ color: 0x182126, metalness: 0.6, roughness: 0.35 }))
  fan.position.z = -1.09
  assembly.add(nacelle, intake, fan)
  return assembly
}

export function createAircraft(): AircraftRig {
  const aircraft = new Group()
  aircraft.name = 'N380FS'
  const landingGearAssemblies = [
    landingGear(-3.15, 1.35, 1, true),
    landingGear(3.15, 1.35, 1, true),
    landingGear(0, -6.55, 0.82, true),
  ]

  const fuselage = mesh(new CapsuleGeometry(1.35, 14.8, 8, 24), bodyMaterial)
  fuselage.rotation.x = Math.PI / 2
  fuselage.position.y = 2.62
  const upperDeck = mesh(new CapsuleGeometry(0.72, 6.6, 6, 20), bodyMaterial)
  upperDeck.rotation.x = Math.PI / 2
  upperDeck.position.set(0, 3.48, -1.75)

  const flaps: Group[] = []
  const wingAssemblies = ([-1, 1] as const).map((side) => {
    const assembly = new Group()
    assembly.name = side < 0 ? 'Left wing' : 'Right wing'
    assembly.position.y = 2.35
    const panel = mesh(slabGeometry([
      [side * 1.05, -1.75],
      [side * 10.7, 1.15],
      [side * 9.85, 2.65],
      [side * 1.05, 0.65],
    ], 0.2), bodyMaterial)
    const stripe = mesh(new BoxGeometry(7.7, 0.045, 0.26), accentMaterial)
    stripe.position.set(side * 5.75, 0.13, 0.55)
    stripe.rotation.y = side * -0.19
    const pivot = new Group()
    pivot.name = 'Flap'
    pivot.position.set(side * 4.9, -0.05, 1.25)
    pivot.rotation.y = side * -0.16
    const flapPanel = mesh(new BoxGeometry(5.9, 0.14, 0.72), bodyMaterial)
    flapPanel.position.z = 0.36
    pivot.add(flapPanel)
    flaps.push(pivot)
    assembly.add(panel, stripe, pivot)
    return assembly
  })

  const tailAssemblies = ([-1, 1] as const).map((side) => {
    const assembly = new Group()
    assembly.name = side < 0 ? 'Left tailplane' : 'Right tailplane'
    assembly.position.y = 3
    assembly.add(mesh(slabGeometry([
      [side * 0.7, 6.1],
      [side * 4.45, 7.45],
      [side * 4.05, 8.25],
      [side * 0.55, 7.45],
    ], 0.16), bodyMaterial))
    return assembly
  })

  const finAssembly = new Group()
  finAssembly.name = 'Fin'
  finAssembly.position.set(0, 3.85, 6.65)
  const finPanel = mesh(slabGeometry([
    [0, -0.9],
    [0, 1.5],
    [3.95, 1.05],
    [3.15, -0.55],
  ], 0.22), accentMaterial)
  finPanel.rotation.z = Math.PI / 2
  finAssembly.add(finPanel)

  const windows = [
    curvedWindow(1.365, 8.9, 2.82, -0.15, 3.9, 0.24),
    curvedWindow(1.365, 8.9, 2.82, -0.15, 2.14, 0.24),
    curvedWindow(1.365, 7.4, 3.2, -0.55, 3.93, 0.2),
    curvedWindow(1.365, 7.4, 3.2, -0.55, 2.15, 0.2),
    curvedWindow(1.37, 1.25, 2.95, -7.2, 2.45, 1.4),
  ]
  const engines = [
    engine('left-outer-engine', -7.3, -0.05),
    engine('left-inner-engine', -3.55, -1.05),
    engine('right-inner-engine', 3.55, -1.05),
    engine('right-outer-engine', 7.3, -0.05),
  ]

  aircraft.add(
    fuselage,
    upperDeck,
    ...wingAssemblies,
    ...tailAssemblies,
    finAssembly,
    ...windows,
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
