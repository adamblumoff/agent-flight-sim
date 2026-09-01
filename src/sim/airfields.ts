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

// FAA 2026 airport data: KSTL 12R/30L is 11,020 by 150 feet. The simulator keeps
// the runway flat at the 30L threshold elevation so takeoff and landing collision
// geometry share one physical surface.
export const KSTL_AIRPORT: Airport = Object.freeze({
  code: 'KSTL',
  name: 'St. Louis Lambert International Airport',
  lat: 38.748698,
  lon: -90.370026,
  elevationFt: 617.3,
})

const KSTL_RUNWAY_LENGTH_FT = 11_020
const KSTL_RUNWAY_THRESHOLD = Object.freeze({ lat: 38.737782, lon: -90.346464 })
const KSTL_RUNWAY_FAR_END = offsetPosition(KSTL_RUNWAY_THRESHOLD, 304, KSTL_RUNWAY_LENGTH_FT / 6_076.12)

export const KSTL_RUNWAY_30L: MissionRunway = Object.freeze({
  id: 'KSTL-30L',
  airport: 'KSTL',
  thresholdLat: KSTL_RUNWAY_THRESHOLD.lat,
  thresholdLon: KSTL_RUNWAY_THRESHOLD.lon,
  farEndLat: KSTL_RUNWAY_FAR_END.lat,
  farEndLon: KSTL_RUNWAY_FAR_END.lon,
  headingDeg: 304,
  lengthFt: KSTL_RUNWAY_LENGTH_FT,
  // FAA published width for KSTL 12R/30L. The simulation's A380 envelope
  // remains within the usable paved surface rather than silently widening it.
  widthFt: 150,
  elevationFt: 585.3,
})

export const KSTL_RUNWAY_12R: MissionRunway = Object.freeze({
  id: 'KSTL-12R',
  airport: 'KSTL',
  thresholdLat: KSTL_RUNWAY_30L.farEndLat,
  thresholdLon: KSTL_RUNWAY_30L.farEndLon,
  farEndLat: KSTL_RUNWAY_30L.thresholdLat,
  farEndLon: KSTL_RUNWAY_30L.thresholdLon,
  headingDeg: 124,
  lengthFt: KSTL_RUNWAY_LENGTH_FT,
  widthFt: 150,
  elevationFt: KSTL_RUNWAY_30L.elevationFt,
})

export const KSTL_DEPARTURE_START = offsetPosition(
  { lat: KSTL_RUNWAY_12R.thresholdLat, lon: KSTL_RUNWAY_12R.thresholdLon },
  KSTL_RUNWAY_12R.headingDeg,
  0.08,
)

// FAA airport data: KMDW field elevation 620 feet; runway 13C/31C is
// 6,522 by 150 feet. The threshold is derived from the published airport
// reference point because Midway remains the filed destination, not the
// emergency landing surface rendered around Lambert.
export const KMDW_AIRPORT: Airport = Object.freeze({
  code: 'KMDW',
  name: 'Chicago Midway International Airport',
  lat: 41.786,
  lon: -87.7525,
  elevationFt: 620,
})

const KMDW_RUNWAY_LENGTH_FT = 6_522
const KMDW_RUNWAY_31C_THRESHOLD = offsetPosition(KMDW_AIRPORT, 138, 0.54)
const KMDW_RUNWAY_31C_FAR_END = offsetPosition(KMDW_RUNWAY_31C_THRESHOLD, 318, KMDW_RUNWAY_LENGTH_FT / 6_076.12)

export const KMDW_RUNWAY_31C: MissionRunway = Object.freeze({
  id: 'KMDW-31C',
  airport: 'KMDW',
  thresholdLat: KMDW_RUNWAY_31C_THRESHOLD.lat,
  thresholdLon: KMDW_RUNWAY_31C_THRESHOLD.lon,
  farEndLat: KMDW_RUNWAY_31C_FAR_END.lat,
  farEndLon: KMDW_RUNWAY_31C_FAR_END.lon,
  headingDeg: 318,
  lengthFt: KMDW_RUNWAY_LENGTH_FT,
  widthFt: 150,
  elevationFt: 613,
})
