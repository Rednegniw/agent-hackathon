import { Daytona, type Sandbox } from '@daytona/sdk'
import type { AgentSandbox } from './arena.js'
import { BaseArena, waitForHealthy } from './arena-base.js'
import type { AgentId } from './events.js'
import type { EventLog } from './log.js'
import type { PhaseClock } from './phases.js'

const CAP = 2000
const CMD_TIMEOUT_S = 60
const URL_TTL_S = 3600

/**
 * KEEP_ALIVE=1 is the demo setting. It disables auto-stop and skips teardown
 * so the sandboxes behind the winning preview URLs still exist at 16:00.
 * See ARENA.md, "The lifecycle trap".
 */
export const KEEP_ALIVE = process.env.KEEP_ALIVE === '1'

/**
 * Hard wall-clock lifetime for every sandbox, KEEP_ALIVE included. Long enough
 * to build, judge and then pitch from the same round; short enough that a
 * forgotten round cannot still be holding vCPU tomorrow.
 */
export const TTL_MINUTES = Number(process.env.SANDBOX_TTL_MINUTES ?? 180)

class DaytonaSandbox implements AgentSandbox {
  constructor(
    private sandbox: Sandbox,
    private agentId: AgentId,
  ) {}

  get id() {
    return this.sandbox.id
  }

  destroy(): Promise<void> {
    return this.sandbox.delete()
  }

  async bash(command: string): Promise<string> {
    /**
     * Signature is (command, cwd?, env?, timeout?) and timeout is SECONDS as
     * the FOURTH positional. The SDK's own JSDoc example passes it third,
     * where it lands in `env` and is silently dropped. Do not copy that.
     */
    const res = await this.sandbox.process.executeCommand(command, undefined, undefined, CMD_TIMEOUT_S)
    const out = (res.result ?? '').slice(0, CAP)

    if (res.exitCode !== 0) throw new Error(`exit ${res.exitCode}: ${out}`)
    return out
  }

  async write(path: string, content: string): Promise<void> {
    /**
     * Paths are relative to /home/daytona. Strip a leading ~ or / so an
     * agent writing "/app/index.html" does not escape to the real root.
     */
    const remote = path.replace(/^[~/]+/, '')
    await this.sandbox.fs.uploadFile(Buffer.from(content, 'utf8'), remote)
  }

  async preview(port: number): Promise<string> {
    /**
     * getSignedPreviewUrl is a SEPARATE method from getPreviewLink, not a
     * flag on it. The plain variant returns 401 without a token header, which
     * an iframe cannot send. Default TTL is 60s, so passing one is required.
     */
    const { url } = await this.sandbox.getSignedPreviewUrl(port, URL_TTL_S)
    return waitForHealthy(url)
  }
}

export class DaytonaArena extends BaseArena {
  #daytona: Daytona
  #pool = new Map<AgentId, DaytonaSandbox>()
  #runId: string

  constructor(log: EventLog, clock: PhaseClock, runId: string) {
    super(log, clock)

    const apiKey = process.env.DAYTONA_API_KEY
    if (!apiKey) throw new Error('DAYTONA_API_KEY is not set. Copy .env.example to .env.')

    this.#daytona = new Daytona({ apiKey })
    this.#runId = runId
  }

  /**
   * Creates one sandbox per agent, concurrently. Measured at ~1.5s for six.
   * Tolerant of individual failures: one agent losing its sandbox must not
   * take down the other five.
   */
  async provision(agentIds: readonly AgentId[]): Promise<AgentId[]> {
    const started = Date.now()

    /**
     * The account has a hard total-vCPU cap (10 at the time of writing, so
     * roughly ten default sandboxes). Sandboxes left running by a previous
     * KEEP_ALIVE round silently eat that budget, and provisioning then fails
     * with "Total CPU limit exceeded" for every agent at once. Observed live:
     * ten orphans from earlier runs took a whole round to 0/4.
     *
     * Warn loudly rather than deleting anything: the orphans might be the
     * sandboxes behind a pitch we are about to give.
     */
    try {
      let existing = 0
      for await (const _ of this.#daytona.list()) existing++

      if (existing) {
        console.warn(
          `[daytona] ${existing} sandbox(es) already running before this round. ` +
            `The account caps total vCPU, so this round may fail to provision.`,
        )
        console.warn(`[daytona] reclaim them first: pnpm --filter arena cleanup`)
      }
    } catch {
      // A failed preflight must never block a round.
    }

    const results = await Promise.allSettled(
      agentIds.map(async (id) => {
        const sandbox = await this.#daytona.create({
          labels: { round: this.#runId, agent: id },

          // ephemeral deletes on stop; autoStopInterval is in MINUTES.
          ephemeral: !KEEP_ALIVE,
          autoStopInterval: KEEP_ALIVE ? 0 : 30,

          /**
           * The backstop that makes cleanup unconditional. ttlMinutes is
           * wall-clock since creation and destroys the sandbox even if it is
           * stopped, paused or archived, so nothing survives a killed process,
           * a crashed teardown, or a KEEP_ALIVE round nobody reclaimed.
           * Without it orphans accumulate silently until the account's vCPU
           * cap fails an entire round at once.
           */
          ttlMinutes: TTL_MINUTES,
        })

        this.#pool.set(id, new DaytonaSandbox(sandbox, id))
        return id
      }),
    )

    const ready: AgentId[] = []
    for (const [i, r] of results.entries()) {
      if (r.status === 'fulfilled') {
        ready.push(r.value)
      } else {
        const id = agentIds[i]
        console.error(`[daytona] ${id} failed to provision:`, r.reason?.message ?? r.reason)
        this.emit({ agentId: 'system', kind: 'phase', body: `${id} could not be provisioned and sits this round out` })
      }
    }

    console.log(
      `[daytona] ${ready.length}/${agentIds.length} sandboxes in ${Date.now() - started}ms` +
        (KEEP_ALIVE ? ' (KEEP_ALIVE: they will outlive this process)' : ''),
    )
    return ready
  }

  /**
   * Teardown normally lives in a finally, which a killed process never
   * reaches. Every orphan we have accumulated came from exactly that: a run
   * interrupted mid-round. These handlers close the gap for the signals we can
   * catch; ttlMinutes covers SIGKILL and crashes, which we cannot.
   */
  installExitGuards(): void {
    if (KEEP_ALIVE) return

    let running = false
    const bail = async (signal: string) => {
      if (running) return
      running = true

      console.log(`\n[daytona] ${signal}: reclaiming ${this.#pool.size} sandbox(es)...`)
      await this.teardown()
      process.exit(130)
    }

    process.once('SIGINT', () => void bail('SIGINT'))
    process.once('SIGTERM', () => void bail('SIGTERM'))
  }

  sandboxFor(agentId: AgentId): AgentSandbox {
    const s = this.#pool.get(agentId)
    if (!s) throw new Error(`no sandbox for ${agentId}: provision() first, or it failed to create`)
    return s
  }

  has(agentId: AgentId): boolean {
    return this.#pool.has(agentId)
  }

  /** Re-mints signed URLs before the pitch. Only works if sandboxes still exist. */
  async refreshPreviews(port = 3000): Promise<Record<string, string>> {
    const out: Record<string, string> = {}

    for (const [id, box] of this.#pool) {
      try {
        out[id] = await box.preview(port)
      } catch (err) {
        console.error(`[daytona] could not refresh ${id}:`, (err as Error).message)
      }
    }
    return out
  }

  async teardown() {
    if (KEEP_ALIVE) {
      const ids = [...this.#pool.values()].map((s) => s.id)
      console.log(`[daytona] KEEP_ALIVE set, leaving ${ids.length} sandboxes running.`)
      console.log(`[daytona] clean up later by label round=${this.#runId}`)
      return
    }

    // allSettled, never all: one failed delete must not orphan the rest.
    const results = await Promise.allSettled([...this.#pool.values()].map((s) => s.destroy()))

    /**
     * An ephemeral sandbox auto-deletes when it stops, so by teardown it may
     * already be gone and delete() rejects with a not-found. That is success,
     * not failure. Reporting it as a leak trains everyone to ignore the
     * warning, which is exactly when a real leak slips past.
     */
    const real = results.filter(
      (r) => r.status === 'rejected' && !/not.?found|404|does not exist/i.test(String(r.reason?.message ?? r.reason)),
    )

    if (real.length) {
      console.error(`[daytona] ${real.length} sandbox deletes failed. Clean up: pnpm --filter arena cleanup ${this.#runId}`)
      for (const r of real) console.error('  ', (r as PromiseRejectedResult).reason?.message)
    }
    this.#pool.clear()
  }
}
