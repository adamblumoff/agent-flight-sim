import { useEffect, useRef, useState } from 'react'
import {
  CallbackPositionProperty,
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Color,
  DistanceDisplayCondition,
  HeadingPitchRoll,
  HorizontalOrigin,
  Ion,
  IonGeocodeProviderType,
  JulianDate,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  NearFarScalar,
  PolylineGlowMaterialProperty,
  Quaternion,
  ShadowMode,
  Transforms,
  VerticalOrigin,
  Viewer,
  createGooglePhotorealistic3DTileset,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import {
  KPWK_TO_KMDW_ROUTE,
  flightSimulator,
} from '../sim/flightSimulator'

const FEET_TO_METERS = 0.3048
const AIRCRAFT_CLEARANCE_METERS = 4
const CHASE_OFFSET = new Cartesian3(-185, 0, 52)
const COCKPIT_OFFSET = new Cartesian3(7.5, 0, 2.4)
const AIRCRAFT_MODEL_URI = '/models/cesium-air.glb'
const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim()
type FlightState = ReturnType<typeof flightSimulator.getState>

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

const setupStatus: FlightWorldStatus = {
  kind: 'setup',
  message: 'A Cesium ion token is required to load the 3D world.',
}

const loadingStatus: FlightWorldStatus = {
  kind: 'loading',
  message: 'Loading the Chicago flight corridor.',
}

function aircraftPosition(state: FlightState, result?: Cartesian3) {
  return Cartesian3.fromDegrees(
    state.lon,
    state.lat,
    state.altitudeFt * FEET_TO_METERS + AIRCRAFT_CLEARANCE_METERS,
    undefined,
    result,
  )
}

function aircraftAttitude(state: FlightState, result: HeadingPitchRoll) {
  result.heading = CesiumMath.toRadians(state.headingDeg - 90)
  result.pitch = CesiumMath.toRadians(state.pitchDeg)
  result.roll = CesiumMath.toRadians(state.bankDeg)
  return result
}

function solarNoonAtLongitude(longitude: number) {
  const now = new Date()
  const utcHours = 12 - longitude / 15
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
      utcHours * 60 * 60 * 1_000,
  )
}

function addRoute(viewer: Viewer) {
  const { departure, arrival } = KPWK_TO_KMDW_ROUTE
  const routeHeightMeters = 22
  const routePositions = Cartesian3.fromDegreesArrayHeights([
    departure.lon,
    departure.lat,
    departure.elevationFt * FEET_TO_METERS + routeHeightMeters,
    arrival.lon,
    arrival.lat,
    arrival.elevationFt * FEET_TO_METERS + routeHeightMeters,
  ])

  viewer.entities.add({
    id: 'planned-route-outline',
    polyline: {
      positions: routePositions,
      width: 12,
      material: Color.fromCssColorString('#050505').withAlpha(0.82),
    },
  })
  viewer.entities.add({
    id: 'planned-route',
    polyline: {
      positions: routePositions,
      width: 6,
      material: new PolylineGlowMaterialProperty({
        color: Color.fromCssColorString('#fbbf24'),
        glowPower: 0.18,
        taperPower: 0.35,
      }),
    },
  })

  for (const airport of [departure, arrival]) {
    viewer.entities.add({
      id: `airport-${airport.code}`,
      position: Cartesian3.fromDegrees(
        airport.lon,
        airport.lat,
        airport.elevationFt * FEET_TO_METERS + 35,
      ),
      point: {
        color: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelSize: 10,
        scaleByDistance: new NearFarScalar(500, 1.35, 80_000, 0.75),
      },
      label: {
        backgroundColor: Color.BLACK.withAlpha(0.82),
        fillColor: Color.WHITE,
        font: '700 14px "Kode Mono", monospace',
        horizontalOrigin: HorizontalOrigin.CENTER,
        outlineColor: Color.BLACK,
        outlineWidth: 4,
        pixelOffset: new Cartesian2(0, -24),
        scaleByDistance: new NearFarScalar(500, 1.15, 90_000, 0.72),
        showBackground: true,
        style: LabelStyle.FILL_AND_OUTLINE,
        text: `${airport.code}  ${airport.name}`,
        translucencyByDistance: new NearFarScalar(5_000, 1, 140_000, 0.12),
        verticalOrigin: VerticalOrigin.BOTTOM,
      },
    })
  }
}

export function FlightWorld({
  cameraMode = 'chase',
  onStatusChange,
}: FlightWorldProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cameraModeRef = useRef(cameraMode)
  const [status, setStatus] = useState<FlightWorldStatus>(
    ionToken ? loadingStatus : setupStatus,
  )

  cameraModeRef.current = cameraMode

  useEffect(() => {
    onStatusChange?.(status)
  }, [onStatusChange, status])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !ionToken) return

    Ion.defaultAccessToken = ionToken

    const viewer = new Viewer(container, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: IonGeocodeProviderType.GOOGLE,
      globe: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      scene3DOnly: true,
      sceneModePicker: false,
      selectionIndicator: false,
      shouldAnimate: false,
      targetFrameRate: 60,
      timeline: false,
    })
    viewer.resolutionScale = Math.min(window.devicePixelRatio, 1.5)
    viewer.clock.currentTime = JulianDate.fromDate(
      solarNoonAtLongitude(
        (KPWK_TO_KMDW_ROUTE.departure.lon + KPWK_TO_KMDW_ROUTE.arrival.lon) / 2,
      ),
    )
    viewer.clock.shouldAnimate = false
    viewer.scene.highDynamicRange = true
    viewer.scene.postProcessStages.fxaa.enabled = true
    viewer.shadows = true

    addRoute(viewer)

    const position = new CallbackPositionProperty(
      (_time, result?: Cartesian3) =>
        aircraftPosition(flightSimulator.getState(), result),
      false,
    )
    const orientationPosition = new Cartesian3()
    const orientationAttitude = new HeadingPitchRoll()
    const orientation = new CallbackProperty(
      (_time, result?: Quaternion) => {
        const state = flightSimulator.getState()
        aircraftPosition(state, orientationPosition)
        aircraftAttitude(state, orientationAttitude)
        return Transforms.headingPitchRollQuaternion(
          orientationPosition,
          orientationAttitude,
          undefined,
          undefined,
          result,
        )
      },
      false,
    )

    viewer.entities.add({
      id: 'aircraft',
      position,
      orientation,
      model: {
        minimumPixelSize: 84,
        maximumScale: 3,
        runAnimations: false,
        shadows: ShadowMode.ENABLED,
        uri: AIRCRAFT_MODEL_URI,
      },
      label: {
        backgroundColor: Color.BLACK.withAlpha(0.72),
        distanceDisplayCondition: new DistanceDisplayCondition(120, 20_000),
        fillColor: Color.WHITE,
        font: '700 13px "Kode Mono", monospace',
        outlineColor: Color.BLACK,
        outlineWidth: 4,
        pixelOffset: new Cartesian2(0, -34),
        showBackground: true,
        style: LabelStyle.FILL_AND_OUTLINE,
        text: 'N417FS',
        verticalOrigin: VerticalOrigin.BOTTOM,
      },
    })

    const cameraPosition = new Cartesian3()
    const cameraAttitude = new HeadingPitchRoll()
    const cameraTransform = new Matrix4()
    const cockpitPosition = new Cartesian3()
    const cockpitDirection = new Cartesian3()
    const cockpitUp = new Cartesian3()
    let previousCameraMode: FlightCameraMode | null = null
    const updateCamera = () => {
      const mode = cameraModeRef.current

      if (mode === 'free') {
        if (previousCameraMode !== 'free') {
          viewer.camera.lookAtTransform(Matrix4.IDENTITY)
          viewer.scene.screenSpaceCameraController.enableInputs = true
        }
        previousCameraMode = mode
        return
      }

      viewer.scene.screenSpaceCameraController.enableInputs = false
      const state = flightSimulator.getState()
      aircraftPosition(state, cameraPosition)
      aircraftAttitude(state, cameraAttitude)
      const transform = Transforms.headingPitchRollToFixedFrame(
        cameraPosition,
        cameraAttitude,
        undefined,
        undefined,
        cameraTransform,
      )

      if (mode === 'cockpit') {
        Matrix4.multiplyByPoint(transform, COCKPIT_OFFSET, cockpitPosition)
        Matrix4.multiplyByPointAsVector(
          transform,
          Cartesian3.UNIT_X,
          cockpitDirection,
        )
        Matrix4.multiplyByPointAsVector(transform, Cartesian3.UNIT_Z, cockpitUp)
        Cartesian3.normalize(cockpitDirection, cockpitDirection)
        Cartesian3.normalize(cockpitUp, cockpitUp)
        viewer.camera.lookAtTransform(Matrix4.IDENTITY)
        viewer.camera.setView({
          destination: cockpitPosition,
          orientation: {
            direction: cockpitDirection,
            up: cockpitUp,
          },
        })
      } else {
        viewer.camera.lookAtTransform(transform, CHASE_OFFSET)
      }
      previousCameraMode = mode
    }

    viewer.scene.preRender.addEventListener(updateCamera)

    let disposed = false
    const loadWorldTimer = window.setTimeout(() => {
      if (disposed) return
      void createGooglePhotorealistic3DTileset({
        onlyUsingWithGoogleGeocoder: true,
      })
        .then((tileset) => {
          if (disposed || viewer.isDestroyed()) {
            tileset.destroy()
            return
          }
          tileset.shadows = ShadowMode.ENABLED
          viewer.scene.primitives.add(tileset)
          setStatus({
            kind: 'ready',
            message: 'Chicago photorealistic scenery is ready.',
          })
        })
        .catch((error: unknown) => {
          if (disposed) return
          const failure = error as { readonly message?: string }
          console.error(
            'Photorealistic world failed to initialize',
            failure.message ?? 'Unknown Cesium error',
          )
          setStatus({
            kind: 'error',
            message:
              'Cesium could not load the 3D world. Check VITE_CESIUM_ION_TOKEN and reload.',
          })
        })
    }, 0)

    return () => {
      disposed = true
      window.clearTimeout(loadWorldTimer)
      viewer.scene.preRender.removeEventListener(updateCamera)
      viewer.destroy()
    }
  }, [])

  const showStatus = status.kind !== 'ready'

  return (
    <div className="flight-world relative min-h-0 overflow-hidden bg-black">
      <div className="absolute inset-0" ref={containerRef} />
      {showStatus ? (
        <div
          aria-live="polite"
          className="absolute inset-0 z-10 grid place-items-center bg-black/86 px-6"
          role={status.kind === 'error' ? 'alert' : 'status'}
        >
          <div className="max-w-md text-center">
            <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-white/48">
              {status.kind === 'setup'
                ? 'World setup required'
                : status.kind === 'error'
                  ? 'World unavailable'
                  : 'Building world'}
            </p>
            <p className="mt-3 text-balance text-lg font-semibold text-white">
              {status.message}
            </p>
            {status.kind === 'setup' ? (
              <p className="mt-3 text-sm leading-6 text-white/58">
                Add{' '}
                <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-white">
                  VITE_CESIUM_ION_TOKEN
                </code>{' '}
                to <code className="font-mono text-white">.env.local</code>, then restart
                the dev server.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default FlightWorld
