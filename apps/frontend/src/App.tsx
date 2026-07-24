import { useEffect, useRef, useState } from 'react'
import type { AgentId, RoundConfig } from './arena'
import { CAST } from './roster'
import { useArena, type Submission } from './useArena'
import Room from './office/Room'
import Hud from './office/Hud'
import Preview from './panels/Preview'
import ProfileSheet from './panels/ProfileSheet'
import SubmissionPanel from './panels/SubmissionPanel'
import OperatorPanel from './panels/OperatorPanel'
import { CrownBanner, ResultsModal, VerdictColumn } from './panels/Judging'

/**
 * The office. One room, and whatever the round's phase floats over it:
 * the lobby before it starts, the submission panel while judging, the
 * results modal and the crown at the end.
 */

const BUBBLE_MS = 6000
const MAX_BUBBLES = 3
const BLIP_MS = 1400

export default function App() {
  const { events, derived, status, connected, error, running, stopping, starting, start, reset } =
    useArena()

  /**
   * Lives here, not in the lobby, so the operator's choices survive the round
   * and the lobby they are handed back at the end is still set up the way they
   * left it.
   */
  const [config, setConfig] = useState<RoundConfig>({
    arena: 'daytona',
    /** Matches DEFAULT_START: a live round costs money, so it is opted into. */
    agents: 'scripted',
    teams: 2,
    agentCount: 6,
    length: 60,
    topic: '',
  })

  const [openAgent, setOpenAgent] = useState<AgentId | null>(null)
  const [expanded, setExpanded] = useState<Submission | null>(null)
  const [subIndex, setSubIndex] = useState(0)
  const [showResults, setShowResults] = useState(false)
  const [bubbles, setBubbles] = useState<Partial<Record<AgentId, string>>>({})
  const [blips, setBlips] = useState<Partial<Record<AgentId, boolean>>>({})

  const phase = status?.phase ?? 'idle'
  const judging = phase === 'judging' || phase === 'judged'

  /**
   * The lobby and the work happen in the office. The aquarium lounge is where
   * the round ends up — it is the demo stage, so it appears once there is
   * something to demo.
   */
  const scene = judging ? 'stage' : 'office'

  /**
   * Thoughts surface as bubbles for a few seconds. Only the newest three are
   * ever on screen — a queue would land stale thoughts late, which reads worse
   * than dropping them.
   */
  const seenThought = useRef(new Set<number>())

  useEffect(() => {
    for (const [id, thought] of Object.entries(derived.thoughts)) {
      if (!thought || seenThought.current.has(thought.seq)) continue
      seenThought.current.add(thought.seq)

      const agentId = id as AgentId
      const body = thought.body.length > 140 ? `${thought.body.slice(0, 138)}…` : thought.body

      setBubbles((prev) => {
        const next = { ...prev, [agentId]: body }
        const keys = Object.keys(next) as AgentId[]
        if (keys.length > MAX_BUBBLES) delete next[keys[0]]
        return next
      })

      setTimeout(() => setBubbles((prev) => {
        if (prev[agentId] !== body) return prev
        const next = { ...prev }
        delete next[agentId]
        return next
      }), BUBBLE_MS)
    }
  }, [derived.thoughts])

  /** A message is a blip over the sender; the text itself lives in Traces. */
  const seenMessage = useRef(new Set<number>())

  useEffect(() => {
    for (const m of derived.messages) {
      if (seenMessage.current.has(m.seq) || m.agentId === 'system') continue
      seenMessage.current.add(m.seq)

      const agentId = m.agentId
      setBlips((prev) => ({ ...prev, [agentId]: true }))
      setTimeout(() => setBlips((prev) => ({ ...prev, [agentId]: false })), BLIP_MS)
    }
  }, [derived.messages])

  /** While judging, the panel follows whoever is presenting. */
  useEffect(() => {
    if (!derived.presenting) return
    const i = derived.submissions.findIndex((s) => s.agentId === derived.presenting)
    if (i >= 0) setSubIndex(i)
  }, [derived.presenting, derived.submissions])

  /**
   * The crown banner is the automatic beat — it keeps the room visible, which
   * is the whole point of the scrimless treatment. The modal is a decision
   * surface and stays shut until the operator asks for it.
   */

  const panelOpen = judging && derived.submissions.length > 0
  const panelInset = openAgent ? 404 : 0

  const hud = <Hud status={status} connected={connected} derived={derived} />

  /**
   * Ends the round and goes back to the lobby, rather than immediately re-running
   * the last config. Both things the operator wants from this button — stopping a
   * round that is going badly, and setting up a fresh one after the leaderboard —
   * end at the same place: the lobby, with the settings in reach.
   *
   * The office-side clearing happens here; the arena's own reset is what makes
   * the lobby reappear, by returning the phase to idle.
   */
  const endRound = () => {
    setShowResults(false)
    setOpenAgent(null)
    setExpanded(null)
    setSubIndex(0)
    seenThought.current.clear()
    seenMessage.current.clear()
    setBubbles({})
    setBlips({})
    void reset()
  }

  const tray = (
    <>
      {derived.ranks.length > 0 && (
        <button className="btn btn-secondary" onClick={() => setShowResults(true)}>
          See the results
        </button>
      )}

      {/**
       * Never disabled while a round runs — that was the bug. A stop button that
       * turns itself off the moment there is something to stop is only useful
       * when it is not needed. It is disabled during 'stopping' alone, where the
       * arena is mid-teardown and a second press has nothing left to do.
       */}
      {phase !== 'idle' && (
        <button className="btn btn-primary" onClick={endRound} disabled={stopping}>
          {stopping ? 'Stopping…' : running || starting ? 'Stop the round' : 'New round'}
        </button>
      )}
    </>
  )

  return (
    <Room
      derived={derived}
      scene={scene}
      panelInset={panelInset}
      bubbles={bubbles}
      blips={blips}
      dim={!!derived.winner}
      onOpenAgent={setOpenAgent}
      hud={hud}
      tray={tray}
    >
      {phase === 'idle' && !running && (
        <OperatorPanel
          running={running}
          starting={starting}
          stopping={stopping}
          error={error ?? status?.error ?? null}
          config={config}
          onConfig={setConfig}
          onStart={start}
        />
      )}

      {panelOpen && (
        <SubmissionPanel
          derived={derived}
          index={subIndex}
          onIndex={setSubIndex}
          onExpand={setExpanded}
          onOpenAgent={setOpenAgent}
        />
      )}

      {judging && derived.presenting && <VerdictColumn derived={derived} />}

      {openAgent && (
        <ProfileSheet agentId={openAgent} events={events} onClose={() => setOpenAgent(null)} />
      )}

      {expanded && (
        <div className="preview-full">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px' }}>
            <div>
              <div className="eyebrow">{expanded.agentId}</div>
              <h4 className="sheet-title">{expanded.title}</h4>
            </div>
            <button className="btn btn-icon btn-secondary" onClick={() => setExpanded(null)} aria-label="Close preview">
              ✕
            </button>
          </div>

          <Preview url={expanded.previewUrl} title={`${expanded.agentId}'s app`} full />

          <div className="owner">
            <div className="plate-art">
              <img src={CAST[expanded.agentId].avatar} alt="" />
            </div>
            <div className="pill-row">
              <span className="status-pill">{expanded.agentId}</span>
            </div>
          </div>
        </div>
      )}

      {derived.winner && <CrownBanner derived={derived} />}

      {showResults && derived.ranks.length > 0 && (
        <ResultsModal derived={derived} onClose={() => setShowResults(false)} />
      )}

      {error && !running && phase !== 'idle' && <div className="error-pill" style={{ position: 'absolute', bottom: 80, left: 18, zIndex: 1200 }}>{error}</div>}
    </Room>
  )
}
