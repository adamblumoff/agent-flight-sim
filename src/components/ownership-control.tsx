import { Bot, LoaderCircle, Undo2, UserRound } from 'lucide-react'

export type OwnershipMode = 'human' | 'handoff_pending' | 'thinking' | 'flying' | 'complete' | 'unavailable'

const ownershipCopy = {
  human: {
    label: 'You have control',
    action: 'Hand off',
    icon: UserRound,
  },
  handoff_pending: {
    label: 'Handoff requested',
    action: 'Cancel',
    icon: LoaderCircle,
  },
  thinking: {
    label: 'Copilot thinking',
    action: 'Take it back',
    icon: LoaderCircle,
  },
  flying: {
    label: 'Copilot flying',
    action: 'Take it back',
    icon: Bot,
  },
  complete: {
    label: 'Copilot has control',
    action: 'Take it back',
    icon: Bot,
  },
  unavailable: {
    label: 'You have control',
    action: 'Copilot offline',
    icon: UserRound,
  },
} as const

export function OwnershipControl({
  mode,
  onClick,
}: {
  readonly mode: OwnershipMode
  readonly onClick: () => void
}) {
  const content = ownershipCopy[mode]
  const Icon = content.icon
  const disabled = mode === 'unavailable'

  return (
    <button
      type="button"
      className={`ownership-control ownership-${mode}`}
      disabled={disabled}
      onClick={onClick}
      aria-label={disabled ? 'You have control. Copilot is unavailable.' : `${content.label}. ${content.action}.`}
    >
      <span className="ownership-icon" aria-hidden="true">
        <Icon className={mode === 'thinking' || mode === 'handoff_pending' ? 'ownership-spinner' : undefined} />
      </span>
      <span className="ownership-label">{content.label}</span>
      <span className="ownership-action">
        {mode === 'flying' || mode === 'thinking' || mode === 'complete' ? <Undo2 aria-hidden="true" /> : null}
        {content.action}
      </span>
    </button>
  )
}
