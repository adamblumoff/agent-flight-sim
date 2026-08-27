import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { FlightState } from '../sim/types'
import { waypointToWorldVector, WORLD_RUNWAY } from './coordinates'

const runway = WORLD_RUNWAY
const runwayLength = runway.lengthFt * 0.3048
const runwayWidth = runway.widthFt * 0.3048

const asphalt = new MeshStandardMaterial({ color: 0x282d2e, roughness: 0.92 })
const concrete = new MeshStandardMaterial({ color: 0x777973, roughness: 0.88 })
const yellowPaint = new MeshStandardMaterial({ color: 0xc69c42, roughness: 0.8 })
const buildingWall = new MeshStandardMaterial({ color: 0x9a9c91, roughness: 0.82 })
const buildingDark = new MeshStandardMaterial({ color: 0x4c5352, roughness: 0.78 })

function seededRandom(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0
    return value / 0x1_0000_0000
  }
}

function createTerrainMaterial(anisotropy: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 1_024
  canvas.height = 1_024
  const context = canvas.getContext('2d')!
  const random = seededRandom(4_221)
  const fieldColors = ['#4a6542', '#596f45', '#66754a', '#52623e', '#71805a', '#435b3c']
  context.fillStyle = '#516944'
  context.fillRect(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y += 90) {
    for (let x = 0; x < canvas.width; x += 105) {
      context.fillStyle = fieldColors[Math.floor(random() * fieldColors.length)]
      context.globalAlpha = 0.72 + random() * 0.22
      context.fillRect(x + 2, y + 2, 99, 84)
      context.fillStyle = 'rgba(231,220,169,.08)'
      for (let stripe = 8; stripe < 90; stripe += 12) context.fillRect(x + stripe, y + 2, 2, 84)
    }
  }
  context.globalAlpha = 0.85
  context.strokeStyle = '#7f8278'
  context.lineWidth = 5
  context.beginPath()
  context.moveTo(-40, 290)
  context.bezierCurveTo(260, 230, 670, 390, 1_070, 300)
  context.moveTo(160, -30)
  context.lineTo(260, 1_060)
  context.moveTo(790, -30)
  context.lineTo(690, 1_060)
  context.stroke()
  context.globalAlpha = 0.16
  for (let index = 0; index < 2_200; index += 1) {
    context.fillStyle = random() > 0.48 ? '#182d1d' : '#c2bd89'
    const size = 1 + random() * 3
    context.fillRect(random() * 1_024, random() * 1_024, size, size)
  }
  context.globalAlpha = 1
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = anisotropy
  return new MeshStandardMaterial({ map: texture, color: 0xb7c0a8, roughness: 0.98 })
}

function createRunwayTexture(anisotropy: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 4_096
  const context = canvas.getContext('2d')!
  const random = seededRandom(16)
  const xToPixel = (x: number) => (x / runwayWidth + 0.5) * canvas.width
  const zToPixel = (z: number) => (1 + z / runwayLength) * canvas.height
  const drawMarking = (x: number, z: number, width: number, depth: number) => {
    const left = xToPixel(x - width / 2)
    const right = xToPixel(x + width / 2)
    const top = zToPixel(z - depth / 2)
    const bottom = zToPixel(z + depth / 2)
    context.fillRect(left, top, right - left, bottom - top)
  }

  context.fillStyle = '#282d2e'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalAlpha = 0.12
  for (let index = 0; index < 5_000; index += 1) {
    const shade = Math.floor(35 + random() * 28)
    context.fillStyle = `rgb(${shade},${shade + 2},${shade + 2})`
    context.fillRect(random() * canvas.width, random() * canvas.height, 1 + random() * 2, 1 + random() * 6)
  }
  context.globalAlpha = 1
  context.fillStyle = '#e5e3d7'

  for (let z = -235; z > -runwayLength + 210; z -= 62) drawMarking(0, z, 0.85, 27)
  for (const end of [-48, -runwayLength + 48]) {
    for (let x = -17.5; x <= 17.5; x += 5) drawMarking(x, end, 2.1, 24)
  }
  for (const z of [-325, -390, -runwayLength + 325, -runwayLength + 390]) {
    drawMarking(-8.6, z, 3.2, 42)
    drawMarking(8.6, z, 3.2, 42)
  }

  const drawRunwayNumber = (text: string, z: number, rotation: number) => {
    context.save()
    context.translate(canvas.width / 2, zToPixel(z))
    context.rotate(rotation)
    context.font = '900 190px Arial, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(text, 0, 0)
    context.restore()
  }
  drawRunwayNumber('16', -132, Math.PI)
  drawRunwayNumber('34', -runwayLength + 132, 0)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = anisotropy
  return texture
}

function box(width: number, height: number, depth: number, material: MeshStandardMaterial) {
  const result = new Mesh(new BoxGeometry(width, height, depth), material)
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function groundBox(
  group: Group,
  width: number,
  depth: number,
  x: number,
  z: number,
  material: MeshStandardMaterial,
  height = 0.08,
  baseY = 0,
) {
  const result = box(width, height, depth, material)
  result.castShadow = false
  result.position.set(x, baseY + height / 2, z)
  group.add(result)
  return result
}

function addRunway(root: Group, anisotropy: number) {
  const runwaySurface = new Mesh(
    new PlaneGeometry(runwayWidth, runwayLength),
    new MeshStandardMaterial({ map: createRunwayTexture(anisotropy), roughness: 0.92 }),
  )
  runwaySurface.rotation.x = -Math.PI / 2
  runwaySurface.position.set(0, 0.006, -runwayLength / 2)
  runwaySurface.receiveShadow = true
  root.add(runwaySurface)

  const lightGeometry = new SphereGeometry(0.18, 6, 4)
  const edgeLight = new MeshBasicMaterial({ color: 0xf3f6dd, toneMapped: false, transparent: true, depthWrite: false })
  const thresholdGreen = new MeshBasicMaterial({ color: 0x4effa3, toneMapped: false, transparent: true, depthWrite: false })
  const thresholdRed = new MeshBasicMaterial({ color: 0xff4f40, toneMapped: false, transparent: true, depthWrite: false })
  const edgePositions: Vector3[] = []
  const greenPositions: Vector3[] = []
  const redPositions: Vector3[] = []
  for (let z = -12; z >= -runwayLength + 12; z -= 48) {
    for (const x of [-runwayWidth / 2 - 0.8, runwayWidth / 2 + 0.8]) edgePositions.push(new Vector3(x, 0.22, z))
  }
  for (let x = -runwayWidth / 2 + 2; x < runwayWidth / 2; x += 4.5) {
    greenPositions.push(new Vector3(x, 0.22, -2))
    redPositions.push(new Vector3(x, 0.22, -runwayLength + 2))
  }
  for (let z = 40; z <= 430; z += 35) edgePositions.push(new Vector3(0, 0.24, z))

  const matrix = new Matrix4()
  const createLights = (positions: Vector3[], material: MeshBasicMaterial) => {
    const lights = new InstancedMesh(lightGeometry, material, positions.length)
    positions.forEach((position, index) => {
      matrix.makeTranslation(position.x, position.y, position.z)
      lights.setMatrixAt(index, matrix)
    })
    lights.instanceMatrix.needsUpdate = true
    root.add(lights)
    return lights
  }
  const lightMeshes = [
    createLights(edgePositions, edgeLight),
    createLights(greenPositions, thresholdGreen),
    createLights(redPositions, thresholdRed),
  ]
  const lightMaterials = [edgeLight, thresholdGreen, thresholdRed]

  return {
    update(distanceFromRunwayCenter: number) {
      const opacity = Math.max(0, Math.min(1, (2_800 - distanceFromRunwayCenter) / 1_000))
      for (const material of lightMaterials) material.opacity = opacity
      for (const lights of lightMeshes) lights.visible = opacity > 0.01
    },
  }
}

function addAirport(root: Group) {
  groundBox(root, 95, runwayLength * 0.82, -112, -runwayLength * 0.52, concrete)
  groundBox(root, 62, 580, 98, -runwayLength * 0.5, concrete)
  for (const z of [-265, -610, -990, -1_270]) {
    groundBox(root, 180, 19, -68, z, concrete)
    groundBox(root, 165, 19, 66, z - 36, concrete)
    groundBox(root, 118, 0.8, -65, z, yellowPaint, 0.012, 0.08)
  }

  const buildings = [
    [-176, -240, 64, 20, 42], [-186, -335, 82, 17, 48], [-170, -460, 58, 14, 34],
    [-183, -740, 75, 18, 46], [-166, -880, 52, 13, 30], [-176, -1_090, 74, 18, 42],
    [168, -325, 58, 15, 38], [176, -470, 75, 17, 42], [170, -690, 50, 13, 32],
    [180, -940, 70, 19, 44], [165, -1_155, 48, 14, 30],
  ] as const
  for (const [x, z, width, height, depth] of buildings) {
    const hangar = box(width, height, depth, x < 0 ? buildingWall : buildingDark)
    hangar.position.set(x, height / 2, z)
    root.add(hangar)
  }

  const tower = box(8, 42, 8, buildingDark)
  tower.position.set(-145, 21, -570)
  const cab = box(15, 7, 15, buildingWall)
  cab.position.set(-145, 44, -570)
  root.add(tower, cab)
  const road = groundBox(root, 14, 2_700, -270, -runwayLength / 2, asphalt)
  road.rotation.y = -0.05

  const random = seededRandom(8_731)
  const city = new InstancedMesh(new BoxGeometry(1, 1, 1), buildingDark, 115)
  const matrix = new Matrix4()
  const scale = new Vector3()
  const position = new Vector3()
  for (let index = 0; index < city.count; index += 1) {
    const side = random() > 0.5 ? 1 : -1
    const width = 18 + random() * 48
    const height = 6 + random() * 20
    const depth = 16 + random() * 45
    position.set(side * (380 + random() * 1_600), height / 2, 350 - random() * 3_600)
    scale.set(width, height, depth)
    matrix.compose(position, city.quaternion, scale)
    city.setMatrixAt(index, matrix)
  }
  city.instanceMatrix.needsUpdate = true
  root.add(city)
}

function createSky() {
  return new Mesh(
    new SphereGeometry(7_000, 28, 14),
    new ShaderMaterial({
      side: DoubleSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new Color(0x31566d) },
        horizonColor: { value: new Color(0xb5c0b0) },
      },
      vertexShader: 'varying vec3 vPosition; void main() { vPosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        varying vec3 vPosition;
        void main() {
          float heightMix = smoothstep(-0.08, 0.7, normalize(vPosition).y);
          gl_FragColor = vec4(mix(horizonColor, topColor, heightMix), 1.0);
        }
      `,
    }),
  )
}

function createRain() {
  const count = 620
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - 0.5) * 180
    positions[index * 3 + 1] = Math.random() * 115
    positions[index * 3 + 2] = (Math.random() - 0.5) * 220
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  const rain = new Points(geometry, new PointsMaterial({
    color: 0xc9d8dc,
    size: 0.36,
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false,
  }))
  rain.frustumCulled = false
  rain.visible = false
  return rain
}

function createGuidanceLine() {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3))
  const line = new Line(geometry, new LineBasicMaterial({
    color: 0x90c9cf,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
  }))
  line.frustumCulled = false
  return line
}

export function createAirportWorld(scene: Scene, anisotropy = 1) {
  const root = new Group()
  root.name = 'KPWK training airport'
  const terrain = new Mesh(new PlaneGeometry(12_000, 12_000), createTerrainMaterial(anisotropy))
  terrain.rotation.x = -Math.PI / 2
  terrain.position.set(0, -0.08, -1_200)
  terrain.receiveShadow = true
  root.add(terrain)
  const runwayLights = addRunway(root, anisotropy)
  addAirport(root)

  const sky = createSky()
  const rain = createRain()
  const guidance = createGuidanceLine()
  root.add(sky, rain, guidance)
  scene.add(root)

  scene.add(new AmbientLight(0x667077, 0.42))
  scene.add(new HemisphereLight(0xbfd9e6, 0x35412b, 1.55))
  const sun = new DirectionalLight(0xfff1d3, 2.6)
  sun.position.set(-950, 1_300, 620)
  sun.castShadow = true
  sun.shadow.mapSize.set(1_024, 1_024)
  sun.shadow.camera.left = -180
  sun.shadow.camera.right = 180
  sun.shadow.camera.top = 180
  sun.shadow.camera.bottom = -180
  sun.shadow.camera.near = 10
  sun.shadow.camera.far = 3_000
  sun.shadow.bias = -0.0001
  sun.shadow.normalBias = 0.06
  sun.shadow.camera.updateProjectionMatrix()
  scene.add(sun)
  scene.add(sun.target)

  const shadowTexelSize = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.width
  const targetPosition = new Vector3()

  let currentWeather = ''
  const setWeather = (state: FlightState) => {
    const visibility = state.scenario.weather.visibilityMiles
    const raining = state.scenario.weather.summary.toLowerCase().includes('rain')
    const weather = raining ? 'rain' : visibility < 1.5 ? 'low' : visibility < 4 ? 'haze' : 'clear'
    const weatherKey = `${weather}:${visibility}:${state.scenario.weather.ceilingFt}`
    if (currentWeather === weatherKey) return
    currentWeather = weatherKey
    rain.visible = weather === 'low' || weather === 'rain'
    const fogFar = Math.min(6_500, Math.max(1_200, visibility * 1_609.34))
    const fogNear = Math.max(100, fogFar * 0.08)
    if (weather === 'low' || weather === 'rain') {
      scene.background = new Color(0x667579)
      scene.fog = new Fog(0x667579, fogNear, fogFar)
      sky.material.uniforms.topColor.value.set(0x263b45)
      sky.material.uniforms.horizonColor.value.set(0x8b9793)
    } else if (weather === 'haze') {
      scene.background = new Color(0x9a9b89)
      scene.fog = new Fog(0x9a9b89, fogNear, fogFar)
      sky.material.uniforms.topColor.value.set(0x647c88)
      sky.material.uniforms.horizonColor.value.set(0xc4bfa9)
    } else {
      scene.background = new Color(0x8eb3c4)
      scene.fog = new Fog(0x9fb7ba, fogNear, fogFar)
      sky.material.uniforms.topColor.value.set(0x396d8b)
      sky.material.uniforms.horizonColor.value.set(0xd2d2be)
    }
  }

  const update = (state: FlightState, aircraftPosition: Vector3, deltaSeconds: number) => {
    setWeather(state)
    sky.position.set(aircraftPosition.x, 0, aircraftPosition.z)
    runwayLights.update(Math.hypot(aircraftPosition.x, aircraftPosition.z + runwayLength / 2))
    const shadowCenterX = Math.round(aircraftPosition.x / shadowTexelSize) * shadowTexelSize
    const shadowCenterZ = Math.round(aircraftPosition.z / shadowTexelSize) * shadowTexelSize
    sun.position.set(shadowCenterX - 950, 1_300, shadowCenterZ + 620)
    sun.target.position.set(shadowCenterX, 0, shadowCenterZ)

    if (rain.visible) {
      rain.position.set(aircraftPosition.x, Math.max(aircraftPosition.y - 30, 0), aircraftPosition.z)
      const positions = rain.geometry.getAttribute('position') as BufferAttribute
      for (let index = 0; index < positions.count; index += 1) {
        const y = positions.getY(index) - deltaSeconds * 72
        positions.setY(index, y < 0 ? 115 : y)
      }
      positions.needsUpdate = true
    }

    const target = state.route.waypoints[state.route.activeWaypointIndex]
    guidance.visible = Boolean(target) && state.altitudeFt > runway.elevationFt + 20
    if (target) {
      waypointToWorldVector(target, targetPosition)
      const positions = guidance.geometry.getAttribute('position') as BufferAttribute
      positions.setXYZ(0, aircraftPosition.x, aircraftPosition.y + 0.5, aircraftPosition.z)
      positions.setXYZ(1, targetPosition.x, targetPosition.y + 0.5, targetPosition.z)
      positions.needsUpdate = true
    }
  }

  return { update }
}

export function disposeScene(scene: Scene) {
  scene.traverse((object) => {
    if (!(object instanceof Mesh || object instanceof Points || object instanceof Line)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if ('map' in material && material.map) material.map.dispose()
      material.dispose()
    }
  })
}
