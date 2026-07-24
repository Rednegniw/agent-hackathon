import { useState } from 'react'
import type { AgentEvent, AgentId } from '../arena'
import { CAST } from '../roster'

/**
 * Who an agent is, and everything it has done this round. The right-hand
 * 392px sheet, no scrim — the room keeps running behind it.
 *
 * Messages live here rather than on the canvas: a rivalry is worth reading in
 * full, and the trace is where an agent's story already is.
 */

const DISC: Record<string, string> = {
  thought: '◇',
  message: '✉',
  build: '⌘',
  submit: '▲',
  team: '◈',
  present: '❝',
}

export interface ProfileSheetProps {
  agentId: AgentId
  events: AgentEvent[]
  onClose: () => void
}

export default function ProfileSheet({ agentId, events, onClose }: ProfileSheetProps) {
  const [tab, setTab] = useState<'persona' | 'traces'>('traces')
  const cast = CAST[agentId]

  /** Its own events, plus messages sent to it — both sides of a conversation. */
  const trace = events.filter(
    (e) => e.agentId === agentId || (e.kind === 'message' && e.targetId === agentId),
  )

  return (
    <aside className="sheet">
      <div className="sheet-head">
        <div>
          <div className="eyebrow">{cast.badge} · agent</div>
          <h4 className="sheet-title">{agentId}</h4>
        </div>
        <button className="btn btn-icon btn-secondary" onClick={onClose} aria-label="Close sheet">
          ✕
        </button>
      </div>

      <div style={{ padding: '0 20px 14px' }}>
        <div className="seg-row">
          <button className={tab === 'persona' ? 'on' : ''} onClick={() => setTab('persona')}>
            Persona
          </button>
          <button className={tab === 'traces' ? 'on' : ''} onClick={() => setTab('traces')}>
            Traces
          </button>
        </div>
      </div>

      <div className="sheet-body">
        {tab === 'persona' ? (
          <>
            <p className="persona-quote">“{cast.quote}”</p>
            <p className="detail muted" style={{ margin: 0 }}>
              {cast.persona}
            </p>
          </>
        ) : trace.length === 0 ? (
          <p className="detail muted">Nothing yet this round.</p>
        ) : (
          <div className="trace">
            {trace.map((e) => (
              <TraceStep key={e.seq} event={e} viewer={agentId} />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function TraceStep({ event, viewer }: { event: AgentEvent; viewer: AgentId }) {
  const sent = event.agentId === viewer

  return (
    <div className={`trace-step kind-${event.kind}`}>
      <span className="trace-disc">{DISC[event.kind] ?? '·'}</span>
      <div className="trace-body">
        {event.kind === 'message' && (
          <span className="msg-eyebrow">
            {sent ? `→ ${event.targetId}` : `${event.agentId} →`}
          </span>
        )}
        {event.kind === 'build' ? <code>{event.body}</code> : event.body}
      </div>
    </div>
  )
}
