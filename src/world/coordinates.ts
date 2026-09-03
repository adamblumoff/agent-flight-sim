import type { FlightState } from '../sim/types'
import type { Vector3 } from 'three'
import { KSTL_RUNWAY_30L } from '../sim/airfields'

export const FEET_TO_METERS = 0.3048
export const NM_TO_METERS = 1_852

export const WORLD_RUNWAY = Object.freeze({
  thresholdLat: KSTL_RUNWAY_30L.thresholdLat,
  thresholdLon: KSTL_RUNWAY_30L.thresholdLon,
  headingDeg: KSTL_RUNWAY_30L.headingDeg,
  lengthFt: KSTL_RUNWAY_30L.lengthFt,
  widthFt: KSTL_RUNWAY_30L.widthFt,
  elevationFt: KSTL_RUNWAY_30L.elevationFt,
  surfaceY: 0.12,
})

const heading = (WORLD_RUNWAY.headingDeg * Math.PI) / 180
const referenceLatitude = (WORLD_RUNWAY.thresholdLat * Math.PI) / 180

export function positionToWorldVector(lat: number, lon: number, altitudeFt: number, target: Vector3) {
  const eastNm = (lon - WORLD_RUNWAY.thresholdLon) * 60 * Math.cos(referenceLatitude)
  const northNm = (lat - WORLD_RUNWAY.thresholdLat) * 60
  const alongNm = eastNm * Math.sin(heading) + northNm * Math.cos(heading)
  const crossNm = -eastNm * Math.cos(heading) + northNm * Math.sin(heading)
  return target.set(
    -crossNm * NM_TO_METERS,
    Math.max(0, altitudeFt - WORLD_RUNWAY.elevationFt) * FEET_TO_METERS,
    -alongNm * NM_TO_METERS,
  )
}

export const stateToWorldVector = (state: FlightState, target: Vector3) =>
  positionToWorldVector(state.lat, state.lon, state.altitudeFt, target)

export const waypointToWorldVector = (fix: { lat: number; lon: number; altitudeFt: number }, target: Vector3) =>
  positionToWorldVector(fix.lat, fix.lon, fix.altitudeFt, target)
