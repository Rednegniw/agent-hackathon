/**
 * The shared vocabulary. Both lanes import from here.
 * Change this file early or not at all: once the agent loop and the office
 * both depend on it, a shape change is a merge conflict at the worst moment.
 */

export const AGENT_IDS = ['ada', 'rex', 'juno', 'iris', 'otto', 'vera'] as const
export type AgentId = (typeof AGENT_IDS)[number]

/**
 * Two lanes, deliberately named for nothing. The brief lives in TOPIC
 * (see topic.ts) and is the same for both by default, so a track is a heat
 * rather than a category. Naming them after subjects was a mistake: the
 * moment the brief changed, the names lied.
 */
export const TRACKS = ['alpha', 'beta'] as const
export type Track = (typeof TRACKS)[number]

export const TRACK_CAPACITY = 3

export type Phase = 'idle' | 'mingle' | 'build' | 'submit' | 'judging' | 'judged'

export type EventKind =
  | 'thought' // agent reasoning, streamed from the assistant turn
  | 'message' // agent to agent, always mediated by the orchestrator
  | 'build' // a command ran or a file was written
  | 'theme' // agent claimed a lane
  | 'team' // agents formed a team
  | 'submit' // agent shipped, carries previewUrl
  | 'present' // agent's case to the judges, argued from its own trace
  | 'verdict' // one juror's score for one agent
  | 'score' // aggregate rank, or a round-level note from 'system'
  | 'crown' // the winner
  | 'phase' // round advanced, agentId is 'system'

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
