# Arena spec

The substrate the agents act on. This is one of three lanes; see
[SPEC.md](SPEC.md) for the whole system and [PLAN.md](PLAN.md) for scope.

**Owns:** Daytona sandbox lifecycle, preview URL resolution and health checks,
the event log, the phase clock, track claiming, the SSE endpoint, and `FakeArena`.

**Does not own:** the Claude Agent SDK loop, personas, prompts, inbox delivery,
the judge (Patrik). The office and the presentation (Kris).

**Contract with Patrik:** the `Arena` interface below, shipped as `FakeArena`
inside the first ten minutes so he never waits on Daytona.

---

## Verified facts

Everything here was measured against `@daytonaio/sdk@0.200.1` and a live sandbox
on 2026-07-24, not read off a docs page. Where this contradicts SPEC.md, this
document is right.

| Fact | Value |
|------|-------|
| Sandbox create, single | **~470ms** |
| Sandbox create, 6 concurrent | **6/6 succeeded in ~1.5s.** No throttling, no limit hit. |
| Default image toolchain | **node 25.9.0, npm 11.12.1, npx, python 3.14.4, pip3, git 2.53.0, curl 8.14.1** |
| Default working dir / user | `/home/daytona`, user `daytona` |
| `executeCommand` return | `{ exitCode: number; result: string; artifacts?: { stdout, charts? } }` |
| `fs.uploadFile(Buffer, remotePath)` | Works. Relative paths resolve under `/home/daytona`. |
| Preview host | **`daytonaproxy01.net`**, *not* `proxy.daytona.works` |
| `getPreviewLink(port)` | `{ sandboxId, url, token }`. URL contains the sandbox UUID. **Returns 401 without the token header.** |
| `getSignedPreviewUrl(port, expiresInSeconds?)` | `{ sandboxId, port, token, url }`. Separate method, not a flag. Opaque 16-char host id, so it does not leak the sandbox UUID. **Returns 200 with no headers at all.** |
| Iframe safety | **Signed URL sends no `X-Frame-Options` and no CSP.** The office can iframe submissions. This was the design's biggest unknown and it is cleared. |

### Three corrections to SPEC.md

1. **No custom snapshot is needed.** The default image already carries node,
   npm, python and git. The `daytona snapshot create hack-agent` step in SPEC.md
   is dead work for the MVP. Build a snapshot only if we later want npm
   dependencies pre-cached, which is an optimisation, not a blocker.
2. **Use `getSignedPreviewUrl()`, not `getPreviewLink()`.** They are different
   methods. The plain one 401s without a header, which an `<iframe>` cannot send.
3. The preview hostname in SPEC.md is wrong. It is `daytonaproxy01.net`.

---

## The interface

This is the whole seam. Ship it first, with `FakeArena` behind it.

```ts
export type AgentId = 'ada' | 'rex' | 'juno' | 'iris' | 'otto' | 'vera'
export type Track = 'time' | 'color'
export type Phase = 'idle' | 'mingle' | 'build' | 'submit' | 'judged'

export interface AgentSandbox {
  /** Runs in the sandbox. Rejects on non-zero exit with stdout attached. */
  bash(command: string): Promise<string>
  /** Absolute or ~-relative path. Creates parent dirs. */
  write(path: string, content: string): Promise<void>
  /** Signed, health-checked, iframe-safe URL. Rejects if nothing is serving. */
  preview(port: number): Promise<string>
}

export interface Arena {
  sandboxFor(agentId: AgentId): AgentSandbox
  claimTrack(agentId: AgentId, track: Track): { ok: true } | { ok: false; open: Track[] }
  trackOf(agentId: AgentId): Track | undefined
  emit(e: Omit<AgentEvent, 'seq' | 'ts'>): AgentEvent
  phase(): Phase
}
```

`AgentEvent` is defined in SPEC.md and is the shared type. Put it in
`src/events.ts` and let both lanes import from there.

---

## Sandbox lifecycle

Create lazily at the end of mingle, one per agent that claimed a track.

```ts
const sandbox = await daytona.create({
  labels: { round: roundId, agent: agentId },
  ephemeral: true,
  autoStopInterval: 30,
})
```

`labels` make sandboxes findable in the dashboard while demoing, which is worth
doing because a judge may ask to see them. `ephemeral` plus `autoStopInterval`
bound the blast radius in time; do not rely on them as the only cleanup.

Teardown is unconditional:

```ts
try {
  await runRound()
} finally {
  await Promise.allSettled([...pool.values()].map((s) => s.delete()))
}
```

`Promise.allSettled`, never `Promise.all`. One failed delete must not orphan the
other five. Log failures and move on.

**Do not** pass a `snapshot` name until a snapshot actually exists. A bad
snapshot name fails at create time, which is the worst place to discover it.

### `bash`

```ts
async bash(command) {
  const res = await this.sandbox.process.executeCommand(command)
  const out = res.result ?? ''
  if (res.exitCode !== 0) {
    throw new Error(`exit ${res.exitCode}: ${out.slice(0, 2000)}`)
  }
  return out
}
```

Throw on non-zero so the tool layer can surface it to the agent as an
`isError` result. Truncate: an agent that runs `npm install` and gets 40KB of
output back has burned its context for nothing.

Backgrounding a long-running server works and is verified:

```
cd ~/app && nohup <cmd> >/tmp/serve.log 2>&1 & sleep 2; echo started
```

Without `nohup ... &` the call blocks until the timeout. Agents will get this
wrong, so say it explicitly in the `sandbox_bash` tool description.

### `write`

`fs.uploadFile(Buffer.from(content), remotePath)`. Relative paths land under
`/home/daytona`. Create parent dirs first with `fs.createFolder(dir, '755')` or
just `mkdir -p` via bash; uploading into a missing directory is not guaranteed.

---

## Preview resolution and health check

The single most important function in this lane, because a submission that
resolves to a dead URL scores zero and looks like our bug rather than the
agent's.

```ts
async preview(port: number): Promise<string> {
  const { url } = await this.sandbox.getSignedPreviewUrl(port, 3600)

  const deadline = Date.now() + 10_000
  let lastStatus = 0
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'follow' })
      lastStatus = res.status
      if (res.ok) return url
    } catch {
      // connection refused while the dev server is still booting
    }
    await sleep(500)
  }
  throw new Error(`preview on :${port} not healthy after 10s (last status ${lastStatus})`)
}
```

Poll, do not check once. The agent calls `submit` the moment it thinks the server
is up, and a Vite cold start is routinely slower than that. Ten seconds with
500ms backoff is the right shape.

`expiresInSeconds: 3600` comfortably outlives the round and the demo. If we
present at 16:00 from a 14:00 run, regenerate the URLs before going on stage.

---

## Event log

Append-only, in memory, mirrored to disk on every append.

```ts
class EventLog {
  #events: AgentEvent[] = []
  #seq = 0
  #subs = new Set<(e: AgentEvent) => void>()

  emit(partial: Omit<AgentEvent, 'seq' | 'ts'>): AgentEvent {
    const e = { ...partial, seq: ++this.#seq, ts: Date.now() }
    this.#events.push(e)
    appendFileSync('events.jsonl', JSON.stringify(e) + '\n')
    for (const fn of this.#subs) fn(e)
    return e
  }

  all() { return this.#events }
  subscribe(fn) { this.#subs.add(fn); return () => this.#subs.delete(fn) }
}
```

`appendFileSync` deliberately. Async writes can interleave and corrupt the file,
and the whole value of `events.jsonl` is that it is a trustworthy replay source.
At our event volume the sync cost is irrelevant.

**`events.jsonl` is the demo insurance.** Do not gitignore it; commit a good run.

---

## Phase clock

```ts
const ROUND = {
  mingle: 90_000,
  build: 12 * 60_000,
  submit: 2 * 60_000,
} as const
```

One object, one place. The clock advances on wall time and emits a `phase` event
on each transition. Agents do not vote on phases and cannot extend them.

Enforcement lives in the tool layer, not here: the arena exposes `phase()` and
the tool implementations refuse calls that are wrong for the current phase. Keep
the refusal message useful, since the agent reads it: name the current phase and
what is allowed in it.

Support a **speed multiplier** from env (`ROUND_SPEED=10`). Nobody should wait 14
real minutes to test the phase machine.

---

## Track claiming

Pure logic, no I/O, so unit-test it directly.

```ts
claimTrack(agentId, track) {
  if (this.#tracks.get(agentId)) return { ok: true }        // idempotent
  const taken = [...this.#tracks.values()].filter((t) => t === track).length
  if (taken >= 3) {
    const open = (['time', 'color'] as Track[]).filter(
      (t) => [...this.#tracks.values()].filter((x) => x === t).length < 3,
    )
    return { ok: false, open }
  }
  this.#tracks.set(agentId, track)
  return { ok: true }
}
```

Idempotent on re-claim, because a model will call it twice. At the end of mingle,
assign anyone still unclaimed to the emptier track and emit the `theme` event on
their behalf. A missing pick must never stall the round.

---

## SSE

```ts
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  for (const e of log.all()) res.write(`data: ${JSON.stringify(e)}\n\n`)
  const off = log.subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`))
  const hb = setInterval(() => res.write(': hb\n\n'), 15_000)
  req.on('close', () => { off(); clearInterval(hb) })
})
```

**Replay-then-tail on connect.** This is what lets Kris refresh mid-demo without
losing the room. Without it a reload shows an empty office.

The heartbeat comment keeps proxies from closing an idle stream. Always clean up
both the subscription and the interval on `close` or a long session leaks.

---

## FakeArena

Ship this first. It is what unblocks Patrik.

- `bash` runs via `child_process.exec` in a per-agent temp dir
- `write` writes to that temp dir
- `preview` starts a real `http.server` on a free local port and returns
  `http://localhost:<port>`, health-checked with the same polling loop

The health-check and phase logic are then shared between fake and real, which
means the code path Patrik develops against is the code path that ships. Expose
it with `ARENA=fake npm run dev`.

---

## Testing ladder

Never debug the full run. Each rung isolates one failure domain.

| Rung | Command | Costs | Proves |
|------|---------|-------|--------|
| 0 | `npm test` | nothing | Phase clock and track claiming, as pure unit tests |
| 1 | `npm run smoke` | a few cents | The whole Daytona path: create, write, serve, sign, fetch, delete. **Already written and passing.** |
| 2 | `ARENA=fake npm run dev` | nothing | Arena plus agent loop plus office, no Daytona, no tokens |
| 3 | one real agent, `ROUND_SPEED=4` | some tokens | A model can actually drive the tools |
| 4 | full six-agent run | real tokens | The demo. Run once, keep `events.jsonl`. |
| any | `npm run replay events.jsonl` | nothing | The office, at 10x, no agents |

`smoke.mjs` is committed and green. Re-run it any time Daytona misbehaves; it
tells you in thirty seconds whether the problem is us or them.

---

## File layout

```
src/
  events.ts        AgentEvent, AgentId, Track, Phase   <- shared, both lanes import
  arena.ts         Arena interface
  arena-daytona.ts DaytonaArena
  arena-fake.ts    FakeArena
  log.ts           EventLog
  phases.ts        clock + ROUND
  server.ts        SSE + static
smoke.mjs          rung 1, committed and passing
events.jsonl       demo insurance, commit a good run
```

---

## Failure modes, and what to do

| Failure | Handling |
|---------|----------|
| `create` rejects for one agent | Run the round without it. Never abort six agents because one sandbox failed. Emit a `phase` note so the office can show an empty desk. |
| Preview never becomes healthy | `submit` fails, agent scores zero, office renders it as a missed deadline. This is a legitimate outcome, not a bug to hide. |
| Agent leaves a blocking foreground process | `executeCommand` has a `timeout` param. Pass one, roughly 60s, so a wedged command cannot eat the build phase. |
| Huge command output | Truncate to ~2KB before returning to the agent. |
| Sandbox delete fails on teardown | `allSettled`, log it, and clean up in the Daytona dashboard by the `round` label afterwards. |
| Signed URL expired before the pitch | Regenerate before going on stage. Cheap; just call `preview()` again. |
