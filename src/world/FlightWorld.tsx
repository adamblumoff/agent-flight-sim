import { useEffect, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  Color,
  Euler,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { flightSimulator } from '../sim/flightSimulator'
import { createAircraft } from './aircraft'
import { createAirportWorld, disposeScene } from './airportScene'
import { stateToWorld } from './coordinates'

export type FlightCameraMode = 'chase' | 'cockpit' | 'free'

export type FlightWorldStatus =
  | { readonly kind: 'setup'; readonly message: string }
  | { readonly kind: 'loading'; readonly message: string }
  | { readonly kind: 'ready'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string }

export interface FlightWorldProps {
  readonly cameraMode?: FlightCameraMode
  readonly onStatusChange?: (status: FlightWorldStatus) => void
}

const loadingStatus: FlightWorldStatus = {
  kind: 'loading',
  message: 'Preparing the KPWK training field.',
}
const readyStatus: FlightWorldStatus = {
  kind: 'ready',
  message: 'KPWK training field is ready.',
}

const DEG_TO_RAD = Math.PI / 180
const RUNWAY_HEADING_DEG = 159
const chaseOffset = new Vector3(0, 6.2, 18)
const chaseLookAhead = new Vector3(0, -4.5, -28)
const cockpitOffset = new Vector3(0, 1.8, -1.28)
const cockpitLookAhead = new Vector3(0, 1.7, -80)

export function FlightWorld({ cameraMode = 'chase', onStatusChange }: FlightWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cameraModeRef = useRef(cameraMode)
  const [status, setStatus] = useState<FlightWorldStatus>(loadingStatus)

  useEffect(() => {
    cameraModeRef.current = cameraMode
  }, [cameraMode])

  useEffect(() => {
    onStatusChange?.(status)
  }, [onStatusChange, status])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true })
    } catch (error) {
      console.error('Three.js world failed to initialize', error)
      setStatus({ kind: 'error', message: 'This browser could not start the 3D flight view.' })
      return
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25))
    renderer.setSize(container.clientWidth, container.clientHeight, false)
    renderer.outputColorSpace = SRGBColorSpace
    renderer.toneMapping = ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.08
    renderer.shadowMap.enabled = true
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
    container.append(renderer.domElement)

    const scene = new Scene()
    scene.background = new Color(0x849ba0)
    const camera = new PerspectiveCamera(56, 1, 0.08, 12_000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxDistance = 850
    controls.minDistance = 5
    controls.maxPolarAngle = Math.PI * 0.485
    controls.enabled = false

    const world = createAirportWorld(scene)
    const aircraft = createAircraft()
    scene.add(aircraft)

    const timer = new Timer()
    timer.connect(document)
    const aircraftPosition = new Vector3()
    const desiredCameraPosition = new Vector3()
    const desiredCameraTarget = new Vector3()
    const smoothedTarget = new Vector3()
    const attitude = new Euler(0, 0, 0, 'YXZ')
    const attitudeQuaternion = new Quaternion()
    let previousMode: FlightCameraMode | null = null
    let animationFrame = 0
    let disposed = false

    const resize = () => {
      const width = Math.max(1, container.clientWidth)
      const height = Math.max(1, container.clientHeight)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    const render = (timestamp: number) => {
      if (disposed) return
      timer.update(timestamp)
      const deltaSeconds = Math.min(timer.getDelta(), 0.05)
      const state = flightSimulator.getState()
      const position = stateToWorld(state)
      aircraftPosition.set(position.x, position.y + 0.025, position.z)
      aircraft.position.copy(aircraftPosition)

      attitude.set(
        state.pitchDeg * DEG_TO_RAD,
        -(state.headingDeg - RUNWAY_HEADING_DEG) * DEG_TO_RAD,
        -state.bankDeg * DEG_TO_RAD,
      )
      attitudeQuaternion.setFromEuler(attitude)
      aircraft.quaternion.copy(attitudeQuaternion)
      const propeller = aircraft.userData.propeller as { rotation: { z: number } }
      propeller.rotation.z += deltaSeconds * (8 + state.throttle * 55)

      world.update(state, deltaSeconds)

      const mode = cameraModeRef.current
      if (previousMode !== mode) {
        camera.fov = mode === 'cockpit' ? 70 : 56
        camera.updateProjectionMatrix()
      }
      if (mode === 'free') {
        if (previousMode !== 'free') {
          desiredCameraPosition.copy(chaseOffset).applyQuaternion(attitudeQuaternion).add(aircraftPosition)
          camera.position.copy(desiredCameraPosition)
          controls.target.copy(aircraftPosition)
          controls.enabled = true
        }
        controls.target.lerp(aircraftPosition, 1 - Math.exp(-deltaSeconds * 2.2))
        controls.update()
      } else {
        controls.enabled = false
        const cameraOffset = mode === 'cockpit' ? cockpitOffset : chaseOffset
        const cameraLookAhead = mode === 'cockpit' ? cockpitLookAhead : chaseLookAhead
        desiredCameraPosition.copy(cameraOffset).applyQuaternion(attitudeQuaternion).add(aircraftPosition)
        desiredCameraTarget.copy(cameraLookAhead).applyQuaternion(attitudeQuaternion).add(aircraftPosition)

        if (previousMode !== mode) {
          camera.position.copy(desiredCameraPosition)
          smoothedTarget.copy(desiredCameraTarget)
        } else {
          const blend = 1 - Math.exp(-deltaSeconds * (mode === 'cockpit' ? 16 : 4.8))
          camera.position.lerp(desiredCameraPosition, blend)
          smoothedTarget.lerp(desiredCameraTarget, blend)
        }
        camera.up.set(0, 1, 0)
        if (mode === 'cockpit') camera.up.applyQuaternion(attitudeQuaternion)
        camera.lookAt(smoothedTarget)
      }
      previousMode = mode

      renderer.render(scene, camera)
      animationFrame = requestAnimationFrame(render)
    }

    const handleContextLost = (event: Event) => {
      event.preventDefault()
      setStatus({ kind: 'error', message: 'The 3D view lost its graphics context. Reload to continue.' })
    }
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost)
    setStatus(readyStatus)
    animationFrame = requestAnimationFrame(render)

    return () => {
      disposed = true
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      timer.dispose()
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost)
      controls.dispose()
      disposeScene(scene)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div className="flight-world relative min-h-0 overflow-hidden bg-[#637a72]">
      <div className="absolute inset-0" ref={containerRef} />
      {status.kind === 'error' ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/80 px-6" role="alert">
          <p className="max-w-md text-center text-lg font-semibold text-white">{status.message}</p>
        </div>
      ) : null}
    </div>
  )
}

export default FlightWorld
