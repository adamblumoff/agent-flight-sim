import { WIDE_BODY_TWINJET_ENVELOPE } from './aircraftEnvelope.ts'
import { finalVerticalSpeedFpm, PILOT_OPERATING_LIMITS } from './pilotOperatingLimits.ts'
import type { FlightPlanProgram, FlightPlanReview, FlightPlanWarning } from './types.ts'

export const reviewFlightPlan = (program: FlightPlanProgram): FlightPlanReview => {
  const warnings: FlightPlanWarning[] = []
  const climbTracking = program.commands.find((command) => command.lateral.mode === 'track_fix' && command.lateral.waypointId === 'KSTL_CLIMB')
  if (climbTracking && !(climbTracking.when.type === 'aircraft_phase' && climbTracking.when.value === 'airborne')) {
    warnings.push(Object.freeze({ code: 'premature_departure_tracking', commandId: climbTracking.id, message: 'Hold runway heading through rotation. Begin track_fix KSTL_CLIMB with an aircraft_phase airborne trigger; airspeed and active-waypoint triggers can turn the aircraft before liftoff.' }))
  }
  if (program.plan !== 'return_kstl') return Object.freeze({ status: warnings.length ? 'warning' : 'ready', warnings: Object.freeze(warnings) })

  const flare = program.commands.find((command) => command.when.type === 'distance_to_runway_at_most'
    && command.when.value <= 0.6
    && command.vertical.mode === 'pitch'
    && command.gearDown
    && command.flapsDeg === 30)
  if (!flare) {
    warnings.push(Object.freeze({ code: 'missing_flare', commandId: null, message: 'No landing-configured exact-pitch flare is scheduled within 0.6 NM.' }))
  } else if (flare.when.type === 'distance_to_runway_at_most' && flare.vertical.mode === 'pitch') {
    const sinkRateFpm = Math.round(finalVerticalSpeedFpm(WIDE_BODY_TWINJET_ENVELOPE.approachSpeedKt, flare.vertical.pitchDeg))
    const distance = flare.when.value
    if (distance < PILOT_OPERATING_LIMITS.approach.flareDistanceMinNm || distance > PILOT_OPERATING_LIMITS.approach.flareDistanceMaxNm) {
      warnings.push(Object.freeze({ code: 'flare_timing', commandId: flare.id, message: `Flare trigger ${distance.toFixed(2)} NM is outside the manual's 0.30-0.40 NM envelope.` }))
    }
    if (sinkRateFpm < -PILOT_OPERATING_LIMITS.approach.maxTouchdownSinkFpm || sinkRateFpm > PILOT_OPERATING_LIMITS.approach.stableDescentMaxFpm) {
      warnings.push(Object.freeze({ code: 'flare_sink_rate', commandId: flare.id, message: `At ${WIDE_BODY_TWINJET_ENVELOPE.approachSpeedKt} kt, ${flare.vertical.pitchDeg.toFixed(1)} degrees of pitch predicts ${sinkRateFpm} fpm. The flare target is -${PILOT_OPERATING_LIMITS.approach.maxTouchdownSinkFpm} to ${PILOT_OPERATING_LIMITS.approach.stableDescentMaxFpm} fpm.` }))
    }
    if (flare.lateral.mode !== 'track_fix' || flare.lateral.waypointId !== 'KSTL_TOUCHDOWN') {
      warnings.push(Object.freeze({ code: 'flare_lateral_guidance', commandId: flare.id, message: 'Keep track_fix targeting KSTL_TOUCHDOWN through the flare so the controller corrects crosswind drift. Switch to runway heading only at landing_roll.' }))
    }
  }

  for (const command of program.commands) {
    const finalCheckpoint = command.when.type === 'active_waypoint'
      && (command.when.value.startsWith('KSTL_FINAL_') || command.when.value === 'KSTL_TOUCHDOWN')
    if (!finalCheckpoint || command.vertical.mode !== 'pitch') continue
    const sinkRateFpm = Math.round(finalVerticalSpeedFpm(WIDE_BODY_TWINJET_ENVELOPE.approachSpeedKt, command.vertical.pitchDeg))
    if (sinkRateFpm < PILOT_OPERATING_LIMITS.approach.stableDescentMinFpm || sinkRateFpm > PILOT_OPERATING_LIMITS.approach.stableDescentMaxFpm) {
      warnings.push(Object.freeze({ code: 'unstable_final_pitch', commandId: command.id, message: `${command.id} predicts ${sinkRateFpm} fpm before the flare. Use altitude mode for final and touchdown checkpoints; switch to exact pitch only at the distance-triggered flare.` }))
    }
  }

  const rollout = program.commands.find((command) => command.when.type === 'aircraft_phase' && command.when.value === 'landing_roll')
  if (!rollout) {
    warnings.push(Object.freeze({ code: 'missing_rollout', commandId: null, message: 'No landing_roll command is scheduled.' }))
  } else {
    const safeRollout = rollout.lateral.mode === 'heading'
      && rollout.vertical.mode === 'pitch' && rollout.vertical.pitchDeg === 0
      && rollout.energy.mode === 'throttle' && rollout.energy.throttle === 0
      && rollout.gearDown && rollout.flapsDeg === 30
    if (!safeRollout) warnings.push(Object.freeze({ code: 'unsafe_rollout', commandId: rollout.id, message: 'Rollout should command runway heading, pitch 0, throttle 0, gear down, and flaps 30.' }))
  }

  if (!program.goAroundCommands?.length) {
    warnings.push(Object.freeze({ code: 'missing_go_around', commandId: null, message: 'No pre-armed go-around branch is present. Add exact commands under go_around.commands.' }))
  }

  return Object.freeze({ status: warnings.length ? 'warning' : 'ready', warnings: Object.freeze(warnings) })
}
