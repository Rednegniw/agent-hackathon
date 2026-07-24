import { useState } from 'react'
import { AGENT_IDS, COMBAT_LENGTHS, type CombatLength, type RoundConfig } from '../arena'

/**
 * The lobby, as the Setup Popovers screen draws it.
 *
 * What /start actually honours: the brief is `topic`, combat length is
 * `durations`, models in play is `agentCount`, and the popover's agent-loop and
 * substrate rows are `agents` and `arena`.
 *
 * Three controls are presentation only, and the arena is untouched by them:
 * the teams count (the orchestrator has no per-round team option and round.ts
 * forms no teams), the archetype deck (no such concept exists), and
 * + Reference (no image input). They are here because the screen reads wrong
 * without them — do not wire anything to them believing they do something.
 */

const TEAM_CHOICES = [1, 2, 3, 4]

/** Ring colours the room already uses, so the dot here matches the penguin there. */
const TEAM_DOTS = ['team-a', 'team-b', 'team-c', 'team-d']

const LENGTH_LABELS: Record<CombatLength, string> = {
  30: '30 sec',
  60: '1 min',
  120: '2 min',
}

/** Cosmetic. See the note above. */
const ARCHETYPES = [
  { glyph: '⚡', name: 'Speedrunner', sub: 'Ships first, polishes never' },
  { glyph: '🔬', name: 'Perfectionist', sub: 'One idea, done properly' },
  { glyph: '🎭', name: 'Showman', sub: 'Builds for the demo' },
  { glyph: '🧱', name: 'Engineer', sub: 'Correctness over flourish' },
  { glyph: '🌿', name: 'Minimalist', sub: 'Removes until it works' },
  { glyph: '🎲', name: 'Wildcard', sub: 'Unpredictable by design' },
  { glyph: '📐', name: 'Systems thinker', sub: 'Structure before surface' },
  { glyph: '🔥', name: 'Contrarian', sub: 'Argues with the brief' },
  { glyph: '🪄', name: 'Stylist', sub: 'Taste as the differentiator' },
  { glyph: '🧭', name: 'Navigator', sub: 'Reads the room, then moves' },
]

const SURPRISES = [
  'A pricing page for a seed-box subscription — warm, rounded, one accent, and the middle tier has to read first.',
  'A single-page tool that makes one annoying daily task genuinely faster. No sign-up, no chrome.',
  'A reading page for a long essay. The typography is the product.',
  'A dashboard for something absurd, treated with total seriousness.',
  'A landing page that explains a hard idea to someone in a hurry.',
]

export interface OperatorPanelProps {
  running: boolean
  starting: boolean
  stopping: boolean
  error: string | null
  config: RoundConfig
  onConfig: (next: RoundConfig) => void
  onStart: (config: RoundConfig) => void
}

export default function OperatorPanel({
  running,
  starting,
  stopping,
  error,
  config,
  onConfig,
  onStart,
}: OperatorPanelProps) {
  const [open, setOpen] = useState<'models' | 'archetypes' | null>(null)
  const [archetypes, setArchetypes] = useState<string[]>(() =>
    ARCHETYPES.slice(0, 6).map((a) => a.name),
  )

  const set = <K extends keyof RoundConfig>(key: K, value: RoundConfig[K]) =>
    onConfig({ ...config, [key]: value })

  const busy = running || starting || stopping

  /**
   * Seats do not always divide evenly, so say the honest thing: settle() tops
   * teams up from the leftovers rather than refusing an awkward split.
   */
  const per = config.agentCount / config.teams
  const rosterNote =
    config.teams === 1
      ? `${config.agentCount} seats · one team, drawn at random`
      : `${config.agentCount} seats · ${
          Number.isInteger(per) ? `${per} models` : `${Math.floor(per)}–${Math.ceil(per)} models`
        } per team, drawn at random`

  const reset = () =>
    onConfig({ arena: 'daytona', agents: 'scripted', teams: 2, agentCount: 6, length: 60, topic: '' })

  const toggleArchetype = (name: string) =>
    setArchetypes((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    )

  return (
    <div className="lobby">
      <div className="lobby-stack">
        <div className="setup-card">
          <div className="setup-head">
            <div className="eyebrow setup-title">Battle setup</div>
            <button className="btn btn-secondary btn-pill" onClick={reset} disabled={busy}>
              Reset
            </button>
          </div>

          <div className="setup-cols">
            <div className="setup-teams">
              <div className="micro-label">Teams</div>
              <div className="seg-row stacked">
                {TEAM_CHOICES.map((n, i) => (
                  <button
                    key={n}
                    className={config.teams === n ? 'on' : ''}
                    onClick={() => set('teams', n)}
                    disabled={busy}
                  >
                    <span className={`pill-dot ${TEAM_DOTS[i]}`} />
                    {n} team{n > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
              <div className="caption">{rosterNote}</div>
            </div>

            <div className="setup-right">
              <div>
                <div className="micro-row">
                  <div className="micro-label">Combat length</div>
                  <div className="micro-value">{LENGTH_LABELS[config.length]}</div>
                </div>
                <div className="seg-row">
                  {COMBAT_LENGTHS.map((n) => (
                    <button
                      key={n}
                      className={config.length === n ? 'on' : ''}
                      onClick={() => set('length', n)}
                      disabled={busy}
                    >
                      {LENGTH_LABELS[n]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="combo-stack">
                <div>
                  <button
                    className={`combo ${open === 'models' ? 'open' : ''}`}
                    onClick={() => setOpen(open === 'models' ? null : 'models')}
                    disabled={busy}
                  >
                    <span className="combo-text">
                      <span className="combo-name">Models in play</span>
                      <span className="combo-sub">
                        {config.agentCount} of {AGENT_IDS.length} in the draw ·{' '}
                        {config.agents === 'real' ? 'live agents' : 'scripted'}
                      </span>
                    </span>
                    <span className="combo-chevron">›</span>
                  </button>

                  {open === 'models' && (
                    <div className="side-pop">
                      <div className="pop-head">
                        <div className="eyebrow">Seats in the draw</div>
                      </div>
                      <div className="pop-list">
                        {AGENT_IDS.map((id, i) => {
                          const on = i < config.agentCount
                          return (
                            <button
                              key={id}
                              className={`check-row ${on ? 'on' : ''}`}
                              onClick={() => set('agentCount', i + 1)}
                            >
                              <span className={`check-box ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
                              <span className="check-name">{id}</span>
                            </button>
                          )
                        })}
                      </div>
                      <div className="pop-foot">
                        <div className="micro-label">Agent loop</div>
                        <div className="seg-row">
                          <button
                            className={config.agents === 'real' ? 'on' : ''}
                            onClick={() => set('agents', 'real')}
                          >
                            Live
                          </button>
                          <button
                            className={config.agents === 'scripted' ? 'on' : ''}
                            onClick={() => set('agents', 'scripted')}
                          >
                            Scripted
                          </button>
                        </div>
                        <div className="micro-label">Substrate</div>
                        <div className="seg-row">
                          <button
                            className={config.arena === 'daytona' ? 'on' : ''}
                            onClick={() => set('arena', 'daytona')}
                          >
                            Daytona
                          </button>
                          <button
                            className={config.arena === 'fake' ? 'on' : ''}
                            onClick={() => set('arena', 'fake')}
                          >
                            Local
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <button
                    className={`combo ${open === 'archetypes' ? 'open' : ''}`}
                    onClick={() => setOpen(open === 'archetypes' ? null : 'archetypes')}
                    disabled={busy}
                  >
                    <span className="combo-text">
                      <span className="combo-name">Archetypes in play</span>
                      <span className="combo-sub">
                        {archetypes.length} of {ARCHETYPES.length} in the deal
                      </span>
                    </span>
                    <span className="combo-chevron">›</span>
                  </button>

                  {open === 'archetypes' && (
                    <div className="side-pop">
                      <div className="pop-head">
                        <div className="eyebrow">The deal</div>
                        <div className="pop-actions">
                          <button
                            className="tiny"
                            onClick={() => setArchetypes(ARCHETYPES.map((a) => a.name))}
                          >
                            All
                          </button>
                          <button className="tiny" onClick={() => setArchetypes([])}>
                            None
                          </button>
                        </div>
                      </div>
                      <div className="pop-list tall">
                        {ARCHETYPES.map((a) => {
                          const on = archetypes.includes(a.name)
                          return (
                            <button
                              key={a.name}
                              className={`check-row ${on ? 'on' : ''}`}
                              onClick={() => toggleArchetype(a.name)}
                            >
                              <span className={`check-box ${on ? 'on' : ''}`}>{on ? '✓' : ''}</span>
                              <span className="check-glyph">{a.glyph}</span>
                              <span className="check-text">
                                <span className="check-name">{a.name}</span>
                                <span className="check-sub">{a.sub}</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {error && <div className="error-pill">{error}</div>}
        </div>

        <div className="brief-card">
          <textarea
            className="brief-input"
            rows={2}
            value={config.topic}
            disabled={busy}
            placeholder="Give them something to fight over"
            onChange={(e) => set('topic', e.target.value)}
          />

          <div className="brief-foot">
            <button
              className="btn btn-secondary btn-pill"
              disabled={busy}
              onClick={() => set('topic', SURPRISES[Math.floor(Math.random() * SURPRISES.length)])}
            >
              Surprise me
            </button>
            {/* Cosmetic, like the archetype deck: /start takes no reference image. */}
            <button
              className="btn btn-secondary btn-pill"
              disabled={busy}
              title="Reference images are not wired to the round yet"
            >
              + Reference
            </button>
            <span className="brief-spacer" />
            <button className="btn btn-primary btn-pill" onClick={() => onStart(config)} disabled={busy}>
              {stopping ? 'Finishing cleanup…' : running ? 'Running…' : starting ? 'Starting…' : 'Start the battle'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
