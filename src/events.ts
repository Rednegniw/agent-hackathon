/**
 * The shared vocabulary. Both lanes import from here.
 * Change this file early or not at all: once the agent loop and the office
 * both depend on it, a shape change is a merge conflict at the worst moment.
 */

export const AGENT_IDS = ['ada', 'rex', 'juno', 'iris', 'otto', 'vera'] as const
export type AgentId = (typeof AGENT_IDS)[number]

export const TRACKS = ['time', 'color'] as const
export type Track = (typeof TRACKS)[number]

export const TRACK_CAPACITY = 3

export type Phase = 'idle' | 'mingle' | 'build' | 'submit' | 'judged'

export type EventKind =
  | 'thought' // agent reasoning, streamed from the assistant turn
  | 'message' // agent to agent, always mediated by the orchestrator
  | 'build' // a command ran or a file was written
  | 'theme' // agent claimed a track
  | 'submit' // agent shipped, carries previewUrl
  | 'phase' // round advanced, agentId is 'system'
  | 'score' // judging result, agentId is 'system' for round-level notes

/** The single event type. Everything the office renders is one of these. */
export interface AgentEvent {
  seq: number
  ts: number

  /**
   * 'system' covers phase transitions and round-level scoring, which
   * belong to no single agent.
   */
  agentId: AgentId | 'system'
  kind: EventKind
  body: string

  track?: Track
  targetId?: AgentId
  previewUrl?: string
  audioUrl?: string
  score?: { mechanical: number; creative: number; rank: number }
}

/** What callers pass to emit(). seq and ts are assigned by the log. */
export type NewEvent = Omit<AgentEvent, 'seq' | 'ts'>

export const isAgentId = (v: string): v is AgentId => AGENT_IDS.includes(v as AgentId)
