import type { AgentSandbox } from './arena.js'
import type { AgentId } from './events.js'
import { saveMedia } from './media.js'
import { speak, voiceEnabled } from './voice.js'

/**
 * The studio: how an agent turns a running page into a narrated product video.
 *
 * Everything mechanical happens inside the agent's own sandbox, because the
 * default Daytona image already ships the two tools this needs. Measured on a
 * live sandbox on 2026-07-24, not read off a docs page:
 *
 * | chromium 1440x900 headless screenshot | ~1.2s   |
 * | ffmpeg 7.1 mp4 render, 2 slides       | ~0.5s   |
 * | downloading the finished mp4          | ~0.5s   |
 * | apt-get install needed                | none, both are preinstalled |
 *
 * That budget is what makes this fit a 60 second submit phase. The only work
 * done on the orchestrator is the ElevenLabs call, because the API key must
 * never enter a sandbox an agent can run commands in.
 */

/** Everything lives under ~/pitch so an agent's own files are never touched. */
const ROOT = 'pitch'

/**
 * A port for the slide server that agents are not told about and are unlikely
 * to pick. It serves our template, not their product, and only to chromium
 * inside the same sandbox.
 */
const SLIDE_PORT = 3990

const FRAME_W = 1280
const FRAME_H = 720

export const VIEWPORTS = {
  desktop: { w: 1440, h: 900 },
  mobile: { w: 420, h: 880 },
} as const

export type Viewport = keyof typeof VIEWPORTS

/** Slides shorter than this read as a glitch; longer than this outstay a demo. */
const MIN_SLIDE_S = 2.5
const MAX_SLIDE_S = 12

/** Enough to tell a story, few enough to fit the phase. */
export const MAX_SLIDES = 5
export const MAX_SHOTS = 4

const ACCENTS: Record<AgentId, string> = {
  ada: '#7dd3fc',
  rex: '#fb7185',
  juno: '#a3e635',
  iris: '#c4b5fd',
  otto: '#fbbf24',
  vera: '#5eead4',
  milo: '#f472b6',
  nova: '#60a5fa',
  pip: '#fdba74',
  quill: '#d8b4fe',
  sage: '#86efac',
  wren: '#67e8f9',
}

export interface ShotSpec {
  label: string
  /** Path on the agent's own server, e.g. "/" or "/?view=results". */
  path: string
  viewport: Viewport
}

export interface SlideSpec {
  /** A label from a previous capture_screens call, or none for a text slide. */
  shot?: string
  headline: string
  caption?: string
  narration: string
}

export interface Deck {
  title: string
  tagline: string
  slides: SlideSpec[]
}

export interface Pitch {
  videoUrl: string
  posterUrl: string
  seconds: number
  voiced: boolean
}

// ---------------------------------------------------------------------------
// shell safety
// ---------------------------------------------------------------------------

/**
 * Single-quote escaping for anything an agent supplied. Labels and paths reach
 * a shell command, so `; rm -rf ~` in a slide title is a real input even
 * though the blast radius is the agent's own sandbox.
 */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** Labels also become filenames, so they are narrowed rather than escaped. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'shot'

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const pad = (n: number) => String(n).padStart(3, '0')

/**
 * The chromium invocation, in one place.
 *
 * --no-sandbox is required: the sandbox user cannot create the user namespace
 * chromium's own sandbox needs, and without it every screenshot fails with a
 * zygote error. The isolation that matters here is the Daytona sandbox itself.
 *
 * --virtual-time-budget is what makes a screenshot deterministic: chromium
 * fast-forwards timers and waits for the page to settle rather than shooting
 * whatever happens to be painted, so a page that fades in still lands.
 */
const shoot = (url: string, out: string, w: number, h: number, budgetMs = 2500) =>
  [
    'chromium --headless --no-sandbox --disable-gpu --disable-dev-shm-usage',
    '--hide-scrollbars --force-device-scale-factor=1',
    `--virtual-time-budget=${budgetMs}`,
    `--window-size=${w},${h}`,
    `--screenshot=${q(out)}`,
    q(url),
    '>/dev/null 2>&1',
  ].join(' ')

// ---------------------------------------------------------------------------
// capability probe
// ---------------------------------------------------------------------------

const probed = new WeakMap<AgentSandbox, Promise<boolean>>()

/**
 * True when this sandbox can actually film. Cached per sandbox: the answer is
 * a property of the image, and re-probing costs an agent a round-trip it does
 * not have.
 *
 * FakeArena runs on the developer's laptop, where chromium and ffmpeg are
 * usually absent, so this is what keeps a free round from failing loudly at
 * something it was never able to do.
 */
export function canFilm(box: AgentSandbox): Promise<boolean> {
  let p = probed.get(box)

  if (!p) {
    p = box
      .bash('command -v chromium >/dev/null && command -v ffmpeg >/dev/null && echo yes')
      .then((out) => out.includes('yes'))
      .catch(() => false)
    probed.set(box, p)
  }
  return p
}

export const NO_STUDIO =
  'This arena has no chromium or ffmpeg, so screenshots and video are unavailable. ' +
  'Submit without a pitch video.'

// ---------------------------------------------------------------------------
// capture
// ---------------------------------------------------------------------------

export interface Shot {
  label: string
  path: string
  viewport: Viewport
  /** Bytes of the downscaled jpeg, ready to hand back to the agent. */
  thumb?: Uint8Array
  error?: string
}

/**
 * Screenshots the agent's own running page, once per requested state.
 *
 * The thumbnails come back to the agent as images, which is the point: an
 * agent that can see its own product writes a pitch about what it actually
 * shipped instead of what it intended to ship.
 */
/** Which viewport each captured label was shot at. Absent is not an error. */
async function readManifest(box: AgentSandbox): Promise<Record<string, Viewport>> {
  try {
    return JSON.parse(Buffer.from(await box.read(`${ROOT}/shots.json`)).toString('utf8'))
  } catch {
    return {}
  }
}

export async function captureShots(
  box: AgentSandbox,
  /** Base URL the shots are taken against, e.g. "http://localhost:3000". */
  origin: string,
  specs: ShotSpec[],
): Promise<Shot[]> {
  /**
   * Paths are relative to ~/pitch, not absolute. Everything an agent supplied
   * is single-quoted for the shell, and single quotes also suppress `$HOME` —
   * so an absolute path built that way lands in a directory called `$HOME`,
   * chromium writes nothing, and every shot reports a dead server.
   */
  const lines = [`set -u`, `mkdir -p ~/${ROOT}/shots ~/${ROOT}/thumbs`, `cd ~/${ROOT}`]

  for (const s of specs) {
    const { w, h } = VIEWPORTS[s.viewport] ?? VIEWPORTS.desktop
    const png = `shots/${s.label}.png`
    const jpg = `thumbs/${s.label}.jpg`
    const url = `${origin.replace(/\/+$/, '')}${s.path}`

    /**
     * Every shot is independent: one dead route must not abort the others, so
     * failures are recorded and the script keeps going. The thumbnail is
     * downscaled hard because it is spent on the agent's context window.
     */
    lines.push(
      `if ${shoot(url, png, w, h)} && [ -s ${png} ]; then`,
      `  ffmpeg -y -loglevel error -i ${png} -vf scale=760:-2 -q:v 6 ${jpg} </dev/null >/dev/null 2>&1 || true`,
      `  echo "ok ${s.label}"`,
      `else`,
      `  echo "fail ${s.label}"`,
      `fi`,
    )
  }

  await box.write(`${ROOT}/capture.sh`, lines.join('\n') + '\n')
  const out = await box.bash(`bash ~/${ROOT}/capture.sh`)

  /**
   * The manifest is how record_pitch learns that "phone" was shot at phone
   * width. Capturing and filming are two separate tool calls with nothing
   * between them but the agent, so the sandbox holds the state rather than the
   * orchestrator — an agent that captures, thinks, and films three turns later
   * still gets its mobile screenshot in a phone-shaped frame.
   */
  const manifest = { ...(await readManifest(box)) }
  for (const s of specs) manifest[s.label] = s.viewport
  await box.write(`${ROOT}/shots.json`, JSON.stringify(manifest)).catch(() => {})

  const shots: Shot[] = []

  for (const s of specs) {
    if (!out.includes(`ok ${s.label}`)) {
      shots.push({ ...s, error: `nothing rendered at ${s.path} — is your server serving it?` })
      continue
    }

    try {
      shots.push({ ...s, thumb: await box.read(`${ROOT}/thumbs/${s.label}.jpg`) })
    } catch (err) {
      // The screenshot exists and can still be used in the video, even if the
      // preview copy could not be fetched back for the agent to look at.
      shots.push({ ...s, error: `captured, but the preview could not be read: ${(err as Error).message}` })
    }
  }
  return shots
}

// ---------------------------------------------------------------------------
// slide rendering
// ---------------------------------------------------------------------------

const shell = (accent: string, body: string) => `<!doctype html>
<meta charset="utf-8">
<style>
  *, *::before, *::after { box-sizing: border-box }
  html, body { margin:0; padding:0 }
  body {
    width:${FRAME_W}px; height:${FRAME_H}px; overflow:hidden;
    background:#0a0a0f; color:#f4f4f5;
    font-family: "DejaVu Sans", "Liberation Sans", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .stage { position:relative; width:100%; height:100%; padding:64px 72px; display:flex; flex-direction:column }
  .glow { position:absolute; inset:auto auto -40% -20%; width:70%; height:90%;
          background:radial-gradient(circle, ${accent}22, transparent 70%); pointer-events:none }
  .bar { position:absolute; left:0; top:0; width:100%; height:5px; background:${accent} }
  .eyebrow { font-size:19px; letter-spacing:.34em; text-transform:uppercase; color:${accent}; font-weight:700 }
  h1 { font-size:76px; line-height:1.04; margin:18px 0 0; font-weight:800; letter-spacing:-.02em }
  h2 { font-size:52px; line-height:1.1; margin:14px 0 0; font-weight:700; letter-spacing:-.015em }
  p.lead { font-size:31px; line-height:1.4; margin:22px 0 0; color:#c7c7d1; max-width:22ch }
  p.tagline { font-size:33px; line-height:1.42; margin:26px 0 0; color:#d4d4dd; max-width:30ch }
  footer { position:absolute; left:72px; right:72px; bottom:38px; display:flex; justify-content:space-between;
           font-size:18px; letter-spacing:.18em; text-transform:uppercase; color:#7a7a88 }
  footer strong { color:${accent}; font-weight:700 }
  .browser { border-radius:14px; overflow:hidden; background:#15151d;
             box-shadow:0 40px 90px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.09) }
  .chrome { height:34px; display:flex; align-items:center; gap:7px; padding:0 14px; background:#22222c }
  .chrome i { width:10px; height:10px; border-radius:50%; background:#3b3b47 }
  .chrome span { margin-left:12px; font-size:13px; color:#6f6f7d; font-family:"DejaVu Sans Mono", monospace }

  /*
    No fixed height and no cover: a desktop shot is 1440 wide and lands here
    at 626, so letting it keep its own aspect ratio shows the whole page and
    downscales it, which is the one direction that stays sharp.
  */
  .browser img { display:block; width:100%; max-height:${FRAME_H - 240}px; object-fit:cover; object-position:top center }

  /*
    A phone shot is 420 wide and portrait. Poured into the browser frame it is
    upscaled 1.5x and visibly soft, so it gets a frame shaped like the device
    it was taken on and is downscaled instead.
  */
  .phone { width:268px; margin:0 auto; padding:9px; border-radius:34px; background:#1b1b24;
           box-shadow:0 40px 90px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.1) }
  .phone img { display:block; width:100%; height:542px; object-fit:cover; object-position:top center;
               border-radius:26px }
</style>
${body}`

/** Opening card. The product name, spoken, over its own screen. */
function titleSlide(agentId: AgentId, deck: Deck, backdrop?: string): string {
  const accent = ACCENTS[agentId]

  return shell(
    accent,
    `<div class="stage">
  <div class="bar"></div>
  <div class="glow"></div>
  ${
    backdrop
      ? `<img src="../shots/${backdrop}.png" style="position:absolute;inset:0;width:100%;height:100%;
         object-fit:cover;object-position:top center;opacity:.16;filter:blur(7px) saturate(.7)">`
      : ''
  }
  <div style="position:relative;margin:auto 0">
    <div class="eyebrow">${escapeHtml(agentId)} presents</div>
    <h1>${escapeHtml(deck.title)}</h1>
    <p class="tagline">${escapeHtml(deck.tagline)}</p>
  </div>
  <footer><span>built live in the arena</span><strong>${escapeHtml(agentId)}</strong></footer>
</div>`,
  )
}

/** A product slide: the copy on the left, the thing itself on the right. */
function contentSlide(
  agentId: AgentId,
  slide: SlideSpec,
  index: number,
  total: number,
  shotPath?: string,
  viewport: Viewport = 'desktop',
): string {
  const accent = ACCENTS[agentId]
  const footer = `<footer><strong>${escapeHtml(agentId)}</strong><span>${index} / ${total}</span></footer>`

  const copy = `<div class="eyebrow">${escapeHtml(String(index).padStart(2, '0'))}</div>
    <h2>${escapeHtml(slide.headline)}</h2>
    ${slide.caption ? `<p class="lead">${escapeHtml(slide.caption)}</p>` : ''}`

  /**
   * A slide with no screenshot is a legitimate choice, not a degraded one:
   * the closing "what it does" card usually reads better as type alone.
   */
  if (!shotPath) {
    return shell(
      accent,
      `<div class="stage">
  <div class="bar"></div><div class="glow"></div>
  <div style="position:relative;margin:auto 0;max-width:34ch">${copy}</div>
  ${footer}
</div>`,
    )
  }

  const frame =
    viewport === 'mobile'
      ? `<div class="phone"><img src="../shots/${shotPath}.png"></div>`
      : `<div class="browser">
      <div class="chrome"><i></i><i></i><i></i><span>${escapeHtml(slide.shot ?? '')}</span></div>
      <img src="../shots/${shotPath}.png">
    </div>`

  return shell(
    accent,
    `<div class="stage">
  <div class="bar"></div><div class="glow"></div>
  <div style="position:relative;display:grid;grid-template-columns:40% 1fr;gap:56px;align-items:center;height:100%">
    <div>${copy}</div>
    ${frame}
  </div>
  ${footer}
</div>`,
  )
}

// ---------------------------------------------------------------------------
// the render
// ---------------------------------------------------------------------------

/**
 * A rough read time, used only when a slide has no audio to measure. Roughly
 * 2.6 words a second is unhurried speech; the floor stops a three-word
 * headline flashing past.
 */
const readSeconds = (text: string) =>
  Math.min(MAX_SLIDE_S, Math.max(MIN_SLIDE_S, text.trim().split(/\s+/).length / 2.6 + 0.8))

/**
 * Films the deck and returns the finished video's public paths.
 *
 * Ordering matters and is not obvious: narration is synthesised first because
 * each slide's on-screen duration is its own narration's length. Rendering the
 * frames first and guessing durations is what produces a video where the voice
 * is two slides ahead of the picture.
 */
export async function recordPitch(
  box: AgentSandbox,
  agentId: AgentId,
  roundId: string,
  deck: Deck,
): Promise<Pitch> {
  if (!(await canFilm(box))) throw new Error(NO_STUDIO)

  const manifest = await readManifest(box)

  /**
   * A slide naming a shot that was never captured — a typo, or a label from an
   * intention rather than a call — would render a broken image icon in the
   * middle of the pitch. Dropping the reference degrades it to a text slide,
   * which is a legitimate slide.
   */
  const slides = deck.slides.slice(0, MAX_SLIDES).map((s) => ({
    ...s,
    shot: s.shot && s.shot in manifest ? s.shot : undefined,
  }))
  if (!slides.length) throw new Error('a deck needs at least one slide')

  /** The title card is ours; the rest is the agent's. */
  const backdrop = slides.find((s) => s.shot)?.shot
  const all: SlideSpec[] = [
    { headline: deck.title, caption: deck.tagline, narration: deck.tagline },
    ...slides,
  ]

  // ---- narration, on the orchestrator ----
  const clips = voiceEnabled()
    ? await Promise.all(all.map((s) => speak(agentId, s.narration)))
    : all.map(() => null)

  const voiced = clips.some(Boolean)

  await Promise.all(
    clips.map(async (bytes, i) => {
      if (bytes) await box.writeBytes(`${ROOT}/audio/${pad(i)}.mp3`, bytes)
    }),
  )

  // ---- slide HTML ----
  for (const [i, slide] of all.entries()) {
    const html =
      i === 0
        ? titleSlide(agentId, deck, backdrop)
        : contentSlide(agentId, slide, i, all.length - 1, slide.shot, manifest[slide.shot ?? ''])

    await box.write(`${ROOT}/slides/${pad(i)}.html`, html)
  }

  /**
   * Slides are served over http rather than opened as file:// URLs. A file://
   * page can load a sibling image, but the rules around it differ by chromium
   * build and a silently missing product screenshot is the one failure that
   * would not look like a failure — the video renders, with a blank frame
   * where the product should be.
   */
  const lines: string[] = [
    'set -eu',
    `cd ~/${ROOT}`,
    'mkdir -p frames audio',
    `if ! curl -sf -o /dev/null http://localhost:${SLIDE_PORT}/; then`,
    `  nohup python3 -m http.server ${SLIDE_PORT} >/tmp/slides.log 2>&1 &`,
    `  for i in $(seq 20); do curl -sf -o /dev/null http://localhost:${SLIDE_PORT}/ && break; sleep 0.25; done`,
    'fi',
    '> slides.txt',
    '> audio.txt',
  ]

  for (const [i, slide] of all.entries()) {
    const n = pad(i)
    const fallback = readSeconds(slide.narration || slide.headline).toFixed(2)

    lines.push(
      `${shoot(`http://localhost:${SLIDE_PORT}/slides/${n}.html`, `frames/${n}.png`, FRAME_W, FRAME_H, 1800)}`,

      /**
       * The duration of the slide is the duration of its own audio. When a
       * clip is missing — TTS off, or one call failed — a silent track of the
       * estimated length is generated in its place, so the two concat lists
       * stay index-aligned and the remaining voiced slides do not drift.
       */
      `if [ -s audio/${n}.mp3 ]; then`,
      `  D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 audio/${n}.mp3)`,
      `  D=$(awk -v d="$D" 'BEGIN{printf "%.2f", d + 0.7}')`,
      `else`,
      `  D=${fallback}`,
      `  ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=44100:cl=mono -t $D -q:a 9 audio/${n}.mp3 </dev/null`,
      `fi`,
      `echo "file '$PWD/frames/${n}.png'" >> slides.txt`,
      `echo "duration $D" >> slides.txt`,
      `echo "file '$PWD/audio/${n}.mp3'" >> audio.txt`,
    )
  }

  /**
   * The concat demuxer ignores the final entry's duration, so the last frame
   * has to be listed twice or it is dropped to a single frame and the closing
   * narration plays over the previous slide.
   */
  lines.push(
    `echo "file '$PWD/frames/${pad(all.length - 1)}.png'" >> slides.txt`,
    'ffmpeg -y -loglevel error -f concat -safe 0 -i slides.txt -f concat -safe 0 -i audio.txt ' +
      '-vf format=yuv420p,fps=25 -c:v libx264 -preset veryfast -crf 23 ' +
      '-c:a aac -b:a 128k -movflags +faststart pitch.mp4 </dev/null',
    'ffmpeg -y -loglevel error -i frames/000.png -vf scale=640:-2 -q:v 4 poster.jpg </dev/null',
    'ffprobe -v error -show_entries format=duration -of csv=p=0 pitch.mp4',
  )

  await box.write(`${ROOT}/render.sh`, lines.join('\n') + '\n')
  const out = await box.bash(`bash ~/${ROOT}/render.sh`)
  const seconds = Number(/([\d.]+)\s*$/.exec(out.trim())?.[1] ?? 0)

  const [video, poster] = await Promise.all([
    box.read(`${ROOT}/pitch.mp4`),
    box.read(`${ROOT}/poster.jpg`).catch(() => null),
  ])

  return {
    videoUrl: saveMedia(roundId, `${agentId}.mp4`, video),
    posterUrl: poster ? saveMedia(roundId, `${agentId}.jpg`, poster) : '',
    seconds: Number.isFinite(seconds) ? Math.round(seconds) : 0,
    voiced,
  }
}
