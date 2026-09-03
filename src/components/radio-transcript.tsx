import { Captions, CaptionsOff, Radio, Volume2, VolumeX } from 'lucide-react'
import { iconButton } from './flight-ui'
import { cn } from '../lib/utils'

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
      className="w-full shrink-0 overflow-hidden border-b border-[#f4efde]/12 bg-[#070a08]/20 text-[#f4efde]"
      aria-label="Flight radio"
      data-captions-visible={captionsVisible}
    >
      <header className="flex min-h-10 items-center justify-between gap-3 border-b border-[#f4efde]/10 py-1.5 pl-3 pr-2">
        <div className="flex items-center gap-2 text-[8px] font-bold uppercase tracking-[0.13em] text-[#f4efde]/65">
          <Radio className="size-3.5 text-[#8bc49b]" aria-hidden="true" />
          <span>Radio</span>
          <i className="size-[5px] rounded-full bg-[#f4efde]/25 data-[live=true]:bg-[#8bc49b] data-[live=true]:shadow-[0_0_0_3px_rgb(139_196_155/10%)]" aria-hidden="true" data-live={Boolean(activeCueId)} />
        </div>
        <div className="flex gap-0.5" role="group" aria-label="Radio accessibility controls">
          <button
            className={cn(iconButton, 'size-7 border-0 bg-transparent aria-pressed:text-[#e2b76f]')}
            type="button"
            aria-label={audioMuted ? 'Unmute radio audio' : 'Mute radio audio'}
            aria-pressed={audioMuted}
            title={audioMuted ? 'Radio audio muted' : 'Mute radio audio'}
            onClick={() => onAudioMutedChange(!audioMuted)}
          >
            {audioMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </button>
          <button
            className={cn(iconButton, 'size-7 border-0 bg-transparent')}
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

      <div className="grid grid-cols-2 gap-3 border-b border-[#f4efde]/10 px-3 py-2" role="group" aria-label="Flight audio mixer">
        <label className="grid grid-cols-[auto_1fr] items-center gap-2 font-mono text-[7px] font-semibold uppercase tracking-[0.08em] text-[#f4efde]/45">
          <span>Environment</span>
          <input
            className="m-0 h-3.5 min-w-0 accent-[#8bc49b] focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-[#f4efde]"
            type="range"
            min="0"
            max="100"
            value={environmentVolume}
            aria-label={`Environment volume ${environmentVolume}%`}
            onChange={(event) => onEnvironmentVolumeChange(event.currentTarget.valueAsNumber)}
          />
        </label>
        <label className="grid grid-cols-[auto_1fr] items-center gap-2 font-mono text-[7px] font-semibold uppercase tracking-[0.08em] text-[#f4efde]/45">
          <span>Radio</span>
          <input
            className="m-0 h-3.5 min-w-0 accent-[#8bc49b] focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-[#f4efde]"
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
        <div className="max-h-[148px] overflow-y-auto p-3 [scrollbar-color:rgb(244_239_222/20%)_transparent] [scrollbar-width:thin]">
          <div
            className="min-h-[53px] border-l-2 border-[#8bc49b] pl-3 data-[priority=high]:border-[#e2b76f] data-[priority=interrupt]:border-[#e78068] [&>span]:block [&>span]:font-mono [&>span]:text-[8px] [&>span]:font-semibold [&>span]:uppercase [&>span]:tracking-[0.1em] [&>span]:text-[#8bc49b] [&>p]:mt-1.5 [&>p]:text-[13px] [&>p]:font-medium [&>p]:leading-snug"
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
              <p className="m-0! text-[10px]! font-normal! text-[#f4efde]/45!">Radio standing by.</p>
            )}
          </div>

          {recentCues.length > 0 ? (
            <ol className="mt-3 grid list-none gap-2 border-t border-[#f4efde]/10 pt-3 [&_li]:grid [&_li]:grid-cols-[62px_1fr] [&_li]:items-baseline [&_li]:gap-2 [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap [&_span]:font-mono [&_span]:text-[8px] [&_span]:font-semibold [&_span]:uppercase [&_span]:tracking-[0.1em] [&_span]:text-[#f4efde]/40 [&_p]:m-0 [&_p]:line-clamp-2 [&_p]:overflow-hidden [&_p]:text-[10px] [&_p]:leading-snug [&_p]:text-[#f4efde]/65" aria-label="Recent radio transcript">
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
        <p className="m-0 px-3 py-2.5 text-[9px] tracking-[0.04em] text-[#f4efde]/40">Captions hidden</p>
      )}
    </section>
  )
}
