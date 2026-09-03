export const FEET_PER_NAUTICAL_MILE = 6_076.12

export const PILOT_OPERATING_LIMITS = Object.freeze({
  approach: Object.freeze({
    glidepathDeg: 3,
    landingAngleOfAttackDeg: 8,
    stableDescentMinFpm: -950,
    stableDescentMaxFpm: -100,
    goAroundDescentFpm: -1_050,
    flareDistanceMinNm: 0.3,
    flareDistanceMaxNm: 0.4,
    nominalFlareDistanceNm: 0.35,
    flarePitchMinDeg: 6.5,
    flarePitchMaxDeg: 7.5,
    nominalFlarePitchDeg: 7.2,
    maxTouchdownSinkFpm: 600,
    maxTouchdownBankDeg: 18,
  }),
  goAround: Object.freeze({
    minimumPitchDeg: 5,
    minimumThrottle: 0.85,
    maximumFlapsDeg: 10 as const,
  }),
})

export const finalVerticalSpeedFpm = (airspeedKt: number, pitchDeg: number) => (
  airspeedKt * FEET_PER_NAUTICAL_MILE / 60
  * Math.sin((pitchDeg - PILOT_OPERATING_LIMITS.approach.landingAngleOfAttackDeg) * Math.PI / 180)
)
