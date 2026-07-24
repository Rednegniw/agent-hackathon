import './env.js'
import { Daytona } from '@daytona/sdk'

/**
 * Mints a signed preview URL for every live sandbox so you can look at what the
 * agents are serving right now, mid-round, without waiting for a submission.
 *
 *   pnpm --filter arena peek            every live sandbox
 *   pnpm --filter arena peek <round>    just that round's
 */
const wanted = process.argv[2]
const PORT = Number(process.env.PEEK_PORT ?? 3000)

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })

for await (const sandbox of daytona.list()) {
  const labels = (sandbox as unknown as { labels?: Record<string, string> }).labels ?? {}
  if (wanted && labels.round !== wanted) continue

  try {
    const { url } = await sandbox.getSignedPreviewUrl(PORT, 3600)

    /**
     * Report whether anything is actually listening. An agent that has not
     * started its server yet is the normal case mid-build, not an error, so
     * this prints the status rather than throwing.
     */
    let status = 'no server yet'
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
      status = `HTTP ${res.status}`
    } catch {
      // Left as "no server yet".
    }

    console.log(`${(labels.agent ?? sandbox.id).padEnd(6)} ${status.padEnd(14)} ${url}`)
  } catch (err) {
    console.error(`${(labels.agent ?? sandbox.id).padEnd(6)} could not sign: ${(err as Error).message}`)
  }
}
