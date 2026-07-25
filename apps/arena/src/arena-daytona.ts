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

/**
 * Paths are relative to /home/daytona. Strip a leading ~ or / so an agent
 * writing "/app/index.html" does not escape to the real root.
 */
const remotePath = (path: string) => path.replace(/^[~/]+/, '')

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
    await this.writeBytes(path, Buffer.from(content, 'utf8'))
  }

  async writeBytes(path: string, content: Uint8Array): Promise<void> {
    await this.sandbox.fs.uploadFile(Buffer.from(content), remotePath(path))
  }

  async read(path: string): Promise<Uint8Array> {
    return new Uint8Array(await this.sandbox.fs.downloadFile(remotePath(path)))
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
  #keepAlive: boolean

  /**
   * `keepAlive` defaults to the KEEP_ALIVE env var so command-line runs are
   * unchanged, but it is per-instance because a round started from the office
   * decides this per round: teardown deletes the sandboxes behind the preview
   * URLs, so a round you intend to click through has to opt out of it.
   */
  constructor(log: EventLog, clock: PhaseClock, runId: string, keepAlive = KEEP_ALIVE) {
    super(log, clock)

    const apiKey = process.env.DAYTONA_API_KEY
    if (!apiKey) throw new Error('DAYTONA_API_KEY is not set. Copy .env.example to .env.')

    this.#daytona = new Daytona({ apiKey })
    this.#runId = runId
    this.#keepAlive = keepAlive
  }

  get keepAlive(): boolean {
    return this.#keepAlive
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
          ephemeral: !this.#keepAlive,
          autoStopInterval: this.#keepAlive ? 0 : 30,

          /**
           * The backstop that makes cleanup unconditional. ttlMinutes is
           * wall-clock since creation and destroys the sandbox even if it is
           * stopped, paused or archived, so nothing survives a killed process,
           * a crashed teardown, or a keep-alive round nobody reclaimed.
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
        (this.#keepAlive ? ' (keep-alive: they will outlive this round)' : ''),
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
    // Per-round, not the env var: a keep-alive round wants to survive the
    // process exiting, which is the whole reason its URLs stay clickable.
    if (this.#keepAlive) return

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

  async teardown() {
    if (this.#keepAlive) {
      const ids = [...this.#pool.values()].map((s) => s.id)
      console.log(`[daytona] keep-alive set, leaving ${ids.length} sandboxes running.`)
      console.log(`[daytona] preview URLs stay live. Clean up with:`)
      console.log(`[daytona]   pnpm --filter arena cleanup ${this.#runId}`)
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
