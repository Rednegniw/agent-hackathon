/**
 * What the agents are asked to build. One brief for the whole field.
 *
 * Broad on purpose: a narrow brief produces six variations of the same thing.
 * Override without touching code:
 *
 *   TOPIC="Build a tool a developer would use daily" pnpm --filter arena real
 *
 * Or per round, from the office, via the prompt box (see setTopic below).
 */

export const DEFAULT_TOPIC =
  'Build a cool, genuinely useful, minimalist website. One self-contained page. ' +
  'Make it something a real person would want to use, and make it look considered.'

const envTopic = () => process.env.TOPIC ?? DEFAULT_TOPIC

/**
 * `let`, not `const`, so a round started from the office can set the brief
 * before the agents read it. ESM exports are live bindings: every consumer
 * that reads TOPIC *inside a function* — agent.ts, judge.ts and braintrust.ts
 * all do — sees the new value without being re-imported.
 *
 * Module-level mutable state is only safe because RoundRunner refuses to start
 * a second round while one is in flight. If concurrent rounds ever become a
 * thing, this has to become a parameter threaded through runAgent and
 * runEvaluation instead.
 */
export let TOPIC: string = envTopic()

/**
 * Sets the brief for the next round. Pass nothing (or blank) to fall back to
 * the env var, then the default — so clearing the prompt box restores the
 * behaviour you get from the command line.
 */
export function setTopic(topic?: string): string {
  const trimmed = topic?.trim()
  TOPIC = trimmed && trimmed.length > 0 ? trimmed : envTopic()
  return TOPIC
}
