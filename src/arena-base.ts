import type { Arena, AgentSandbox, ClaimResult } from './arena.js'
import { TRACKS, TRACK_CAPACITY, type AgentEvent, type AgentId, type NewEvent, type Phase, type Track } from './events.js'
import type { EventLog } from './log.js'
import type { PhaseClock } from './phases.js'

/** Logic shared by the fake and real arenas. Only sandboxFor differs. */
export abstract class BaseArena implements Arena {
  protected tracks = new Map<AgentId, Track>()

  constructor(
    protected log: EventLog,
    protected clock: PhaseClock,
  ) {}

  abstract sandboxFor(agentId: AgentId): AgentSandbox

  emit(e: NewEvent): AgentEvent {
    return this.log.emit(e)
  }

  phase(): Phase {
    return this.clock.phase()
  }

  trackOf(agentId: AgentId): Track | undefined {
    return this.tracks.get(agentId)
  }

  openTracks(): Track[] {
    return TRACKS.filter((t) => this.countIn(t) < TRACK_CAPACITY)
  }

  countIn(track: Track): number {
    let n = 0
    for (const t of this.tracks.values()) if (t === track) n++
    return n
  }

  claimTrack(agentId: AgentId, track: Track): ClaimResult {
    const existing = this.tracks.get(agentId)

    /**
     * Idempotent ONLY for the same track. Returning ok for a different one
     * would let the tool emit a `theme` event that disagrees with trackOf(),
     * so the office and the per-track judge would file the entry under the
     * wrong brief. Models do call this twice.
     */
    if (existing) {
      return existing === track
        ? { ok: true }
        : { ok: false, open: this.openTracks(), reason: `you already committed to "${existing}"` }
    }

    if (this.countIn(track) >= TRACK_CAPACITY) {
      return { ok: false, open: this.openTracks(), reason: `"${track}" is full` }
    }

    this.tracks.set(agentId, track)
    return { ok: true }
  }

  /**
   * End of mingle: anyone who never picked goes to the emptier track.
   * A missing pick must never stall the round.
   */
  assignStragglers(all: readonly AgentId[]) {
    for (const id of all) {
      if (this.tracks.get(id)) continue

      const target = [...TRACKS].sort((a, b) => this.countIn(a) - this.countIn(b))[0]
      this.tracks.set(id, target)
      this.emit({ agentId: id, kind: 'theme', body: target, track: target })
    }
  }

  snapshot(): Record<string, Track> {
    return Object.fromEntries(this.tracks)
  }
}

/** Shared health-check poll. Identical in fake and real so behaviour matches. */
export async function waitForHealthy(url: string, budgetMs = 10_000): Promise<string> {
  const deadline = Date.now() + budgetMs
  let last = 'no response'

  while (Date.now() < deadline) {
    try {
      /**
       * Per-attempt timeout is essential. The deadline is only checked
       * between attempts, so a proxy that accepts the connection then stalls
       * would park this call far past the budget.
       */
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(2000) })
      if (res.ok) return url
      last = `status ${res.status}`
    } catch (err) {
      last = err instanceof Error ? err.name : String(err)
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  throw new Error(`preview never became healthy within ${budgetMs}ms (last: ${last})`)
}
