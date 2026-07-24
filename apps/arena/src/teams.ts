import { AGENT_IDS, type AgentId } from './events.js'

/**
 * Team formation.
 *
 * Solo agents produce six small things. Teams produce fewer, larger things and
 * a reason for the agents to talk to each other, which is the difference
 * between a chat feature that looks decorative and one that decides the round.
 *
 * Size is bounded at both ends on purpose. A minimum forces negotiation: an
 * agent cannot simply refuse to collaborate. A maximum stops all six piling
 * into one team and turning the round into a single entry.
 *
 *   TEAM_MIN=2 TEAM_MAX=3 pnpm --filter arena real
 *   TEAM_MIN=1 TEAM_MAX=1   solo, the old behaviour
 */

export const TEAM_MIN = Math.max(1, Number(process.env.TEAM_MIN ?? 2))
export const TEAM_MAX = Math.max(TEAM_MIN, Number(process.env.TEAM_MAX ?? 3))

export const TEAMS_ENABLED = TEAM_MAX > 1

export interface Team {
  id: string
  members: AgentId[]
  /** Speaks for the team when it presents and is crowned. */
  owner: AgentId
}

export class TeamRoster {
  #teams = new Map<string, Team>()
  #of = new Map<AgentId, string>()
  #submitter = new Map<string, AgentId>()
  #next = 1

  teams(): Team[] {
    return [...this.#teams.values()]
  }

  teamOf(agentId: AgentId): Team | undefined {
    const id = this.#of.get(agentId)
    return id ? this.#teams.get(id) : undefined
  }

  /** The member who speaks for the team. */
  isOwner(agentId: AgentId): boolean {
    return this.teamOf(agentId)?.owner === agentId
  }

  /**
   * A team ships ONE project. The first member whose submission is accepted
   * becomes the team's submitter; everyone else is refused and told who holds
   * it. Checked before the health check and recorded only after it passes, so
   * a dead server never locks a team out of shipping.
   */
  submitterOf(agentId: AgentId): AgentId | undefined {
    const team = this.teamOf(agentId)
    return team ? this.#submitter.get(team.id) : undefined
  }

  recordSubmit(agentId: AgentId): void {
    const team = this.teamOf(agentId)
    if (team && !this.#submitter.has(team.id)) this.#submitter.set(team.id, agentId)
  }

  /**
   * An agent invites others. Idempotent, and refuses anything that would break
   * the size bounds or steal a member from an existing team.
   */
  form(founder: AgentId, invitees: AgentId[]): { ok: true; team: Team } | { ok: false; reason: string } {
    if (this.#of.has(founder)) {
      return { ok: false, reason: `you are already on ${this.#of.get(founder)}` }
    }

    const unknown = invitees.filter((i) => !AGENT_IDS.includes(i))
    if (unknown.length) return { ok: false, reason: `no such agent: ${unknown.join(', ')}` }

    const taken = invitees.filter((i) => this.#of.has(i))
    if (taken.length) return { ok: false, reason: `already on a team: ${taken.join(', ')}` }

    const members = [founder, ...invitees.filter((i) => i !== founder)]
    if (members.length > TEAM_MAX) {
      return { ok: false, reason: `teams hold at most ${TEAM_MAX}, you proposed ${members.length}` }
    }

    const id = `team-${this.#next++}`
    const team: Team = { id, members, owner: founder }

    this.#teams.set(id, team)
    for (const m of members) this.#of.set(m, id)

    return { ok: true, team }
  }

  /**
   * Closes the roster when mingle ends. Anyone unteamed is grouped into teams
   * that satisfy TEAM_MIN, and undersized teams absorb the leftovers. Nobody is
   * left out, because a stalled agent is worse than an imperfect team.
   */
  settle(roster: readonly AgentId[]): Team[] {
    const loose = roster.filter((id) => !this.#of.has(id))

    // Top up undersized teams first.
    for (const team of this.#teams.values()) {
      while (team.members.length < TEAM_MIN && loose.length) {
        const pick = loose.shift()!
        team.members.push(pick)
        this.#of.set(pick, team.id)
      }
    }

    // Whatever is left becomes new teams of TEAM_MAX.
    while (loose.length) {
      const members = loose.splice(0, TEAM_MAX)
      const id = `team-${this.#next++}`

      this.#teams.set(id, { id, members, owner: members[0] })
      for (const m of members) this.#of.set(m, id)
    }

    /**
     * A trailing team below the minimum gets folded into the smallest other
     * team, even if that pushes it one over TEAM_MAX. A team of one defeats
     * the point; one oversized team does not.
     */
    for (const team of [...this.#teams.values()]) {
      if (team.members.length >= TEAM_MIN || this.#teams.size === 1) continue

      const host = this.teams()
        .filter((t) => t.id !== team.id)
        .sort((a, b) => a.members.length - b.members.length)[0]
      if (!host) continue

      for (const m of team.members) {
        host.members.push(m)
        this.#of.set(m, host.id)
      }
      this.#teams.delete(team.id)
    }

    return this.teams()
  }

  describe(): string {
    return this.teams()
      .map((t) => `${t.id}: ${t.members.join(', ')}`)
      .join('\n')
  }
}
