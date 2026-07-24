import express from 'express'
import { join } from 'node:path'
import type { AgentEvent } from './events.js'
import type { EventLog } from './log.js'

export interface ServerDeps {
  log: EventLog
  state: () => unknown
}

export function startServer(deps: ServerDeps, port = Number(process.env.PORT ?? 4000)) {
  const app = express()

  // The office runs on its own dev server, so every route is cross-origin.
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    next()
  })

  app.get('/state', (_req, res) => res.json(deps.state()))

  app.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    })

    const send = (e: AgentEvent) => res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`)

    /**
     * Replay-then-tail. EventSource reconnects automatically after any blip
     * and replays Last-Event-ID, so honouring it keeps a reconnect from
     * re-rendering the entire round. The office should still dedupe by seq.
     */
    const since = Number(req.headers['last-event-id'] ?? 0)
    for (const e of deps.log.since(since)) send(e)

    const off = deps.log.subscribe(send)
    const hb = setInterval(() => res.write(': hb\n\n'), 15_000)

    req.on('close', () => {
      off()
      clearInterval(hb)
    })
  })

  app.use(express.static(join(process.cwd(), 'public')))

  const server = app.listen(port, () => {
    console.log(`[server] http://localhost:${port}  (events at /events)`)
  })

  /**
   * Without this the process keeps running against a port it never bound,
   * and you spend ten minutes debugging an office that is quietly reading a
   * previous run's event stream.
   */
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[server] port ${port} is already in use. Kill the old run or set PORT.`)
      process.exit(1)
    }
    throw err
  })

  return server
}
