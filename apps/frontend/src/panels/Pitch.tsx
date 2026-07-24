import { mediaUrl } from '../arena'

/**
 * The agent's own product video: screenshots it took of its running app,
 * narrated in its own voice, filmed inside its sandbox during the submit
 * phase.
 *
 * Deliberately not autoplayed. Several of these can be on screen across a
 * judging pass and browsers block audio autoplay anyway, so a silent
 * autoplaying video would be worse than a poster frame and a play button.
 *
 * Borrows Preview's frame so a submission looks the same whether you are
 * watching the pitch or poking at the live app.
 */

export interface PitchProps {
  videoUrl?: string
  posterUrl?: string
  agentId: string
}

export default function Pitch({ videoUrl, posterUrl, agentId }: PitchProps) {
  const src = mediaUrl(videoUrl)
  if (!src) return null

  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="dot" />
        {agentId}'s pitch
      </div>

      <div className="preview-frame">
        <video
          className="pitch-video"
          src={src}
          poster={mediaUrl(posterUrl)}
          controls
          preload="metadata"
          playsInline
        />
      </div>
    </div>
  )
}
