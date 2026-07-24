import type { AgentEvent, AgentId, NewEvent, Phase, Track } from './events.js'

/**
 * One agent's sandbox. The ONLY way an agent touches a filesystem.
 * FakeArena and DaytonaArena both implement this, so the code path Patrik
 * develops against is the code path that ships.
 */
export interface AgentSandbox {
  /** Runs a command. Rejects on non-zero exit, with output attached. */
  bash(command: string): Promise<string>

  /** Writes a file, creating parent directories. */
  write(path: string, content: string): Promise<void>

  /**
   * Resolves a signed, health-checked, iframe-safe URL for a port.
   * Polls until something is actually serving, so a submit that races the
   * dev server's boot does not fail spuriously. Rejects if nothing comes up.
   */
  preview(port: number): Promise<string>
}

/** Everything the agent loop needs from the substrate. */
export interface Arena {
  sandboxFor(agentId: AgentId): AgentSandbox

  /**
   * Claims a track. Idempotent for the same track; returns the open tracks
   * if this one is full or if the agent already claimed a different one.
   */
  claimTrack(agentId: AgentId, track: Track): ClaimResult

  trackOf(agentId: AgentId): Track | undefined

  emit(e: NewEvent): AgentEvent

  phase(): Phase
}

export type ClaimResult = { ok: true } | { ok: false; open: Track[]; reason: string }
