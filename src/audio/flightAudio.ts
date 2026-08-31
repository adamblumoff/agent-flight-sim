import { flightSimulator } from '../sim/flightSimulator'
import type { FlightState } from '../sim/types'
import { buildRadioCue, type RadioCue } from './radioCues'

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value))
const DEFAULT_VOLUME = 0.5
const DEFAULT_RADIO_VOLUME = 0.68
const MAX_RADIO_HISTORY = 24

export interface FlightRadioSnapshot {
  readonly cues: readonly RadioCue[]
  readonly activeCueId: string | null
}

const EMPTY_RADIO_SNAPSHOT: FlightRadioSnapshot = Object.freeze({ cues: Object.freeze([]), activeCueId: null })

interface AudioSnapshot {
  readonly elapsedSeconds: number
  readonly gearDown: boolean
  readonly flapsDeg: number
  readonly emergencyActive: boolean
  readonly impactRevision: number
  readonly landingRecorded: boolean
}

class FlightAudioController {
  private context: AudioContext | null = null
  private environmentGain: GainNode | null = null
  private radioEffectsGain: GainNode | null = null
  private engineGain: GainNode | null = null
  private engineLow: OscillatorNode | null = null
  private engineHigh: OscillatorNode | null = null
  private windGain: GainNode | null = null
  private rainGain: GainNode | null = null
  private runwayGain: GainNode | null = null
  private frame = 0
  private running = false
  private unsubscribeSimulator: (() => void) | null = null
  private environmentVolume = DEFAULT_VOLUME
  private radioVolume = DEFAULT_RADIO_VOLUME
  private muted = false
  private previous: AudioSnapshot | null = null
  private processedTraceId = 0
  private radioRunId = ''
  private radioQueue: RadioCue[] = []
  private currentCue: RadioCue | null = null
  private radioSnapshot = EMPTY_RADIO_SNAPSHOT
  private readonly radioListeners = new Set<() => void>()

  start() {
    if (this.running) return
    this.running = true
    const state = flightSimulator.getState()
    this.previous = this.snapshot(state)
    this.processRadioTrace(state)
    this.unsubscribeSimulator = flightSimulator.subscribe(() => this.processRadioTrace(flightSimulator.getState()))
    window.addEventListener('pointerdown', this.unlock, { capture: true })
    window.addEventListener('keydown', this.unlock, { capture: true })
    this.frame = requestAnimationFrame(this.update)
  }

  stop() {
    if (!this.running) return
    this.running = false
    this.environmentVolume = DEFAULT_VOLUME
    this.radioVolume = DEFAULT_RADIO_VOLUME
    this.muted = false
    cancelAnimationFrame(this.frame)
    window.removeEventListener('pointerdown', this.unlock, { capture: true })
    window.removeEventListener('keydown', this.unlock, { capture: true })
    this.unsubscribeSimulator?.()
    this.unsubscribeSimulator = null
    window.speechSynthesis?.cancel()
    void this.context?.close()
    this.context = null
    this.environmentGain = null
    this.radioEffectsGain = null
    this.engineGain = null
    this.engineLow = null
    this.engineHigh = null
    this.windGain = null
    this.rainGain = null
    this.runwayGain = null
    this.resetRadio('')
  }

  setEnvironmentVolume(volume: number) {
    this.environmentVolume = clamp(volume)
    if (!this.muted && this.environmentVolume > 0) void this.ensureAudio()
    const now = this.context?.currentTime ?? 0
    this.environmentGain?.gain.setTargetAtTime(this.environmentLevel(), now, 0.04)
  }

  setRadioVolume(volume: number) {
    this.radioVolume = clamp(volume)
    if (!this.muted && this.radioVolume > 0) void this.ensureAudio()
    const now = this.context?.currentTime ?? 0
    this.radioEffectsGain?.gain.setTargetAtTime(this.radioLevel(), now, 0.04)
  }

  setMuted(muted: boolean) {
    if (this.muted === muted) return
    this.muted = muted
    const now = this.context?.currentTime ?? 0
    this.environmentGain?.gain.setTargetAtTime(this.environmentLevel(), now, 0.04)
    this.radioEffectsGain?.gain.setTargetAtTime(this.radioLevel(), now, 0.04)
    if (muted) {
      window.speechSynthesis?.cancel()
      this.radioQueue = []
      this.currentCue = null
      this.publishRadio()
    } else {
      void this.ensureAudio()
    }
  }

  readonly subscribeRadio = (listener: () => void) => {
    this.radioListeners.add(listener)
    return () => this.radioListeners.delete(listener)
  }

  readonly getRadioSnapshot = () => this.radioSnapshot

  private readonly unlock = () => {
    if (!this.muted && (this.environmentVolume > 0 || this.radioVolume > 0)) void this.ensureAudio()
  }

  private async ensureAudio() {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume()
      return
    }

    const context = new AudioContext({ latencyHint: 'interactive' })
    const environmentGain = context.createGain()
    environmentGain.gain.value = this.environmentLevel()
    environmentGain.connect(context.destination)

    const radioEffectsGain = context.createGain()
    radioEffectsGain.gain.value = this.radioLevel()
    radioEffectsGain.connect(context.destination)

    const engineGain = context.createGain()
    const engineFilter = context.createBiquadFilter()
    engineFilter.type = 'lowpass'
    engineFilter.frequency.value = 720
    engineFilter.Q.value = 0.6
    engineGain.gain.value = 0
    engineGain.connect(engineFilter).connect(environmentGain)

    const engineLow = context.createOscillator()
    engineLow.type = 'sine'
    engineLow.frequency.value = 38
    const lowGain = context.createGain()
    lowGain.gain.value = 0.72
    engineLow.connect(lowGain).connect(engineGain)
    engineLow.start()

    const engineHigh = context.createOscillator()
    engineHigh.type = 'triangle'
    engineHigh.frequency.value = 82
    const highGain = context.createGain()
    highGain.gain.value = 0.28
    engineHigh.connect(highGain).connect(engineGain)
    engineHigh.start()

    const noise = this.createNoiseLoop(context)
    const windFilter = context.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 680
    windFilter.Q.value = 0.5
    const windGain = context.createGain()
    windGain.gain.value = 0
    noise.connect(windFilter).connect(windGain).connect(environmentGain)

    const rainNoise = this.createNoiseLoop(context)
    const rainFilter = context.createBiquadFilter()
    rainFilter.type = 'highpass'
    rainFilter.frequency.value = 1_900
    const rainGain = context.createGain()
    rainGain.gain.value = 0
    rainNoise.connect(rainFilter).connect(rainGain).connect(environmentGain)

    const runwayNoise = this.createNoiseLoop(context)
    const runwayFilter = context.createBiquadFilter()
    runwayFilter.type = 'bandpass'
    runwayFilter.frequency.value = 115
    runwayFilter.Q.value = 1.2
    const runwayGain = context.createGain()
    runwayGain.gain.value = 0
    runwayNoise.connect(runwayFilter).connect(runwayGain).connect(environmentGain)

    this.context = context
    this.environmentGain = environmentGain
    this.radioEffectsGain = radioEffectsGain
    this.engineGain = engineGain
    this.engineLow = engineLow
    this.engineHigh = engineHigh
    this.windGain = windGain
    this.rainGain = rainGain
    this.runwayGain = runwayGain
    await context.resume()
  }

  private createNoiseLoop(context: AudioContext) {
    const frameCount = context.sampleRate * 2
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const channel = buffer.getChannelData(0)
    let previous = 0
    for (let index = 0; index < frameCount; index += 1) {
      const white = Math.random() * 2 - 1
      previous = previous * 0.82 + white * 0.18
      channel[index] = previous
    }
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    source.start()
    return source
  }

  private readonly update = () => {
    if (!this.running) return
    const state = flightSimulator.getState()
    const snapshot = this.snapshot(state)
    const reset = this.previous !== null && snapshot.elapsedSeconds < this.previous.elapsedSeconds

    if (reset) this.resetRadio(state.checkride.runId)

    if (this.context && this.context.state === 'running') {
      this.updateContinuousAudio(state)
      if (this.previous && !reset) this.playStateChanges(state, this.previous, snapshot)
    }

    this.previous = snapshot
    this.frame = requestAnimationFrame(this.update)
  }

  private updateContinuousAudio(state: FlightState) {
    const context = this.context
    if (!context) return
    const now = context.currentTime
    const speed = clamp(state.airspeedKt / 280)
    const airborne = state.aircraftPhase === 'airborne'
    const rolling = state.aircraftPhase === 'takeoff_roll' || state.aircraftPhase === 'landing_roll'
    const engineLevel = state.aircraftPhase === 'stopped' ? 0.006 : 0.008 + state.throttle * 0.035 + speed * 0.006
    const engineFrequency = 34 + state.throttle * 58 + speed * 22
    const windLevel = (airborne ? 0.008 : 0.002) + speed ** 1.5 * 0.06 + state.scenario.weather.windSpeedKt / 1_200
    const rainLevel = state.scenario.weather.summary.toLowerCase().includes('rain') ? 0.009 + speed * 0.013 : 0
    const runwayLevel = rolling ? clamp(state.airspeedKt / 150) * 0.055 : 0

    this.engineGain?.gain.setTargetAtTime(engineLevel, now, 0.12)
    this.engineLow?.frequency.setTargetAtTime(engineFrequency, now, 0.1)
    this.engineHigh?.frequency.setTargetAtTime(engineFrequency * 2.06, now, 0.1)
    this.windGain?.gain.setTargetAtTime(windLevel, now, 0.16)
    this.rainGain?.gain.setTargetAtTime(rainLevel, now, 0.25)
    this.runwayGain?.gain.setTargetAtTime(runwayLevel, now, 0.05)
  }

  private playStateChanges(state: FlightState, previous: AudioSnapshot, current: AudioSnapshot) {
    if (previous.gearDown !== current.gearDown) {
      this.playNoiseBurst(0.24, 0.12, 260)
      this.playTone(current.gearDown ? 110 : 145, current.gearDown ? 65 : 92, 0.34, 0.1, 'square')
    }
    if (previous.flapsDeg !== current.flapsDeg) {
      this.playTone(current.flapsDeg > previous.flapsDeg ? 190 : 135, 86, 0.42, 0.045, 'sawtooth')
    }
    if (!previous.emergencyActive && current.emergencyActive) this.playWarning()
    if (current.impactRevision > previous.impactRevision) {
      const destructive = state.impact?.severity === 'destructive'
      this.playNoiseBurst(destructive ? 1.4 : 0.5, destructive ? 0.48 : 0.22, destructive ? 170 : 260)
      this.playTone(destructive ? 72 : 105, 34, destructive ? 1.1 : 0.36, destructive ? 0.28 : 0.14, 'sawtooth')
    } else if (!previous.landingRecorded && current.landingRecorded && state.debrief.landing?.safe) {
      const force = clamp(state.debrief.landing.sinkRateFpm / 600, 0.25, 1)
      this.playNoiseBurst(0.22, 0.08 + force * 0.12, 220)
      this.playTone(96, 52, 0.28, 0.08 + force * 0.08, 'sine')
    }
  }

  private playWarning() {
    this.playTone(780, 780, 0.15, 0.09, 'square')
    this.playTone(620, 620, 0.18, 0.09, 'square', 0.2)
    this.playTone(780, 780, 0.15, 0.09, 'square', 0.43)
  }

  private playTone(startHz: number, endHz: number, duration: number, level: number, type: OscillatorType, delay = 0) {
    const context = this.context
    const environmentGain = this.environmentGain
    if (!context || !environmentGain) return
    const start = context.currentTime + delay
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(startHz, start)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), start + duration)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(level, start + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(gain).connect(environmentGain)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
  }

  private playNoiseBurst(duration: number, level: number, frequency: number) {
    const context = this.context
    const environmentGain = this.environmentGain
    if (!context || !environmentGain) return
    const source = this.createNoiseLoop(context)
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = frequency
    const gain = context.createGain()
    const now = context.currentTime
    gain.gain.setValueAtTime(level, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    source.loop = false
    source.connect(filter).connect(gain).connect(environmentGain)
    source.stop(now + duration)
  }

  private processRadioTrace(state: FlightState) {
    if (state.checkride.runId !== this.radioRunId) this.resetRadio(state.checkride.runId)
    const trace = flightSimulator.getTrace()
    if ((trace.at(-1)?.id ?? 0) <= this.processedTraceId) return
    for (const event of trace) {
      if (event.id <= this.processedTraceId) continue
      this.processedTraceId = event.id
      const cue = buildRadioCue(event, state)
      if (!cue) continue
      this.radioSnapshot = Object.freeze({
        cues: Object.freeze([...this.radioSnapshot.cues.slice(-(MAX_RADIO_HISTORY - 1)), cue]),
        activeCueId: this.radioSnapshot.activeCueId,
      })
      this.radioListeners.forEach((listener) => listener())
      if (!this.muted && this.radioVolume > 0) this.enqueueRadio(cue)
    }
  }

  private enqueueRadio(cue: RadioCue) {
    if (cue.priority === 'interrupt') {
      this.radioQueue = this.radioQueue.filter((queued) => queued.priority === 'interrupt')
      if (this.currentCue && this.currentCue.priority !== 'interrupt') window.speechSynthesis?.cancel()
    }
    this.radioQueue.push(cue)
    this.playNextRadioCue()
  }

  private playNextRadioCue() {
    if (this.currentCue || this.muted || this.radioVolume <= 0) return
    const cue = this.radioQueue.shift()
    if (!cue || !('speechSynthesis' in window)) return

    const utterance = new SpeechSynthesisUtterance(cue.text)
    utterance.volume = this.radioVolume
    utterance.rate = cue.speaker === 'atc' ? 0.92 : 0.98
    utterance.pitch = cue.speaker === 'atc' ? 0.88 : cue.speaker === 'cabin' ? 1.08 : 1
    utterance.voice = this.voiceFor(cue)
    this.currentCue = cue
    this.publishRadio()
    utterance.onstart = () => {
      this.setRadioActive(cue)
    }
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      window.clearTimeout(watchdog)
      if (this.currentCue?.id === cue.id) this.playSquelch(cue.id, true)
      this.currentCue = null
      this.setRadioActive(null)
      this.publishRadio()
      this.playNextRadioCue()
    }
    utterance.onend = finish
    utterance.onerror = finish
    const watchdog = window.setTimeout(finish, Math.min(20_000, Math.max(4_000, cue.text.length * 85)))
    this.playSquelch(cue.id, false)
    window.speechSynthesis.speak(utterance)
  }

  private voiceFor(cue: RadioCue) {
    const voices = window.speechSynthesis.getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith('en'))
      .sort((left, right) => `${left.lang}:${left.name}`.localeCompare(`${right.lang}:${right.name}`))
    if (voices.length === 0) return null
    const offset = cue.speaker === 'atc' ? 0 : cue.speaker === 'cabin' ? 2 : cue.speaker === 'system' ? 3 : 1
    return voices[offset % voices.length]
  }

  private setRadioActive(cue: RadioCue | null) {
    const now = this.context?.currentTime ?? 0
    const duck = cue ? 0.28 : 1
    this.environmentGain?.gain.setTargetAtTime(this.environmentLevel() * duck, now, cue ? 0.05 : 0.25)
  }

  private playSquelch(cueId: string, ending: boolean) {
    const context = this.context
    const radioEffectsGain = this.radioEffectsGain
    if (!context || !radioEffectsGain || this.muted) return
    const duration = ending ? 0.07 : 0.1
    const frameCount = Math.max(1, Math.floor(context.sampleRate * duration))
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const channel = buffer.getChannelData(0)
    let seed = this.seedFor(`${cueId}:${ending ? 'end' : 'start'}`)
    for (let index = 0; index < frameCount; index += 1) {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      channel[index] = ((seed >>> 0) / 0xffffffff * 2 - 1) * (1 - index / frameCount)
    }
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    source.buffer = buffer
    filter.type = 'bandpass'
    filter.frequency.value = 1_850
    filter.Q.value = 0.8
    gain.gain.value = ending ? 0.08 : 0.12
    source.connect(filter).connect(gain).connect(radioEffectsGain)
    source.start()
  }

  private seedFor(value: string) {
    let seed = 2_166_136_261
    for (let index = 0; index < value.length; index += 1) seed = Math.imul(seed ^ value.charCodeAt(index), 16_777_619)
    return seed || 1
  }

  private environmentLevel() {
    return this.muted ? 0 : this.environmentVolume
  }

  private radioLevel() {
    return this.muted ? 0 : this.radioVolume
  }

  private publishRadio() {
    this.radioSnapshot = Object.freeze({
      cues: this.radioSnapshot.cues,
      activeCueId: this.currentCue?.id ?? null,
    })
    this.radioListeners.forEach((listener) => listener())
  }

  private resetRadio(runId: string) {
    window.speechSynthesis?.cancel()
    this.processedTraceId = 0
    this.radioRunId = runId
    this.radioQueue = []
    this.currentCue = null
    this.radioSnapshot = EMPTY_RADIO_SNAPSHOT
    this.radioListeners.forEach((listener) => listener())
  }

  private snapshot(state: FlightState): AudioSnapshot {
    return {
      elapsedSeconds: state.elapsedSeconds,
      gearDown: state.gearDown,
      flapsDeg: state.flapsDeg,
      emergencyActive: state.checkride.status === 'decision_required' || state.checkride.alert !== null,
      impactRevision: state.impact?.revision ?? 0,
      landingRecorded: state.debrief.landing !== null,
    }
  }
}

export const flightAudio = new FlightAudioController()
