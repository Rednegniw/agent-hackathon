import './env.js'
import type { BaseArena } from './arena-base.js'
import { DaytonaArena, KEEP_ALIVE } from './arena-daytona.js'
import { FakeArena } from './arena-fake.js'
import { AGENT_IDS, TRACKS, type AgentId, type Track } from './events.js'
import { EventLog } from './log.js'
import { PhaseClock, sleep } from './phases.js'
import { startServer } from './server.js'

/**
 * Runs a full round with scripted agents against either arena.
 *
 *   pnpm dev:fast                            fake, free, instant
 *   ARENA=daytona pnpm --filter arena dev    real sandboxes, still no tokens
 *
 * The daytona mode is the important one: it exercises the entire real
 * substrate without spending a single token on the agent loop.
 */

const REAL = process.env.ARENA === 'daytona'

const runId = new Date().toISOString().replace(/[:.]/g, '-')
const log = new EventLog(runId)
const clock = new PhaseClock()
const arena: BaseArena = REAL ? new DaytonaArena(log, clock, runId) : new FakeArena(log, clock)

startServer({ log, state: () => ({ phase: clock.phase(), tracks: arena.snapshot(), run: runId }) })

const PICKS: Record<AgentId, Track> = {
  ada: 'time',
  rex: 'color',
  juno: 'time',
  iris: 'color',
  otto: 'time',
  vera: 'color',
}

const PITCH: Record<AgentId, string> = {
  ada: 'A timer that is honest about drift.',
  rex: 'Palettes that argue with each other.',
  juno: 'One clock, no settings, no options.',
  iris: 'Colour distance you can actually see.',
  otto: 'The smallest countdown that works.',
  vera: 'A clock that only tells you what you need.',
}

clock.onPhase(async (phase) => {
  log.emit({ agentId: 'system', kind: 'phase', body: phase })
  console.log(`[phase] ${phase}`)

  /**
   * Sandboxes are provisioned lazily at the end of mingle, once tracks are
   * settled. Nothing is created for an agent that never got going, and the
   * mingle phase costs no compute.
   */
  if (phase === 'build') {
    arena.assignStragglers(AGENT_IDS)
    if (arena instanceof DaytonaArena) await arena.provision(AGENT_IDS)
  }
})

async function agentScript(id: AgentId) {
  await sleep(300 + Math.floor(Math.random() * 900))

  // mingle
  log.emit({ agentId: id, kind: 'thought', body: `Weighing ${TRACKS.join(' against ')}.` })
  const want = PICKS[id]
  const res = arena.claimTrack(id, want)

  if (res.ok) {
    log.emit({ agentId: id, kind: 'theme', body: want, track: want })
  } else {
    const fallback = res.open[0]
    log.emit({ agentId: id, kind: 'thought', body: `${res.reason}. Taking ${fallback}.` })
    arena.claimTrack(id, fallback)
    log.emit({ agentId: id, kind: 'theme', body: fallback, track: fallback })
  }

  const rival = AGENT_IDS.find((o) => o !== id && PICKS[o] === arena.trackOf(id))
  if (rival) {
    log.emit({ agentId: id, kind: 'message', targetId: rival, body: `What angle are you taking?` })
  }

  // build
  while (clock.phase() === 'mingle') await sleep(200)
  if (REAL && !(arena as DaytonaArena).has(id)) {
    log.emit({ agentId: id, kind: 'thought', body: 'No sandbox. Sitting this round out.' })
    return
  }

  const box = arena.sandboxFor(id)

  await box.write('app/index.html', `<!doctype html><title>${id}</title><h1>${id}</h1><p>${PITCH[id]}</p>`)
  log.emit({ agentId: id, kind: 'build', body: 'wrote app/index.html' })

  /**
   * nohup plus & is required. Without backgrounding, executeCommand blocks
   * until the 60s timeout and the agent loses its build phase. FakeArena
   * ignores this and serves the directory itself.
   */
  await box.bash(`cd ~/app && nohup python3 -m http.server 3000 >/tmp/serve.log 2>&1 & sleep 1; echo up`)
  log.emit({ agentId: id, kind: 'build', body: 'dev server started on 3000' })
  log.emit({ agentId: id, kind: 'thought', body: 'Serving on 3000. Verifying before I submit.' })

  // submit
  while (clock.phase() !== 'submit') await sleep(200)

  try {
    const url = await box.preview(3000)
    log.emit({ agentId: id, kind: 'submit', body: PITCH[id], track: arena.trackOf(id), previewUrl: url })
  } catch (err) {
    log.emit({ agentId: id, kind: 'thought', body: `submission failed: ${(err as Error).message}` })
  }
}

const main = async () => {
  console.log(`[dev] run ${runId} arena=${REAL ? 'daytona' : 'fake'} -> ${log.file}`)

  try {
    await Promise.all([clock.run(), ...AGENT_IDS.map((id) => agentScript(id).catch((err) => {
      console.error(`[${id}]`, err.message)
      log.emit({ agentId: id, kind: 'thought', body: `failed: ${err.message}` })
    }))])

    log.emit({ agentId: 'system', kind: 'score', body: 'round complete' })
    console.log(`[dev] done. ${log.all().length} events in ${log.file}`)
  } finally {
    if (arena instanceof DaytonaArena) await arena.teardown()
    else await (arena as FakeArena).teardown()
  }

  console.log(
    KEEP_ALIVE && REAL
      ? '[dev] sandboxes kept alive. Preview URLs stay live for the pitch.'
      : '[dev] server still up for the office. ctrl-c to stop.',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
