import type { Phase } from './events.js'

/**
 * Round shape in one place. Real durations; divide by ROUND_SPEED to test.
 * Agents do not vote on phases and cannot extend them.
 */
export const ROUND = {
  mingle: 90_000,
  build: 12 * 60_000,
  submit: 2 * 60_000,
} as const

/** ROUND_SPEED=10 makes a 14 minute round take 84 seconds. */
export const SPEED = Math.max(1, Number(process.env.ROUND_SPEED ?? 1))

const scaled = (ms: number) => Math.round(ms / SPEED)

export const SEQUENCE: { phase: Phase; ms: number }[] = [
  { phase: 'mingle', ms: scaled(ROUND.mingle) },
  { phase: 'build', ms: scaled(ROUND.build) },
  { phase: 'submit', ms: scaled(ROUND.submit) },
]

type Hook = (phase: Phase) => void | Promise<void>

/**
 * Wall-clock phase driver. Runs the sequence once, then lands on 'judged'.
 * Hooks are awaited between phases, which is where sandbox creation and
 * end-of-mingle track assignment hang off.
 */
export class PhaseClock {
  #phase: Phase = 'idle'
  #hooks: Hook[] = []
  #stopped = false

  phase(): Phase {
    return this.#phase
  }

  /** Fires on every transition, including the final 'judged'. */
  onPhase(fn: Hook) {
    this.#hooks.push(fn)
  }

  async #enter(phase: Phase) {
    /**
     * Hooks run BEFORE the phase is published, so phase() only reports a
     * phase once its setup has finished. Publishing first creates a race:
     * agents poll phase(), see 'build' the instant it flips, and run ahead
     * of the provision() hook that is still awaiting. Every agent then finds
     * no sandbox and sits the round out while six healthy ones exist.
     */
    for (const h of this.#hooks) {
      try {
        await h(phase)
      } catch (err) {
        console.error(`[phases] hook failed on ${phase}:`, err)
      }
    }

    this.#phase = phase
  }

  async run() {
    for (const step of SEQUENCE) {
      if (this.#stopped) break
      await this.#enter(step.phase)
      await sleep(step.ms)
    }
    await this.#enter('judged')
  }

  stop() {
    this.#stopped = true
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** What each phase permits. The tool layer enforces this, the arena reports it. */
export const ALLOWED: Record<Phase, string[]> = {
  idle: [],
  mingle: ['pick_theme', 'send_message'],
  build: ['sandbox_bash', 'sandbox_write', 'send_message'],
  submit: ['submit'],
  judged: [],
}

export function refuse(tool: string, phase: Phase): string {
  const ok = ALLOWED[phase]
  return ok.length
    ? `"${tool}" is not available during the ${phase} phase. Right now you can only use: ${ok.join(', ')}.`
    : `"${tool}" is not available: the round is in the ${phase} phase and no tools are active.`
}
