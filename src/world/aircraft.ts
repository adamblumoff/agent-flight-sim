import {
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
  SphereGeometry,
  TorusGeometry,
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
  const tire = mesh(new TorusGeometry(0.28 * scale, 0.09 * scale, 8, 18), rubberMaterial)
  tire.rotation.y = Math.PI / 2
  tire.position.set(x, 0.28 * scale, z)
  const strut = mesh(new CylinderGeometry(0.035, 0.035, 1.05, 8), metalMaterial)
  strut.position.set(x, 0.79, z)
  assembly.add(tire, strut)
  return assembly
}

export function createAircraft() {
  const aircraft = new Group()
  aircraft.name = 'N417FS'

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
    new CircleGeometry(1.56, 32),
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
    wheel(-1.45, 0.35),
    wheel(1.45, 0.35),
    wheel(0, -2.8, 0.78),
  )

  return aircraft
}
