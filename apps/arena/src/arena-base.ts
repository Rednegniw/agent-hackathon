import type { Arena, AgentSandbox } from './arena.js'
import type { AgentEvent, AgentId, NewEvent, Phase } from './events.js'
import type { EventLog } from './log.js'
import type { PhaseClock } from './phases.js'

/** Logic shared by the fake and real arenas. Only sandboxFor differs. */
export abstract class BaseArena implements Arena {

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






  snapshot(): Record<string, string> {
    return {}
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
