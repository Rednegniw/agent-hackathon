/**
 * What the agents are asked to build. One brief for the whole field.
 *
 * Broad on purpose: a narrow brief produces six variations of the same thing.
 * Override without touching code:
 *
 *   TOPIC="Build a tool a developer would use daily" pnpm --filter arena real
 */
export const TOPIC =
  process.env.TOPIC ??
  'Build a cool, genuinely useful, minimalist website. One self-contained page. ' +
    'Make it something a real person would want to use, and make it look considered.'
