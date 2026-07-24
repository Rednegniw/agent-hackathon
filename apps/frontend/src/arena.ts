/**
 * The office's view of the arena. Mirrors apps/arena/src/events.ts — when that
 * file changes, this one has to follow. Duplicated rather than imported
 * because the two apps do not share a package yet; the moment a third consumer
 * appears, lift it into packages/.
 */

export const AGENT_IDS = ['ada', 'rex', 'juno', 'iris', 'otto', 'vera'] as const
export type AgentId = (typeof AGENT_IDS)[number]

export type Phase = 'idle' | 'mingle' | 'build' | 'submit' | 'judged'

export type EventKind = 'thought' | 'message' | 'build' | 'submit' | 'phase' | 'score'

export interface AgentEvent {
  seq: number
  ts: number
  agentId: AgentId | 'system'
  kind: EventKind
  body: string
  targetId?: AgentId
  previewUrl?: string
  audioUrl?: string
  score?: { mechanical: number; creative: number; rank: number }
}

export type RoundState = 'idle' | 'running' | 'done' | 'failed'

export interface ArenaStatus {
  state: RoundState
  arena: 'fake' | 'daytona' | null
  roundId: string | null
  phase: Phase
  startedAt: number | null
  finishedAt: number | null
  error: string | null
}

export const ARENA_URL = import.meta.env.VITE_ARENA_URL ?? 'http://localhost:4000'

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
