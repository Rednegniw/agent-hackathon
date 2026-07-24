import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Arena } from './arena.js'
import type { AgentEvent, AgentId } from './events.js'
import { TOPIC } from './topic.js'
import type { TeamRoster } from './teams.js'
import { renderTrace, submittedAgents, traceFor, traceForTeam, type AgentTrace } from './trace.js'

/**
 * The evaluator round.
 *
 * Each agent that shipped presents its own case, arguing from its trace rather
 * than from a summary we write for it. A panel of judge agents then scores every
 * presentation independently, and the aggregate crowns a winner.
 *
 * A panel rather than one judge because a single LLM score is noisy and
 * unfalsifiable. Three independent judges with different lenses disagree in
 * useful ways, and the spread is itself a signal worth showing on stage.
 */

export interface Criterion {
  key: string
  label: string
  prompt: string
}

export const CRITERIA: Criterion[] = [
  { key: 'useful', label: 'Usefulness', prompt: 'Would a real person actually use this?' },
  { key: 'craft', label: 'Craft', prompt: 'Is it considered? Does it look and feel deliberate?' },
  { key: 'original', label: 'Originality', prompt: 'Is the angle surprising, or the obvious answer?' },
]

export const JUDGES = [
  {
    id: 'juror-product',
    lens: 'You judge as a product person. You care whether a real person would use this ' +
      'tomorrow, and you are unmoved by technical cleverness that serves nobody.',
  },
  {
    id: 'juror-craft',
    lens: 'You judge as a designer. You care about restraint, typography, spacing and whether ' +
      'the thing looks decided rather than defaulted.',
  },
  {
    id: 'juror-engineer',
    lens: 'You judge as an engineer. You read the trace as well as the artifact, and you can ' +
      'tell a considered approach from one that got lucky.',
  },
] as const

export interface Score {
  judge: string
  agentId: AgentId
  scores: Record<string, number>
  total: number
  comment: string
}

export interface Verdict {
  /** Solo agent id, or a team id when the entry was a team. */
  agentId: AgentId
  total: number
  perJudge: Score[]
  presentation: string
  members: AgentId[]
  voice: AgentId
}

const MODEL = process.env.JUDGE_MODEL ?? 'claude-haiku-4-5'

/** Pulls the first JSON object out of a model response. */
function extractJson<T>(text: string): T | null {
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as T
  } catch {
    return null
  }
}

/**
 * Never throws. The evaluator round opens roughly sixteen fresh sessions back
 * to back, immediately after the agents have hammered the same account all
 * round, so a transient rate limit is likely rather than exotic. An unhandled
 * rejection here would kill the process at the finale, after the build already
 * succeeded and before any winner was crowned. An empty string instead flows
 * into the existing abstain path.
 */
async function ask(prompt: string, system: string, maxTurns = 2): Promise<string> {
  let out = ''
  try {
    for await (const msg of query({
      prompt,
      options: { model: MODEL, systemPrompt: system, tools: [], maxTurns },
    })) {
      if (msg.type === 'assistant') {
        for (const b of msg.message.content) if (b.type === 'text') out += b.text
      }
    }
  } catch (err) {
    console.warn('[judge] query failed:', (err as Error).message)
  }
  return out
}

/** The agent makes its own case, grounded in its trace. */
async function present(trace: AgentTrace, arena: Arena, entry: Entry): Promise<string> {
  const who = entry.members.length > 1
    ? `${entry.label}, a team of ${entry.members.join(' and ')}`
    : entry.label
  const text = await ask(
    `Here is the record of what you actually did:\n\n${renderTrace(trace)}\n\n` +
      `Present your work to the judges in at most 60 words. Argue from what you built and the ` +
      `decisions you made. Do not invent anything that is not in the record. No preamble.`,
    `You are ${who}, presenting your hackathon project to a panel of judges. ` +
      `The brief was: ${TOPIC}`,
  )

  const speech = text.trim().slice(0, 600)
  arena.emit({ agentId: entry.voice, kind: 'present', body: speech })
  return speech
}

/** One judge scores one presentation. */
async function scoreOne(
  judge: (typeof JUDGES)[number],
  trace: AgentTrace,
  speech: string,
  arena: Arena,
  entry: Entry,
): Promise<Score | null> {
  const rubric = CRITERIA.map((c) => `  "${c.key}": 0-10   // ${c.prompt}`).join('\n')

  const text = await ask(
    `Brief: ${TOPIC}\n\n` +
      `Agent: ${trace.agentId}\n` +
      `Its presentation: ${speech}\n\n` +
      `Its trace:\n${renderTrace(trace)}\n\n` +
      `Score it. Reply with ONLY a JSON object:\n{\n${rubric}\n  "comment": "one sentence"\n}`,
    `You are ${judge.id}, judging a hackathon. ${judge.lens} ` +
      `Score honestly: a 10 is exceptional and most work is not exceptional.`,
  )

  let parsed = extractJson<Record<string, number | string>>(text)

  /**
   * A juror that returns unparseable output must not cost the agent points.
   * Scoring 0 on a parse failure penalises the competitor for the judge's
   * malfunction and can decide the round: observed live, where one juror
   * returned prose and handed an otherwise solid entry a 0/30.
   * Retry once, then abstain.
   */
  if (!parsed) {
    /**
     * The retry is a fresh session with no memory of the first, so it must
     * restate the rubric. Without it the model answers something plausible
     * like {"score": 8}, which parses but contains none of the criteria keys
     * and lands right back on 0/30, defeating the point of retrying.
     */
    const retry = await ask(
      `Reply with ONLY this JSON object and nothing else:\n{\n${rubric}\n  "comment": "one sentence"\n}\n\n` +
        `Entry: ${entry.label}\nPresentation: ${speech}`,
      `You are ${judge.id}. ${judge.lens}`,
    )
    parsed = extractJson<Record<string, number | string>>(retry)
  }

  // A parse that contains none of the criteria is not a score. Abstain.
  if (parsed && !CRITERIA.some((c) => c.key in parsed!)) parsed = null

  if (!parsed) {
    console.warn(`[judge] ${judge.id} could not score ${entry.label}, abstaining`)
    arena.emit({
      agentId: entry.voice,
      kind: 'verdict',
      body: `${judge.id}: abstained (no parseable score)`,
    })
    return null
  }

  const scores: Record<string, number> = {}

  for (const c of CRITERIA) {
    const v = Number(parsed[c.key] ?? 0)
    scores[c.key] = Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 0
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0)
  const comment = String(parsed?.comment ?? '(no comment)').slice(0, 240)

  arena.emit({
    agentId: entry.voice,
    kind: 'verdict',
    body: `${judge.id} on ${entry.label}: ${total}/30 - ${comment}`,
    score: { points: total, rank: 0 },
  })

  return { judge: judge.id, agentId: entry.label as AgentId, scores, total, comment }
}

export interface EvaluationResult {
  verdicts: Verdict[]
  winner?: Verdict
}

/**
 * One competitor: a solo agent, or a whole team collapsed into a single entry.
 * Teams share a sandbox, so without this the same artifact enters two or three
 * times and gets scored as separate submissions.
 */
interface Entry {
  label: string
  members: AgentId[]
  /** Whose id carries the entry's events, so the office can place them. */
  voice: AgentId
}

function entriesFrom(events: AgentEvent[], teams?: TeamRoster): Entry[] {
  const finalists = submittedAgents(events)
  const seen = new Set<string>()
  const entries: Entry[] = []

  for (const id of finalists) {
    const team = teams?.teamOf(id)

    if (!team) {
      if (seen.has(id)) continue
      seen.add(id)
      entries.push({ label: id, members: [id], voice: id })
      continue
    }

    // Whole team, once, however many members happened to call submit.
    if (seen.has(team.id)) continue
    seen.add(team.id)
    entries.push({ label: team.id, members: team.members, voice: team.owner })
  }

  return entries
}

/** Runs the whole evaluator round and crowns a winner. */
export async function runEvaluation(
  events: AgentEvent[],
  arena: Arena,
  teams?: TeamRoster,
): Promise<EvaluationResult> {
  const entries = entriesFrom(events, teams)

  if (!entries.length) {
    arena.emit({ agentId: 'system', kind: 'score', body: 'nobody submitted, no winner' })
    return { verdicts: [] }
  }

  arena.emit({
    agentId: 'system',
    kind: 'phase',
    body: `judging ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} with ${JUDGES.length} jurors`,
  })

  const verdicts: Verdict[] = []

  /**
   * Presentations run in parallel, then judging. Sequential judging per agent
   * keeps the office readable: scores land one agent at a time rather than
   * eighteen at once.
   */
  const traces = entries.map((e) =>
    e.members.length > 1 ? traceForTeam(events, e.members, e.label) : traceFor(events, e.members[0]),
  )
  const speeches = await Promise.all(
    traces.map((t, i) => present(t, arena, entries[i])),
  )

  for (const [i, trace] of traces.entries()) {
    const settled = await Promise.all(
      JUDGES.map((j) => scoreOne(j, trace, speeches[i], arena, entries[i])),
    )
    const perJudge = settled.filter((s): s is Score => s !== null)

    /**
     * Mean of the jurors who actually scored, scaled back up, so an abstention
     * does not silently cost the agent a third of its points.
     */
    const raw = perJudge.reduce((a, s) => a + s.total, 0)
    const total = perJudge.length ? Math.round((raw / perJudge.length) * JUDGES.length) : 0

    verdicts.push({ agentId: entries[i].label as AgentId, total, perJudge, presentation: speeches[i], members: entries[i].members, voice: entries[i].voice })
  }

  verdicts.sort((a, b) => b.total - a.total)
  verdicts.forEach((v, i) => {
    arena.emit({
      agentId: v.voice,
      kind: 'score',
      body: `${v.agentId}: rank ${i + 1} of ${verdicts.length}, ${v.total}/${JUDGES.length * CRITERIA.length * 10}`,
      score: { points: v.total, rank: i + 1 },
    })
  })

  const winner = verdicts[0]
  arena.emit({
    agentId: winner.voice,
    kind: 'crown',
    body:
      winner.members.length > 1
        ? `${winner.agentId} (${winner.members.join(' + ')}) wins with ${winner.total} points`
        : `${winner.agentId} wins with ${winner.total} points`,
  })

  return { verdicts, winner }
}
