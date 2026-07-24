import type { AgentEvent } from './events.js'
import { CRITERIA, JUDGES, type Verdict } from './judge.js'
import { TOPIC } from './topic.js'
import { traceFor } from './trace.js'

/**
 * Logs the round to Braintrust as an experiment: one case per finalist, the
 * brief as input, the shipped artifact as output, and one scorer per criterion
 * plus the mechanical checks.
 *
 * Deliberately non-fatal. A missing key or a network blip must never take down
 * a round that already produced a winner, so every failure here is a warning.
 */
export async function logToBraintrust(verdicts: Verdict[], events: AgentEvent[]): Promise<void> {
  if (!process.env.BRAINTRUST_API_KEY) {
    console.log('[braintrust] no BRAINTRUST_API_KEY, skipping')
    return
  }
  if (!verdicts.length) return

  try {
    const { init, initLogger } = await import('braintrust')
    const project = process.env.BRAINTRUST_PROJECT ?? 'agent-hackathon-arena'

    const experiment = await init(project, {
      experiment: `round-${new Date().toISOString().slice(0, 19)}`,
      metadata: { topic: TOPIC, judges: JUDGES.map((j) => j.id), finalists: verdicts.length },
    })

    for (const v of verdicts) {
      const trace = traceFor(events, v.agentId)

      /** Mechanical checks: deterministic, no model involved. */
      const shipped = trace.previewUrl ? 1 : 0
      const substantial = trace.bytesWritten > 500 ? 1 : 0

      const scores: Record<string, number> = {
        shipped,
        substantial,
        mechanical: (shipped + substantial) / 2,
      }

      // Per-criterion means across the panel, normalised to 0-1.
      for (const c of CRITERIA) {
        const vals = v.perJudge.map((j) => j.scores[c.key] ?? 0)
        scores[c.key] = vals.reduce((a, b) => a + b, 0) / vals.length / 10
      }
      scores.panel_total = v.total / (JUDGES.length * CRITERIA.length * 10)

      experiment.log({
        input: { brief: TOPIC, agent: v.agentId, lane: trace.track },
        output: {
          previewUrl: trace.previewUrl,
          pitch: trace.pitch,
          presentation: v.presentation,
          bytesWritten: trace.bytesWritten,
          actions: trace.actions,
        },
        scores,
        metadata: {
          rank: verdicts.indexOf(v) + 1,
          comments: v.perJudge.map((j) => `${j.judge}: ${j.comment}`),
        },
      })
    }

    const summary = await experiment.summarize()
    console.log(`[braintrust] logged ${verdicts.length} cases to "${project}"`)
    if (summary.experimentUrl) console.log(`[braintrust] ${summary.experimentUrl}`)
  } catch (err) {
    console.warn('[braintrust] logging failed (round is unaffected):', (err as Error).message)
  }
}
