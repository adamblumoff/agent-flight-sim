import { Bot, CircleHelp, UserRound } from 'lucide-react'
import type { FlightMode } from '../sim/types'
import { cn } from '../lib/utils'

const modeCopy = {
  unselected: { label: 'Choose pilot', icon: CircleHelp },
  human: { label: 'Manual flight', icon: UserRound },
  agent: { label: 'Agent flight', icon: Bot },
} as const

export function FlightModeBadge({ mode }: { readonly mode: FlightMode }) {
  const content = modeCopy[mode]
  const Icon = content.icon

  return (
    <div
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-lg border bg-[#171815]/85 px-3 py-2 backdrop-blur-xl',
        mode === 'agent' && 'border-[#8bc49b]/30 text-[#8bc49b]',
        mode === 'human' && 'border-[#e2b76f]/30 text-[#e2b76f]',
        mode === 'unselected' && 'border-[#f4efde]/12 text-[#b9b3a3]',
      )}
      aria-label={content.label}
    >
      <span className="grid size-4 place-items-center [&_svg]:size-3.5" aria-hidden="true"><Icon /></span>
      <strong className="font-mono text-[8px] font-semibold uppercase tracking-[0.1em] max-sm:hidden">{content.label}</strong>
    </div>
  )
}
