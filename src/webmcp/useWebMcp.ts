import { useEffect, useState } from 'react'
import { executeFlightToolFromUnknown } from '../shared/executeFlightTool'
import { flightToolDefinitions } from '../shared/flightTools'

export type WebMcpStatus = 'registering' | 'ready' | 'unsupported' | 'error'

function createFlightTools(): WebMCP.ModelContextTool[] {
  return flightToolDefinitions.map((definition) => ({
    name: definition.name,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    annotations: { readOnlyHint: definition.readOnly },
    execute: (input: Record<string, unknown>) =>
      executeFlightToolFromUnknown(definition.name, input),
  }))
}

export function useWebMcp() {
  const [status, setStatus] = useState<WebMcpStatus>('registering')

  useEffect(() => {
    if (!document.modelContext) {
      setStatus('unsupported')
      return
    }
    const modelContext = document.modelContext
    const controller = new AbortController()

    async function registerTools() {
      try {
        await Promise.all(
          createFlightTools().map((tool) =>
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

  return status
}
