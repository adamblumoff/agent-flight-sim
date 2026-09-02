import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024

function evidenceArchive(): Plugin {
  return {
    name: 'flightdeck-evidence-archive',
    configureServer(server) {
      server.middlewares.use('/__flightdeck/evidence', (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end()
          return
        }

        const chunks: Buffer[] = []
        let receivedBytes = 0
        request.on('data', (chunk: Buffer) => {
          receivedBytes += chunk.length
          if (receivedBytes <= MAX_EVIDENCE_BYTES) chunks.push(chunk)
        })
        request.on('end', async () => {
          try {
            if (receivedBytes > MAX_EVIDENCE_BYTES) throw new Error('Evidence payload is too large')
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              readonly run?: { readonly runId?: unknown; readonly outcome?: unknown }
              readonly calls?: readonly { readonly tool?: unknown }[]
            }
            const runId = payload.run?.runId
            if (typeof runId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(runId)) throw new Error('Invalid run ID')
            if (!Array.isArray(payload.calls)) throw new Error('Missing WebMCP calls')
            const run = payload.run
            if (!run) throw new Error('Missing run metadata')

            const runDirectory = join(process.cwd(), '.flightdeck', 'runs', runId)
            await mkdir(runDirectory, { recursive: true })
            const callNumber = String(payload.calls.length).padStart(4, '0')
            const tool = String(payload.calls.at(-1)?.tool ?? 'start').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)
            const filename = run.outcome === 'in_progress' ? `${callNumber}-${tool}.json` : 'terminal.json'
            const path = join(runDirectory, filename)
            await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

            response.statusCode = 201
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify({ path }))
          } catch (error) {
            response.statusCode = 400
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Evidence archive failed' }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [evidenceArchive(), tailwindcss(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
