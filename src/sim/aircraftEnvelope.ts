import type { FlightMode } from './types'

export interface AircraftEnvelope {
  readonly name: string
  readonly standardRunwayWidthFt: number
  readonly decisionSpeedKt: number
  readonly rotateSpeedKt: number
  readonly takeoffSafetySpeedKt: number
  readonly rotationRateDegPerSecond: number
  readonly liftoffPitchDeg: number
  readonly initialClimbPitchDeg: number
  readonly initialClimbVerticalSpeedFpm: number
  readonly departureHeadingReleaseAglFt: number
  readonly initialClimbSpeedKt: number
  readonly flapRetractionSpeedKt: number
  readonly enrouteSpeedKt: number
  readonly emergencyTurnSpeedKt: number
  readonly baseSpeedKt: number
  readonly finalSpeedKt: number
  readonly approachSpeedKt: number
  readonly stableApproachMinKt: number
  readonly stableApproachMaxKt: number
  readonly maxTouchdownSpeedKt: number
  readonly minCommandSpeedKt: number
  readonly maxCommandSpeedKt: number
  readonly maxSimulationSpeedKt: number
  readonly takeoffFlapsDeg: 0 | 10
  readonly approachFlapsDeg: 0 | 20
  readonly landingFlapsDeg: 0 | 30
  readonly hasConventionalFlaps: boolean
}

export const A380_ENVELOPE: AircraftEnvelope = Object.freeze({
  name: 'A380-style wide-body',
  standardRunwayWidthFt: 260,
  decisionSpeedKt: 150,
  rotateSpeedKt: 170,
  takeoffSafetySpeedKt: 190,
  rotationRateDegPerSecond: 3,
  liftoffPitchDeg: 10,
  initialClimbPitchDeg: 12.5,
  initialClimbVerticalSpeedFpm: 1_200,
  departureHeadingReleaseAglFt: 400,
  initialClimbSpeedKt: 210,
  flapRetractionSpeedKt: 210,
  enrouteSpeedKt: 230,
  emergencyTurnSpeedKt: 210,
  baseSpeedKt: 185,
  finalSpeedKt: 155,
  approachSpeedKt: 140,
  stableApproachMinKt: 132,
  stableApproachMaxKt: 148,
  maxTouchdownSpeedKt: 155,
  minCommandSpeedKt: 140,
  maxCommandSpeedKt: 250,
  maxSimulationSpeedKt: 270,
  takeoffFlapsDeg: 10,
  approachFlapsDeg: 20,
  landingFlapsDeg: 30,
  hasConventionalFlaps: true,
})

// Terminal-area values are based on the published Concorde accident record and
// operator data. The short Judge mission intentionally does not model Mach 2 cruise.
export const CONCORDE_ENVELOPE: AircraftEnvelope = Object.freeze({
  name: 'Concorde',
  standardRunwayWidthFt: 200,
  decisionSpeedKt: 150,
  rotateSpeedKt: 198,
  takeoffSafetySpeedKt: 220,
  rotationRateDegPerSecond: 3,
  liftoffPitchDeg: 13,
  initialClimbPitchDeg: 13,
  initialClimbVerticalSpeedFpm: 1_500,
  departureHeadingReleaseAglFt: 400,
  initialClimbSpeedKt: 250,
  flapRetractionSpeedKt: 250,
  enrouteSpeedKt: 250,
  emergencyTurnSpeedKt: 230,
  baseSpeedKt: 200,
  finalSpeedKt: 175,
  approachSpeedKt: 165,
  stableApproachMinKt: 158,
  stableApproachMaxKt: 172,
  maxTouchdownSpeedKt: 180,
  minCommandSpeedKt: 160,
  maxCommandSpeedKt: 250,
  maxSimulationSpeedKt: 270,
  takeoffFlapsDeg: 0,
  approachFlapsDeg: 0,
  landingFlapsDeg: 0,
  hasConventionalFlaps: false,
})

export const flightEnvelopeFor = (mode: FlightMode) => mode === 'judge' ? CONCORDE_ENVELOPE : A380_ENVELOPE
