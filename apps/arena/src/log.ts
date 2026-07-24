import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent, NewEvent } from './events.js'

const RUNS_DIR = join(process.cwd(), 'runs')

/**
 * Append-only event log. The spine of the whole system: the office is a
 * renderer over this, and the on-disk file is the demo's fallback if a live
 * run fails on stage.
 */
export class EventLog {
  #events: AgentEvent[] = []
  #seq = 0
  #subs = new Set<(e: AgentEvent) => void>()
  #file: string

  constructor(runId: string) {
    mkdirSync(RUNS_DIR, { recursive: true })

    /**
     * One file per run. #seq restarts at 1 in every process, so appending
     * every run to one shared file interleaves duplicate seq numbers and
     * silently corrupts the artifact the demo falls back on.
     */
    this.#file = join(RUNS_DIR, `events-${runId}.jsonl`)
  }

  get file() {
    return this.#file
  }

  emit(partial: NewEvent): AgentEvent {
    const e: AgentEvent = { ...partial, seq: ++this.#seq, ts: Date.now() }
    this.#events.push(e)

    // Sync on purpose: async writes can interleave and corrupt the replay file.
    appendFileSync(this.#file, JSON.stringify(e) + '\n')

    /**
     * A throwing subscriber must not propagate. emit() is called from inside
     * agent tool handlers, so one bad callback (a TTS hook, a write to a
     * just-closed SSE response) would blow up the agent's turn and starve
     * every subscriber after it.
     */
    for (const fn of this.#subs) {
      try {
        fn(e)
      } catch (err) {
        console.error('[log] subscriber threw:', err)
      }
    }

    return e
  }

  /** Defensive copy: a caller that sorts or splices must not corrupt the log. */
  all(): AgentEvent[] {
    return [...this.#events]
  }

  since(seq: number): AgentEvent[] {
    return this.#events.filter((e) => e.seq > seq)
  }

  /**
   * The highest seq emitted so far. The log is never truncated — one process
   * appends every round to it — so a round records this at its start and the
   * office hides everything at or below it. That is how "start a new round"
   * clears the office without asking the log to forget anything.
   */
  head(): number {
    return this.#seq
  }

  subscribe(fn: (e: AgentEvent) => void): () => void {
    this.#subs.add(fn)
    return () => this.#subs.delete(fn)
  }
}

/** Reads a saved run back for replay. Powers the demo fallback. */
export function loadRun(file: string): AgentEvent[] {
  if (!existsSync(file)) throw new Error(`no such run: ${file}`)
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AgentEvent)
}
