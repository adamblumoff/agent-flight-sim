import { useChat } from '@ai-sdk/react'
import { useAISDKRuntime } from '@assistant-ui/ai-sdk'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from 'ai'
import { useMemo } from 'react'
import { flightSimulator } from '../sim/flightSimulator'
import { executeFlightToolFromUnknown } from '../shared/executeFlightTool'
import {
  flightToolDefinitionsByName,
  isFlightToolName,
  type FlightToolName,
} from '../shared/flightTools'

export type FlightAgentStatus = 'submitted' | 'streaming' | 'ready' | 'error'

export interface FlightToolReceiptView {
  readonly toolCallId: string
  readonly name: FlightToolName
  readonly title: string
  readonly state: string
  readonly input?: unknown
  readonly output?: unknown
  readonly errorText?: string
}

const transport = new DefaultChatTransport({
  api: '/api/chat',
  body: () => ({
    flightContext: {
      state: flightSimulator.getState(),
      recentEvents: flightSimulator.getTrace().slice(-8),
    },
  }),
})

export function useFlightAgent() {
  const chat = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      if (!isFlightToolName(toolCall.toolName)) {
        chat.addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          state: 'output-error',
          errorText: `Unknown flight tool: ${toolCall.toolName}`,
        })
        return
      }

      try {
        const output = executeFlightToolFromUnknown(toolCall.toolName, toolCall.input)
        chat.addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output,
        })
      } catch (error) {
        chat.addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          state: 'output-error',
          errorText: error instanceof Error ? error.message : 'The flight command failed',
        })
      }
    },
  })
  const runtime = useAISDKRuntime(chat)

  return useMemo(
    () => ({
      messages: chat.messages,
      status: chat.status as FlightAgentStatus,
      error: chat.error,
      send: async (text: string) => {
        const message = text.trim()
        if (!message) return
        await chat.sendMessage({ text: message })
      },
      stop: chat.stop,
      isReady: chat.status === 'ready',
      runtime,
    }),
    [chat.error, chat.messages, chat.sendMessage, chat.status, chat.stop, runtime],
  )
}

export function flightToolReceipt(part: UIMessage['parts'][number]): FlightToolReceiptView | null {
  if (typeof part !== 'object' || part === null) return null
  const value = part as unknown as Record<string, unknown>
  const type = value.type
  const name =
    type === 'dynamic-tool'
      ? value.toolName
      : typeof type === 'string' && type.startsWith('tool-')
        ? type.slice(5)
        : undefined

  if (typeof name !== 'string' || !isFlightToolName(name)) return null
  if (typeof value.toolCallId !== 'string' || typeof value.state !== 'string') return null

  return {
    toolCallId: value.toolCallId,
    name,
    title: flightToolDefinitionsByName[name].title,
    state: value.state,
    input: value.input,
    output: value.output,
    errorText: typeof value.errorText === 'string' ? value.errorText : undefined,
  }
}
