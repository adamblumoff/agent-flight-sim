"use client"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { ChatStatus } from "ai"
import { CornerDownLeftIcon, SquareIcon, XIcon } from "lucide-react"
import type {
  ComponentProps,
  FormEvent,
  FormEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
} from "react"
import { useCallback, useState } from "react"

export interface PromptInputMessage {
  text: string
  files: never[]
}

export type PromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>
}

export const PromptInput = ({
  className,
  children,
  onSubmit,
  ...props
}: PromptInputProps) => {
  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault()
      const form = event.currentTarget
      const text = String(new FormData(form).get("message") ?? "").trim()
      if (!text) return
      form.reset()
      void onSubmit({ text, files: [] }, event)
    },
    [onSubmit],
  )

  return (
    <form className={cn("w-full", className)} onSubmit={handleSubmit} {...props}>
      <InputGroup>{children}</InputGroup>
    </form>
  )
}

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>

export const PromptInputBody = ({ className, ...props }: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
)

export type PromptInputTextareaProps = ComponentProps<typeof InputGroupTextarea>

export const PromptInputTextarea = ({
  className,
  onKeyDown,
  ...props
}: PromptInputTextareaProps) => {
  const [isComposing, setIsComposing] = useState(false)
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    onKeyDown?.(event)
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey) return
    if (isComposing || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  return (
    <InputGroupTextarea
      className={cn("max-h-32 min-h-10", className)}
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
}

export type PromptInputFooterProps = ComponentProps<typeof InputGroupAddon>

export const PromptInputFooter = ({ className, ...props }: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("justify-between", className)}
    {...props}
  />
)

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus
  onStop?: () => void
}

export const PromptInputSubmit = ({
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === "submitted" || status === "streaming"
  const handleClick = (event: Parameters<NonNullable<typeof onClick>>[0]) => {
    if (isGenerating && onStop) {
      event.preventDefault()
      onStop()
      return
    }
    onClick?.(event)
  }

  const icon = status === "submitted"
    ? <Spinner />
    : status === "streaming"
      ? <SquareIcon />
      : status === "error"
        ? <XIcon />
        : <CornerDownLeftIcon />

  return (
    <InputGroupButton
      aria-label={isGenerating ? "Stop" : "Send message"}
      onClick={handleClick}
      size="icon-sm"
      type={isGenerating && onStop ? "button" : "submit"}
      variant="default"
      {...props}
    >
      {children ?? icon}
    </InputGroupButton>
  )
}
