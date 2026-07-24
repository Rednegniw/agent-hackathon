import './env.js'
import { Daytona } from '@daytonaio/sdk'

/**
 * Deletes sandboxes left behind by KEEP_ALIVE runs. Those have auto-stop
 * disabled on purpose so the pitch URLs stay live, which means nothing
 * reclaims them automatically and they bill until someone does this.
 *
 *   pnpm --filter arena cleanup            everything this key can see
 *   pnpm --filter arena cleanup <round>    one run, by its round label
 */

const filter = process.argv[2]
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })

// list() is an async iterator, not an array. Collect before filtering.
const all: Awaited<ReturnType<typeof daytona.get>>[] = []
for await (const s of daytona.list()) all.push(s)

const targets = filter ? all.filter((s) => s.labels?.round === filter) : all

if (!targets.length) {
  console.log(filter ? `nothing labelled round=${filter}` : 'no sandboxes to clean up')
  process.exit(0)
}

console.log(`deleting ${targets.length} sandbox(es)...`)
const results = await Promise.allSettled(targets.map((s) => s.delete()))

const failed = results.filter((r) => r.status === 'rejected')
console.log(`  ${results.length - failed.length} deleted, ${failed.length} failed`)
for (const f of failed) console.error('  ', (f as PromiseRejectedResult).reason?.message)
