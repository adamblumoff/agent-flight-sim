import { WIDE_BODY_TWINJET_ENVELOPE } from '../sim/aircraftEnvelope.ts'
import { KSTL_RUNWAY_12R } from '../sim/airfields.ts'
import { finalVerticalSpeedFpm, PILOT_OPERATING_LIMITS } from '../sim/pilotOperatingLimits.ts'

const envelope = WIDE_BODY_TWINJET_ENVELOPE
const limits = PILOT_OPERATING_LIMITS
const badFlareSinkFpm = Math.round(finalVerticalSpeedFpm(envelope.approachSpeedKt, limits.approach.glidepathDeg))
const nominalFlareSinkFpm = Math.round(finalVerticalSpeedFpm(envelope.approachSpeedKt, limits.approach.nominalFlarePitchDeg))

export const PILOT_MANUAL = Object.freeze({
  aircraft: envelope.name,
  controlContract: Object.freeze([
    'You choose every exact command. The simulator applies the active command continuously at 60 Hz while you think or wait.',
    'Commands execute in order and persist until the next trigger. Use track_fix with each published checkpoint target.',
    'A checkpoint completes as soon as the aircraft enters its published horizontal capture radius. Altitude, speed, heading, and vertical rate do not affect checkpoint capture.',
    'You may replace the active program after ATC accepts the route. Route progress is preserved.',
  ]),
  takeoff: Object.freeze({
    runwayHeadingDeg: KSTL_RUNWAY_12R.headingDeg,
    throttle: 1,
    flapsDeg: envelope.takeoffFlapsDeg,
    rotateAtKt: envelope.rotateSpeedKt,
    pitchDeg: Object.freeze({ minimum: 10, nominal: envelope.initialClimbPitchDeg }),
    positiveRate: `Hold runway heading through rotation. Use aircraft_phase airborne—not airspeed or active_waypoint—to begin track_fix KSTL_CLIMB and retract the gear. Hold flaps 10 until at least 1,000 ft AGL and ${envelope.flapRetractionSpeedKt} kt, then select flaps 0.`,
  }),
  approach: Object.freeze({
    pathDeg: limits.approach.glidepathDeg,
    targetAirspeedKt: envelope.approachSpeedKt,
    stableAirspeedKt: Object.freeze({ minimum: envelope.stableApproachMinKt, maximum: envelope.stableApproachMaxKt }),
    stableVerticalSpeedFpm: Object.freeze({ minimum: limits.approach.stableDescentMinFpm, maximum: limits.approach.stableDescentMaxFpm }),
    configuration: 'Use altitude mode for every published final and touchdown checkpoint. A 3-degree glidepath is not 3 degrees of aircraft pitch. Be gear down and flaps 30 by the touchdown leg, then switch to exact pitch only at the flare trigger.',
  }),
  flare: Object.freeze({
    triggerDistanceNm: Object.freeze({ minimum: limits.approach.flareDistanceMinNm, nominal: limits.approach.nominalFlareDistanceNm, maximum: limits.approach.flareDistanceMaxNm }),
    targetAirspeedKt: envelope.approachSpeedKt,
    pitchDeg: Object.freeze({ minimum: limits.approach.flarePitchMinDeg, nominal: limits.approach.nominalFlarePitchDeg, maximum: limits.approach.flarePitchMaxDeg }),
    lateralGuidance: 'Keep lateral mode track_fix targeting KSTL_TOUCHDOWN through the flare. Do not switch to a fixed runway heading until aircraft_phase landing_roll; heading alone does not correct crosswind drift.',
    note: `Aircraft pitch is not glidepath angle. On final, the model subtracts ${limits.approach.landingAngleOfAttackDeg} degrees of landing angle of attack. At ${envelope.approachSpeedKt} kt, ${limits.approach.glidepathDeg} degrees of pitch predicts about ${badFlareSinkFpm.toLocaleString('en-US')} fpm; ${limits.approach.nominalFlarePitchDeg} degrees predicts about ${nominalFlareSinkFpm.toLocaleString('en-US')} fpm.`,
  }),
  touchdown: Object.freeze({
    maximumSinkRateFpm: limits.approach.maxTouchdownSinkFpm,
    maximumAirspeedKt: envelope.maxTouchdownSpeedKt,
    maximumBankDeg: limits.approach.maxTouchdownBankDeg,
    rollout: 'At aircraft_phase landing_roll, command runway heading, pitch 0, throttle 0, gear down, and flaps 30.',
  }),
  goAround: Object.freeze({
    prearm: 'Put exact missed-approach commands in go_around.commands. The simulator switches to them immediately if the approach becomes unsafe and loads KSTL_GO_AROUND.',
    firstCommand: Object.freeze({ minimumPitchDeg: limits.goAround.minimumPitchDeg, minimumThrottle: limits.goAround.minimumThrottle, gearDown: false, maximumFlapsDeg: limits.goAround.maximumFlapsDeg }),
    sequence: 'Lead with an immediate climb command. Use altitude_at_least before changing to altitude hold. The mission clock may deduct points at zero but no longer stops the aircraft.',
  }),
})

export type PilotManual = typeof PILOT_MANUAL
