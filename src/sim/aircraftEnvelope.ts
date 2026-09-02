export interface AircraftEnvelope {
  readonly name: string
  readonly maximumTakeoffMassKg: number
  readonly dispatchMassKg: number
  readonly engineCount: number
  readonly takeoffThrustPerEngineLbf: number
  readonly wingAreaM2: number
  readonly cleanMaximumLiftCoefficient: number
  readonly takeoffMaximumLiftCoefficient: number
  readonly landingMaximumLiftCoefficient: number
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
  readonly routeBankDeg: number
  readonly approachInterceptGainDegPerNm: number
  readonly maxApproachInterceptAngleDeg: number
  readonly takeoffFlapsDeg: 0 | 10
  readonly approachFlapsDeg: 0 | 20
  readonly landingFlapsDeg: 0 | 30
}

export const WIDE_BODY_TWINJET_ENVELOPE: AircraftEnvelope = Object.freeze({
  name: 'Wide-body twinjet',
  maximumTakeoffMassKg: 259_220,
  // A short STL-MDW sector is dispatched below the 192,776 kg design landing
  // mass. That makes the local return plausible without fuel dumping.
  dispatchMassKg: 190_000,
  engineCount: 2,
  takeoffThrustPerEngineLbf: 74_100,
  wingAreaM2: 377,
  cleanMaximumLiftCoefficient: 1.45,
  takeoffMaximumLiftCoefficient: 1.9,
  landingMaximumLiftCoefficient: 2.35,
  standardRunwayWidthFt: 150,
  // Representative dispatch speeds for this modeled weight, KSTL runway 12R,
  // dry pavement, light headwind, and flaps 10. Real crews calculate V-speeds
  // from the exact load and conditions before every departure.
  decisionSpeedKt: 145,
  rotateSpeedKt: 155,
  takeoffSafetySpeedKt: 165,
  rotationRateDegPerSecond: 2.5,
  liftoffPitchDeg: 12.5,
  initialClimbPitchDeg: 12.5,
  initialClimbVerticalSpeedFpm: 2_200,
  departureHeadingReleaseAglFt: 400,
  initialClimbSpeedKt: 190,
  flapRetractionSpeedKt: 210,
  enrouteSpeedKt: 235,
  emergencyTurnSpeedKt: 205,
  baseSpeedKt: 180,
  finalSpeedKt: 160,
  approachSpeedKt: 145,
  stableApproachMinKt: 138,
  stableApproachMaxKt: 152,
  maxTouchdownSpeedKt: 160,
  minCommandSpeedKt: 130,
  maxCommandSpeedKt: 280,
  maxSimulationSpeedKt: 320,
  routeBankDeg: 30,
  approachInterceptGainDegPerNm: 38,
  maxApproachInterceptAngleDeg: 45,
  takeoffFlapsDeg: 10,
  approachFlapsDeg: 20,
  landingFlapsDeg: 30,
})

const POUNDS_FORCE_TO_NEWTONS = 4.448_221_615_3
const METERS_PER_SECOND_TO_KNOTS = 1.943_844_492_4

/** Ideal sea-level acceleration at the aircraft's dispatched mission mass. */
export const staticThrustAccelerationKtPerSecond = (aircraft: AircraftEnvelope) => (
  aircraft.engineCount * aircraft.takeoffThrustPerEngineLbf * POUNDS_FORCE_TO_NEWTONS
  / aircraft.dispatchMassKg
  * METERS_PER_SECOND_TO_KNOTS
)
