import type { AgentEvent, AgentId, NewEvent, Phase } from './events.js'

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

  /** Writes binary content. Same path rules as write. */
  writeBytes(path: string, content: Uint8Array): Promise<void>

  /**
   * Reads a file back out. This is how rendered media leaves the sandbox:
   * the studio films inside the box, and the finished mp4 has to reach the
   * orchestrator's public directory before the sandbox is torn down.
   */
  read(path: string): Promise<Uint8Array>

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


  emit(e: NewEvent): AgentEvent

  phase(): Phase
}

