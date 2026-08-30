import { useCallback, useEffect, useRef, useState } from 'react'
import { executeFlightToolFromUnknown } from '../shared/executeFlightTool'
import {
  flightToolDefinitions,
  type FlightToolName,
} from '../shared/flightTools'

export type WebMcpStatus = 'registering' | 'ready' | 'unsupported' | 'error'

export interface WebMcpActivity {
  readonly id: number
  readonly tool: FlightToolName
  readonly title: string
  readonly status: 'completed' | 'failed'
  readonly summary: string
  readonly timestamp: number
  readonly arguments: Readonly<Record<string, unknown>>
}

type RecordActivity = (activity: Omit<WebMcpActivity, 'id' | 'timestamp'>) => void

function createFlightTools(recordActivity: RecordActivity): WebMCP.ModelContextTool[] {
  return flightToolDefinitions.map((definition) => ({
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: { readOnlyHint: definition.readOnly },
    execute: async (input: Record<string, unknown>) => {
      try {
        const result = await executeFlightToolFromUnknown(definition.name, input)
        recordActivity({
          tool: definition.name,
          title: definition.title,
          status: result.ok ? 'completed' : 'failed',
          summary: result.summary,
          arguments: input,
        })
        return result
      } catch (error) {
        recordActivity({
          tool: definition.name,
          title: definition.title,
          status: 'failed',
          summary: error instanceof Error ? error.message : 'Tool call failed',
          arguments: input,
        })
        throw error
      }
    },
  }))
}

export function useWebMcp() {
  const [status, setStatus] = useState<WebMcpStatus>('registering')
  const [activities, setActivities] = useState<readonly WebMcpActivity[]>([])
  const nextActivityId = useRef(1)
  const clearActivities = useCallback(() => setActivities([]), [])

  useEffect(() => {
    if (!document.modelContext) {
      setStatus('unsupported')
      return
    }
    const modelContext = document.modelContext
    const controller = new AbortController()
    const recordActivity: RecordActivity = (activity) => {
      const event = {
        ...activity,
        id: nextActivityId.current++,
        timestamp: Date.now(),
      }
      setActivities((current) => activity.tool === 'start_flight' ? [event] : [...current, event])
    }

    async function registerTools() {
      try {
        await Promise.all(
          createFlightTools(recordActivity).map((tool) =>
            modelContext.registerTool(tool, { signal: controller.signal }),
          ),
        )
        if (!controller.signal.aborted) setStatus('ready')
      } catch (error) {
        if (!controller.signal.aborted) {
          controller.abort()
          setStatus('error')
          console.error('WebMCP registration failed', error)
        }
      }
    }

    void registerTools()
    return () => controller.abort()
  }, [])

  return { status, activities, clearActivities }
}
