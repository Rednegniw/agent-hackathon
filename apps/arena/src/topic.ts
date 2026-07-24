import { TRACKS, type Track } from './events.js'

/**
 * What the agents are asked to build.
 *
 * Broad on purpose. A narrow brief ("do something with the current time")
 * produces six variations of a clock, which is comparable but dull. A broad
 * one gives the agents room to be surprising while still answering the same
 * question, which is what makes the round worth watching.
 *
 * Override without touching code:
 *   TOPIC="Build a tool a developer would use daily" pnpm --filter arena dev
 *
 * Per lane, when you want two different briefs instead of two heats of one:
 *   TOPIC_ALPHA="..." TOPIC_BETA="..." pnpm --filter arena dev
 */
export const TOPIC =
  process.env.TOPIC ??
  'Build a cool, genuinely useful, minimalist website. One self-contained page. ' +
    'Make it something a real person would want to use, and make it look considered.'

const perTrack = (t: Track): string | undefined => process.env[`TOPIC_${t.toUpperCase()}`]

/** The brief each lane answers. Same for both unless overridden. */
export const THEMES: Record<Track, string> = Object.fromEntries(
  TRACKS.map((t) => [t, perTrack(t) ?? TOPIC]),
) as Record<Track, string>

/** True when the lanes were given different briefs, which changes how we judge. */
export const LANES_DIFFER = new Set(Object.values(THEMES)).size > 1

export function describeTopic(): string {
  return LANES_DIFFER
    ? TRACKS.map((t) => `  ${t} - ${THEMES[t]}`).join('\n')
    : `  ${TOPIC}`
}
