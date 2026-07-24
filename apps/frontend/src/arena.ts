/**
 * The office's view of the arena. The vocabulary is imported straight from
 * the arena package — one source of truth, no drift. Only the fetch helpers
 * and status shape (which the arena serves but does not export) live here.
 */

export * from '../../arena/src/events'

import type { Phase } from '../../arena/src/events'

/** Mirrors round.ts — kept local so the office doesn't import the arena's dep graph. */
export type RoundState = 'idle' | 'running' | 'stopping' | 'done' | 'failed'

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

  /**
   * Events at or below this seq belong to a previous round. The arena owns this
   * so a reloaded office hides the same backlog a long-lived one does.
   */
  epochSeq: number
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

/** How long a whole round lasts, as the lobby offers it. Seconds, like `durations`. */
export const COMBAT_LENGTHS = [30, 60, 120] as const
export type CombatLength = (typeof COMBAT_LENGTHS)[number]

/**
 * Phase splits per combat length. Written out rather than derived from a ratio
 * because the useful shape is not proportional: mingle needs a floor to be
 * legible at all, and build is what benefits from the extra time.
 */
const SPLITS: Record<CombatLength, { mingle: number; build: number; submit: number }> = {
  30: { mingle: 4, build: 20, submit: 6 },
  60: { mingle: 6, build: 42, submit: 12 },
  120: { mingle: 10, build: 85, submit: 25 },
}

/** Everything the lobby can set about a round. Mirrors StartBody in round.ts. */
export interface RoundConfig {
  arena: 'fake' | 'daytona'
  agents: 'scripted' | 'real'
  /**
   * How many teams the field is split into. Sent, but NOT yet honoured: team
   * size lives in TEAM_MIN/TEAM_MAX in the arena's teams.ts, which /start does
   * not read, and round.ts forms no teams at all. The arena ignores unknown
   * keys, so this is inert until the orchestrator grows a `teams` option.
   */
  teams: number
  /** Seats in the draw, taken from the top of the roster. */
  agentCount: number
  length: CombatLength
  /** Blank falls back to the arena's own default brief. */
  topic: string
}

export async function startRound(config: RoundConfig): Promise<StartAck> {
  const res = await fetch(`${ARENA_URL}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      arena: config.arena,
      agents: config.agents,
      agentCount: config.agentCount,
      teams: config.teams,
      durations: SPLITS[config.length],
      topic: config.topic.trim() || undefined,
    }),
  })

  // 409 carries a real reason ("a round is already running"), so parse either way.
  return (await res.json()) as StartAck
}

/**
 * Ends the round and returns the arena to the lobby.
 *
 * `stopping` means a live round is being torn down and the arena reaches idle
 * shortly after — the office finds out from its own /state poll, not from here,
 * because teardown outlasts the request.
 */
export async function resetRound(): Promise<{ ok: boolean; stopping: boolean }> {
  const res = await fetch(`${ARENA_URL}/reset`, { method: 'POST' })
  if (!res.ok) throw new Error(`reset failed: ${res.status}`)
  return (await res.json()) as { ok: boolean; stopping: boolean }
}

export async function fetchStatus(): Promise<ArenaStatus> {
  const res = await fetch(`${ARENA_URL}/state`)
  if (!res.ok) throw new Error(`status ${res.status}`)
  return (await res.json()) as ArenaStatus
}
