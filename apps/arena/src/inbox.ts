import type { AgentId } from './events.js'

/**
 * Agent-to-agent delivery, mediated by the orchestrator.
 *
 * Sandboxes have isolated network stacks, so agents cannot reach each other
 * directly and never should. Everything goes through here, which also means
 * every message is logged, replayable and auditable.
 *
 * This is the half that was missing: send_message used to emit an event and
 * return "sent", and the recipient never saw a thing. The tool description
 * promised "they see it on their next turn" and that was simply untrue, which
 * also meant team formation could not involve any actual negotiation.
 */
export interface Letter {
  from: AgentId
  text: string
  at: number
}

export class Inbox {
  #queues = new Map<AgentId, Letter[]>()
  #wake = new Map<AgentId, () => void>()

  post(to: AgentId, from: AgentId, text: string): void {
    const q = this.#queues.get(to) ?? []
    q.push({ from, text, at: Date.now() })
    this.#queues.set(to, q)

    /**
     * Wake a reader parked in take(), so delivery is immediate rather than
     * waiting out its poll interval.
     */
    this.#wake.get(to)?.()
  }

  /**
   * Takes everything waiting, or blocks until mail arrives or the timeout
   * elapses. Returns an empty array on timeout so the caller can re-check
   * whether the round is still open.
   */
  async take(agentId: AgentId, timeoutMs: number): Promise<Letter[]> {
    const ready = this.#queues.get(agentId)
    if (ready?.length) {
      this.#queues.set(agentId, [])
      return ready
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      this.#wake.set(agentId, () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.#wake.delete(agentId)

    const mail = this.#queues.get(agentId) ?? []
    this.#queues.set(agentId, [])
    return mail
  }

  /** Releases every parked reader, so generators can close at round end. */
  releaseAll(): void {
    for (const wake of this.#wake.values()) wake()
    this.#wake.clear()
  }
}
