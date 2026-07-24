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

export interface Step {
  phase: Phase
  ms: number
}

/**
 * Speed is a per-round argument, not just an env var, because rounds are now
 * started from the office at whatever pace the operator picks. The env var
 * remains the default so `pnpm dev:fast` behaves exactly as before.
 */
export function sequenceAt(speed: number): Step[] {
  const s = Math.max(1, speed)
  const scaled = (ms: number) => Math.round(ms / s)

  return [
    { phase: 'mingle', ms: scaled(ROUND.mingle) },
    { phase: 'build', ms: scaled(ROUND.build) },
    { phase: 'submit', ms: scaled(ROUND.submit) },
  ]
}

export const SEQUENCE: Step[] = sequenceAt(SPEED)

/** Phase lengths in seconds. What the office actually sets. */
export interface Durations {
  mingle: number
  build: number
  submit: number
}

/** The default speed expressed as seconds, so the office has numbers to show. */
export const defaultDurations = (speed = SPEED): Durations => {
  const [mingle, build, submit] = sequenceAt(speed)
  return {
    mingle: Math.round(mingle.ms / 1000),
    build: Math.round(build.ms / 1000),
    submit: Math.round(submit.ms / 1000),
  }
}

/**
 * An explicit sequence, in seconds.
 *
 * Preferred over `sequenceAt` for anything an operator drives: a speed
 * multiplier hides the number that actually matters, which is how long an
 * agent gets to build. Real agents need minutes; scripted ones need seconds.
 */
export function sequenceOf(d: Durations): Step[] {
  return [
    { phase: 'mingle', ms: Math.round(d.mingle * 1000) },
    { phase: 'build', ms: Math.round(d.build * 1000) },
    { phase: 'submit', ms: Math.round(d.submit * 1000) },
  ]
}

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
  #sequence: Step[]
  #phaseStartedAt: number | null = null
  #phaseMs: number | null = null

  constructor(sequence: Step[] = SEQUENCE) {
    this.#sequence = sequence
  }

  phase(): Phase {
    return this.#phase
  }

  /** Total wall-clock length of the round, so the office can show a countdown. */
  get durationMs(): number {
    return this.#sequence.reduce((n, s) => n + s.ms, 0)
  }

  /** When the current phase began, for the office's countdown pill. */
  get phaseStartedAt(): number | null {
    return this.#phaseStartedAt
  }

  /** How long the current phase runs, or null for untimed phases (idle, judged). */
  get phaseDurationMs(): number | null {
    return this.#phaseMs
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
    for (const step of this.#sequence) {
      if (this.#stopped) break
      await this.#enter(step.phase)
      this.#phaseStartedAt = Date.now()
      this.#phaseMs = step.ms
      await sleep(step.ms)
    }

    /**
     * Judging is a phase the office can render, not dead time after the round.
     * run() stops here; the caller drives the evaluator round and then calls
     * finish(), so /state reports 'judging' for the minutes it actually takes.
     */
    await this.#enter('judging')
  }

  /** Closes the round once judging has produced a winner. */
  async finish() {
    await this.#enter('judged')
    this.#phaseStartedAt = Date.now()
    this.#phaseMs = null
  }

  stop() {
    this.#stopped = true
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** What each phase permits. The tool layer enforces this, the arena reports it. */
export const ALLOWED: Record<Phase, string[]> = {
  idle: [],
  judging: [],
  mingle: ['form_team', 'send_message'],
  build: ['sandbox_bash', 'sandbox_write', 'send_message', 'submit', 'capture_screens'],

  /**
   * record_pitch is submit-only, but it waits rather than refusing when called
   * from 'build' — see waitForSubmit in agent.ts. This table is what the agent
   * is told; the tool is what enforces it.
   */
  submit: ['sandbox_bash', 'sandbox_write', 'submit', 'capture_screens', 'record_pitch'],
  judged: [],
}

export function refuse(tool: string, phase: Phase): string {
  const ok = ALLOWED[phase]
  return ok.length
    ? `"${tool}" is not available during the ${phase} phase. Right now you can only use: ${ok.join(', ')}.`
    : `"${tool}" is not available: the round is in the ${phase} phase and no tools are active.`
}
