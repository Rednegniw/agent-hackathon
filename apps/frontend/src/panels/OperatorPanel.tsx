/**
 * The lobby, as the Setup Popovers screen draws it — but bound to the two
 * settings the arena actually has. Model pools and archetypes are not
 * invented here: the panel offers what /start accepts and nothing else.
 */

import type { AgentKind, StartRequest } from '../arena'

export interface OperatorPanelProps {
  running: boolean
  starting: boolean
  error: string | null
  arena: 'fake' | 'daytona'
  speed: number
  agents: AgentKind
  agentCount: number
  onArena: (a: 'fake' | 'daytona') => void
  onSpeed: (n: number) => void
  onAgents: (a: AgentKind) => void
  onAgentCount: (n: number) => void
  onStart: (req: StartRequest) => void
}

export default function OperatorPanel({
  running,
  starting,
  error,
  arena,
  speed,
  agents,
  agentCount,
  onArena,
  onSpeed,
  onAgents,
  onAgentCount,
  onStart,
}: OperatorPanelProps) {
  return (
    <div className="lobby">
      <div className="setup-card">
        <h4>Battle setup</h4>

        <div>
          <div className="field-label">
            <span>Substrate</span>
            <span className="muted">{arena === 'daytona' ? 'real sandboxes' : 'local, free'}</span>
          </div>
          <div className="seg-row">
            <button
              className={arena === 'daytona' ? 'on' : ''}
              onClick={() => onArena('daytona')}
              disabled={running}
            >
              Daytona
            </button>
            <button
              className={arena === 'fake' ? 'on' : ''}
              onClick={() => onArena('fake')}
              disabled={running}
            >
              Fake
            </button>
          </div>
        </div>

        {/* Who competes: the scripted substrate check, or the real agent loop */}
        <div>
          <div className="field-label">
            <span>Agents</span>
            <span className="muted">{agents === 'real' ? 'costs tokens' : 'free, no models'}</span>
          </div>
          <div className="seg-row">
            <button
              className={agents === 'real' ? 'on' : ''}
              onClick={() => onAgents('real')}
              disabled={running}
            >
              Real
            </button>
            <button
              className={agents === 'scripted' ? 'on' : ''}
              onClick={() => onAgents('scripted')}
              disabled={running}
            >
              Scripted
            </button>
          </div>
        </div>

        <div>
          <div className="field-label">
            <span>Roster</span>
            <span className="muted">{agentCount} agents</span>
          </div>
          <label className="slider-band">
            <input
              type="range"
              min={1}
              max={12}
              value={agentCount}
              disabled={running}
              onChange={(e) => onAgentCount(Number(e.target.value))}
            />
          </label>
        </div>

        {/* Speed only reaches the server for scripted rounds; a real one uses its own phases. */}
        <div style={{ opacity: agents === 'real' ? 0.45 : 1 }}>
          <div className="field-label">
            <span>Round speed</span>
            <span className="muted">&times;{speed}</span>
          </div>
          <label className="slider-band">
            <input
              type="range"
              min={1}
              max={60}
              value={speed}
              disabled={running || agents === 'real'}
              onChange={(e) => onSpeed(Number(e.target.value))}
            />
          </label>
          <div className="detail muted">
            {agents === 'real'
              ? 'real rounds use their own phases (20s / 4m / 90s)'
              : speed === 1
                ? '14 minute round'
                : `about ${Math.round(870 / speed)}s`}
          </div>
        </div>

        {error && <div className="error-pill">{error}</div>}

        <button
          className="btn btn-primary"
          onClick={() => onStart({ arena, speed, agents, agentCount })}
          disabled={running || starting}
        >
          {running ? 'Running…' : starting ? 'Starting…' : 'Start the battle'}
        </button>
      </div>
    </div>
  )
}
