import type { AgentEvent, AgentId } from './events.js'

/**
 * One agent's record of what it actually did.
 *
 * The event log is already the source of truth, so a trace is a view over it
 * rather than a second store. It exists because both the presentation and the
 * judging need to reason about process, not just the artifact: an agent should
 * argue from what it built, and a judge should be able to tell a considered
 * approach from a lucky one.
 */
export interface AgentTrace {
  agentId: AgentId
  track?: string
  title?: string
  pitch?: string
  previewUrl?: string

  /** Commands run and files written, in order. */
  actions: string[]

  /** The agent's own reasoning, as it streamed. */
  reasoning: string[]

  bytesWritten: number
  toolCalls: number
  firstActionAt?: number
  submittedAt?: number
}

export function traceFor(events: AgentEvent[], agentId: AgentId): AgentTrace {
  const mine = events.filter((e) => e.agentId === agentId)
  const submit = mine.find((e) => e.kind === 'submit')
  const theme = mine.find((e) => e.kind === 'theme')
  const builds = mine.filter((e) => e.kind === 'build')

  const bytes = builds.reduce((sum, e) => {
    const m = /\((\d+)b\)/.exec(e.body)
    return sum + (m ? Number(m[1]) : 0)
  }, 0)

  return {
    agentId,
    track: theme?.track,
    pitch: submit?.body,
    previewUrl: submit?.previewUrl,
    actions: builds.map((e) => e.body),
    reasoning: mine.filter((e) => e.kind === 'thought').map((e) => e.body),
    bytesWritten: bytes,
    toolCalls: builds.length,
    firstActionAt: builds[0]?.ts,
    submittedAt: submit?.ts,
  }
}

/** Compact, human-readable form. This is what a judge actually reads. */
export function renderTrace(t: AgentTrace): string {
  const lines = [
    `AGENT: ${t.agentId}`,
    `LANE: ${t.track ?? 'none'}`,
    `PITCH: ${t.pitch ?? '(never submitted)'}`,
    `SHIPPED: ${t.previewUrl ?? 'nothing'}`,
    `BYTES WRITTEN: ${t.bytesWritten}`,
    '',
    'WHAT IT DID:',
    ...t.actions.map((a, i) => `  ${i + 1}. ${a}`),
  ]

  if (t.reasoning.length) {
    lines.push('', 'HOW IT REASONED:')
    for (const r of t.reasoning.slice(0, 6)) lines.push(`  - ${r.slice(0, 200)}`)
  }

  return lines.join('\n')
}

export function submittedAgents(events: AgentEvent[]): AgentId[] {
  return events.filter((e) => e.kind === 'submit').map((e) => e.agentId as AgentId)
}
