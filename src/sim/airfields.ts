import type { Airport, MissionRunway } from './types'

const EARTH_RADIUS_NM = 3_440.065
const radians = (degrees: number) => degrees * Math.PI / 180

export function offsetPosition(origin: { lat: number; lon: number }, bearing: number, distanceNm: number) {
  const angular = distanceNm / EARTH_RADIUS_NM
  const bearingRad = radians(bearing)
  const lat1 = radians(origin.lat)
  const lon1 = radians(origin.lon)
  const lat = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearingRad))
  const lon = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat))
  return Object.freeze({ lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI })
}

export const KPWK_AIRPORT: Airport = Object.freeze({
  code: 'KPWK',
  name: 'Chicago Executive Airport',
  lat: 42.11255,
  lon: -87.89998,
  elevationFt: 645,
})

export const KPWK_RUNWAY_16: MissionRunway = Object.freeze({
  id: 'KPWK-16',
  airport: 'KPWK',
  thresholdLat: 42.123329,
  thresholdLon: -87.907126,
  farEndLat: 42.110552,
  farEndLon: -87.900405,
  headingDeg: 159,
  lengthFt: 5_001,
  widthFt: 150,
  elevationFt: KPWK_AIRPORT.elevationFt,
})

const northFieldReference = offsetPosition({ lat: KPWK_RUNWAY_16.thresholdLat, lon: KPWK_RUNWAY_16.thresholdLon }, 339, 0.9)
const northFieldThreshold = offsetPosition(northFieldReference, 249, 0.38)
const northFieldFarEnd = offsetPosition(northFieldThreshold, 180, 2_600 / 6_076.12)

export const NORTH_FIELD_AIRPORT: Airport = Object.freeze({
  code: 'KNFD',
  name: 'North Field',
  lat: northFieldThreshold.lat,
  lon: northFieldThreshold.lon,
  elevationFt: 645,
})

export const NORTH_FIELD_RUNWAY_18: MissionRunway = Object.freeze({
  id: 'KNFD-18',
  airport: 'KNFD',
  thresholdLat: northFieldThreshold.lat,
  thresholdLon: northFieldThreshold.lon,
  farEndLat: northFieldFarEnd.lat,
  farEndLon: northFieldFarEnd.lon,
  headingDeg: 180,
  lengthFt: 2_600,
  widthFt: 75,
  elevationFt: NORTH_FIELD_AIRPORT.elevationFt,
})

export const NORTH_FIELD_START = offsetPosition(
  { lat: NORTH_FIELD_RUNWAY_18.thresholdLat, lon: NORTH_FIELD_RUNWAY_18.thresholdLon },
  NORTH_FIELD_RUNWAY_18.headingDeg,
  0.08,
)

const lakesideThreshold = offsetPosition(NORTH_FIELD_START, 28, 12.5)
const lakesideFarEnd = offsetPosition(lakesideThreshold, 220, 4_400 / 6_076.12)

export const LAKESIDE_AIRPORT: Airport = Object.freeze({
  code: 'KLAK',
  name: 'Lakeside Municipal',
  lat: lakesideThreshold.lat,
  lon: lakesideThreshold.lon,
  elevationFt: KPWK_AIRPORT.elevationFt,
})

export const LAKESIDE_RUNWAY_22: MissionRunway = Object.freeze({
  id: 'KLAK-22',
  airport: 'KLAK',
  thresholdLat: lakesideThreshold.lat,
  thresholdLon: lakesideThreshold.lon,
  farEndLat: lakesideFarEnd.lat,
  farEndLon: lakesideFarEnd.lon,
  headingDeg: 220,
  lengthFt: 4_400,
  widthFt: 100,
  elevationFt: LAKESIDE_AIRPORT.elevationFt,
})
