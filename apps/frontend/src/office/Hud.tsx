import { useEffect, useState } from 'react'
import type { ArenaStatus } from '../arena'
import type { Fold } from '../useArena'

/**
 * The cream pills along the top edge: what the round is doing, how long the
 * phase has left, and which teams formed.
 */

function useCountdown(startedAt: number | null, durationMs: number | null) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!startedAt || !durationMs) return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [startedAt, durationMs])

  if (!startedAt || !durationMs) return null

  const left = Math.max(0, startedAt + durationMs - now)
  const total = Math.round(left / 1000)
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

export interface HudProps {
  status: ArenaStatus | null
  connected: boolean
  derived: Fold
}

export default function Hud({ status, connected, derived }: HudProps) {
  const clock = useCountdown(status?.phaseStartedAt ?? null, status?.phaseDurationMs ?? null)
  const phase = status?.phase ?? 'idle'
  const live = status?.state === 'running'

  const counts = derived.teamOrder.map((team, i) => ({
    team,
    ring: i % 2 === 0 ? 'a' : 'b',
    n: Object.values(derived.teams).filter((t) => t === team).length,
  }))

  return (
    <div className="hud">
      <div className="hud-pill">
        <span className={`dot ${live && connected ? '' : 'off'}`} />
        {!connected
          ? 'Offline'
          : live
            ? `Round · ${phase}`
            : phase === 'idle'
              ? 'Lobby · not started'
              : `Round over · ${phase}`}
      </div>

      {clock && <div className="hud-pill clock">{clock} left</div>}

      {counts.length > 0 && (
        <div className="hud-pill">
          {counts.map((c) => (
            <span className="team-count" key={c.team}>
              <span className={`pill-dot team-${c.ring}`} />
              {c.team} · {c.n}
            </span>
          ))}
        </div>
      )}

      {status?.arena && <div className="hud-pill quiet">{status.arena}</div>}
    </div>
  )
}
