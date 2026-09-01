import { Captions, CaptionsOff, Radio, Volume2, VolumeX } from 'lucide-react'
import './radio-transcript.css'

export interface RadioTranscriptCue {
  readonly id: string
  readonly speaker: string
  readonly speakerLabel?: string
  readonly text: string
  readonly priority: 'low' | 'normal' | 'high' | 'interrupt'
}

export interface RadioTranscriptProps {
  readonly cues: readonly RadioTranscriptCue[]
  readonly activeCueId?: string | null
  readonly captionsVisible: boolean
  readonly audioMuted: boolean
  readonly environmentVolume: number
  readonly radioVolume: number
  readonly onCaptionsVisibleChange: (visible: boolean) => void
  readonly onAudioMutedChange: (muted: boolean) => void
  readonly onEnvironmentVolumeChange: (volume: number) => void
  readonly onRadioVolumeChange: (volume: number) => void
  readonly maxRecent?: number
  readonly className?: string
}

const speakerLabels: Readonly<Record<string, string>> = {
  atc: 'ATC',
  copilot: 'Copilot',
  cockpit: 'Cockpit',
  flight_director: 'Flight director',
  cabin: 'Cabin',
}

function labelSpeaker(cue: RadioTranscriptCue) {
  if (cue.speakerLabel) return cue.speakerLabel
  const normalized = cue.speaker.trim().toLowerCase()
  return speakerLabels[normalized] ?? cue.speaker.trim()
}

export function RadioTranscript({
  cues,
  activeCueId,
  captionsVisible,
  audioMuted,
  environmentVolume,
  radioVolume,
  onCaptionsVisibleChange,
  onAudioMutedChange,
  onEnvironmentVolumeChange,
  onRadioVolumeChange,
  maxRecent = 3,
  className,
}: RadioTranscriptProps) {
  const activeCue = activeCueId
    ? cues.find((cue) => cue.id === activeCueId)
    : cues.at(-1)
  const recentCues = cues
    .filter((cue) => cue.id !== activeCue?.id)
    .slice(-Math.max(0, maxRecent))
    .reverse()

  return (
    <section
      className={`radio-transcript${className ? ` ${className}` : ''}`}
      aria-label="Flight radio"
      data-captions-visible={captionsVisible}
    >
      <header className="radio-transcript-header">
        <div className="radio-transcript-title">
          <Radio aria-hidden="true" />
          <span>Radio</span>
          <i aria-hidden="true" data-live={Boolean(activeCueId)} />
        </div>
        <div className="radio-transcript-controls" role="group" aria-label="Radio accessibility controls">
          <button
            type="button"
            aria-label={audioMuted ? 'Unmute radio audio' : 'Mute radio audio'}
            aria-pressed={audioMuted}
            title={audioMuted ? 'Radio audio muted' : 'Mute radio audio'}
            onClick={() => onAudioMutedChange(!audioMuted)}
          >
            {audioMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </button>
          <button
            type="button"
            aria-label={captionsVisible ? 'Hide radio captions' : 'Show radio captions'}
            aria-pressed={captionsVisible}
            title={captionsVisible ? 'Hide radio captions' : 'Show radio captions'}
            onClick={() => onCaptionsVisibleChange(!captionsVisible)}
          >
            {captionsVisible ? <Captions aria-hidden="true" /> : <CaptionsOff aria-hidden="true" />}
          </button>
        </div>
      </header>

      <div className="radio-mixer" role="group" aria-label="Flight audio mixer">
        <label>
          <span>Environment</span>
          <input
            type="range"
            min="0"
            max="100"
            value={environmentVolume}
            aria-label={`Environment volume ${environmentVolume}%`}
            onChange={(event) => onEnvironmentVolumeChange(event.currentTarget.valueAsNumber)}
          />
        </label>
        <label>
          <span>Radio</span>
          <input
            type="range"
            min="0"
            max="100"
            value={radioVolume}
            aria-label={`Radio volume ${radioVolume}%`}
            onChange={(event) => onRadioVolumeChange(event.currentTarget.valueAsNumber)}
          />
        </label>
      </div>

      {captionsVisible ? (
        <div className="radio-transcript-content">
          <div
            className="radio-current-cue"
            data-priority={activeCue?.priority ?? 'normal'}
            aria-live={activeCue?.priority === 'high' || activeCue?.priority === 'interrupt' ? 'assertive' : 'polite'}
            aria-atomic="true"
          >
            {activeCue ? (
              <>
                <span>{labelSpeaker(activeCue)}</span>
                <p>{activeCue.text}</p>
              </>
            ) : (
              <p className="radio-standby">Radio standing by.</p>
            )}
          </div>

          {recentCues.length > 0 ? (
            <ol className="radio-transcript-history" aria-label="Recent radio transcript">
              {recentCues.map((cue) => (
                <li key={cue.id}>
                  <span>{labelSpeaker(cue)}</span>
                  <p>{cue.text}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : (
        <p className="radio-captions-hidden">Captions hidden</p>
      )}
    </section>
  )
}
