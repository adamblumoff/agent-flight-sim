import { useEffect, useRef } from 'react'
import {
  CallbackPositionProperty,
  Cartesian2,
  Cartesian3,
  Color,
  HeadingPitchRoll,
  ImageryLayer,
  Ion,
  Math as CesiumMath,
  Matrix4,
  Terrain,
  TileMapServiceImageryProvider,
  Transforms,
  Viewer,
  buildModuleUrl,
  createGooglePhotorealistic3DTileset,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { flightSimulator } from '../sim/flightSimulator'

const FEET_TO_METERS = 0.3048
const CHASE_OFFSET = new Cartesian3(-240, 0, 80)
const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim()
type FlightState = ReturnType<typeof flightSimulator.getState>

function aircraftPosition(state: FlightState, result?: Cartesian3) {
  return Cartesian3.fromDegrees(
    state.lon,
    state.lat,
    state.altitudeFt * FEET_TO_METERS,
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

export function FlightWorld() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    if (ionToken) Ion.defaultAccessToken = ionToken

    const viewer = new Viewer(container, {
      animation: false,
      baseLayer: ImageryLayer.fromProviderAsync(
        TileMapServiceImageryProvider.fromUrl(
          buildModuleUrl('Assets/Textures/NaturalEarthII'),
        ),
      ),
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      scene3DOnly: true,
      sceneModePicker: false,
      selectionIndicator: false,
      shouldAnimate: true,
      targetFrameRate: 30,
      timeline: false,
      terrain: ionToken ? Terrain.fromWorldTerrain() : undefined,
    })
    viewer.resolutionScale = Math.min(window.devicePixelRatio, 1)

    const position = new CallbackPositionProperty(
      (_time, result?: Cartesian3) =>
        aircraftPosition(flightSimulator.getState(), result),
      false,
    )

    viewer.entities.add({
      id: 'aircraft',
      position,
      point: {
        color: Color.fromCssColorString('#67e8f9'),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        pixelSize: 13,
      },
      label: {
        fillColor: Color.WHITE,
        font: '600 13px system-ui',
        pixelOffset: new Cartesian2(0, -22),
        text: 'N417FS',
      },
    })

    const cameraPosition = new Cartesian3()
    const cameraAttitude = new HeadingPitchRoll()
    const cameraTransform = new Matrix4()
    const chaseAircraft = () => {
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
      viewer.camera.lookAtTransform(transform, CHASE_OFFSET)
    }

    viewer.scene.preRender.addEventListener(chaseAircraft)

    let disposed = false
    if (ionToken) {
      void createGooglePhotorealistic3DTileset()
        .then((tileset) => {
          if (disposed || viewer.isDestroyed()) tileset.destroy()
          else viewer.scene.primitives.add(tileset)
        })
        .catch((error: unknown) => {
          console.warn('Photorealistic 3D Tiles are unavailable.', error)
        })
    }

    return () => {
      disposed = true
      viewer.scene.preRender.removeEventListener(chaseAircraft)
      viewer.destroy()
    }
  }, [])

  return (
    <div className="flight-world" ref={containerRef}>
      {ionToken ? null : (
        <div className="world-notice">
          Add VITE_CESIUM_ION_TOKEN for terrain and photorealistic scenery.
        </div>
      )}
    </div>
  )
}

export default FlightWorld
