import './env.js'
import { DaytonaArena } from './arena-daytona.js'
import { EventLog } from './log.js'
import { MEDIA_DIR, saveMedia } from './media.js'
import { PhaseClock } from './phases.js'
import { captureShots, canFilm, recordPitch } from './studio.js'
import { voiceEnabled } from './voice.js'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Rung 1½ of the testing ladder: the studio path on its own.
 *
 *   pnpm --filter arena smoke:studio
 *
 * One sandbox, one page, two screenshots, one narrated video. Costs a few
 * cents of Daytona and a few seconds of ElevenLabs, and answers the only
 * question worth asking before a live round: can an agent film its own
 * product inside its own sandbox, and does the file reach the office?
 *
 * Never debug this through a full round. If this is green the studio is fine
 * and the problem is the agent loop; if it is red, nothing else matters.
 */

const PORT = 3000

const PAGE = `<!doctype html>
<meta charset="utf-8"><title>Smoke</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; gap:1rem;
         background:#0b0b12; color:#f4f4f5; font-family:system-ui,sans-serif; text-align:center }
  h1 { font-size:clamp(2rem,9vw,5rem); margin:0 }
  p { color:#9c9cae; letter-spacing:.2em; text-transform:uppercase; font-size:.8rem; margin:0 }
</style>
<h1>Studio smoke</h1>
<p>a page, so there is something to photograph</p>`

const runId = `studio-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`
const arena = new DaytonaArena(new EventLog(runId), new PhaseClock([]), runId, false)

const step = async <T,>(label: string, fn: () => Promise<T>): Promise<T> => {
  const started = Date.now()
  const out = await fn()
  console.log(`  ok  ${label.padEnd(28)} ${Date.now() - started}ms`)
  return out
}

const main = async () => {
  console.log(`[studio-smoke] ${runId}`)
  console.log(`[studio-smoke] voice ${voiceEnabled() ? 'on' : 'off (silent video)'}\n`)

  await step('provision sandbox', async () => {
    const ready = await arena.provision(['ada'])
    if (!ready.length) throw new Error('no sandbox')
  })

  const box = arena.sandboxFor('ada')

  await step('chromium + ffmpeg present', async () => {
    if (!(await canFilm(box))) throw new Error('the image is missing chromium or ffmpeg')
  })

  await step('write and serve a page', async () => {
    await box.write('app/index.html', PAGE)
    await box.bash(`cd ~/app && nohup python3 -m http.server ${PORT} >/tmp/serve.log 2>&1 & sleep 1; echo up`)
  })

  const shots = await step('capture 2 screenshots', async () => {
    const taken = await captureShots(box, `http://localhost:${PORT}`, [
      { label: 'home', path: '/', viewport: 'desktop' },
      { label: 'phone', path: '/', viewport: 'mobile' },
    ])

    const failed = taken.filter((s) => s.error)
    if (failed.length) throw new Error(failed.map((s) => `${s.label}: ${s.error}`).join('; '))
    return taken
  })

  console.log(`      thumbnails: ${shots.map((s) => `${s.label} ${s.thumb?.length ?? 0}b`).join(', ')}`)

  const pitch = await step('film the pitch', () =>
    recordPitch(box, 'ada', runId, {
      title: 'Studio smoke',
      tagline: 'A page, photographed and narrated without leaving the sandbox.',
      slides: [
        {
          shot: 'home',
          headline: 'It photographs itself',
          caption: 'Headless chromium, inside the sandbox.',
          narration: 'Every screenshot is taken by a real browser running inside the sandbox itself.',
        },
        {
          shot: 'phone',
          headline: 'At any width',
          narration: 'The same page again at phone width, then muxed to video by ffmpeg.',
        },
      ],
    }),
  )

  /**
   * The frames are kept alongside the video. A slide that renders wrong is
   * invisible in a 23 second mp4 and obvious in a still, and this is the only
   * run where the sandbox is still alive to ask.
   */
  for (const n of ['000', '001', '002']) {
    try {
      saveMedia(runId, `frame-${n}.png`, await box.read(`pitch/frames/${n}.png`))
    } catch {
      // Fewer slides than frames asked for, which is not a failure.
    }
  }

  const file = join(MEDIA_DIR, runId, 'ada.mp4')
  if (!existsSync(file)) throw new Error(`video never reached ${file}`)

  console.log(
    `\n[studio-smoke] ${pitch.seconds}s, ${(statSync(file).size / 1024).toFixed(0)}KB, ` +
      `${pitch.voiced ? 'voiced' : 'silent'}`,
  )
  console.log(`[studio-smoke] ${file}`)
  console.log(`[studio-smoke] served at ${pitch.videoUrl}`)
}

main()
  .catch((err) => {
    console.error(`\n[studio-smoke] FAILED: ${err.message}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await arena.teardown()
    process.exit(process.exitCode ?? 0)
  })
