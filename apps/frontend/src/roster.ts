import { AGENT_IDS, type AgentId } from './arena'

/**
 * Who each agent is on screen.
 *
 * The persona lines mirror PERSONAS in apps/arena/src/agent.ts, which the
 * office cannot import: that module pulls in the Agent SDK, and none of it
 * belongs in a browser bundle. The quote is the office's own — one line in
 * the agent's voice for the persona card, per the design system.
 *
 * Art is assigned by roster position rather than hard-coded per name, so a
 * thirteenth agent gets a penguin instead of a type error. There are ten
 * plates for twelve agents, so the tail repeats; the name pill disambiguates.
 */

export interface CastMember {
  id: AgentId
  avatar: string
  /** Model badge letter on the avatar corner. */
  badge: string
  persona: string
  quote: string
}

const PLATES = [
  'goggles-beanie',
  'punk-pastel',
  'teal-beanie',
  'aviator-lilac',
  'sleepy-mint',
  'scarf-mohawk',
  'bandana-fish',
  'mint-beanie',
  'beanie-classic',
  'bandana-side',
]

const VOICES: Record<string, { persona: string; quote: string }> = {
  ada: {
    persona: 'Systems-minded. Prefers correctness and edge cases over polish.',
    quote: 'I would rather ship the thing that never breaks.',
  },
  rex: {
    persona: 'Visual. Prefers something striking over something complete.',
    quote: 'If it does not stop you scrolling, it did not happen.',
  },
  juno: {
    persona: 'Product-minded. Prefers the simplest thing a real person would use.',
    quote: 'One page, one job, no explaining.',
  },
  iris: {
    persona: 'Data-minded. Wants to compute or visualise something, not just display it.',
    quote: 'Show me the number and I will show you the shape of it.',
  },
  otto: {
    persona: 'Minimalist. Ships the smallest thing that fully works, then stops.',
    quote: 'Forty lines, then I put the pen down.',
  },
  vera: {
    persona: 'Contrarian. Looks for the angle on a brief that nobody else will take.',
    quote: 'Everyone read the brief the same way. That is the opening.',
  },
  milo: {
    persona: 'Playful. Wants the thing to be fun to use, not just correct.',
    quote: 'Nobody ever came back for the correct one.',
  },
  nova: {
    persona: 'Ambitious. Reaches for the harder version of the idea.',
    quote: 'The easy version is already built. Ask for the other one.',
  },
  pip: {
    persona: 'Pragmatic. Ships the boring thing that works and never apologises for it.',
    quote: 'Boring shipped beats clever nearly done.',
  },
  quill: {
    persona: 'A writer. Cares about the words in the interface as much as the code.',
    quote: 'Half your interface is sentences. Write them.',
  },
  sage: {
    persona: 'Careful. Would rather ship less and have all of it work.',
    quote: 'Fewer promises, all of them kept.',
  },
  wren: {
    persona: 'Curious. Builds the thing it personally wants to exist.',
    quote: 'I am building this for me. You are welcome to it.',
  },
}

export const CAST = Object.fromEntries(
  AGENT_IDS.map((id, i) => [
    id,
    {
      id,
      avatar: `/avatars/${PLATES[i % PLATES.length]}.png`,
      badge: id[0].toUpperCase(),
      persona: VOICES[id]?.persona ?? 'An agent in the round.',
      quote: VOICES[id]?.quote ?? 'Let the work speak.',
    },
  ]),
) as Record<AgentId, CastMember>

export const ROSTER = AGENT_IDS

/** Jurors are characters too, but they never compete. */
export const JURY: Record<string, { lens: string }> = {
  'juror-product': { lens: 'Would anyone use it?' },
  'juror-craft': { lens: 'Is it made well?' },
  'juror-engineer': { lens: 'Does it hold up?' },
}

export const isCast = (id: string): id is AgentId => id in CAST
