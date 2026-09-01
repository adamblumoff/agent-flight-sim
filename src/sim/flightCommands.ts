export interface FlightControlInput {
  /** Normalized thrust command. Zero is idle; one is maximum available power. */
  readonly throttle?: number
  /** Persistent normalized pitch input. Positive values command nose-up attitude. */
  readonly pitchIntent?: number
  /** Persistent normalized bank input. Positive values command right bank. */
  readonly bankIntent?: number
  readonly gearDown?: boolean
  readonly flapsDeg?: 0 | 10 | 20 | 30
  readonly reason?: string
}
