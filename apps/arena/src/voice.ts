import type { AgentId } from './events.js'

/**
 * ElevenLabs, for the voiced pitch.
 *
 * One fixed voice per agent, assigned here next to the persona, because the
 * voice is part of the character the same way the name is. Six voices chosen to
 * be tellable apart on a room's PA: two accents, mixed registers, no two
 * neighbours in the roster sounding alike.
 */
export const VOICES: Record<AgentId, string> = {
  ada: 'Xb7hH8MSUJpSbSDYk0k2', // Alice, british, clear and precise
  rex: 'TX3LPaxmHKxFdv7VOQHJ', // Liam, american, energetic
  juno: 'cgSgspJ2msm6clMCkdW9', // Jessica, american, bright and warm
  iris: 'XrExE9yKIg1WjnnlVkGX', // Matilda, american, professional
  otto: 'onwK4e9ZLuTAKqWW03F9', // Daniel, british, steady broadcaster
  vera: 'FGY2WhTYpPnrIDTdsKH5', // Laura, american, quirky
  milo: 'iP95p4xoKVk53GoZ742B', // Chris, american, charming
  nova: 'IKne3meq5aSn9XLyUdCD', // Charlie, australian, confident
  pip: 'EXAVITQu4vr4xnSDxMaL', // Sarah, american, reassuring
  quill: 'pFZP5JQG7iQjIQuC4Bku', // Lily, british, velvety
  sage: 'pqHfZKP75CvOlQylNhV4', // Bill, american, wise and mature
  wren: 'SAz9YHcvj6GT2YYXdXww', // River, neutral, informative
}

/**
 * Flash rather than multilingual: a pitch is six short lines synthesised while
 * a 60 second phase is running, so latency is the constraint that matters and
 * the quality difference is inaudible over a projector.
 */
const MODEL = process.env.ELEVENLABS_MODEL ?? 'eleven_flash_v2_5'
const FORMAT = 'mp3_44100_128'

/** A line longer than this is a paragraph, and it will not fit a slide. */
const MAX_CHARS = 500

export const voiceEnabled = (): boolean => Boolean(process.env.ELEVENLABS_API_KEY)

/**
 * The account allows four concurrent syntheses. Six agents filming four-slide
 * decks at the end of the same submit phase is twenty-four at once, and the
 * overflow comes back as 429 concurrent_limit_exceeded — observed live, where
 * a two-agent round already lost two clips.
 *
 * A queue rather than a retry-only fix: retries alone still send the burst,
 * and the whole round is racing one phase. Three, not four, leaves room for
 * anything else on the key.
 */
const LIMIT = Number(process.env.ELEVENLABS_CONCURRENCY ?? 3)

let active = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (active < LIMIT) {
    active++
    return
  }
  await new Promise<void>((resolve) => waiting.push(resolve))
  active++
}

function release(): void {
  active--
  waiting.shift()?.()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Synthesises one line. Returns null on any failure, deliberately: a TTS
 * outage must cost the round its audio, never its video and never its round.
 * Every caller renders silently when this returns null.
 */
export async function speak(agentId: AgentId, text: string): Promise<Uint8Array | null> {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key || !text.trim()) return null

  const voice = VOICES[agentId] ?? VOICES.ada

  await acquire()

  try {
    /**
     * Two attempts. The queue above should keep us under the ceiling, but a
     * long round can overlap a previous round's tail, and a lost clip is a
     * silent slide in the middle of a pitch.
     */
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=${FORMAT}`,
          {
            method: 'POST',
            headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: text.slice(0, MAX_CHARS),
              model_id: MODEL,
              voice_settings: { stability: 0.4, similarity_boost: 0.8, speed: 1.05 },
            }),
            signal: AbortSignal.timeout(20_000),
          },
        )

        if (res.ok) return new Uint8Array(await res.arrayBuffer())

        const body = (await res.text()).slice(0, 200)
        if (res.status !== 429 || attempt === 1) {
          console.warn(`[voice] ${agentId}: ${res.status} ${body}`)
          return null
        }
        await sleep(1200)
      } catch (err) {
        console.warn(`[voice] ${agentId} failed:`, (err as Error).message)
        return null
      }
    }
    return null
  } finally {
    release()
  }
}
