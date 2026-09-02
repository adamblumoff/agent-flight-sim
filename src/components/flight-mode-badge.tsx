import { Bot, CircleHelp, UserRound } from 'lucide-react'
import type { FlightMode } from '../sim/types'

const modeCopy = {
  unselected: { label: 'Choose pilot', icon: CircleHelp },
  human: { label: 'Manual flight', icon: UserRound },
  agent: { label: 'Agent flight', icon: Bot },
} as const

export function FlightModeBadge({ mode }: { readonly mode: FlightMode }) {
  const content = modeCopy[mode]
  const Icon = content.icon

  return (
    <div className={`flight-mode-badge flight-mode-${mode}`} aria-label={content.label}>
      <span aria-hidden="true"><Icon /></span>
      <strong>{content.label}</strong>
    </div>
  )
}
