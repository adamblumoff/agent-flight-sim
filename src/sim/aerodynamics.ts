import type { CheckrideSeed, ScenarioConditions } from './types'

const radians = (degrees: number) => degrees * Math.PI / 180
const degrees = (value: number) => value * 180 / Math.PI
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const normalizeHeading = (value: number) => ((value % 360) + 360) % 360

export interface GroundMotion {
  readonly groundSpeedKt: number
  readonly trackDeg: number
  readonly headwindKt: number
  readonly crosswindKt: number
}

export interface StallResponse {
  readonly angleOfAttackDeg: number
  readonly stallSpeedKt: number
  readonly severity: number
  readonly sinkRateFpm: number
}

export type TurbulenceLevel = 'none' | 'light' | 'moderate'

export interface TurbulenceResponse {
  readonly level: TurbulenceLevel
  readonly verticalAccelerationFpmPerSecond: number
  readonly rollRateDegPerSecond: number
}

interface WindVector {
  readonly northKt: number
  readonly eastKt: number
}

function windVectorFor(
  weather: ScenarioConditions['weather'],
  elapsedSeconds: number,
  seed: CheckrideSeed,
): WindVector {
  const windToRad = radians(normalizeHeading(weather.windDirectionDeg + 180))
  const gustPhase = seed * 0.071
  const alongGustKt = weather.windSpeedKt * (
    Math.sin(elapsedSeconds * 0.43 + gustPhase) * 0.07
    + Math.sin(elapsedSeconds * 1.17 + gustPhase * 2.3) * 0.025
  )
  const crossGustKt = weather.windSpeedKt * Math.sin(elapsedSeconds * 0.71 + gustPhase * 1.7) * 0.045
  const windSpeedKt = Math.max(0, weather.windSpeedKt + alongGustKt)
  return Object.freeze({
    northKt: Math.cos(windToRad) * windSpeedKt - Math.sin(windToRad) * crossGustKt,
    eastKt: Math.sin(windToRad) * windSpeedKt + Math.cos(windToRad) * crossGustKt,
  })
}

const unitNoise = (value: number) => {
  const raw = Math.sin(value * 12.9898 + 78.233) * 43_758.5453
  return raw - Math.floor(raw)
}

/** Deterministic, intermittent turbulence so a seed remains replayable through WebMCP. */
export function turbulenceFor(
  weather: ScenarioConditions['weather'],
  elapsedSeconds: number,
  seed: CheckrideSeed,
): TurbulenceResponse {
  const cycleSeconds = 27
  const cycle = Math.floor(elapsedSeconds / cycleSeconds)
  const phaseSeconds = elapsedSeconds - cycle * cycleSeconds
  const weatherIntensity = clamp(
    (weather.windSpeedKt - 4) / 20 + (weather.summary.toLowerCase().includes('rain') ? 0.18 : 0),
    0,
    1,
  )
  const occurrence = unitNoise(seed * 17 + cycle * 31)
  const startsAt = 4 + unitNoise(seed * 23 + cycle * 19) * 9
  const duration = 4 + unitNoise(seed * 29 + cycle * 13) * 5
  const active = occurrence < 0.3 + weatherIntensity * 0.45
    && phaseSeconds >= startsAt
    && phaseSeconds <= startsAt + duration
  if (!active) return Object.freeze({ level: 'none', verticalAccelerationFpmPerSecond: 0, rollRateDegPerSecond: 0 })

  const localPhase = (phaseSeconds - startsAt) / duration
  const envelope = Math.sin(localPhase * Math.PI)
  const intensity = envelope * (0.42 + weatherIntensity * 0.58) * (0.8 + occurrence * 0.4)
  const verticalAccelerationFpmPerSecond = intensity * (
    Math.sin(elapsedSeconds * 2.7 + seed) * 210
    + Math.sin(elapsedSeconds * 5.9 + seed * 0.37) * 85
  )
  const rollRateDegPerSecond = intensity * (
    Math.sin(elapsedSeconds * 1.9 + seed * 0.61) * 2.1
    + Math.sin(elapsedSeconds * 4.1 + seed) * 0.7
  )
  return Object.freeze({
    level: intensity >= 0.62 ? 'moderate' : 'light',
    verticalAccelerationFpmPerSecond,
    rollRateDegPerSecond,
  })
}

/** Resolve meteorological wind (direction it comes from) against the aircraft's air vector. */
export function groundMotionFor(
  airspeedKt: number,
  headingDeg: number,
  weather: ScenarioConditions['weather'],
  elapsedSeconds: number,
  seed: CheckrideSeed,
): GroundMotion {
  const wind = windVectorFor(weather, elapsedSeconds, seed)
  const headingRad = radians(headingDeg)
  const airNorthKt = Math.cos(headingRad) * airspeedKt
  const airEastKt = Math.sin(headingRad) * airspeedKt
  const groundNorthKt = airNorthKt + wind.northKt
  const groundEastKt = airEastKt + wind.eastKt
  const tailwindKt = wind.northKt * Math.cos(headingRad) + wind.eastKt * Math.sin(headingRad)
  const crosswindKt = wind.eastKt * Math.cos(headingRad) - wind.northKt * Math.sin(headingRad)

  return Object.freeze({
    groundSpeedKt: Math.hypot(groundNorthKt, groundEastKt),
    trackDeg: normalizeHeading(degrees(Math.atan2(groundEastKt, groundNorthKt))),
    headwindKt: -tailwindKt,
    crosswindKt,
  })
}

/** Heading required to hold a desired ground track through the current wind. */
export function windCorrectedHeadingDeg(
  desiredTrackDeg: number,
  airspeedKt: number,
  weather: ScenarioConditions['weather'],
  elapsedSeconds: number,
  seed: CheckrideSeed,
) {
  const trackRad = radians(desiredTrackDeg)
  const wind = windVectorFor(weather, elapsedSeconds, seed)
  const windAcrossTrackKt = -wind.northKt * Math.sin(trackRad) + wind.eastKt * Math.cos(trackRad)
  const correctionDeg = degrees(Math.asin(clamp(-windAcrossTrackKt / Math.max(airspeedKt, 1), -0.95, 0.95)))
  return normalizeHeading(desiredTrackDeg + correctionDeg)
}

/** Tuned A380-class drag expressed as knots-per-second of deceleration. */
export function airborneDragKtPerSecond(airspeedKt: number, flapsDeg: number, gearDown: boolean, bankDeg: number) {
  const speedRatio = Math.max(airspeedKt, 35) / 230
  const dynamicPressure = speedRatio ** 2
  const loadFactor = 1 / Math.max(0.45, Math.cos(radians(Math.min(63, Math.abs(bankDeg)))))
  const parasiteDrag = 2.9 * dynamicPressure
  const configurationDrag = (flapsDeg / 30 * 1.2 + (gearDown ? 0.9 : 0)) * Math.max(0.35, dynamicPressure)
  const inducedDrag = 0.55 * (150 / Math.max(airspeedKt, 90)) ** 2 * loadFactor
  return 0.22 + parasiteDrag + configurationDrag + inducedDrag
}

export function stallResponseFor(
  airspeedKt: number,
  pitchDeg: number,
  verticalSpeedFpm: number,
  bankDeg: number,
  flapsDeg: number,
): StallResponse {
  const verticalSpeedKt = verticalSpeedFpm * 60 / 6_076.12
  const flightPathDeg = degrees(Math.atan2(verticalSpeedKt, Math.max(airspeedKt, 1)))
  const angleOfAttackDeg = pitchDeg - flightPathDeg
  const baseStallSpeedKt = flapsDeg >= 30 ? 110 : flapsDeg >= 20 ? 116 : flapsDeg >= 10 ? 123 : 132
  const bankLoadFactor = 1 / Math.max(0.5, Math.cos(radians(Math.min(60, Math.abs(bankDeg)))))
  const stallSpeedKt = baseStallSpeedKt * Math.sqrt(bankLoadFactor)
  const speedSeverity = clamp((stallSpeedKt - airspeedKt) / 32, 0, 1)
  const angleSeverity = clamp((angleOfAttackDeg - 13) / 10, 0, 1)
  const severity = Math.max(speedSeverity, angleSeverity)
  return Object.freeze({
    angleOfAttackDeg,
    stallSpeedKt,
    severity,
    sinkRateFpm: severity ** 1.45 * 3_200,
  })
}
