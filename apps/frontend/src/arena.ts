/**
 * The office's view of the arena. The vocabulary is imported straight from
 * the arena package — one source of truth, no drift. Only the fetch helpers
 * and status shape (which the arena serves but does not export) live here.
 */

export * from '../../arena/src/events'

import type { Phase } from '../../arena/src/events'

/** Mirrors round.ts — kept local so the office doesn't import the arena's dep graph. */
export type RoundState = 'idle' | 'running' | 'done' | 'failed'

export interface ArenaStatus {
  state: RoundState
  arena: 'fake' | 'daytona' | null
  roundId: string | null
  phase: Phase
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  /** Countdown data for the HUD clock pill. */
  phaseStartedAt: number | null
  phaseDurationMs: number | null
}

export const ARENA_URL = import.meta.env.VITE_ARENA_URL ?? 'http://localhost:4000'

/**
 * Pitch videos are served by the arena, which emits a path rather than an
 * absolute URL because it does not know which host the office reached it on.
 * Prefix here, where that is known.
 *
 * Unlike a preview URL these outlive the sandbox — the media is copied out
 * before teardown — so a pitch still plays after the round is over.
 */
export const mediaUrl = (path?: string): string | undefined =>
  !path ? undefined : path.startsWith('/') ? `${ARENA_URL}${path}` : path

export type StartAck =
  | { ok: true; roundId: string }
  /** 400 means the payload was wrong, 409 that a round is already running. */
  | { ok: false; reason: string; status?: 400 | 409 }

export async function startRound(arena: 'fake' | 'daytona', speed: number): Promise<StartAck> {
  const res = await fetch(`${ARENA_URL}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arena, speed }),
  })

  // 409 carries a real reason ("a round is already running"), so parse either way.
  return (await res.json()) as StartAck
}

export async function fetchStatus(): Promise<ArenaStatus> {
  const res = await fetch(`${ARENA_URL}/state`)
  if (!res.ok) throw new Error(`status ${res.status}`)
  return (await res.json()) as ArenaStatus
}
