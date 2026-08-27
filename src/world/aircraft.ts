import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
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

const bodyMaterial = new MeshPhysicalMaterial({
  color: 0xe8eceb,
  metalness: 0.18,
  roughness: 0.42,
  clearcoat: 0.55,
  clearcoatRoughness: 0.3,
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

function wheel(x: number, z: number, scale = 1) {
  const assembly = new Group()
  assembly.name = 'Landing gear'
  const tireCenterY = 0.37 * scale
  const strutLength = 0.95 * scale
  const tire = mesh(new TorusGeometry(0.28 * scale, 0.09 * scale, 8, 18), rubberMaterial)
  tire.rotation.y = Math.PI / 2
  tire.position.set(x, tireCenterY, z)
  const strut = mesh(new CylinderGeometry(0.035, 0.035, strutLength, 8), metalMaterial)
  strut.position.set(x, tireCenterY + strutLength / 2, z)
  assembly.add(tire, strut)
  return assembly
}

export function createAircraft() {
  const aircraft = new Group()
  aircraft.name = 'N417FS'
  const landingGear = [wheel(-1.45, 0.35), wheel(1.45, 0.35), wheel(0, -2.8, 0.78)]
  aircraft.userData.landingGear = landingGear

  const fuselage = mesh(new CapsuleGeometry(0.66, 4.7, 6, 14), bodyMaterial)
  fuselage.rotation.x = Math.PI / 2
  fuselage.position.y = 1.4

  const nose = mesh(new ConeGeometry(0.62, 1.65, 18), bodyMaterial)
  nose.rotation.x = -Math.PI / 2
  nose.position.set(0, 1.4, -3.9)

  const wings = mesh(new BoxGeometry(10.8, 0.14, 1.42), bodyMaterial)
  wings.position.set(0, 1.32, -0.55)
  wings.rotation.x = -0.035

  const wingStripe = mesh(new BoxGeometry(10.3, 0.04, 0.28), accentMaterial)
  wingStripe.position.set(0, 1.4, -0.8)

  const tailplane = mesh(new BoxGeometry(4.1, 0.11, 0.78), bodyMaterial)
  tailplane.position.set(0, 1.58, 2.8)

  const fin = mesh(new BoxGeometry(0.14, 1.75, 1.45), accentMaterial)
  fin.position.set(0, 2.2, 2.7)
  fin.rotation.x = -0.28

  const windshield = mesh(new BoxGeometry(1.02, 0.61, 0.08), glassMaterial)
  windshield.position.set(0, 1.82, -1.92)
  windshield.rotation.x = -0.22

  const sideWindowLeft = mesh(new BoxGeometry(0.07, 0.54, 1.2), glassMaterial)
  sideWindowLeft.position.set(-0.65, 1.83, -1.05)
  const sideWindowRight = sideWindowLeft.clone()
  sideWindowRight.position.x = 0.65

  const spinner = mesh(new SphereGeometry(0.22, 12, 8), accentMaterial)
  spinner.scale.z = 1.3
  spinner.position.set(0, 1.4, -4.76)
  const propellerDisc = new Mesh(
    new CircleGeometry(1.08, 32),
    new MeshBasicMaterial({ color: 0xaeb8ba, transparent: true, opacity: 0.16, depthWrite: false }),
  )
  propellerDisc.position.set(0, 1.4, -4.82)

  aircraft.add(
    fuselage,
    nose,
    wings,
    wingStripe,
    tailplane,
    fin,
    windshield,
    sideWindowLeft,
    sideWindowRight,
    spinner,
    propellerDisc,
    ...landingGear,
  )

  return aircraft
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
