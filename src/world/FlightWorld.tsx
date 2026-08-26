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
  PolylineDashMaterialProperty,
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
  COMPACT_TRAINING_MISSION,
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
  message: 'Loading the KPWK training circuit.',
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

function addMission(viewer: Viewer) {
  const { airport, fixes, legs, runway } = COMPACT_TRAINING_MISSION
  const fixesById = new Map(fixes.map((fix) => [fix.id, fix]))
  const routeCoordinates = [
    runway.thresholdLon,
    runway.thresholdLat,
    runway.elevationFt * FEET_TO_METERS + 5,
  ]

  for (const leg of legs) {
    const fix = fixesById.get(leg.to)
    if (!fix) continue
    routeCoordinates.push(
      fix.lon,
      fix.lat,
      Math.max(fix.altitudeFt, runway.elevationFt) * FEET_TO_METERS + 5,
    )
  }

  const routePositions = Cartesian3.fromDegreesArrayHeights(routeCoordinates)
  const runwayPositions = Cartesian3.fromDegreesArrayHeights([
    runway.thresholdLon,
    runway.thresholdLat,
    runway.elevationFt * FEET_TO_METERS + 1.5,
    runway.farEndLon,
    runway.farEndLat,
    runway.elevationFt * FEET_TO_METERS + 1.5,
  ])

  viewer.entities.add({
    id: 'mission-runway',
    corridor: {
      positions: runwayPositions,
      width: runway.widthFt * FEET_TO_METERS,
      material: Color.fromCssColorString('#151515').withAlpha(0.68),
      outline: false,
    },
  })
  viewer.entities.add({
    id: 'mission-runway-centerline',
    polyline: {
      positions: runwayPositions,
      width: 2,
      material: new PolylineDashMaterialProperty({
        color: Color.WHITE.withAlpha(0.9),
        dashLength: 18,
      }),
    },
  })

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

  for (const fix of fixes) {
    viewer.entities.add({
      id: `mission-fix-${fix.id}`,
      position: Cartesian3.fromDegrees(
        fix.lon,
        fix.lat,
        Math.max(fix.altitudeFt, runway.elevationFt) * FEET_TO_METERS + 8,
      ),
      point: {
        color: fix.id.includes('GATE') ? Color.fromCssColorString('#f0b95c') : Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        pixelSize: 8,
        scaleByDistance: new NearFarScalar(500, 1.3, 30_000, 0.72),
      },
      label: {
        backgroundColor: Color.BLACK.withAlpha(0.82),
        fillColor: Color.WHITE,
        font: '700 12px "Kode Mono", monospace',
        horizontalOrigin: HorizontalOrigin.CENTER,
        outlineColor: Color.BLACK,
        outlineWidth: 4,
        pixelOffset: new Cartesian2(0, -20),
        scaleByDistance: new NearFarScalar(500, 1.1, 35_000, 0.68),
        showBackground: true,
        style: LabelStyle.FILL_AND_OUTLINE,
        text: `${fix.name}  ${fix.altitudeFt.toLocaleString()} FT / ${fix.airspeedKt} KT`,
        translucencyByDistance: new NearFarScalar(3_000, 1, 45_000, 0.08),
        verticalOrigin: VerticalOrigin.BOTTOM,
      },
    })
  }

  viewer.entities.add({
    id: `airport-${airport.code}`,
    position: Cartesian3.fromDegrees(
      runway.farEndLon,
      runway.farEndLat,
      runway.elevationFt * FEET_TO_METERS + 18,
    ),
    label: {
      backgroundColor: Color.BLACK.withAlpha(0.88),
      fillColor: Color.WHITE,
      font: '700 13px "Kode Mono", monospace',
      horizontalOrigin: HorizontalOrigin.CENTER,
      outlineColor: Color.BLACK,
      outlineWidth: 4,
      pixelOffset: new Cartesian2(0, -18),
      scaleByDistance: new NearFarScalar(500, 1.15, 35_000, 0.7),
      showBackground: true,
      style: LabelStyle.FILL_AND_OUTLINE,
      text: `${airport.code}  RWY ${runway.id.replace('TRAINING-', '')}`,
      verticalOrigin: VerticalOrigin.BOTTOM,
    },
  })
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
        COMPACT_TRAINING_MISSION.airport.lon,
      ),
    )
    viewer.clock.shouldAnimate = false
    viewer.scene.highDynamicRange = true
    viewer.scene.postProcessStages.fxaa.enabled = true
    viewer.shadows = true

    addMission(viewer)

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
            message: 'KPWK photorealistic scenery is ready.',
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
