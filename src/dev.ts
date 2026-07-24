import 'dotenv/config'
import { FakeArena } from './arena-fake.js'
import { AGENT_IDS, TRACKS, type AgentId, type Track } from './events.js'
import { EventLog } from './log.js'
import { PhaseClock, sleep } from './phases.js'
import { startServer } from './server.js'

/**
 * Runs a full round against FakeArena with scripted agents. No Daytona, no
 * tokens. Gives Kris a live event stream and Patrik a real Arena to build on.
 *
 *   ROUND_SPEED=30 npx tsx src/dev.ts
 */

const runId = new Date().toISOString().replace(/[:.]/g, '-')
const log = new EventLog(runId)
const clock = new PhaseClock()
const arena = new FakeArena(log, clock)

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

  if (phase === 'build') arena.assignStragglers(AGENT_IDS)
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
  const box = arena.sandboxFor(id)

  await box.write('index.html', `<!doctype html><title>${id}</title><h1>${id}</h1><p>${PITCH[id]}</p>`)
  log.emit({ agentId: id, kind: 'build', body: 'wrote index.html' })

  await sleep(500)
  const ls = await box.bash('ls -la')
  log.emit({ agentId: id, kind: 'build', body: `ls -> ${ls.split('\n').length} entries` })
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
  console.log(`[dev] run ${runId} -> ${log.file}`)
  await Promise.all([clock.run(), ...AGENT_IDS.map(agentScript)])

  log.emit({ agentId: 'system', kind: 'score', body: 'round complete' })
  console.log(`[dev] done. ${log.all().length} events in ${log.file}`)
  console.log('[dev] server still up for the office. ctrl-c to stop.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
