import { query } from '@anthropic-ai/claude-agent-sdk'
import type { Arena } from './arena.js'
import type { AgentEvent, AgentId } from './events.js'
import { TOPIC } from './topic.js'
import { renderTrace, submittedAgents, traceFor, type AgentTrace } from './trace.js'

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
  agentId: AgentId
  total: number
  perJudge: Score[]
  presentation: string
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

async function ask(prompt: string, system: string, maxTurns = 2): Promise<string> {
  let out = ''
  for await (const msg of query({
    prompt,
    options: { model: MODEL, systemPrompt: system, tools: [], maxTurns },
  })) {
    if (msg.type === 'assistant') {
      for (const b of msg.message.content) if (b.type === 'text') out += b.text
    }
  }
  return out
}

/** The agent makes its own case, grounded in its trace. */
async function present(trace: AgentTrace, arena: Arena): Promise<string> {
  const text = await ask(
    `Here is the record of what you actually did:\n\n${renderTrace(trace)}\n\n` +
      `Present your work to the judges in at most 60 words. Argue from what you built and the ` +
      `decisions you made. Do not invent anything that is not in the record. No preamble.`,
    `You are ${trace.agentId}, an agent presenting your hackathon project to a panel of judges. ` +
      `The brief was: ${TOPIC}`,
  )

  const speech = text.trim().slice(0, 600)
  arena.emit({ agentId: trace.agentId, kind: 'present', body: speech, track: trace.track as never })
  return speech
}

/** One judge scores one presentation. */
async function scoreOne(
  judge: (typeof JUDGES)[number],
  trace: AgentTrace,
  speech: string,
  arena: Arena,
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
    const retry = await ask(
      `Your last reply was not valid JSON. Reply with ONLY the JSON object, nothing else.\n\n` +
        `Agent: ${trace.agentId}\nPresentation: ${speech}`,
      `You are ${judge.id}. ${judge.lens}`,
    )
    parsed = extractJson<Record<string, number | string>>(retry)
  }

  if (!parsed) {
    console.warn(`[judge] ${judge.id} could not score ${trace.agentId}, abstaining`)
    arena.emit({
      agentId: trace.agentId,
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
    agentId: trace.agentId,
    kind: 'verdict',
    body: `${judge.id}: ${total}/30 - ${comment}`,
    score: { mechanical: 0, creative: total, rank: 0 },
  })

  return { judge: judge.id, agentId: trace.agentId, scores, total, comment }
}

export interface EvaluationResult {
  verdicts: Verdict[]
  winner?: Verdict
}

/** Runs the whole evaluator round and crowns a winner. */
export async function runEvaluation(events: AgentEvent[], arena: Arena): Promise<EvaluationResult> {
  const finalists = submittedAgents(events)

  if (!finalists.length) {
    arena.emit({ agentId: 'system', kind: 'score', body: 'nobody submitted, no winner' })
    return { verdicts: [] }
  }

  arena.emit({
    agentId: 'system',
    kind: 'phase',
    body: `judging ${finalists.length} finalists with ${JUDGES.length} jurors`,
  })

  const verdicts: Verdict[] = []

  /**
   * Presentations run in parallel, then judging. Sequential judging per agent
   * keeps the office readable: scores land one agent at a time rather than
   * eighteen at once.
   */
  const traces = finalists.map((id) => traceFor(events, id))
  const speeches = await Promise.all(traces.map((t) => present(t, arena)))

  for (const [i, trace] of traces.entries()) {
    const settled = await Promise.all(JUDGES.map((j) => scoreOne(j, trace, speeches[i], arena)))
    const perJudge = settled.filter((s): s is Score => s !== null)

    /**
     * Mean of the jurors who actually scored, scaled back up, so an abstention
     * does not silently cost the agent a third of its points.
     */
    const raw = perJudge.reduce((a, s) => a + s.total, 0)
    const total = perJudge.length ? Math.round((raw / perJudge.length) * JUDGES.length) : 0

    verdicts.push({ agentId: trace.agentId, total, perJudge, presentation: speeches[i] })
  }

  verdicts.sort((a, b) => b.total - a.total)
  verdicts.forEach((v, i) => {
    arena.emit({
      agentId: v.agentId,
      kind: 'score',
      body: `rank ${i + 1} of ${verdicts.length}, ${v.total}/${JUDGES.length * CRITERIA.length * 10}`,
      score: { mechanical: 0, creative: v.total, rank: i + 1 },
    })
  })

  const winner = verdicts[0]
  arena.emit({
    agentId: winner.agentId,
    kind: 'crown',
    body: `${winner.agentId} wins with ${winner.total} points`,
  })

  return { verdicts, winner }
}
