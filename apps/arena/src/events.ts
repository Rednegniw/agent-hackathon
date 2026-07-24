/**
 * The shared vocabulary. Both lanes import from here.
 * Change this file early or not at all: once the agent loop and the office
 * both depend on it, a shape change is a merge conflict at the worst moment.
 */

export const AGENT_IDS = [
  'ada', 'rex', 'juno', 'iris', 'otto', 'vera',
  'milo', 'nova', 'pip', 'quill', 'sage', 'wren',
] as const
export type AgentId = (typeof AGENT_IDS)[number]

/**
 * There is one brief and one field. Lanes existed to keep entries comparable
 * when there were two different themes; with a single broad TOPIC they only
 * split the field arbitrarily and gave the judges two pools where one was
 * fairer.
 */

export type Phase = 'idle' | 'mingle' | 'build' | 'submit' | 'judging' | 'judged'

export type EventKind =
  | 'thought' // agent reasoning, streamed from the assistant turn
  | 'message' // agent to agent, always mediated by the orchestrator
  | 'build' // a command ran or a file was written
  | 'team' // agents formed a team
  | 'submit' // agent shipped, carries previewUrl
  | 'shot' // a screenshot the agent took of its own running product
  | 'pitch' // the agent's narrated product video, carries videoUrl
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

  targetId?: AgentId
  previewUrl?: string
  audioUrl?: string

  /**
   * Paths, not absolute URLs, and served by the arena itself. The arena does
   * not know which host the office reached it on, so the office prefixes its
   * own ARENA_URL. Unlike previewUrl these outlive the sandbox: the media is
   * copied out before teardown, so a pitch video still plays tomorrow.
   */
  videoUrl?: string
  posterUrl?: string

  score?: { points: number; rank: number }
}

/** What callers pass to emit(). seq and ts are assigned by the log. */
export type NewEvent = Omit<AgentEvent, 'seq' | 'ts'>

export const isAgentId = (v: string): v is AgentId => AGENT_IDS.includes(v as AgentId)
