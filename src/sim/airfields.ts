import type { Airport, MissionRunway } from './types'
import { A380_ENVELOPE } from './aircraftEnvelope.ts'

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

// KSTL runway 30L uses its published threshold, true course, and 11,020 ft length.
// The simulator's runway surface tracks the 30L threshold elevation rather than the
// airport-reference elevation, so the landing physics meets the real pavement.
export const KSTL_AIRPORT: Airport = Object.freeze({
  code: 'KSTL',
  name: 'St. Louis Lambert International Airport',
  lat: 38.748698,
  lon: -90.370026,
  elevationFt: 617.3,
})

const KSTL_RUNWAY_LENGTH_FT = 11_020
const KSTL_RUNWAY_THRESHOLD = Object.freeze({ lat: 38.737782, lon: -90.346464 })
const KSTL_RUNWAY_FAR_END = offsetPosition(KSTL_RUNWAY_THRESHOLD, 302, KSTL_RUNWAY_LENGTH_FT / 6_076.12)

export const KSTL_RUNWAY_30L: MissionRunway = Object.freeze({
  id: 'KSTL-30L',
  airport: 'KSTL',
  thresholdLat: KSTL_RUNWAY_THRESHOLD.lat,
  thresholdLon: KSTL_RUNWAY_THRESHOLD.lon,
  farEndLat: KSTL_RUNWAY_FAR_END.lat,
  farEndLon: KSTL_RUNWAY_FAR_END.lon,
  headingDeg: 302,
  lengthFt: KSTL_RUNWAY_LENGTH_FT,
  // FAA published width for KSTL 12R/30L. The simulation's A380 envelope
  // remains within the usable paved surface rather than silently widening it.
  widthFt: 150,
  elevationFt: 585.3,
})

const NORTH_FIELD_RUNWAY_LENGTH_FT = 10_000
const northFieldReference = offsetPosition({ lat: KSTL_RUNWAY_30L.thresholdLat, lon: KSTL_RUNWAY_30L.thresholdLon }, 122, 2.2)
const northFieldThreshold = offsetPosition(northFieldReference, 249, 0.72)
const northFieldFarEnd = offsetPosition(northFieldThreshold, 180, NORTH_FIELD_RUNWAY_LENGTH_FT / 6_076.12)

export const NORTH_FIELD_AIRPORT: Airport = Object.freeze({
  code: 'KNFD',
  name: 'North Field',
  lat: northFieldThreshold.lat,
  lon: northFieldThreshold.lon,
  elevationFt: KSTL_RUNWAY_30L.elevationFt,
})

export const NORTH_FIELD_RUNWAY_18: MissionRunway = Object.freeze({
  id: 'KNFD-18',
  airport: 'KNFD',
  thresholdLat: northFieldThreshold.lat,
  thresholdLon: northFieldThreshold.lon,
  farEndLat: northFieldFarEnd.lat,
  farEndLon: northFieldFarEnd.lon,
  headingDeg: 180,
  lengthFt: NORTH_FIELD_RUNWAY_LENGTH_FT,
  widthFt: A380_ENVELOPE.standardRunwayWidthFt,
  elevationFt: NORTH_FIELD_AIRPORT.elevationFt,
})

export const NORTH_FIELD_START = offsetPosition(
  { lat: NORTH_FIELD_RUNWAY_18.thresholdLat, lon: NORTH_FIELD_RUNWAY_18.thresholdLon },
  NORTH_FIELD_RUNWAY_18.headingDeg,
  0.08,
)

const lakesideThreshold = offsetPosition(NORTH_FIELD_START, 28, 12.5)
const LAKESIDE_RUNWAY_LENGTH_FT = 9_500
const lakesideFarEnd = offsetPosition(lakesideThreshold, 220, LAKESIDE_RUNWAY_LENGTH_FT / 6_076.12)

export const LAKESIDE_AIRPORT: Airport = Object.freeze({
  code: 'KLAK',
  name: 'Lakeside Municipal',
  lat: lakesideThreshold.lat,
  lon: lakesideThreshold.lon,
  elevationFt: KSTL_RUNWAY_30L.elevationFt,
})

export const LAKESIDE_RUNWAY_22: MissionRunway = Object.freeze({
  id: 'KLAK-22',
  airport: 'KLAK',
  thresholdLat: lakesideThreshold.lat,
  thresholdLon: lakesideThreshold.lon,
  farEndLat: lakesideFarEnd.lat,
  farEndLon: lakesideFarEnd.lon,
  headingDeg: 220,
  lengthFt: LAKESIDE_RUNWAY_LENGTH_FT,
  widthFt: A380_ENVELOPE.standardRunwayWidthFt,
  elevationFt: LAKESIDE_AIRPORT.elevationFt,
})

export const LAKESIDE_RUNWAY_04: MissionRunway = Object.freeze({
  id: 'KLAK-04',
  airport: 'KLAK',
  thresholdLat: lakesideFarEnd.lat,
  thresholdLon: lakesideFarEnd.lon,
  farEndLat: lakesideThreshold.lat,
  farEndLon: lakesideThreshold.lon,
  headingDeg: 40,
  lengthFt: LAKESIDE_RUNWAY_LENGTH_FT,
  widthFt: A380_ENVELOPE.standardRunwayWidthFt,
  elevationFt: LAKESIDE_AIRPORT.elevationFt,
})
