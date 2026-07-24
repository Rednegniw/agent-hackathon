import './env.js'
import { EventLog } from './log.js'
import {
  DEFAULT_START,
  RoundRunner,
  parseStartOptions,
  type ArenaKind,
  type StartOptions,
} from './round.js'
import { startServer } from './server.js'

/**
 * The arena server. Boots idle and waits for the office to start a round.
 *
 *   pnpm --filter arena dev                     server only; press Start in the office
 *   AUTOSTART=1 pnpm --filter arena dev         start a round immediately, as before
 *   ARENA=fake AUTOSTART=1 pnpm --filter arena dev   same, but free and instant
 *
 * The round itself is scripted, not LLM-driven, so it exercises the whole
 * Daytona substrate without spending a token. See round.ts.
 */

const runId = new Date().toISOString().replace(/[:.]/g, '-')

/**
 * One log for the process, not one per round. It is the append-only spine:
 * SSE clients replay it by Last-Event-ID, so a second round has to continue
 * the same seq sequence rather than restart it.
 */
const log = new EventLog(runId)
const runner = new RoundRunner(log)

/** One line describing what a round will actually do. */
const describe = (o: StartOptions) =>
  `arena=${o.arena} agents=${o.agents}x${o.agentCount} ` +
  `phases=${o.durations.mingle}/${o.durations.build}/${o.durations.submit}s` +
  (o.keepAlive ? ' keep-alive' : '')

startServer({
  log,
  state: () => ({ ...runner.status(), run: runId, file: log.file }),
  start: (body) => {
    const opts = parseStartOptions(body)
    if ('error' in opts) return { ok: false, reason: opts.error, status: 400 }

    const ack = runner.start(opts)
    if (ack.ok) console.log(`[start] round ${ack.roundId} ${describe(opts)}`)
    return ack
  },
  reset: () => {
    const ack = runner.reset()
    console.log(ack.stopping ? '[reset] stopping the round…' : '[reset] back to idle')
    return ack
  },
})

console.log(`[dev] run ${runId} -> ${log.file}`)

if (process.env.AUTOSTART === '1') {
  const opts = parseStartOptions({
    arena: (process.env.ARENA as ArenaKind) ?? DEFAULT_START.arena,
    agents: process.env.AGENT_KIND,
    agentCount: process.env.AGENT_COUNT ? Number(process.env.AGENT_COUNT) : undefined,
    speed: process.env.ROUND_SPEED,
  })

  if ('error' in opts) {
    console.error(`[dev] AUTOSTART rejected: ${opts.error}`)
    process.exit(1)
  }

  console.log(`[dev] AUTOSTART ${describe(opts)}`)
  runner.start(opts)
} else {
  console.log('[dev] idle. Press Start in the office, or POST /start.')
}
