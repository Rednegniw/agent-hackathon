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
  title?: string
  pitch?: string
  previewUrl?: string

  /** Title and tagline from the agent's own product video, if it filmed one. */
  product?: string

  /** Commands run and files written, in order. */
  actions: string[]

  /** The agent's own reasoning, as it streamed. */
  reasoning: string[]

  /**
   * Set only for a team entry. Its presence tells renderTrace that `actions`
   * covers several agents working in parallel in separate sandboxes, which
   * reads very differently from one agent's sequential history.
   */
  members?: AgentId[]

  bytesWritten: number
  toolCalls: number
  firstActionAt?: number
  submittedAt?: number
}

export function traceFor(events: AgentEvent[], agentId: AgentId): AgentTrace {
  const mine = events.filter((e) => e.agentId === agentId)
  const submit = mine.find((e) => e.kind === 'submit')
  const builds = mine.filter((e) => e.kind === 'build')

  const bytes = builds.reduce((sum, e) => {
    const m = /\((\d+)b\)/.exec(e.body)
    return sum + (m ? Number(m[1]) : 0)
  }, 0)

  return {
    agentId,
    pitch: submit?.body,
    previewUrl: submit?.previewUrl,
    product: mine.find((e) => e.kind === 'pitch')?.body,
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
  const team = t.members && t.members.length > 1 ? t.members : null

  const lines = [
    team ? `TEAM: ${t.agentId} (${team.join(' + ')})` : `AGENT: ${t.agentId}`,
    `PITCH: ${t.pitch ?? '(never submitted)'}`,
    `PRODUCT VIDEO: ${t.product ?? '(never filmed one)'}`,
    `SHIPPED: ${t.previewUrl ?? 'nothing'}`,
    `BYTES WRITTEN: ${t.bytesWritten}`,
  ]

  /**
   * Without this, jurors read a team's merged build log as one file being
   * rewritten once per member and marked it down for "chaotic iteration" and
   * "three people rewriting the same file". Each member has an isolated
   * sandbox; concurrent drafting is the intended design, not indecision.
   */
  if (team) {
    lines.push(
      '',
      `These ${team.length} agents each work in their OWN isolated sandbox and deliver files to`,
      'the integrator. The sections below are PARALLEL work by different authors, not',
      'sequential edits to one file. Several members each writing their own index.html is',
      'expected, not a sign of thrash.',
    )
  }

  lines.push('', 'WHAT IT DID:')

  // Numbering implies one ordered history, which a team trace is not.
  lines.push(...t.actions.map((a, i) => (team ? `  ${a}` : `  ${i + 1}. ${a}`)))

  if (t.reasoning.length) {
    lines.push('', 'HOW IT REASONED:')

    // A team's budget scales with its members, or only the first speaks.
    const cap = team ? 6 * team.length : 6
    for (const r of t.reasoning.slice(0, cap)) lines.push(`  - ${r.slice(0, 200)}`)
  }

  return lines.join('\n')
}

export function submittedAgents(events: AgentEvent[]): AgentId[] {
  return events.filter((e) => e.kind === 'submit').map((e) => e.agentId as AgentId)
}

/**
 * One trace for a whole team.
 *
 * Teammates each have their own sandbox and coordinate by message, so this
 * merges their separate records into the single story the jurors should judge:
 * one entry, one presentation, one score.
 */
export function traceForTeam(events: AgentEvent[], members: AgentId[], label: string): AgentTrace {
  const parts = members.map((m) => traceFor(events, m))
  const submitted = parts.find((p) => p.previewUrl) ?? parts[0]

  return {
    agentId: label as AgentId,
    members,
    pitch: submitted.pitch,
    previewUrl: submitted.previewUrl,

    /**
     * Grouped by author, NOT interleaved by time.
     *
     * Interleaving was actively costing teams points. Each teammate drafts in
     * their own sandbox, so three members each writing their own app/index.html
     * is three parallel drafts; flattened into one timeline it reads as one
     * file being rewritten three times. Jurors said exactly that, unprompted:
     * "three people rewriting the same file", "chaotic iteration via
     * file-swapping". They were describing share_file, the collaboration
     * mechanism, and scoring it as thrash.
     *
     * Each member's work is now labelled and kept contiguous, so the judge can
     * tell parallel authorship from indecision.
     */
    actions: members.flatMap((m) => {
      const own = events.filter((e) => e.agentId === m && e.kind === 'build')
      if (!own.length) return []
      return [`--- ${m}, in their own sandbox ---`, ...own.map((e) => `${m}: ${e.body}`)]
    }),

    reasoning: members.flatMap((m) => {
      const own = events.filter((e) => e.agentId === m && e.kind === 'thought')
      if (!own.length) return []
      return [`--- ${m} ---`, ...own.map((e) => `${m}: ${e.body}`)]
    }),

    bytesWritten: parts.reduce((n, p) => n + p.bytesWritten, 0),
    toolCalls: parts.reduce((n, p) => n + p.toolCalls, 0),
    firstActionAt: Math.min(...parts.map((p) => p.firstActionAt ?? Infinity)),
    submittedAt: submitted.submittedAt,
  }
}
