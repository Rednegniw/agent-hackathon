/**
 * Smoke test for team shipping: the one-submission-per-team lock and the
 * share_file transfer path, exercised through FakeArena. No model calls,
 * no Daytona, runs in under a second: pnpm --filter arena smoke:teams
 */
import { FakeArena } from './arena-fake.js'
import { EventLog } from './log.js'
import { PhaseClock } from './phases.js'
import { TeamRoster } from './teams.js'

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`FAIL: ${msg}`)
  console.log(`  ok  ${msg}`)
}

// ---- the submit lock ----
const roster = new TeamRoster()
const formed = roster.form('ada', ['rex', 'juno'])
assert(formed.ok, 'team forms')

assert(roster.submitterOf('ada') === undefined, 'no submitter before anyone ships')
roster.recordSubmit('rex')
assert(roster.submitterOf('ada') === 'rex', 'teammates see rex holds the entry')
assert(roster.submitterOf('rex') === 'rex', 'rex may resubmit (fix-and-retry)')
roster.recordSubmit('juno')
assert(roster.submitterOf('juno') === 'rex', 'a later recordSubmit does not steal the lock')
assert(roster.submitterOf('wren') === undefined, 'solo agent is never locked')

// ---- the share_file transfer path ----
const runId = `smoke-teams-${Date.now()}`
const arena = new FakeArena(new EventLog(runId), new PhaseClock([]))

const a = arena.sandboxFor('ada')
const b = arena.sandboxFor('rex')
await a.write('app/style.css', 'body { margin: 0 }')

const bytes = await a.read('app/style.css')
await b.writeBytes('app/style.css', bytes)

const roundTrip = Buffer.from(await b.read('app/style.css')).toString('utf8')
assert(roundTrip === 'body { margin: 0 }', 'file moves between sandboxes intact')

await arena.teardown()
console.log('\nall green')
