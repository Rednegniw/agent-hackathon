/**
 * The lobby, as the Setup Popovers screen draws it — but bound to the two
 * settings the arena actually has. Model pools and archetypes are not
 * invented here: the panel offers what /start accepts and nothing else.
 */

export interface OperatorPanelProps {
  running: boolean
  starting: boolean
  error: string | null
  arena: 'fake' | 'daytona'
  speed: number
  onArena: (a: 'fake' | 'daytona') => void
  onSpeed: (n: number) => void
  onStart: (arena: 'fake' | 'daytona', speed: number) => void
}

export default function OperatorPanel({
  running,
  starting,
  error,
  arena,
  speed,
  onArena,
  onSpeed,
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

        <div>
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
              disabled={running}
              onChange={(e) => onSpeed(Number(e.target.value))}
            />
          </label>
          <div className="detail muted">
            {speed === 1 ? '14 minute round' : `about ${Math.round(870 / speed)}s`}
          </div>
        </div>

        {error && <div className="error-pill">{error}</div>}

        <button
          className="btn btn-primary"
          onClick={() => onStart(arena, speed)}
          disabled={running || starting}
        >
          {running ? 'Running…' : starting ? 'Starting…' : 'Start the battle'}
        </button>
      </div>
    </div>
  )
}
