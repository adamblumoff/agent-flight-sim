import { useEffect, useRef, useState } from 'react'
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  Euler,
  MathUtils,
  Mesh,
  PCFShadowMap,
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
import { createAircraft, createCrashEffects } from './aircraft'
import { createAircraftBreakup } from './aircraftBreakup'
import { createAirportWorld, disposeScene } from './airportScene'
import { createCheckpointOrb } from './checkpointOrb'
import { stateToWorldVector, WORLD_RUNWAY } from './coordinates'

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
const chaseOffset = new Vector3(0, 28, 105)
const chaseLookAhead = new Vector3(0, -10, -120)
const cockpitOffset = new Vector3(0, 10.5, -34)
const cockpitLookAhead = new Vector3(0, 10, -240)
const crashOrigin = new Vector3(0, 8, -34)

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
      renderer = new WebGLRenderer({ antialias: true, reversedDepthBuffer: true })
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
    renderer.shadowMap.type = PCFShadowMap
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
    container.append(renderer.domElement)

    const scene = new Scene()
    scene.background = new Color(0x849ba0)
    const camera = new PerspectiveCamera(56, 1, 0.25, 8_000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.maxDistance = 1_500
    controls.minDistance = 15
    controls.maxPolarAngle = Math.PI * 0.485
    controls.enabled = false

    const world = createAirportWorld(scene, Math.min(8, renderer.capabilities.getMaxAnisotropy()))
    const aircraftRig = createAircraft()
    const aircraft = aircraftRig.root
    const landingGear = aircraftRig.landingGear
    const flaps = aircraftRig.flaps
    const breakup = createAircraftBreakup(aircraft, aircraftRig.breakawayParts)
    const crashEffects = createCrashEffects()
    const checkpointOrb = createCheckpointOrb()
    scene.add(aircraft, breakup.root, crashEffects.root, checkpointOrb.root)

    const timer = new Timer()
    timer.connect(document)
    const aircraftPosition = new Vector3()
    const previousAircraftPosition = new Vector3()
    const currentAircraftPosition = new Vector3()
    const desiredCameraPosition = new Vector3()
    const desiredCameraTarget = new Vector3()
    const dynamicChaseOffset = chaseOffset.clone()
    const dynamicChaseLookAhead = chaseLookAhead.clone()
    const smoothedTarget = new Vector3()
    const freeLookDirection = new Vector3()
    const explosionPosition = new Vector3()
    const aircraftBounds = new Box3()
    const visiblePartBounds = new Box3()
    const attitude = new Euler(0, 0, 0, 'YXZ')
    const previousAttitudeQuaternion = new Quaternion()
    const currentAttitudeQuaternion = new Quaternion()
    const attitudeQuaternion = new Quaternion()
    let previousMode: FlightCameraMode | null = null
    let smoothedAcceleration = 0
    let visualFlapRadians = 0
    let visualGearCompression = 0
    let gearCompressionPulse = 0
    let handledImpactRevision = 0
    let safeLandingWasActive = false
    let crashWasActive = false
    let animationFrame = 0
    let disposed = false
    let statsPanel: import('stats-gl').default | null = null

    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('stats')) {
      void import('stats-gl').then(async ({ default: Stats }) => {
        if (disposed) return
        const panel = new Stats({ trackGPU: true, trackHz: true, horizontal: true })
        await panel.init(renderer)
        if (disposed) {
          panel.dispose()
          return
        }
        panel.dom.style.cssText = 'position:absolute;top:12px;left:56px;z-index:40;'
        container.append(panel.dom)
        statsPanel = panel
      })
    }

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
      const previousState = flightSimulator.getPreviousState()
      const interpolationAlpha = flightSimulator.getInterpolationAlpha(timestamp)
      stateToWorldVector(previousState, previousAircraftPosition)
      stateToWorldVector(state, currentAircraftPosition)
      aircraftPosition.lerpVectors(previousAircraftPosition, currentAircraftPosition, interpolationAlpha)
      const crashLanding = state.debrief.landing?.safe === false ? state.debrief.landing : null
      const groundY = crashLanding?.onRunway === false ? 0 : WORLD_RUNWAY.surfaceY
      aircraftPosition.y += groundY + 0.01
      aircraft.position.copy(aircraftPosition)

      attitude.set(
        previousState.pitchDeg * DEG_TO_RAD,
        -(previousState.headingDeg - RUNWAY_HEADING_DEG) * DEG_TO_RAD,
        -previousState.bankDeg * DEG_TO_RAD,
      )
      previousAttitudeQuaternion.setFromEuler(attitude)
      attitude.set(
        state.pitchDeg * DEG_TO_RAD,
        -(state.headingDeg - RUNWAY_HEADING_DEG) * DEG_TO_RAD,
        -state.bankDeg * DEG_TO_RAD,
      )
      currentAttitudeQuaternion.setFromEuler(attitude)
      attitudeQuaternion.slerpQuaternions(previousAttitudeQuaternion, currentAttitudeQuaternion, interpolationAlpha)
      aircraft.quaternion.copy(attitudeQuaternion)
      const safeLanding = state.debrief.landing?.safe === true
      if (safeLanding && !safeLandingWasActive) {
        gearCompressionPulse = MathUtils.clamp(state.debrief.landing!.sinkRateFpm / 600, 0, 1) * 0.18
      }
      safeLandingWasActive = safeLanding
      gearCompressionPulse = MathUtils.damp(gearCompressionPulse, 0, 2.6, deltaSeconds)
      const suspensionTarget = state.gearDown && (state.aircraftPhase === 'landing_roll' || state.aircraftPhase === 'stopped')
        ? 0.09 + gearCompressionPulse
        : 0
      visualGearCompression = MathUtils.damp(visualGearCompression, suspensionTarget, 11, deltaSeconds)
      for (const gear of landingGear) {
        gear.visible = state.gearDown
        gear.position.y = visualGearCompression
      }
      visualFlapRadians = MathUtils.damp(visualFlapRadians, state.flapsDeg * DEG_TO_RAD, 4.5, deltaSeconds)
      for (const flap of flaps) flap.rotation.x = visualFlapRadians

      if (state.aircraftPhase !== 'airborne') {
        aircraft.updateMatrixWorld(true)
        aircraftBounds.makeEmpty()
        aircraft.traverseVisible((part) => {
          if (!(part instanceof Mesh) || !part.geometry) return
          if (!part.geometry.boundingBox) part.geometry.computeBoundingBox()
          if (!part.geometry.boundingBox) return
          visiblePartBounds.copy(part.geometry.boundingBox).applyMatrix4(part.matrixWorld)
          aircraftBounds.union(visiblePartBounds)
        })
        const penetration = groundY + 0.005 - aircraftBounds.min.y
        if (penetration > 0) aircraft.position.y += penetration
      }

      const destructiveImpact = state.impact?.severity === 'destructive' ? state.impact : null
      if (destructiveImpact && destructiveImpact.revision !== handledImpactRevision) {
        handledImpactRevision = destructiveImpact.revision
        breakup.start(destructiveImpact)
      } else if (!state.impact && handledImpactRevision !== 0) {
        handledImpactRevision = 0
        breakup.reset()
      }
      breakup.update(deltaSeconds, groundY)
      const crashActive = Boolean(destructiveImpact)
      if (crashActive && !crashWasActive) {
        explosionPosition.copy(crashOrigin).applyQuaternion(attitudeQuaternion).add(aircraft.position)
        crashEffects.start(explosionPosition)
      } else if (!crashActive && crashWasActive) crashEffects.reset()
      crashEffects.update(deltaSeconds, groundY)
      crashWasActive = crashActive
      world.update(state, aircraftPosition, deltaSeconds)
      checkpointOrb.update(state, state.elapsedSeconds + interpolationAlpha / 60)

      const mode = cameraModeRef.current
      aircraft.visible = mode !== 'cockpit'
      breakup.setVisible(mode !== 'cockpit')
      const renderedAcceleration = MathUtils.lerp(
        previousState.motion.longitudinalAccelerationKtPerSecond,
        state.motion.longitudinalAccelerationKtPerSecond,
        interpolationAlpha,
      )
      smoothedAcceleration = MathUtils.damp(smoothedAcceleration, MathUtils.clamp(renderedAcceleration, -8, 8), 3.5, deltaSeconds)
      const accelerationCue = MathUtils.clamp(smoothedAcceleration / 5, -1, 1)
      dynamicChaseOffset.set(0, 28, 105 + (accelerationCue >= 0 ? accelerationCue * 14 : accelerationCue * 8))
      dynamicChaseLookAhead.set(0, -10, -120 - accelerationCue * 10)
      const targetFov = mode === 'cockpit' ? 70 : mode === 'chase' ? 56 + accelerationCue * 4 : 56
      const previousFov = camera.fov
      camera.fov = previousMode !== mode ? targetFov : MathUtils.damp(camera.fov, targetFov, 4, deltaSeconds)
      if (Math.abs(camera.fov - previousFov) > 0.01) {
        camera.updateProjectionMatrix()
      }
      if (mode === 'free') {
        if (previousMode !== 'free') {
          camera.getWorldDirection(freeLookDirection)
          camera.up.set(0, 1, 0)
          controls.target.copy(camera.position).addScaledVector(
            freeLookDirection,
            Math.max(25, camera.position.distanceTo(aircraft.position)),
          )
          controls.enabled = true
          controls.update()
        }
        controls.update()
      } else {
        controls.enabled = false
        const cameraOffset = mode === 'cockpit' ? cockpitOffset : dynamicChaseOffset
        const cameraLookAhead = mode === 'cockpit' ? cockpitLookAhead : dynamicChaseLookAhead
        desiredCameraPosition.copy(cameraOffset).applyQuaternion(attitudeQuaternion).add(aircraft.position)
        desiredCameraTarget.copy(cameraLookAhead).applyQuaternion(attitudeQuaternion).add(aircraft.position)

        if (previousMode !== mode || mode === 'cockpit') {
          camera.position.copy(desiredCameraPosition)
          smoothedTarget.copy(desiredCameraTarget)
        } else {
          const blend = 1 - Math.exp(-deltaSeconds * 4.8)
          camera.position.lerp(desiredCameraPosition, blend)
          smoothedTarget.lerp(desiredCameraTarget, blend)
        }
        camera.up.set(0, 1, 0)
        if (mode === 'cockpit') camera.up.applyQuaternion(attitudeQuaternion)
        camera.lookAt(smoothedTarget)
      }
      previousMode = mode

      renderer.render(scene, camera)
      statsPanel?.update()
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
      statsPanel?.dispose()
      statsPanel?.dom.remove()
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
