import type { RadioCue, RadioCueKind, RadioSpeaker } from './radioCues'

export interface RadioVoiceClip {
  readonly key: string
  readonly speaker: RadioSpeaker
  readonly text: string
  readonly voice: string
  readonly speed: number
  readonly url: string
}

const clip = (
  key: string,
  speaker: RadioSpeaker,
  text: string,
  voice: string,
  speed: number,
): RadioVoiceClip => Object.freeze({
  key,
  speaker,
  text,
  voice,
  speed,
  url: `/audio/radio/${key}.mp3?voice=${voice}`,
})

/**
 * These are deliberately canonical aviation callouts rather than recordings of
 * arbitrary agent prose. The exact WebMCP payload remains in the transcript;
 * only authoritative ATC transmissions are voiced.
 */
export const RADIO_VOICE_PACK = Object.freeze([
  clip('takeoff-clearance', 'atc', 'Flightdeck, cleared for takeoff.', 'af_heart', 1.08),
  clip('takeoff-clearance-12r', 'atc', 'Flightdeck, runway one two right, cleared for takeoff.', 'af_heart', 1.08),
  clip('takeoff-clearance-30l', 'atc', 'Flightdeck, runway three zero left, cleared for takeoff.', 'af_heart', 1.08),
  clip('clearance-issued', 'atc', 'Flightdeck, diversion approved. Fly the assigned heading and altitude.', 'af_heart', 1.08),
  clip('clearance-issued-kstl-30l', 'atc', 'Flightdeck, radar vectors St. Louis Lambert. Expect runway three zero left.', 'af_heart', 1.08),
  clip('clearance-issued-kmdw-31c', 'atc', 'Flightdeck, cleared to Chicago Midway. Expect runway three one center.', 'af_heart', 1.08),
  clip('landing-clearance', 'atc', 'Flightdeck, cleared to land.', 'af_heart', 1.06),
  clip('landing-clearance-30l', 'atc', 'Flightdeck, runway three zero left, cleared to land.', 'af_heart', 1.06),
  clip('landing-clearance-31c', 'atc', 'Flightdeck, runway three one center, cleared to land.', 'af_heart', 1.06),
] satisfies readonly RadioVoiceClip[])

const clipsByKey = new Map(RADIO_VOICE_PACK.map((entry) => [entry.key, entry]))

const destinationVariant = (text: string) => {
  const normalized = text.toLowerCase()
  if (normalized.includes('st. louis lambert')) return 'kstl'
  if (normalized.includes('chicago midway')) return 'kmdw'
  return null
}

const runwayVariant = (text: string) => {
  const normalized = text.toLowerCase()
  if (normalized.includes('three zero left')) return '30l'
  if (normalized.includes('one two right')) return '12r'
  if (normalized.includes('three one center')) return '31c'
  return null
}

const specializedKey = (cue: RadioCue): string | null => {
  const destination = destinationVariant(cue.text)
  const runway = runwayVariant(cue.text)
  if (cue.kind === 'takeoff-clearance' && runway) return `${cue.kind}-${runway}`
  if (cue.kind === 'clearance-issued' && destination && runway) return `${cue.kind}-${destination}-${runway}`
  if (cue.kind === 'landing-clearance' && runway) return `${cue.kind}-${runway}`
  return null
}

export const radioVoiceClipFor = (cue: RadioCue): RadioVoiceClip | null => {
  if (cue.speaker !== 'atc') return null
  const specialized = specializedKey(cue)
  return (specialized ? clipsByKey.get(specialized) : undefined) ?? clipsByKey.get(cue.kind) ?? null
}

export const radioVoicePackCovers = (kinds: readonly RadioCueKind[]) => kinds.every((kind) => clipsByKey.has(kind))
