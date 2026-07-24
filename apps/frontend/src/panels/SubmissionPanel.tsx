import { useEffect, useState } from 'react'
import type { AgentId } from '../arena'
import { CAST } from '../roster'
import type { Fold, Submission } from '../useArena'
import Preview from './Preview'
import Pitch from './Pitch'

/**
 * The judging surface: the 404px panel inset from the top-left of the canvas,
 * one submission at a time, no scrim. Arrow keys page the pile.
 *
 * Heat and ranking are here as the design drew them, but they are a soft
 * signal only — nothing is sent anywhere until there is a human player.
 */

const RANK_WORDS = ['Missed the brief', 'Thin', 'Solid', 'Would ship it', 'Best in the room']

export interface SubmissionPanelProps {
  derived: Fold
  /** Index to show; when judging, the presenting agent's entry wins. */
  index: number
  onIndex: (i: number) => void
  onExpand: (s: Submission) => void
  onOpenAgent: (id: AgentId) => void
}

export default function SubmissionPanel({
  derived,
  index,
  onIndex,
  onExpand,
  onOpenAgent,
}: SubmissionPanelProps) {
  const { submissions } = derived
  const [heat, setHeat] = useState<Record<number, number>>({})
  const [rank, setRank] = useState<Record<number, number>>({})

  const clamped = Math.min(index, Math.max(0, submissions.length - 1))
  const current = submissions[clamped]

  /**
   * The pitch leads when there is one. It is the agent's own account of what
   * it built, in its own voice, and it reads in twenty seconds — the live app
   * is one tap away and stays the thing you poke at.
   */
  const [tab, setTab] = useState<'pitch' | 'app'>('pitch')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') onIndex(Math.max(0, clamped - 1))
      if (e.key === 'ArrowRight') onIndex(Math.min(submissions.length - 1, clamped + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clamped, submissions.length, onIndex])

  if (!current) return null

  const cast = CAST[current.agentId]
  const taps = heat[current.seq] ?? 0
  const myRank = rank[current.seq] ?? 0
  const pitch = derived.presentations[current.agentId]

  return (
    <aside className="panel">
      <div className="sheet-head">
        <div>
          <div className="eyebrow">
            Submission {clamped + 1} of {submissions.length}
            <span className="progress-dots">
              {submissions.map((s, i) => (
                <i key={s.seq} className={i === clamped ? 'current' : rank[s.seq] ? 'done' : ''} />
              ))}
            </span>
          </div>
          <h4 className="sheet-title">{current.title}</h4>
        </div>
        <button
          className="btn btn-icon btn-secondary"
          onClick={() => onOpenAgent(current.agentId)}
          aria-label={`Open ${current.agentId}'s traces`}
        >
          ☰
        </button>
      </div>

      <div className="sheet-body">
        {current.videoUrl && (
          <div className="seg-row">
            <button className={tab === 'pitch' ? 'on' : ''} onClick={() => setTab('pitch')}>
              Pitch
            </button>
            <button className={tab === 'app' ? 'on' : ''} onClick={() => setTab('app')}>
              Live app
            </button>
          </div>
        )}

        {current.videoUrl && tab === 'pitch' ? (
          <Pitch
            videoUrl={current.videoUrl}
            posterUrl={current.posterUrl}
            agentId={current.agentId}
          />
        ) : (
          <Preview
            url={current.previewUrl}
            title={`${current.agentId}'s app`}
            onExpand={() => onExpand(current)}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="plate-art" style={{ position: 'relative', width: 30, height: 30, borderRadius: 8 }}>
            <img src={cast.avatar} alt="" />
          </div>
          <span className="detail">
            <strong>{current.agentId}</strong>
            {derived.teams[current.agentId] && (
              <span className="muted"> · {derived.teams[current.agentId]}</span>
            )}
          </span>
        </div>

        {pitch && <p className="detail" style={{ margin: 0, lineHeight: 1.6 }}>{pitch}</p>}

        <div className="tag-row">
          {derived.teams[current.agentId] && (
            <span className="tag tag-accent">{derived.teams[current.agentId]}</span>
          )}
          <span className="tag tag-accent-2">Shipped</span>
          {current.previewUrl && <span className="tag tag-outline">Live preview</span>}
          {current.videoUrl && <span className="tag tag-outline">Filmed its own pitch</span>}
        </div>
      </div>

      <div className="sheet-foot" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className={`btn ${taps ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setHeat((h) => ({ ...h, [current.seq]: Math.min(5, taps + 1) }))}
            disabled={taps >= 5}
          >
            🔥 {taps || 'Heat'}
          </button>
          <span className="detail muted">soft signal · not scored</span>
        </div>

        <div>
          <div className="field-label">
            <span>Your ranking</span>
            <span className="muted">{myRank ? RANK_WORDS[myRank - 1] : '—'}</span>
          </div>
          <div className="seg-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={myRank === n ? 'on' : ''}
                onClick={() => setRank((r) => ({ ...r, [current.seq]: myRank === n ? 0 : n }))}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn-secondary"
            style={{ flex: 1 }}
            onClick={() => onIndex(Math.max(0, clamped - 1))}
            disabled={clamped === 0}
          >
            ←
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 2 }}
            onClick={() => onIndex(Math.min(submissions.length - 1, clamped + 1))}
            disabled={clamped >= submissions.length - 1}
          >
            Next submission
          </button>
        </div>
      </div>
    </aside>
  )
}
