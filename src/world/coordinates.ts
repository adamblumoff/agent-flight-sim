import type { FlightState } from '../sim/types'

export const FEET_TO_METERS = 0.3048
export const NM_TO_METERS = 1_852

export const WORLD_RUNWAY = Object.freeze({
  thresholdLat: 42.12332888888889,
  thresholdLon: -87.90712641666667,
  headingDeg: 159,
  lengthFt: 5_001,
  widthFt: 150,
  elevationFt: 645,
})

const heading = (WORLD_RUNWAY.headingDeg * Math.PI) / 180
const referenceLatitude = (WORLD_RUNWAY.thresholdLat * Math.PI) / 180

export function positionToWorld(lat: number, lon: number, altitudeFt: number) {
  const eastNm = (lon - WORLD_RUNWAY.thresholdLon) * 60 * Math.cos(referenceLatitude)
  const northNm = (lat - WORLD_RUNWAY.thresholdLat) * 60
  const alongNm = eastNm * Math.sin(heading) + northNm * Math.cos(heading)
  const crossNm = -eastNm * Math.cos(heading) + northNm * Math.sin(heading)

  return {
    x: -crossNm * NM_TO_METERS,
    y: Math.max(0, altitudeFt - WORLD_RUNWAY.elevationFt) * FEET_TO_METERS,
    z: -alongNm * NM_TO_METERS,
  }
}

export const stateToWorld = (state: FlightState) =>
  positionToWorld(state.lat, state.lon, state.altitudeFt)

export const waypointToWorld = (fix: { lat: number; lon: number; altitudeFt: number }) =>
  positionToWorld(fix.lat, fix.lon, fix.altitudeFt)
