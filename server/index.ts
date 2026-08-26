import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { openai } from '@ai-sdk/openai'
import { Hono } from 'hono'
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  jsonSchema,
  streamText,
  toUIMessageStream,
  tool,
  type UIMessage,
} from 'ai'
import { pathToFileURL } from 'node:url'
import { flightToolDefinitions } from '../src/shared/flightTools'

interface FlightContext {
  readonly state?: Readonly<Record<string, unknown>>
  readonly recentEvents?: readonly unknown[]
}

interface ChatBody {
  readonly messages?: UIMessage[]
  readonly flightContext?: FlightContext
}

const browserFlightTools = Object.fromEntries(
  flightToolDefinitions.map((definition) => [
    definition.name,
    tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
    }),
  ]),
)

const COPILOT_INSTRUCTIONS = `You are Flightdeck, the concise AI copilot in a shared-cockpit training simulator flying KPWK to KMDW.

Operating rules:
- Answer questions directly. The latest live flight state and recent action log are already supplied below, so do not call a read tool merely to answer a question.
- Never change the aircraft unless the pilot clearly gives a command or accepts your recommendation.
- Before taking primary control, verbally announce "My controls" and then call transfer_control with owner "agent". Never imply you control the aircraft until that receipt succeeds.
- When the pilot says "my controls", "I have control", "stop", "cancel automation", or equivalent, immediately call transfer_control with owner "human". This stops agent control.
- When you own the controls, prefer the flight director for continuous heading, altitude, and airspeed control. The browser runs the 60 Hz controller.
- After a command, state exactly what changed in one short sentence. Tool receipts are visible to the pilot, so do not invent success.
- Be calm, operational, and brief. Surface safety-critical concerns clearly. This is a simulator, not real-world flight authority.`

const serializeFlightContext = (context: FlightContext | undefined) => {
  if (!context) return 'No browser flight state was supplied.'
  const serialized = JSON.stringify(context)
  return serialized.length > 12_000
    ? `${serialized.slice(0, 12_000)}…`
    : serialized
}

export const app = new Hono()

app.get('/api/health', (context) =>
  context.json({
    ok: true,
    modelConfigured: Boolean(process.env.OPENAI_API_KEY),
  }),
)

app.post('/api/chat', async (context) => {
  if (!process.env.OPENAI_API_KEY) {
    context.header('X-Agent-Error-Code', 'OPENAI_API_KEY_MISSING')
    return context.text(
      'AI copilot is not configured. Set OPENAI_API_KEY on the server and restart it.',
      503,
    )
  }

  let body: ChatBody
  try {
    body = await context.req.json<ChatBody>()
  } catch {
    return context.json({ error: 'The chat request must be valid JSON.' }, 400)
  }

  if (!Array.isArray(body.messages)) {
    return context.json({ error: 'The chat request must include a messages array.' }, 400)
  }

  const result = streamText({
    model: openai(process.env.OPENAI_MODEL ?? 'gpt-5.4-mini'),
    system: `${COPILOT_INSTRUCTIONS}\n\n<browser_flight_context>\n${serializeFlightContext(body.flightContext)}\n</browser_flight_context>`,
    messages: await convertToModelMessages(body.messages),
    tools: browserFlightTools,
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
    headers: {
      'Cache-Control': 'no-store',
    },
  })
})

app.use('/assets/*', serveStatic({ root: './dist' }))
app.use('/cesiumStatic/*', serveStatic({ root: './dist' }))
app.use('/models/*', serveStatic({ root: './dist' }))
app.get('*', serveStatic({ root: './dist', path: 'index.html' }))

const isEntryPoint = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false

if (isEntryPoint) {
  const port = Number.parseInt(process.env.PORT ?? '8787', 10)
  serve({ fetch: app.fetch, port })
  console.log(`Flightdeck server listening on http://localhost:${port}`)
}

export default app
