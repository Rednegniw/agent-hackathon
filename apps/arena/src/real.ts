import './env.js'
import { runAgent } from './agent.js'
import { logToBraintrust } from './braintrust.js'
import { DaytonaArena, KEEP_ALIVE } from './arena-daytona.js'
import { FakeArena } from './arena-fake.js'
import type { AgentId } from './events.js'
import { Inbox } from './inbox.js'
import { runEvaluation } from './judge.js'
import { EventLog } from './log.js'
import { PhaseClock } from './phases.js'
import { TEAMS_ENABLED, TeamRoster } from './teams.js'
import { startServer } from './server.js'

/**
 * A real round: actual models driving the actual tools against actual sandboxes.
 *
 *   AGENTS=ada,rex,juno,iris MODEL=claude-haiku-4-5 ROUND_SPEED=4 \
 *     ARENA=daytona KEEP_ALIVE=1 pnpm --filter arena real
 *
 * Costs tokens. Start small: this is the first thing that proves a model can
 * actually drive the tool surface, which no scripted run can tell us.
 */

const REAL = process.env.ARENA === 'daytona'
const MODEL = process.env.MODEL ?? 'claude-haiku-4-5'
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 30)

const ROSTER = (process.env.AGENTS ?? 'ada,rex,juno,iris').split(',') as AgentId[]

const runId = new Date().toISOString().replace(/[:.]/g, '-')
const log = new EventLog(runId)
const clock = new PhaseClock()
const arena = REAL ? new DaytonaArena(log, clock, runId) : new FakeArena(log, clock)

const inbox = new Inbox()
const teams = TEAMS_ENABLED ? new TeamRoster() : undefined

/**
 * The conversation stays open while the round is live. Once judging starts the
 * generators close, which is what lets each query() session finish.
 */
const roundIsOpen = () => ['mingle', 'build', 'submit'].includes(clock.phase())

startServer({ log, state: () => ({ phase: clock.phase(), tracks: arena.snapshot(), run: runId }) })

clock.onPhase(async (phase) => {
  log.emit({ agentId: 'system', kind: 'phase', body: phase })
  console.log(`[phase] ${phase}`)

  if (phase === 'build') {
    arena.assignStragglers(ROSTER)

    if (teams) {
      const settled = teams.settle(ROSTER)
      for (const t of settled) {
        log.emit({ agentId: t.owner, kind: 'team', body: `${t.id}: ${t.members.join(', ')} (owner ${t.owner})` })
      }
      console.log(`[teams]\n${teams.describe()}`)
    }

    if (arena instanceof DaytonaArena) await arena.provision(ROSTER)
  }

  /** Round over: release every parked reader so the agent sessions can close. */
  if (phase === 'judging' || phase === 'judged') inbox.releaseAll()
})

const main = async () => {
  console.log(`[real] run ${runId}`)
  console.log(`[real] ${ROSTER.length} agents on ${MODEL}, arena=${REAL ? 'daytona' : 'fake'}`)

  try {
    await Promise.all([
      clock.run(),
      ...ROSTER.map((id) =>
        runAgent(id, arena, ROSTER.filter((o) => o !== id), MODEL, MAX_TURNS, teams, inbox, roundIsOpen).catch((e) => {
          console.error(`[${id}] crashed:`, e.message)
          log.emit({ agentId: id, kind: 'thought', body: `crashed: ${e.message}` })
        }),
      ),
    ])

    const subs = log.all().filter((e) => e.kind === 'submit')
    console.log(`\n[real] ${subs.length}/${ROSTER.length} submitted`)
    for (const s of subs) console.log(`  ${s.agentId} [${s.track}] ${s.previewUrl}`)

    // The evaluator round: agents present, jurors score, a winner is crowned.
    if (process.env.SKIP_JUDGING !== '1') {
      console.log('\n[judge] evaluator round...')
      const { verdicts, winner } = await runEvaluation(log.all(), arena)

      for (const v of verdicts) {
        console.log(`  ${v.agentId.padEnd(6)} ${String(v.total).padStart(3)}/90  ${v.presentation.slice(0, 70)}`)
        for (const s of v.perJudge) console.log(`      ${s.judge.padEnd(16)} ${s.total}/30  ${s.comment.slice(0, 60)}`)
      }
      if (winner) console.log(`\n[judge] WINNER: ${winner.agentId} with ${winner.total} points`)

      await logToBraintrust(verdicts, log.all())
    }

    log.emit({ agentId: 'system', kind: 'score', body: `round complete, ${subs.length}/${ROSTER.length} submitted` })
    console.log(`[real] ${log.all().length} events -> ${log.file}`)
  } finally {
    if (arena instanceof DaytonaArena) await arena.teardown()
    else await arena.teardown()
  }

  if (!(KEEP_ALIVE && REAL)) process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
