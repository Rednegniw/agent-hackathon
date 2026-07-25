import './env.js'
import { EventLog, loadRun } from './log.js'
import { startServer } from './server.js'
import { sleep } from './phases.js'
import type { Phase } from './events.js'

/**
 * Replays a recorded run into a live server, so the office can be developed
 * and demoed with no agents, no sandboxes and no tokens.
 *
 *   pnpm --filter arena replay ../../fixtures/judged-run.jsonl
 *   REPLAY_SPEED=4 pnpm --filter arena replay <file>
 *
 * Original inter-event gaps are preserved (divided by REPLAY_SPEED) so the
 * round paces like the real thing rather than dumping in one frame.
 */

const file = process.argv[2] ?? '../../fixtures/judged-run.jsonl'
const speed = Math.max(1, Number(process.env.REPLAY_SPEED ?? 8))

/** Longest we ever wait between two events, however long the real gap was. */
const MAX_GAP_MS = 4000

const runId = new Date().toISOString().replace(/[:.]/g, '-')
const log = new EventLog(runId)
const source = loadRun(file)

let phase: Phase = 'idle'
let phaseStartedAt: number | null = null

startServer({
  log,
  state: () => ({
    state: phase === 'judged' ? 'done' : 'running',
    arena: 'fake',
    roundId: runId,
    phase,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    phaseStartedAt,
    phaseDurationMs: null,
    run: runId,
    file: log.file,
  }),
})

const PHASES = ['idle', 'mingle', 'build', 'submit', 'judging', 'judged']

async function run() {
  console.log(`[replay] ${source.length} events from ${file} at ${speed}x`)

  for (const [i, e] of source.entries()) {
    const prev = source[i - 1]
    if (prev) await sleep(Math.min(MAX_GAP_MS, Math.max(0, e.ts - prev.ts) / speed))

    /**
     * The phase a replay reports comes from its own phase events, since there
     * is no clock driving it. Bodies like "judging 3 entries with 3 jurors"
     * are notes, not transitions, so only exact phase names count.
     */
    if (e.kind === 'phase' && PHASES.includes(e.body)) {
      phase = e.body as Phase
      phaseStartedAt = Date.now()
    }

    const { seq: _seq, ts: _ts, ...rest } = e
    log.emit(rest)
  }

  console.log('[replay] done. The office keeps serving; ctrl-c to stop.')
}

void run()
