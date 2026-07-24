import type { BaseArena } from './arena-base.js'
import { DaytonaArena, KEEP_ALIVE } from './arena-daytona.js'
import { FakeArena } from './arena-fake.js'
import { AGENT_IDS, TRACKS, type AgentId, type Track } from './events.js'
import type { EventLog } from './log.js'
import { PhaseClock, sequenceAt, sleep } from './phases.js'

/**
 * One scripted round, startable on demand from the office.
 *
 * The agents here are scripted, not LLM-driven: they exercise the whole
 * substrate (claim a track, write a file, serve it, resolve a signed preview
 * URL, submit) without spending a token. When the real agent loop lands it
 * replaces `agentScript` and nothing else in this file has to change.
 */

export const ARENA_KINDS = ['fake', 'daytona'] as const
export type ArenaKind = (typeof ARENA_KINDS)[number]

export type RoundState = 'idle' | 'running' | 'done' | 'failed'

/** The task every agent builds. Deliberately the smallest thing that ships. */
const PORT = 3000

const helloPage = (id: AgentId) =>
  `<!doctype html>
<meta charset="utf-8">
<title>${id}</title>
<style>
  body { margin:0; display:grid; place-items:center; min-height:100vh;
         font-family:system-ui,sans-serif; background:#111; color:#eee }
  h1 { font-size:clamp(2rem,10vw,6rem); margin:0 }
  p  { opacity:.6; letter-spacing:.2em; text-transform:uppercase; font-size:.8rem }
</style>
<h1>Hello world</h1>
<p>from ${id}</p>`

const PICKS: Record<AgentId, Track> = {
  ada: 'alpha',
  rex: 'beta',
  juno: 'alpha',
  iris: 'beta',
  otto: 'alpha',
  vera: 'beta',
}

export interface StartOptions {
  arena: ArenaKind
  /** Divides the real phase durations. 25 turns a ~14 minute round into ~34s. */
  speed: number
}

export const DEFAULT_START: StartOptions = { arena: 'daytona', speed: 25 }

/**
 * Coerces an untrusted request body into StartOptions. An unknown arena name
 * is rejected rather than defaulted: silently running a fake round when the
 * operator asked for Daytona is the kind of thing you discover on stage.
 */
export function parseStartOptions(body: { arena?: unknown; speed?: unknown }): StartOptions | { error: string } {
  const arena = body.arena ?? DEFAULT_START.arena
  if (typeof arena !== 'string' || !ARENA_KINDS.includes(arena as ArenaKind)) {
    return { error: `arena must be one of: ${ARENA_KINDS.join(', ')}` }
  }

  const raw = body.speed ?? DEFAULT_START.speed
  const speed = Number(raw)
  if (!Number.isFinite(speed) || speed < 1 || speed > 200) {
    return { error: 'speed must be a number between 1 and 200' }
  }

  return { arena: arena as ArenaKind, speed }
}

export interface RoundStatus {
  state: RoundState
  arena: ArenaKind | null
  roundId: string | null
  phase: string
  tracks: Record<string, Track>
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

/**
 * Owns the "is a round in flight" question. The HTTP layer asks this and
 * nothing else, so a double-clicked button cannot start two rounds racing for
 * the same sandboxes.
 */
export class RoundRunner {
  #log: EventLog
  #state: RoundState = 'idle'
  #arena?: BaseArena
  #clock?: PhaseClock
  #kind: ArenaKind | null = null
  #roundId: string | null = null
  #startedAt: number | null = null
  #finishedAt: number | null = null
  #error: string | null = null

  constructor(log: EventLog) {
    this.#log = log
  }

  status(): RoundStatus {
    return {
      state: this.#state,
      arena: this.#kind,
      roundId: this.#roundId,
      phase: this.#clock?.phase() ?? 'idle',
      tracks: this.#arena?.snapshot() ?? {},
      startedAt: this.#startedAt,
      finishedAt: this.#finishedAt,
      error: this.#error,
    }
  }

  /**
   * Kicks a round off and returns immediately. The caller gets an ack, not a
   * result: everything that happens next is visible on the event stream, which
   * is the whole point of the append-only log.
   */
  start(opts: StartOptions): { ok: true; roundId: string } | { ok: false; reason: string } {
    if (this.#state === 'running') {
      return { ok: false, reason: `a round is already running (${this.#roundId})` }
    }

    const roundId = new Date().toISOString().replace(/[:.]/g, '-')

    this.#state = 'running'
    this.#kind = opts.arena
    this.#roundId = roundId
    this.#startedAt = Date.now()
    this.#finishedAt = null
    this.#error = null

    // Deliberately not awaited: the HTTP response must not wait out the round.
    void this.#run(roundId, opts)

    return { ok: true, roundId }
  }

  async #run(roundId: string, opts: StartOptions) {
    const clock = new PhaseClock(sequenceAt(opts.speed))
    const arena: BaseArena =
      opts.arena === 'daytona'
        ? new DaytonaArena(this.#log, clock, roundId)
        : new FakeArena(this.#log, clock)

    this.#clock = clock
    this.#arena = arena

    clock.onPhase(async (phase) => {
      this.#log.emit({ agentId: 'system', kind: 'phase', body: phase })
      console.log(`[round ${roundId}] phase ${phase}`)

      /**
       * Sandboxes are provisioned lazily at the end of mingle, once tracks are
       * settled. Nothing is created for an agent that never got going.
       */
      if (phase === 'build') {
        arena.assignStragglers(AGENT_IDS)
        if (arena instanceof DaytonaArena) await arena.provision(AGENT_IDS)
      }
    })

    try {
      await Promise.all([
        clock.run(),
        ...AGENT_IDS.map((id) =>
          this.#agentScript(arena, clock, id, opts.arena).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[round ${roundId}] ${id}:`, msg)
            this.#log.emit({ agentId: id, kind: 'thought', body: `failed: ${msg}` })
          }),
        ),
      ])

      this.#log.emit({ agentId: 'system', kind: 'score', body: 'round complete' })
      this.#state = 'done'
    } catch (err) {
      this.#error = err instanceof Error ? err.message : String(err)
      this.#log.emit({ agentId: 'system', kind: 'score', body: `round failed: ${this.#error}` })
      this.#state = 'failed'
    } finally {
      this.#finishedAt = Date.now()

      /**
       * Teardown always runs, even on failure. Without it a failed round leaks
       * six sandboxes, and the next click leaks six more.
       */
      try {
        if (arena instanceof DaytonaArena) await arena.teardown()
        else await (arena as FakeArena).teardown()
      } catch (err) {
        console.error(`[round ${roundId}] teardown failed:`, err)
      }

      const secs = ((this.#finishedAt - (this.#startedAt ?? this.#finishedAt)) / 1000).toFixed(1)
      console.log(`[round ${roundId}] ${this.#state} in ${secs}s`)
    }
  }

  /** One agent: pick a track, build Hello world, serve it, submit the URL. */
  async #agentScript(arena: BaseArena, clock: PhaseClock, id: AgentId, kind: ArenaKind) {
    await sleep(300 + Math.floor(Math.random() * 900))

    // ---- mingle ----
    this.#log.emit({ agentId: id, kind: 'thought', body: `Weighing ${TRACKS.join(' against ')}.` })

    const want = PICKS[id]
    const res = arena.claimTrack(id, want)

    if (res.ok) {
      this.#log.emit({ agentId: id, kind: 'theme', body: want, track: want })
    } else {
      const fallback = res.open[0]
      this.#log.emit({ agentId: id, kind: 'thought', body: `${res.reason}. Taking ${fallback}.` })
      arena.claimTrack(id, fallback)
      this.#log.emit({ agentId: id, kind: 'theme', body: fallback, track: fallback })
    }

    const rival = AGENT_IDS.find((o) => o !== id && PICKS[o] === arena.trackOf(id))
    if (rival) {
      this.#log.emit({ agentId: id, kind: 'message', targetId: rival, body: 'Shipping a hello world. You?' })
    }

    // ---- build ----
    while (clock.phase() === 'mingle') await sleep(200)

    if (kind === 'daytona' && !(arena as DaytonaArena).has(id)) {
      this.#log.emit({ agentId: id, kind: 'thought', body: 'No sandbox. Sitting this round out.' })
      return
    }

    const box = arena.sandboxFor(id)

    await box.write('app/index.html', helloPage(id))
    this.#log.emit({ agentId: id, kind: 'build', body: 'wrote app/index.html' })

    /**
     * nohup plus & is required. Without backgrounding, executeCommand blocks
     * until the 60s timeout and the agent loses its build phase. FakeArena
     * ignores the command and serves the directory itself.
     */
    await box.bash(`cd ~/app && nohup python3 -m http.server ${PORT} >/tmp/serve.log 2>&1 & sleep 1; echo up`)
    this.#log.emit({ agentId: id, kind: 'build', body: `dev server started on ${PORT}` })

    // ---- submit ----
    while (clock.phase() !== 'submit') await sleep(200)

    try {
      const url = await box.preview(PORT)
      this.#log.emit({
        agentId: id,
        kind: 'submit',
        body: 'Hello world, shipped.',
        track: arena.trackOf(id),
        previewUrl: url,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.#log.emit({ agentId: id, kind: 'thought', body: `submission failed: ${msg}` })
    }
  }
}

export { KEEP_ALIVE }
