export interface AircraftEnvelope {
  readonly name: string
  readonly maximumTakeoffMassKg: number
  readonly dispatchMassKg: number
  readonly engineCount: number
  readonly takeoffThrustPerEngineLbf: number
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
  readonly hasConventionalFlaps: boolean
}

export const CONCORDE_ENVELOPE: AircraftEnvelope = Object.freeze({
  name: 'Concorde',
  maximumTakeoffMassKg: 185_070,
  // A short KSTL-KMDW sector carries far less fuel than a transatlantic
  // departure. This keeps the aircraft above operating empty weight while
  // avoiding the maximum-weight performance used by AF4590.
  dispatchMassKg: 135_000,
  engineCount: 4,
  takeoffThrustPerEngineLbf: 38_050,
  standardRunwayWidthFt: 200,
  decisionSpeedKt: 130,
  rotateSpeedKt: 170,
  takeoffSafetySpeedKt: 188,
  rotationRateDegPerSecond: 3,
  liftoffPitchDeg: 13,
  initialClimbPitchDeg: 13,
  initialClimbVerticalSpeedFpm: 1_500,
  departureHeadingReleaseAglFt: 400,
  initialClimbSpeedKt: 250,
  flapRetractionSpeedKt: 250,
  enrouteSpeedKt: 250,
  emergencyTurnSpeedKt: 170,
  baseSpeedKt: 190,
  finalSpeedKt: 165,
  approachSpeedKt: 155,
  stableApproachMinKt: 148,
  stableApproachMaxKt: 165,
  maxTouchdownSpeedKt: 175,
  minCommandSpeedKt: 145,
  maxCommandSpeedKt: 270,
  maxSimulationSpeedKt: 310,
  routeBankDeg: 35,
  // The compressed return starts about 1.5 NM off centerline. A shallow,
  // continuously closing intercept gives the real turn radius enough room to
  // roll out on runway heading instead of chasing the centerline past it.
  approachInterceptGainDegPerNm: 45,
  maxApproachInterceptAngleDeg: 60,
  takeoffFlapsDeg: 0,
  approachFlapsDeg: 0,
  landingFlapsDeg: 0,
  hasConventionalFlaps: false,
})

const POUNDS_FORCE_TO_NEWTONS = 4.448_221_615_3
const METERS_PER_SECOND_TO_KNOTS = 1.943_844_492_4

/** Ideal sea-level acceleration at the aircraft's dispatched mission mass. */
export const staticThrustAccelerationKtPerSecond = (aircraft: AircraftEnvelope) => (
  aircraft.engineCount * aircraft.takeoffThrustPerEngineLbf * POUNDS_FORCE_TO_NEWTONS
  / aircraft.dispatchMassKg
  * METERS_PER_SECOND_TO_KNOTS
)
