import type { AgentStatus } from '../useArena'
import { CAST } from '../roster'
import type { AgentId } from '../arena'

/**
 * One agent's presence in the room. Position is written straight onto the
 * element by the walk loop in Room, so this component never re-renders as an
 * agent moves — only when what it *is* changes.
 */

const LABEL: Record<AgentStatus, string | null> = {
  idle: null,
  thinking: 'Thinking',
  working: 'Working',
  reviewing: 'Reviewing',
  shipped: 'Shipped',
  out: 'Sitting out',
}

const LIVE: AgentStatus[] = ['thinking', 'working', 'reviewing']

export interface PenguinProps {
  id: AgentId
  status: AgentStatus
  /** 'a' or 'b' — which colour ring the agent's team gets, if it has one. */
  ring?: 'a' | 'b'
  thought?: string
  blip?: boolean
  presenting?: boolean
  dimmed?: boolean
  winner?: boolean
  rejected?: boolean
  onOpen?: (id: AgentId) => void
  elementRef?: (el: HTMLDivElement | null) => void
}

export default function Penguin({
  id,
  status,
  ring,
  thought,
  blip,
  presenting,
  dimmed,
  winner,
  rejected,
  onOpen,
  elementRef,
}: PenguinProps) {
  const cast = CAST[id]
  const label = LABEL[status]
  const live = LIVE.includes(status)

  const classes = ['penguin']
  if (presenting) classes.push('presenting')
  if (dimmed) classes.push('dimmed')
  if (winner) classes.push('winner')
  if (rejected) classes.push('rejected')
  if (status === 'out') classes.push('out')

  return (
    <div
      ref={elementRef}
      className={classes.join(' ')}
      data-id={id}
      data-ring={ring}
      onClick={() => onOpen?.(id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen?.(id)
      }}
      aria-label={`${id}: ${label ?? 'idle'}`}
    >
      {thought && <div className="bubble">{thought}</div>}
      {blip && !thought && <div className="blip">✉</div>}

      <div className="penguin-plate">
        <div className="plate-art">
          <img src={cast.avatar} alt="" />
        </div>
        {winner && <span className="trophy">🏆</span>}
      </div>

      <div className="pill-row">
        <span className={`status-pill ${live ? 'live' : ''}`}>
          {ring && <span className={`pill-dot team-${ring}`} />}
          {label ?? id}
          {status === 'shipped' && <span className="pill-dot shipped" />}
        </span>
      </div>
    </div>
  )
}
