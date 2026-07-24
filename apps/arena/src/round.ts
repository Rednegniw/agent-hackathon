import { runAgent } from './agent.js'
import type { BaseArena } from './arena-base.js'
import { DaytonaArena, KEEP_ALIVE } from './arena-daytona.js'
import { FakeArena } from './arena-fake.js'
import { AGENT_IDS, type AgentId, type Phase } from './events.js'
import { runEvaluation } from './judge.js'
import type { EventLog } from './log.js'
import { PhaseClock, defaultDurations, sequenceOf, sleep, type Durations } from './phases.js'
import { canFilm, captureShots, recordPitch, type ShotSpec } from './studio.js'
import { TOPIC, setTopic } from './topic.js'

/**
 * One round, startable on demand from the office.
 *
 * Two flavours, because they answer different questions:
 *
 * - `scripted` agents exercise the whole substrate (claim a track, write a
 *   file, serve it, resolve a signed preview URL, submit) without spending a
 *   token. Their output is fixed, so the brief only decorates the page.
 * - `real` agents are the Claude Agent SDK loop in agent.ts. These are the
 *   ones the brief actually drives, and they cost tokens on every round.
 */

export const ARENA_KINDS = ['fake', 'daytona'] as const
export type ArenaKind = (typeof ARENA_KINDS)[number]

export const AGENT_KINDS = ['scripted', 'real'] as const
export type AgentKind = (typeof AGENT_KINDS)[number]

export type RoundState = 'idle' | 'running' | 'done' | 'failed'

const PORT = 3000

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Phases in the order the clock visits them. */
const PHASE_ORDER: Phase[] = ['idle', 'mingle', 'build', 'submit', 'judging', 'judged']

/** True once the round has reached `target`, including having gone past it. */
const atOrPast = (current: Phase, target: Phase) =>
  PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(target)

/**
 * What a scripted agent ships. It cannot actually answer a brief, so it shows
 * the brief instead — that way a free round still proves the prompt reached
 * the arena, without pretending the agent understood it.
 */
const helloPage = (id: AgentId, brief: string) =>
  `<!doctype html>
<meta charset="utf-8">
<title>${id}</title>
<style>
  body { margin:0; display:grid; place-items:center; min-height:100vh; gap:1rem;
         font-family:system-ui,sans-serif; background:#111; color:#eee; text-align:center }
  h1 { font-size:clamp(2rem,10vw,6rem); margin:0 }
  p  { opacity:.6; letter-spacing:.2em; text-transform:uppercase; font-size:.8rem; margin:0 }
  blockquote { max-width:34rem; margin:0; padding:0 1.5rem; opacity:.45; font-size:.9rem; line-height:1.5 }
</style>
<h1>Hello world</h1>
<p>from ${id}</p>
<blockquote>${escape(brief)}</blockquote>`


export interface StartOptions {
  arena: ArenaKind
  agents: AgentKind

  /** How many agents compete. Taken from the front of AGENT_IDS. */
  agentCount: number

  /** Phase lengths in seconds. The office sets these directly. */
  durations: Durations

  /** The brief. Blank falls back to $TOPIC, then the built-in default. */
  topic?: string
  model: string

  /**
   * Leave the sandboxes running after the round. Teardown deletes them, which
   * kills every preview URL the round produced — so any round you intend to
   * click through, demo or screenshot needs this on. Costs real resources
   * until cleaned up, so it is off by default.
   */
  keepAlive: boolean
}

/** Real agents need minutes to think; scripted ones are done in seconds. */
export const SCRIPTED_DURATIONS: Durations = { mingle: 4, build: 30, submit: 8 }

/**
 * Submit is 90s rather than 60 because it is no longer just a health check:
 * the agent screenshots its product and films a narrated pitch inside that
 * window, which measures at 15-20s of tool time on top of its own turns.
 */
export const REAL_DURATIONS: Durations = { mingle: 20, build: 240, submit: 90 }

/**
 * Four, not six. Six personas exist and the office can still ask for them, but
 * a default round stays inside the account's vCPU budget with room for the
 * orphans a keep-alive round leaves behind — and four decks filmed at the end
 * of one submit phase also sits comfortably inside the TTS concurrency cap.
 */
export const DEFAULT_AGENTS = 4

export const DEFAULT_START: StartOptions = {
  arena: 'daytona',
  agents: 'scripted',
  agentCount: DEFAULT_AGENTS,
  durations: SCRIPTED_DURATIONS,
  model: process.env.MODEL ?? 'claude-haiku-4-5',
  keepAlive: KEEP_ALIVE,
}

/** A brief longer than this is a copy-paste accident, not a prompt. */
const MAX_TOPIC = 2000

/** An hour per phase is already absurd; beyond that it is a typo. */
const MAX_PHASE_S = 3600

export interface StartBody {
  arena?: unknown
  /** Legacy multiplier. Only used when `durations` is absent. */
  speed?: unknown
  agents?: unknown
  agentCount?: unknown
  durations?: unknown
  topic?: unknown
  model?: unknown
  keepAlive?: unknown
}

function parseDurations(raw: unknown, fallback: Durations): Durations | { error: string } {
  if (raw === undefined) return fallback
  if (typeof raw !== 'object' || raw === null) return { error: 'durations must be an object' }

  const out = {} as Durations
  for (const key of ['mingle', 'build', 'submit'] as const) {
    const v = Number((raw as Record<string, unknown>)[key] ?? fallback[key])

    /**
     * Zero is rejected rather than clamped. A zero-length build phase looks
     * like it works — the round completes — but every agent silently loses
     * its turn, and the empty result reads as an agent failure.
     */
    if (!Number.isFinite(v) || v < 1 || v > MAX_PHASE_S) {
      return { error: `durations.${key} must be between 1 and ${MAX_PHASE_S} seconds` }
    }
    out[key] = v
  }
  return out
}

/**
 * Coerces an untrusted request body into StartOptions. An unknown arena name
 * is rejected rather than defaulted: silently running a fake round when the
 * operator asked for Daytona is the kind of thing you discover on stage. The
 * same goes for the agent kind — defaulting a `real` typo to `scripted` would
 * quietly produce a round that ignores the brief.
 */
export function parseStartOptions(body: StartBody): StartOptions | { error: string } {
  const arena = body.arena ?? DEFAULT_START.arena
  if (typeof arena !== 'string' || !ARENA_KINDS.includes(arena as ArenaKind)) {
    return { error: `arena must be one of: ${ARENA_KINDS.join(', ')}` }
  }

  const agents = body.agents ?? DEFAULT_START.agents
  if (typeof agents !== 'string' || !AGENT_KINDS.includes(agents as AgentKind)) {
    return { error: `agents must be one of: ${AGENT_KINDS.join(', ')}` }
  }

  const kind = agents as AgentKind

  /**
   * Roster size is capped by how many personas exist and by track capacity,
   * and floored at one so a round always has someone in it.
   */
  const agentCount = Number(body.agentCount ?? DEFAULT_START.agentCount)
  if (!Number.isInteger(agentCount) || agentCount < 1 || agentCount > AGENT_IDS.length) {
    return { error: `agentCount must be a whole number between 1 and ${AGENT_IDS.length}` }
  }

  /**
   * `speed` is still honoured when no explicit durations arrive, so the env
   * var, AUTOSTART and any existing caller keep working.
   */
  const fallback =
    body.speed !== undefined
      ? defaultDurations(Number(body.speed))
      : kind === 'real'
        ? REAL_DURATIONS
        : SCRIPTED_DURATIONS

  if (body.speed !== undefined) {
    const s = Number(body.speed)
    if (!Number.isFinite(s) || s < 1 || s > 200) {
      return { error: 'speed must be a number between 1 and 200' }
    }
  }

  const durations = parseDurations(body.durations, fallback)
  if ('error' in durations) return durations

  if (body.topic !== undefined && typeof body.topic !== 'string') {
    return { error: 'topic must be a string' }
  }
  if (typeof body.topic === 'string' && body.topic.length > MAX_TOPIC) {
    return { error: `topic must be ${MAX_TOPIC} characters or fewer` }
  }

  const model = body.model ?? DEFAULT_START.model
  if (typeof model !== 'string' || !model.trim()) {
    return { error: 'model must be a non-empty string' }
  }

  const keepAlive = body.keepAlive ?? DEFAULT_START.keepAlive
  if (typeof keepAlive !== 'boolean') {
    return { error: 'keepAlive must be a boolean' }
  }

  return {
    arena: arena as ArenaKind,
    agents: kind,
    agentCount,
    durations,
    topic: typeof body.topic === 'string' ? body.topic : undefined,
    model,
    keepAlive,
  }
}

export interface RoundStatus {
  state: RoundState
  arena: ArenaKind | null
  agents: AgentKind | null
  /** The brief actually in force, after fallbacks. The office echoes this. */
  topic: string
  /** False means this round's preview URLs die when it ends. */
  keepAlive: boolean
  agentCount: number
  durations: Durations
  roundId: string | null
  phase: string
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  /** Countdown data: when the current phase began and how long it runs. */
  phaseStartedAt: number | null
  phaseDurationMs: number | null
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
  #agents: AgentKind | null = null
  #keepAlive = false
  #agentCount = 0
  #durations: Durations = DEFAULT_START.durations
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
      agents: this.#agents,
      topic: TOPIC,
      keepAlive: this.#keepAlive,
      agentCount: this.#agentCount,
      durations: this.#durations,
      roundId: this.#roundId,
      phase: this.#clock?.phase() ?? 'idle',
      startedAt: this.#startedAt,
      finishedAt: this.#finishedAt,
      error: this.#error,
      phaseStartedAt: this.#clock?.phaseStartedAt ?? null,
      phaseDurationMs: this.#clock?.phaseDurationMs ?? null,
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

    /**
     * Set the brief before anything reads it. agent.ts and judge.ts pick it up
     * through live bindings, so this must happen before the first agent turn.
     */
    const brief = setTopic(opts.topic)

    this.#state = 'running'
    this.#kind = opts.arena
    this.#agents = opts.agents
    this.#keepAlive = opts.keepAlive && opts.arena === 'daytona'
    this.#agentCount = opts.agentCount
    this.#durations = opts.durations
    this.#roundId = roundId
    this.#startedAt = Date.now()
    this.#finishedAt = null
    this.#error = null

    this.#log.emit({ agentId: 'system', kind: 'phase', body: `brief: ${brief}` })

    /**
     * Deliberately not awaited: the HTTP response must not wait out the round.
     * The catch is load-bearing — anything that throws before #run's own try
     * block (a missing DAYTONA_API_KEY, for one) would otherwise surface as an
     * unhandled rejection and take the whole server down with it.
     */
    void this.#run(roundId, opts).catch((err: unknown) => {
      this.#error = err instanceof Error ? err.message : String(err)
      this.#state = 'failed'
      this.#finishedAt = Date.now()
      this.#log.emit({ agentId: 'system', kind: 'score', body: `round failed: ${this.#error}` })
      console.error(`[round ${roundId}] failed to start:`, this.#error)
    })

    return { ok: true, roundId }
  }

  async #run(roundId: string, opts: StartOptions) {
    const clock = new PhaseClock(sequenceOf(opts.durations))
    const arena: BaseArena =
      opts.arena === 'daytona'
        ? new DaytonaArena(this.#log, clock, roundId, opts.keepAlive)
        : new FakeArena(this.#log, clock)

    this.#clock = clock
    this.#arena = arena

    /**
     * Taken from the front of AGENT_IDS so the roster is deterministic: the
     * same count always yields the same personas, which makes two rounds
     * comparable.
     */
    const roster: AgentId[] = AGENT_IDS.slice(0, opts.agentCount)

    clock.onPhase(async (phase) => {
      this.#log.emit({ agentId: 'system', kind: 'phase', body: phase })
      console.log(`[round ${roundId}] phase ${phase}`)

      /**
       * Sandboxes are provisioned lazily at the end of mingle. Nothing is
       * created for an agent that never got going.
       */
      if (phase === 'build') {
        if (arena instanceof DaytonaArena) await arena.provision(roster)
      }

    })

    const drive = (id: AgentId) =>
      opts.agents === 'real'
        ? runAgent(
            id,
            arena,
            roster.filter((o) => o !== id),
            opts.model,
            Number(process.env.MAX_TURNS ?? 30),
            { roundId },
          )
        : this.#agentScript(arena, clock, id, opts.arena, roundId)

    try {
      await Promise.all([
        clock.run(),
        ...roster.map((id) =>
          drive(id).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[round ${roundId}] ${id}:`, msg)
            this.#log.emit({ agentId: id, kind: 'thought', body: `failed: ${msg}` })
          }),
        ),
      ])

      /**
       * After every agent has stopped, and before teardown deletes the
       * sandboxes. Waiting for the agents matters: filming at the 'judged'
       * transition instead would race an agent still recording its own pitch
       * and film the same submission twice.
       */
      await this.#fillMissingPitches(arena, roundId)

      /**
       * The evaluator round, then close the clock.
       *
       * Both halves are load-bearing. PhaseClock.run() deliberately stops at
       * 'judging' and waits for its caller to drive the evaluation, so a
       * runner that never judges leaves /state reporting 'judging' forever —
       * the office shows "Round over · judging" and never reaches the
       * verdicts, the ranking or the crown. real.ts already did this; the
       * office's own runner did not, so nothing started from the Start button
       * was ever judged.
       */
      if (process.env.SKIP_JUDGING !== '1') {
        try {
          const { winner } = await runEvaluation(this.#log.all(), arena)
          if (winner) console.log(`[round ${roundId}] winner: ${winner.agentId} (${winner.total})`)
        } catch (err) {
          console.error(`[round ${roundId}] judging failed:`, (err as Error).message)
          this.#log.emit({ agentId: 'system', kind: 'score', body: `judging failed: ${(err as Error).message}` })
        }
      }

      this.#log.emit({ agentId: 'system', kind: 'score', body: 'round complete' })
      this.#state = 'done'
    } catch (err) {
      this.#error = err instanceof Error ? err.message : String(err)
      this.#log.emit({ agentId: 'system', kind: 'score', body: `round failed: ${this.#error}` })
      this.#state = 'failed'
    } finally {
      this.#finishedAt = Date.now()

      /**
       * In the finally, not the happy path: run() parks the clock on 'judging'
       * and only finish() moves it on, so a round that threw anywhere above
       * would otherwise leave the office reporting judging forever with no
       * round running to end it.
       */
      try {
        await clock.finish()
      } catch (err) {
        console.error(`[round ${roundId}] could not close the clock:`, (err as Error).message)
      }

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

  /**
   * Films a pitch for every agent that shipped but never recorded one.
   *
   * Real agents run out of turns, or spend the submit phase fixing a server,
   * and a missing video is indistinguishable on stage from a missing entry.
   * The copy here is deliberately plain — it is a stand-in for the agent's own
   * pitch, and it should not read like one.
   */
  async #fillMissingPitches(arena: BaseArena, roundId: string) {
    const events = this.#log.all()
    const filmed = new Set(events.filter((e) => e.kind === 'pitch').map((e) => e.agentId))

    const orphans = events.filter(
      (e) => e.kind === 'submit' && e.previewUrl && !filmed.has(e.agentId),
    )
    if (!orphans.length) return

    await Promise.all(
      orphans.map(async (sub) => {
        const id = sub.agentId as AgentId
        try {
          const box = arena.sandboxFor(id)
          if (!(await canFilm(box))) return

          const shots: ShotSpec[] = [
            { label: 'home', path: '/', viewport: 'desktop' },
            { label: 'mobile', path: '/', viewport: 'mobile' },
          ]

          /**
           * localhost first, the signed preview URL second. The agent's port
           * is not recorded anywhere, so a submission served on 8080 is only
           * reachable through the proxy — which is slower, but is the
           * difference between a video and no video.
           */
          let taken = await captureShots(box, `http://localhost:${PORT}`, shots)
          if (taken.every((s) => s.error)) {
            taken = await captureShots(box, sub.previewUrl!, shots)
          }

          const usable = taken.filter((s) => !s.error).map((s) => s.label)
          /**
           * Still the agent's voice, even though it never wrote this. The
           * submit pitch is already the agent speaking about its own work, so
           * it carries the first person for free — this only has to avoid
           * wrapping it in narration about the agent.
           */
          const pitch = await recordPitch(box, id, roundId, {
            title: 'What I shipped',
            tagline: sub.body.slice(0, 160),
            slides: [
              {
                shot: usable[0],
                headline: 'What I built',
                caption: sub.body.slice(0, 120),
                narration: `Here is what I built. ${sub.body.slice(0, 280)}`,
              },
            ],
          })

          this.#log.emit({
            agentId: id,
            kind: 'pitch',
            /**
             * The agent's own words only. That this deck was filmed for it is
             * a fact about the round, not something the agent says, and the
             * office renders this body as the caption under the video — so the
             * note goes to the operator's stream instead of into its mouth.
             */
            body: sub.body.slice(0, 160),
            videoUrl: pitch.videoUrl,
            posterUrl: pitch.posterUrl,
          })

          this.#log.emit({
            agentId: 'system',
            kind: 'phase',
            body: `${id} never filmed a pitch, so one was made from its submission`,
          })
        } catch (err) {
          console.warn(`[round ${roundId}] could not auto-film ${id}:`, (err as Error).message)
        }
      }),
    )
  }

  /** One agent: pick a track, build Hello world, serve it, submit the URL. */
  async #agentScript(arena: BaseArena, clock: PhaseClock, id: AgentId, kind: ArenaKind, roundId: string) {
    await sleep(300 + Math.floor(Math.random() * 900))

    // ---- mingle ----
    this.#log.emit({ agentId: id, kind: 'thought', body: 'Sizing up the brief.' })

    const rival = AGENT_IDS.find((o) => o !== id)
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

    await box.write('app/index.html', helloPage(id, TOPIC))
    this.#log.emit({ agentId: id, kind: 'build', body: 'wrote app/index.html' })

    /**
     * nohup plus & is required. Without backgrounding, executeCommand blocks
     * until the 60s timeout and the agent loses its build phase. FakeArena
     * ignores the command and serves the directory itself.
     */
    await box.bash(`cd ~/app && nohup python3 -m http.server ${PORT} >/tmp/serve.log 2>&1 & sleep 1; echo up`)
    this.#log.emit({ agentId: id, kind: 'build', body: `dev server started on ${PORT}` })

    // ---- submit ----
    /**
     * Wait for submit *or later*, never for submit exactly. An agent whose
     * build overran the phase arrives here when the clock already says
     * 'judged', and an equality check then spins forever: Promise.all never
     * settles, the round never finishes, and every later round is refused as
     * "already running". Being late is recoverable; hanging is not.
     */
    while (!atOrPast(clock.phase(), 'submit')) await sleep(200)

    try {
      const url = await box.preview(PORT)
      this.#log.emit({
        agentId: id,
        kind: 'submit',
        body: 'Hello world, shipped.',
        previewUrl: url,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.#log.emit({ agentId: id, kind: 'thought', body: `submission failed: ${msg}` })
      return
    }

    /**
     * Scripted agents film too. It costs no tokens and it is the only way the
     * studio path — chromium, ElevenLabs, ffmpeg, the media route, the office
     * player — gets exercised without spending a model call on it.
     */
    await this.#scriptedPitch(arena, id, roundId)
  }

  /** The scripted agent's deck. Fixed copy, real screenshots, real video. */
  async #scriptedPitch(arena: BaseArena, id: AgentId, roundId: string) {
    const box = arena.sandboxFor(id)

    try {
      if (!(await canFilm(box))) {
        this.#log.emit({ agentId: id, kind: 'thought', body: 'no studio in this arena, skipping the video' })
        return
      }

      const shots: ShotSpec[] = [
        { label: 'home', path: '/', viewport: 'desktop' },
        { label: 'phone', path: '/', viewport: 'mobile' },
      ]
      const taken = await captureShots(box, `http://localhost:${PORT}`, shots)
      const usable = taken.filter((s) => !s.error).map((s) => s.label)

      this.#log.emit({
        agentId: id,
        kind: 'shot',
        body: usable.length ? `captured ${usable.join(', ')}` : 'no screenshot rendered',
      })

      /**
       * First person throughout, because it is the agent's own voice reading
       * this aloud to the room. A deck that says "ada shipped a page" while
       * ada is the one speaking sounds like a narrator describing an exhibit.
       */
      const pitch = await recordPitch(box, id, roundId, {
        title: 'Hello world',
        tagline: 'I shipped one self-contained page, live, from my own sandbox.',
        slides: [
          {
            shot: usable[0],
            headline: 'What I built',
            caption: 'One file, served from a sandbox of my own.',
            narration: 'I built a single self-contained page and served it from my own sandbox.',
          },
          {
            shot: usable[1],
            headline: 'On a phone',
            caption: 'The same page, narrower.',
            narration:
              'Here it is again at phone width. I photographed it myself, with a real browser running inside my sandbox.',
          },
        ],
      })

      this.#log.emit({
        agentId: id,
        kind: 'pitch',
        body: 'Hello world — I shipped one self-contained page, live, from my own sandbox.',
        videoUrl: pitch.videoUrl,
        posterUrl: pitch.posterUrl,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.#log.emit({ agentId: id, kind: 'thought', body: `could not film a pitch: ${msg}` })
    }
  }
}

export { KEEP_ALIVE }
