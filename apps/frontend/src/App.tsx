import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ARENA_URL, fetchStatus, startRound, type AgentEvent, type ArenaStatus } from './arena'

const PHASES = ['mingle', 'build', 'submit', 'judged'] as const

/**
 * Live view over the arena's event stream, plus the control that starts a
 * round. This is a functional control surface, not the pixel office — it
 * renders the same append-only log the office will, so both can coexist.
 */
export default function App() {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [status, setStatus] = useState<ArenaStatus | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const [arena, setArena] = useState<'fake' | 'daytona'>('daytona')
  const [speed, setSpeed] = useState(25)

  /**
   * Events at or below this seq belong to a previous round. The log is
   * append-only and the server replays it on connect, so the office hides the
   * backlog rather than asking the arena to forget it.
   */
  const [hideBefore, setHideBefore] = useState(0)

  // ---- event stream ----
  useEffect(() => {
    const source = new EventSource(`${ARENA_URL}/events`)

    source.onopen = () => {
      setConnected(true)
      setError(null)
    }

    source.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as AgentEvent

      // Dedupe by seq: a reconnect replays from Last-Event-ID and can overlap.
      setEvents((prev) => (prev.some((p) => p.seq === e.seq) ? prev : [...prev, e]))
    }

    source.onerror = () => {
      setConnected(false)
      setError(`cannot reach the arena at ${ARENA_URL} — is it running?`)
    }

    return () => source.close()
  }, [])

  // ---- status ----
  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchStatus())
    } catch {
      // The SSE error path already reports an unreachable arena.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(refresh, 1000)
    return () => clearInterval(id)
  }, [refresh])

  const running = status?.state === 'running'

  const onStart = async () => {
    setStarting(true)
    setError(null)

    try {
      // Hide the previous round before the new one's events start landing.
      setHideBefore(events.reduce((n, e) => Math.max(n, e.seq), 0))

      const ack = await startRound(arena, speed)
      if (!ack.ok) setError(ack.reason)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setStarting(false)
    }
  }

  const visible = useMemo(() => events.filter((e) => e.seq > hideBefore), [events, hideBefore])
  const submissions = useMemo(() => visible.filter((e) => e.kind === 'submit'), [visible])

  return (
    <div className="app">
      <header>
        <div className="title">
          <h1>arena</h1>
          <span className={`dot ${connected ? 'on' : 'off'}`} />
          <span className="muted">{connected ? 'live' : 'offline'}</span>
        </div>

        <div className="controls">
          <label>
            substrate
            <select
              value={arena}
              onChange={(e) => setArena(e.target.value as 'fake' | 'daytona')}
              disabled={running}
            >
              <option value="daytona">daytona (real sandboxes)</option>
              <option value="fake">fake (local, free)</option>
            </select>
          </label>

          <label>
            speed &times;{speed}
            <input
              type="range"
              min={1}
              max={60}
              value={speed}
              disabled={running}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </label>

          <button className="start" onClick={onStart} disabled={running || starting}>
            {running ? 'running…' : starting ? 'starting…' : 'Start round'}
          </button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="phases">
        {PHASES.map((p) => (
          <span key={p} className={`phase ${status?.phase === p ? 'active' : ''}`}>
            {p}
          </span>
        ))}
        <span className="muted spacer">
          {status ? `${status.state}${status.arena ? ` · ${status.arena}` : ''}` : '…'}
        </span>
      </section>

      {submissions.length > 0 && (
        <section className="submissions">
          <h2>submissions</h2>
          <ul>
            {submissions.map((e) => (
              <li key={e.seq}>
                <strong>{e.agentId}</strong>
                <a href={e.previewUrl} target="_blank" rel="noreferrer">
                  {e.previewUrl}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EventStream events={visible} />
    </div>
  )
}

function EventStream({ events }: { events: AgentEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [events.length])

  if (!events.length) {
    return <p className="empty">No events yet. Press Start round.</p>
  }

  return (
    <ol className="stream">
      {events.map((e) => (
        <li key={e.seq} className={`ev ${e.kind}`}>
          <span className="seq">{e.seq}</span>
          <span className="who">{e.agentId}</span>
          <span className="kind">{e.kind}</span>
          <span className="body">
            {e.targetId && <span className="to">→ {e.targetId} </span>}
            {e.body}
            {e.previewUrl && (
              <>
                {' '}
                <a href={e.previewUrl} target="_blank" rel="noreferrer">
                  open
                </a>
              </>
            )}
          </span>
        </li>
      ))}
      <div ref={endRef} />
    </ol>
  )
}
