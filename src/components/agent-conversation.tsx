import { isToolUIPart, type UIMessage } from 'ai'
import { Bot, CircleStop, PlaneTakeoff, Radar, Sparkles, UserRound } from 'lucide-react'
import { useFlightAgent, flightToolReceipt } from '../agent/useFlightAgent'
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from './ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from './ai-elements/message'
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from './ai-elements/prompt-input'
import { Suggestion, Suggestions } from './ai-elements/suggestion'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from './ai-elements/tool'

function FlightToolPart({ part }: { part: UIMessage['parts'][number] }) {
  if (!isToolUIPart(part)) return null

  const receipt = flightToolReceipt(part)
  if (!receipt) return null

  const headerProps = part.type === 'dynamic-tool'
    ? { type: part.type, toolName: part.toolName, state: part.state }
    : { type: part.type, state: part.state }

  return (
    <Tool className="flight-tool" defaultOpen={part.state === 'output-error'}>
      <ToolHeader title={receipt.title} {...headerProps} />
      <ToolContent>
        <ToolInput input={part.input} />
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  )
}

function FlightMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === 'user'

  return (
    <Message className="flight-message" from={message.role}>
      <div className="message-author">
        <span className={isUser ? 'message-avatar message-avatar-user' : 'message-avatar'}>
          {isUser ? <UserRound /> : <Bot />}
        </span>
        {isUser ? 'You' : 'Copilot'}
      </div>
      <MessageContent className="flight-message-content">
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <MessageResponse key={`${message.id}-text-${index}`}>
                {part.text}
              </MessageResponse>
            )
          }

          if (isToolUIPart(part)) {
            return <FlightToolPart key={part.toolCallId} part={part} />
          }

          return null
        })}
      </MessageContent>
    </Message>
  )
}

function readableError(error: Error) {
  try {
    const parsed = JSON.parse(error.message) as { error?: unknown }
    if (typeof parsed.error === 'string') return parsed.error
  } catch {
    // The transport also returns plain text errors.
  }
  return error.message
}

export function AgentConversation() {
  const agent = useFlightAgent()

  return (
    <section className="conversation-panel" aria-label="AI copilot conversation">
      <div className="conversation-header">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-white/70" aria-hidden="true" />
            <h1>Copilot</h1>
            <span className={`agent-status agent-status-${agent.error ? 'failed' : agent.isReady ? 'ready' : 'waiting'}`}>
              {agent.error ? 'Offline' : agent.isReady ? 'Ready' : 'Working'}
            </span>
          </div>
          <p>Ask, plan, then hand off when you want action.</p>
        </div>
      </div>

      {agent.error ? (
        <div className="agent-error" role="alert">
          <CircleStop className="size-3.5 shrink-0" />
          <span>{readableError(agent.error)}</span>
        </div>
      ) : null}

      <Conversation className="conversation-thread">
        <ConversationContent className="conversation-viewport">
          {agent.messages.length === 0 ? (
            <ConversationEmptyState className="conversation-empty">
              <span className="message-avatar"><Bot /></span>
              <div>
                <p>I can read the aircraft, explain what is happening, or fly after you hand me control.</p>
                <Suggestions className="mt-3">
                  <Suggestion
                    suggestion="What should I do before takeoff?"
                    onClick={(prompt) => void agent.send(prompt)}
                  >
                    <PlaneTakeoff /> Before takeoff
                  </Suggestion>
                  <Suggestion
                    suggestion="How does the flight look right now?"
                    onClick={(prompt) => void agent.send(prompt)}
                  >
                    <Radar /> Read the aircraft
                  </Suggestion>
                </Suggestions>
              </div>
            </ConversationEmptyState>
          ) : (
            agent.messages.map((message) => (
              <FlightMessage key={message.id} message={message} />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        className="conversation-composer"
        onSubmit={({ text }) => agent.send(text)}
      >
        <PromptInputBody>
          <PromptInputTextarea
            aria-label="Message the copilot"
            className="conversation-input"
            name="message"
            placeholder="Ask about the flight or give a command…"
          />
        </PromptInputBody>
        <PromptInputFooter className="conversation-footer">
          <span className="conversation-note">Questions are read-only. Changes appear as receipts.</span>
          <PromptInputSubmit status={agent.status} onStop={agent.stop} />
        </PromptInputFooter>
      </PromptInput>
    </section>
  )
}
