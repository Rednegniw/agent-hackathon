import { useEffect, useRef, useState } from 'react'

/**
 * A submitted app, running, in a frame.
 *
 * A cross-origin iframe never fires onerror, and onload fires even for error
 * pages, so "is it alive" cannot be answered properly. We shimmer until the
 * frame loads or ~8s pass, then say so plainly and keep the pitch readable.
 * The open-in-a-new-tab escape hatch is always there.
 */

const TIMEOUT_MS = 8000

export interface PreviewProps {
  url?: string
  title: string
  full?: boolean
  onExpand?: () => void
}

export default function Preview({ url, title, full, onExpand }: PreviewProps) {
  const [state, setState] = useState<'loading' | 'live' | 'offline'>(url ? 'loading' : 'offline')
  const timer = useRef<number>(undefined)

  useEffect(() => {
    if (!url) {
      setState('offline')
      return
    }

    setState('loading')
    timer.current = window.setTimeout(() => setState((s) => (s === 'loading' ? 'offline' : s)), TIMEOUT_MS)
    return () => window.clearTimeout(timer.current)
  }, [url])

  const host = url ? url.replace(/^https?:\/\//, '').slice(0, 46) : 'no preview url'

  return (
    <div className="preview">
      <div className="preview-bar">
        <span className={`dot ${state === 'live' ? '' : 'dead'}`} />
        {host}
      </div>

      <div
        className={`preview-frame ${full ? 'full' : ''}`}
        onClick={onExpand}
        style={{ cursor: onExpand ? 'zoom-in' : undefined }}
      >
        {url && state !== 'offline' && (
          <iframe
            src={url}
            title={title}
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerPolicy="no-referrer"
            onLoad={() => {
              window.clearTimeout(timer.current)
              setState('live')
            }}
          />
        )}

        {state === 'loading' && <div className="preview-loading">loading {title}…</div>}

        {state === 'offline' && (
          <div className="preview-offline">
            <span>preview offline</span>
            {url && (
              <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">
                open in new tab
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
