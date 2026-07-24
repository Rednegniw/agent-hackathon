import { JURY } from '../roster'
import type { Fold } from '../useArena'

/**
 * The judging act, minus the submission panel (which carries the entry
 * itself). Three juror cards dock beside the panel and fill in as each
 * verdict lands; the ranks and the crown follow.
 */

const JUROR_ORDER = ['juror-product', 'juror-craft', 'juror-engineer']

export function VerdictColumn({ derived }: { derived: Fold }) {
  const subject = derived.presenting
  if (!subject) return null

  const mine = derived.verdicts.filter((v) => v.agentId === subject)

  return (
    <div className="verdicts">
      <div className="eyebrow" style={{ color: 'var(--color-neutral-100)' }}>
        The panel · {subject}
      </div>

      {JUROR_ORDER.map((juror) => {
        const verdict = mine.find((v) => v.juror === juror)
        const lens = JURY[juror]?.lens

        if (!verdict) {
          return (
            <div className="verdict-card waiting" key={juror}>
              <div className="who">
                <span className="juror">{juror}</span>
                <span className="total">…</span>
              </div>
              <p>deliberating</p>
            </div>
          )
        }

        return (
          <div className="verdict-card" key={juror}>
            <div className="who">
              <span className="juror">{juror}</span>
              <span className="total">{verdict.total === null ? '—' : `${verdict.total}/30`}</span>
            </div>
            <p className="muted" style={{ fontSize: 11 }}>
              {lens}
            </p>
            <p>{verdict.comment}</p>
          </div>
        )
      })}
    </div>
  )
}

export function ResultsModal({ derived, onClose }: { derived: Fold; onClose: () => void }) {
  const { ranks, winner } = derived
  if (!ranks.length) return null

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow">Results</div>
        <h3>
          {winner ? `${winner.agentId} takes the round` : 'The panel has ruled'}
        </h3>
        <p className="detail muted" style={{ margin: 0 }}>
          Three jurors, thirty points each.
        </p>

        <div className="score-rows">
          {ranks.map((r, i) => (
            <div
              key={r.agentId}
              className={`score-row ${r.rank === 1 ? 'winner' : ''}`}
              style={{ animationDelay: `${(ranks.length - 1 - i) * 220}ms` }}
            >
              <span className="num">{r.total}</span>
              <span className="name">{r.agentId}</span>
              <span className="detail muted" style={{ marginLeft: 'auto' }}>
                rank {r.rank}
              </span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onClose}>
            Back to room
          </button>
        </div>
      </div>
    </div>
  )
}

export function CrownBanner({ derived }: { derived: Fold }) {
  const { winner } = derived
  if (!winner) return null

  const rank = derived.ranks.find((r) => r.agentId === winner.agentId)

  return (
    <div className="crown-banner">
      <div className="line">{winner.agentId} takes the round</div>
      <div className="sub">
        {rank ? `${rank.total} of 90` : winner.body}
        {derived.teams[winner.agentId] ? ` · ${derived.teams[winner.agentId]}` : ''}
      </div>
    </div>
  )
}
