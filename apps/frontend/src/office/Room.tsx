import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentId } from '../arena'
import { ROSTER } from '../roster'
import type { Fold } from '../useArena'
import Penguin from './Penguin'

/**
 * The room, and the loop that keeps it alive.
 *
 * Positions are simulated in a ref and written to the DOM inside one
 * requestAnimationFrame loop — deliberately outside React. Ticking six
 * transforms through state at 60fps would re-render the whole subtree for
 * nothing. Only discrete things (bursts, which agent is talking) are state.
 *
 * Ported from design/battle-app-system/Battle Room Scene.dc.html.
 */

const GLYPHS = ['🔥', '👏', '💀', '🤯', '✨', '😤']

/** Walkable floor as a fraction of the stage: off the water, off the riser. */
const BOUNDS = { x0: 0.06, x1: 0.56, y0: 0.48, y1: 0.78 }

interface Walker {
  x: number
  y: number
  tx: number
  ty: number
  wait: number
  speed: number
}

interface Burst {
  id: string
  glyph: string
  left: number
  top: number
}

function randPoint(stageWidth: number, panelInset: number) {
  // Keep the 48px plate and its pill clear of whatever panel is open.
  const maxX = (stageWidth - panelInset - 70) / (stageWidth || 1)
  const x1 = Math.max(BOUNDS.x0 + 0.1, Math.min(BOUNDS.x1, maxX))
  return {
    x: BOUNDS.x0 + Math.random() * (x1 - BOUNDS.x0),
    y: BOUNDS.y0 + Math.random() * (BOUNDS.y1 - BOUNDS.y0),
  }
}

export interface RoomProps {
  derived: Fold
  /** Right-hand inset the walkers should avoid, in px. */
  panelInset?: number
  /** Agent whose thought bubble should show, and the text. */
  bubbles: Partial<Record<AgentId, string>>
  blips: Partial<Record<AgentId, boolean>>
  rejected?: AgentId | null
  dim?: boolean
  onOpenAgent?: (id: AgentId) => void
  hud?: ReactNode
  tray?: ReactNode
  children?: ReactNode
}

export default function Room({
  derived,
  panelInset = 0,
  bubbles,
  blips,
  rejected,
  dim,
  onOpenAgent,
  hud,
  tray,
  children,
}: RoomProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const elements = useRef(new Map<AgentId, HTMLDivElement>())
  const sim = useRef(new Map<AgentId, Walker>())
  const inset = useRef(panelInset)
  const [bursts, setBursts] = useState<Burst[]>([])

  inset.current = panelInset

  const spawn = useCallback((left: number, top: number, glyph: string) => {
    const id = Math.random().toString(36).slice(2)
    setBursts((prev) => [...prev, { id, glyph, left, top }])
    setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), 1700)
  }, [])

  const fireEmoji = (glyph: string) => spawn(30 + Math.random() * 30, 55 + Math.random() * 25, glyph)

  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min(64, now - last)
      last = now

      const stage = stageRef.current
      if (stage) {
        const w = stage.clientWidth
        const h = stage.clientHeight

        for (const [id, el] of elements.current) {
          let a = sim.current.get(id)

          if (!a) {
            const p = randPoint(w, inset.current)
            a = { ...p, tx: p.x, ty: p.y, wait: 400 + Math.random() * 2600, speed: 26 + Math.random() * 22 }
            sim.current.set(id, a)
          }

          if (a.wait > 0) {
            a.wait -= dt
          } else {
            const dx = a.tx - a.x
            const dy = a.ty - a.y
            const dist = Math.hypot(dx * w, dy * h)

            if (dist < 3) {
              const p = randPoint(w, inset.current)
              a.tx = p.x
              a.ty = p.y
              a.wait = 1200 + Math.random() * 5000
              a.speed = 26 + Math.random() * 22
            } else {
              const step = (a.speed * dt) / 1000
              a.x += ((dx * w) / dist) * (step / w)
              a.y += ((dy * h) / dist) * (step / h)
            }
          }

          el.style.transform = `translate3d(${a.x * w}px, ${a.y * h}px, 0)`
          el.style.zIndex = String(Math.round(a.y * 1000))
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const setRef = useCallback(
    (id: AgentId) => (el: HTMLDivElement | null) => {
      if (el) elements.current.set(id, el)
      else elements.current.delete(id)
    },
    [],
  )

  /** Ring colour marks which team an agent belongs to. Solo agents keep cream. */
  const teamRing = (agentId: AgentId): 'a' | 'b' | undefined => {
    const team = derived.teams[agentId]
    if (!team) return undefined
    return derived.teamOrder.indexOf(team) % 2 === 0 ? 'a' : 'b'
  }

  const presenting = derived.presenting

  return (
    <div className="room">
      <img className="room-art" src="/room.png" alt="" />

      <div className="room-stage" ref={stageRef} data-stage="1">
        {ROSTER.map((id) => (
          <Penguin
            key={id}
            id={id}
            elementRef={setRef(id)}
            status={derived.status[id] ?? 'idle'}
            ring={teamRing(id)}
            thought={bubbles[id]}
            blip={blips[id]}
            presenting={presenting === id}
            dimmed={!!presenting && presenting !== id}
            winner={derived.winner?.agentId === id}
            rejected={rejected === id}
            onOpen={onOpenAgent}
          />
        ))}

        {bursts.map((b) => (
          <div key={b.id} className="burst" style={{ left: `${b.left}%`, top: `${b.top}%` }}>
            {b.glyph}
          </div>
        ))}
      </div>

      {dim && <div className="room-dim" />}

      {hud}

      <div className={`tray ${panelInset ? 'inset' : ''}`}>
        <div className="emoji-tray">
          {GLYPHS.slice(0, 4).map((g) => (
            <button
              key={g}
              className="btn btn-icon"
              onClick={() => fireEmoji(g)}
              aria-label={`React with ${g}`}
            >
              {g}
            </button>
          ))}
        </div>
        {tray}
      </div>

      {children}
    </div>
  )
}
