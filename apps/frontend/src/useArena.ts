import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ARENA_URL,
  fetchStatus,
  startRound,
  type AgentEvent,
  type AgentId,
  type ArenaStatus,
} from './arena'
import { ROSTER } from './roster'

/**
 * The office's whole state layer.
 *
 * The raw event array is the only source of truth: everything the screens
 * need is folded out of it on render. At a few hundred events a round that
 * costs nothing, and it means a reconnect (which replays from Last-Event-ID)
 * lands in exactly the same place as a first load.
 */

/** What an agent is doing right now, from the last event it produced. */
export type AgentStatus = 'idle' | 'thinking' | 'working' | 'reviewing' | 'shipped' | 'out'

export interface Submission {
  agentId: AgentId
  title: string
  previewUrl?: string
  seq: number

  /**
   * The agent's own narrated product video, filmed in its sandbox during the
   * submit phase. Arrives on a later 'pitch' event than the submission, so it
   * is stitched on after the fold rather than read off the submit event.
   */
  videoUrl?: string
  posterUrl?: string
  /** Title and tagline the agent gave the product when it filmed. */
  pitchTitle?: string
}

export interface JurorVerdict {
  juror: string
  agentId: AgentId
  total: number | null
  comment: string
  seq: number
}

export interface Ranking {
  agentId: AgentId
  total: number
  rank: number
}

export interface Fold {
  status: Record<string, AgentStatus>
  /** Team id per agent, for those on one. Solo agents are absent. */
  teams: Record<string, string>
  /** Team ids in first-seen order, so colour assignment is stable. */
  teamOrder: string[]
  thoughts: Record<string, { body: string; seq: number } | undefined>
  messages: AgentEvent[]
  submissions: Submission[]
  presenting: AgentId | null
  presentations: Record<string, string>
  verdicts: JurorVerdict[]
  ranks: Ranking[]
  winner: { agentId: AgentId; body: string } | null
  brief: string | null
}

const STATUS_BY_KIND: Partial<Record<AgentEvent['kind'], AgentStatus>> = {
  thought: 'thinking',
  message: 'reviewing',
  build: 'working',
  team: 'thinking',
  submit: 'shipped',
  pitch: 'shipped',
  present: 'reviewing',
}

/**
 * "{juror} on {entry}: {total}/30 - {comment}", or an abstention. The number
 * rides on event.score.points, which is what we trust; the body is only mined
 * for the juror's name and its comment.
 */
function parseVerdict(e: AgentEvent): JurorVerdict {
  const [head, ...rest] = e.body.split(': ')
  const juror = head.split(' on ')[0].trim()
  const tail = rest.join(': ')
  const comment = tail.includes(' - ') ? tail.slice(tail.indexOf(' - ') + 3) : tail

  return {
    juror,
    agentId: e.agentId as AgentId,
    total: e.score ? e.score.points : null,
    comment,
    seq: e.seq,
  }
}

export function fold(events: AgentEvent[]): Fold {
  const out: Fold = {
    status: {},
    teams: {},
    teamOrder: [],
    thoughts: {},
    messages: [],
    submissions: [],
    presenting: null,
    presentations: {},
    verdicts: [],
    ranks: [],
    winner: null,
    brief: null,
  }

  for (const id of ROSTER) out.status[id] = 'idle'

  for (const e of events) {
    if (e.agentId !== 'system') {
      const next = STATUS_BY_KIND[e.kind]
      if (next) out.status[e.agentId] = next

      // An agent that never got a sandbox sits the round out.
      if (e.kind === 'thought' && /no sandbox|sitting this round out|crashed|failed/i.test(e.body)) {
        out.status[e.agentId] = 'out'
      }
    }

    switch (e.kind) {
      case 'thought':
        if (e.agentId !== 'system') out.thoughts[e.agentId] = { body: e.body, seq: e.seq }
        break

      case 'message':
        out.messages.push(e)
        break

      /**
       * "team-1: ada, rex" — every member is named in the body, so one event
       * places the whole team even though only the owner emits it.
       */
      case 'team': {
        const [teamId, roster] = e.body.split(': ')
        if (!teamId || !roster) break
        if (!out.teamOrder.includes(teamId)) out.teamOrder.push(teamId)
        for (const member of roster.split(',').map((m) => m.trim())) {
          if (member) out.teams[member] = teamId
        }
        break
      }

      case 'submit':
        if (e.agentId !== 'system') {
          out.submissions.push({
            agentId: e.agentId,
            title: e.body,
            previewUrl: e.previewUrl,
            seq: e.seq,
          })
        }
        break

      /**
       * Filmed after submitting, so the submission it belongs to already
       * exists. Matched on agent rather than seq for that reason.
       */
      case 'pitch': {
        if (e.agentId === 'system') break
        const sub = out.submissions.find((s) => s.agentId === e.agentId)
        if (sub) {
          sub.videoUrl = e.videoUrl
          sub.posterUrl = e.posterUrl
          sub.pitchTitle = e.body
        }
        break
      }

      case 'present':
        if (e.agentId !== 'system') {
          out.presenting = e.agentId
          out.presentations[e.agentId] = e.body
        }
        break

      case 'verdict':
        out.verdicts.push(parseVerdict(e))
        break

      case 'score':
        if (e.agentId !== 'system' && e.score?.rank) {
          out.ranks.push({ agentId: e.agentId, total: e.score.points, rank: e.score.rank })
        }
        break

      case 'crown':
        if (e.agentId !== 'system') out.winner = { agentId: e.agentId, body: e.body }
        break
    }
  }

  out.ranks.sort((a, b) => a.rank - b.rank)
  return out
}

export interface Arena {
  events: AgentEvent[]
  derived: Fold
  status: ArenaStatus | null
  connected: boolean
  error: string | null
  running: boolean
  starting: boolean
  start: (arena: 'fake' | 'daytona', speed: number) => Promise<void>
}

export function useArena(): Arena {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [status, setStatus] = useState<ArenaStatus | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  /**
   * Events at or below this seq belong to a previous round. The log is
   * append-only and the server replays it on connect, so the office hides the
   * backlog rather than asking the arena to forget it.
   */
  const [hideBefore, setHideBefore] = useState(0)

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

  const start = useCallback(
    async (arena: 'fake' | 'daytona', speed: number) => {
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
    },
    [events, refresh],
  )

  const visible = useMemo(() => events.filter((e) => e.seq > hideBefore), [events, hideBefore])
  const derived = useMemo(() => fold(visible), [visible])

  return {
    events: visible,
    derived,
    status,
    connected,
    error,
    running: status?.state === 'running',
    starting,
    start,
  }
}
