import type { CSSProperties } from 'react'
import { JURY, JUROR_ORDER } from '../roster'
import type { Fold } from '../useArena'

/**
 * The panel, in the tank.
 *
 * Three sharks hang in the aquarium on the right of the lounge for the whole
 * judging act. They arrive with the stage — the sharks appearing *is* the beat
 * that says the round has stopped being built and started being judged.
 *
 * Unlike the walkers in Room, nothing here is simulated: the sharks hold a
 * lane and drift, so the movement is pure CSS and costs no frames. The only
 * thing that reacts to the round is the pill, which turns into a score once
 * that juror has ruled on whoever is presenting.
 */

/**
 * A lane per juror, in percentages of the room. The tank's front glass runs
 * diagonally, so the lower lanes sit further right to stay in the water; the
 * drift is small enough that nobody swims through it.
 */
const LANES = [
  { x: 72, y: 17, drift: 34, dur: 13 },
  { x: 79, y: 40, drift: -28, dur: 17 },
  { x: 76, y: 62, drift: 30, dur: 15 },
]

export default function Jury({ derived }: { derived: Fold }) {
  const subject = derived.presenting

  return (
    <div className="tank">
      {JUROR_ORDER.map((id, i) => {
        const juror = JURY[id]
        const lane = LANES[i]
        const verdict = subject
          ? derived.verdicts.find((v) => v.juror === id && v.agentId === subject)
          : undefined

        const style = {
          '--lane-x': `${lane.x}%`,
          '--lane-y': `${lane.y}%`,
          '--drift': `${lane.drift}px`,
          '--swim': `${lane.dur}s`,
          '--enter': `${i * 220}ms`,
        } as CSSProperties

        return (
          <div className="shark" key={id} style={style} title={juror.lens}>
            <div className="shark-swim">
              <div className="shark-plate">
                <div className="plate-art">
                  <img src={juror.avatar} alt="" />
                </div>
              </div>

              {/* Shimmering means deliberating, so it only runs while there is
                  someone on the floor this juror has not ruled on yet. */}
              <div className="pill-row">
                <span className={`status-pill ${subject && !verdict ? 'live' : ''}`}>
                  {juror.name}
                  {verdict && (
                    <span className="score">
                      {verdict.total === null ? '—' : `${verdict.total}/30`}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
