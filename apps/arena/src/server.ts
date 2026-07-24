import express from 'express'
import { join } from 'node:path'
import type { AgentEvent } from './events.js'
import type { EventLog } from './log.js'
import { MEDIA_DIR } from './media.js'

export interface ServerDeps {
  log: EventLog
  state: () => unknown

  /**
   * Starts a round. Optional so a replay-only server can be stood up without
   * one. Returns an ack, never the round's result: the round is watched on the
   * event stream, not awaited over HTTP.
   */
  start?: (opts: { arena?: unknown; speed?: unknown }) => StartAck
}

export type StartAck =
  | { ok: true; roundId: string }
  /** 400 for a malformed request, 409 for a server that is simply busy. */
  | { ok: false; reason: string; status?: 400 | 409 }

export function startServer(deps: ServerDeps, port = Number(process.env.PORT ?? 4000)) {
  const app = express()

  app.use(express.json())

  /**
   * The office runs on its own dev server, so every route is cross-origin.
   * A JSON POST is preflighted, so Allow-Origin alone is not enough: without
   * Allow-Methods and Allow-Headers on the OPTIONS response the browser blocks
   * the start request before the server ever sees it.
   */
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Last-Event-ID')

    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.get('/state', (_req, res) => res.json(deps.state()))

  app.post('/start', (req, res) => {
    if (!deps.start) {
      res.status(501).json({ ok: false, reason: 'this server was started without a round runner' })
      return
    }

    const ack = deps.start(req.body ?? {})

    /**
     * 202, not 200: the round is accepted and runs asynchronously. A rejection
     * carries its own status so a busy server (409) is distinguishable from a
     * bad payload (400) — the office retries one and not the other.
     */
    res.status(ack.ok ? 202 : (ack.status ?? 409)).json(ack)
  })

  app.get('/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    })

    /**
     * Flush the headers immediately. writeHead alone buffers until the first
     * write, so a client connecting to an idle arena — no events yet, next
     * heartbeat 15s away — never sees the response open and reports itself
     * offline for as long as nothing happens.
     */
    res.flushHeaders()
    res.write(': open\n\n')

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

  /**
   * Pitch videos, resolved against the module rather than cwd so the same
   * files are served whether the arena was started from the repo root or from
   * its own package. These outlive the round: the media is copied out of the
   * sandbox before teardown, so a video still plays after its sandbox is gone.
   */
  app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h' }))
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
