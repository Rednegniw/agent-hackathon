# Arena spec

The substrate the agents act on. This is one of three lanes; see
[SPEC.md](SPEC.md) for the original design of the whole system.

**Owns:** Daytona sandbox lifecycle, preview URL resolution and health checks,
the event log, the phase clock, the SSE endpoint, and `FakeArena`.

**Does not own:** the Claude Agent SDK loop, personas, prompts, inbox delivery,
the judge (Patrik). The office and the presentation (Kris).

**Contract with Patrik:** the `Arena` interface below, shipped as `FakeArena`
inside the first ten minutes so he never waits on Daytona.

---

## Verified facts

Everything here was measured against `@daytona/sdk@0.200.1` and a live sandbox
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
| `chromium` and `ffmpeg` | **Both preinstalled** (`/usr/bin`, ffmpeg 7.1.3 with libx264 and aac). Pillow too. No `apt-get` step, which is just as well: **apt is unusable**, the sandbox user is not root and `dpkg` lock is 13 Permission denied. |
| Headless screenshot | **~1.2s** at 1440x900. Requires `--no-sandbox`. |
| mp4 render, 3 slides + audio | **~0.5s** |
| `fs.downloadFile(path)` | Works, ~0.5s for a 350KB mp4. Same relative-path rules as `uploadFile`. |

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

This is the whole seam, as shipped. `FakeArena` implements it too, so the code
path developed against a laptop is the code path that runs on Daytona.

```ts
export type Phase = 'idle' | 'mingle' | 'build' | 'submit' | 'judging' | 'judged'

export interface AgentSandbox {
  /** Runs in the sandbox. Rejects on non-zero exit with stdout attached. */
  bash(command: string): Promise<string>
  /** Absolute or ~-relative path. Creates parent dirs. */
  write(path: string, content: string): Promise<void>
  writeBytes(path: string, content: Uint8Array): Promise<void>
  /** How rendered media leaves the sandbox before teardown. */
  read(path: string): Promise<Uint8Array>
  /** Signed, health-checked, iframe-safe URL. Rejects if nothing is serving. */
  preview(port: number): Promise<string>
}

export interface Arena {
  sandboxFor(agentId: AgentId): AgentSandbox
  /** Optional: only a real arena can fail to provision one. */
  has?(agentId: AgentId): boolean
  emit(e: NewEvent): AgentEvent
  phase(): Phase
}
```

`AgentId` is the twelve-persona union in `src/events.ts`, which both lanes
import. `agentId` is `AgentId | 'system'`, because `phase` and `score` events
have no agent.

**Tracks were cut.** An earlier draft had agents claim one of two themed tracks
(`claimTrack`, `trackOf`). The shipped design has a single brief per round and
teams instead, so none of that exists in the code.

---

## Sandbox lifecycle

Create lazily at the end of mingle, one per agent on the roster.

### The lifecycle trap, and it will cost us the demo if ignored

Three independent timers all destroy the thing we pitch, and the defaults are
worse than they look. From `Daytona.d.ts:122,125,131`:

- **`autoStopInterval` is in MINUTES, not seconds**, and **defaults to 15**.
- **`ephemeral: true` forces `autoDeleteInterval = 0`**, which means "delete
  immediately upon stopping". Ephemeral plus auto-stop equals gone, not paused.
- **Signed URLs default to 60 seconds** (`Sandbox.d.ts:559`). Passing an explicit
  expiry is load-bearing.

This mattered because the demo plan was to run a round two hours before pitching
it, with the winning preview URLs live on stage. With the defaults those
sandboxes are deleted about twenty minutes after the round and the iframe shows
a 404 in front of the room. You cannot re-sign a URL for a deleted sandbox, so
"just call `preview()` again" is not a recovery path.

**The rule: the run we pitch from is a keep-alive run.**

```ts
const KEEP = process.env.KEEP_ALIVE === '1'

const sandbox = await daytona.create({
  labels: { round: roundId, agent: agentId },
  ephemeral: !KEEP,                    // ephemeral deletes on stop
  autoStopInterval: KEEP ? 0 : 30,     // MINUTES. 0 disables auto-stop.
})
```

```ts
try {
  await runRound()
} finally {
  if (!KEEP) {
    await Promise.allSettled([...pool.values()].map((s) => s.delete()))
  } else {
    console.log('KEEP_ALIVE: sandboxes left running. Clean up by label later.')
  }
}
```

`Promise.allSettled`, never `Promise.all`. One failed delete must not orphan the
other five. Log failures and move on. Sandboxes kept alive are findable and
deletable afterwards by the `round` label, so this leaks nothing permanently.

**Backstage before the pitch:** re-mint the signed URLs for the winners. It is
one `preview()` call each and it removes every expiry question.

`labels` make sandboxes findable in the dashboard while demoing, which is worth
doing because a judge may ask to see them.

**Do not** pass a `snapshot` name until a snapshot actually exists. A bad
snapshot name fails at create time, which is the worst place to discover it.

### `bash`

```ts
const CAP = 2000

async bash(command) {
  // Signature is (command, cwd?, env?, timeout?) and timeout is SECONDS.
  // It is the FOURTH positional. The SDK's own JSDoc example gets this wrong
  // (Process.d.ts:65 passes it third, where it lands in `env` and is silently
  // dropped). Always pass the two undefineds.
  const res = await this.sandbox.process.executeCommand(command, undefined, undefined, 60)
  const out = (res.result ?? '').slice(0, CAP)
  if (res.exitCode !== 0) throw new Error(`exit ${res.exitCode}: ${out}`)
  return out
}
```

Throw on non-zero so the tool layer can surface it to the agent as an `isError`
result. Truncate **both** paths: an agent that runs `npm install` and gets 40KB
back has burned its context for nothing, and tokens are the binding constraint.

Without the timeout, an agent that starts a foreground server wedges that call
for the rest of the build phase. They will do this.

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
      // Per-attempt timeout is essential. Without it a proxy that accepts the
      // connection and then stalls parks this call far past the 10s deadline,
      // because the deadline is only checked between attempts.
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(2000) })
      lastStatus = res.status
      if (res.ok) return url
    } catch {
      // connection refused or timed out while the dev server is still booting
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
    appendFileSync(this.#file, JSON.stringify(e) + '\n')
    // A throwing subscriber must not propagate. emit() is called from inside
    // agent tool handlers, so one bad callback (a TTS hook, a write to a
    // just-closed SSE response) would blow up the agent's turn and starve
    // every later subscriber.
    for (const fn of this.#subs) {
      try { fn(e) } catch (err) { console.error('subscriber threw:', err) }
    }
    return e
  }

  all() { return this.#events }
  subscribe(fn) { this.#subs.add(fn); return () => this.#subs.delete(fn) }
}
```

`appendFileSync` deliberately. Async writes can interleave and corrupt the file,
and the whole value of the log is that it is a trustworthy replay source. At our
event volume the sync cost is irrelevant.

**One file per round: `events-${roundId}.jsonl`, resolved against a fixed dir,
not cwd.** `#seq` restarts at 1 in every process, so appending every run to one
shared file interleaves duplicate seq numbers and silently destroys the exact
artifact the demo falls back on.

**The chosen run's file is the demo insurance.** Do not gitignore it; commit the
good one.

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

## SSE

```ts
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',   // Kris's office runs on another origin
  })

  // EventSource auto-reconnects after any blip and sends Last-Event-ID.
  // Without honouring it, every reconnect replays the whole log and the
  // office double-renders the round.
  const since = Number(req.headers['last-event-id'] ?? 0)
  const send = (e) => res.write(`id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`)

  for (const e of log.all()) if (e.seq > since) send(e)
  const off = log.subscribe(send)
  const hb = setInterval(() => res.write(': hb\n\n'), 15_000)
  req.on('close', () => { off(); clearInterval(hb) })
})
```

**Replay-then-tail on connect.** This is what lets Kris refresh mid-demo without
losing the room. Without it a reload shows an empty office.

`id:` on every frame plus the `Last-Event-ID` check makes reconnects idempotent.
The office should still dedupe by `seq` as a belt-and-braces measure; say so to
Kris, since it is a two-line guard on his side.

The heartbeat comment keeps proxies from closing an idle stream. Always clean up
both the subscription and the interval on `close` or a long session leaks.

---

## The studio: how an agent films its own product

The submit phase is no longer just a health check. Each agent screenshots its
own running page and turns those screenshots into a narrated product video,
and the office plays those videos rather than only linking preview URLs.

All of it happens **inside the agent's own sandbox**, because the default image
already carries chromium and ffmpeg (see the fact table). Nothing is installed,
nothing extra is provisioned, and the whole path measures **~15s per agent**.

Two tools, both phase-gated like every other:

- `capture_screens` — chromium shoots `http://localhost:<port><path>` at desktop
  or phone width. The thumbnails are **returned to the agent as images**, so an
  agent writes its pitch looking at what it actually shipped.
- `record_pitch` — title, tagline and up to five slides of headline, caption and
  narration. Submit-phase only.

The orchestrator does exactly one part of this: the ElevenLabs call. **The API
key never enters a sandbox** an agent can run shell commands in. The mp3s are
uploaded back and ffmpeg muxes them.

Three things here are load-bearing and each one cost a debugging cycle:

1. **Each slide is on screen for exactly as long as its own narration.** So
   narration is synthesised *before* the frames are rendered. Guessing durations
   and rendering first puts the voice two slides ahead of the picture.
2. **Never build an absolute path out of `$HOME` in these scripts.** Everything
   an agent supplies is single-quoted for the shell, and single quotes suppress
   `$HOME` too — chromium then writes into a directory literally named `$HOME`,
   every shot silently fails, and it reads as a dead server. The scripts `cd`
   into `~/pitch` and use relative paths.
3. **The concat demuxer ignores the last entry's duration**, so the final frame
   is listed twice or the closing narration plays over the previous slide.

`pnpm --filter arena smoke:studio` is rung 1½ of the ladder: one sandbox, two
screenshots, one narrated video, about 30 seconds. It also keeps the rendered
frames next to the mp4, because a slide that lays out wrong is invisible in a
23 second video and obvious in a still.

**ElevenLabs allows four concurrent syntheses.** Six agents filming four-slide
decks at the end of the same phase is twenty-four at once, and the overflow
comes back as `429 concurrent_limit_exceeded` — measured, on a two-agent round
that lost two clips. `voice.ts` queues to three and retries once. A lost clip is
not fatal: that slide gets silence of the estimated length and the rest stay in
sync.

**Every submission that shipped gets filmed**, whether or not its agent got
round to it. `#fillMissingPitches` runs after the agents stop and before
teardown, and films anyone who submitted but never recorded. A missing video
looks like a missing entry on stage.

The media is copied out to `apps/arena/public/media/<round>/` and served at
`/media/...`, so **unlike preview URLs it outlives the sandbox**. A round with
`keepAlive` off still has playable pitches tomorrow.

## The account vCPU cap will kill a demo run

Measured, not guessed. The Daytona account has a **hard total-vCPU limit of 10**,
so roughly ten default sandboxes at once. Exceeding it does not queue or degrade:
every `create` in the round fails at once with

```
Total CPU limit exceeded. Maximum allowed: 10.
```

**The trap is `KEEP_ALIVE`.** Sandboxes deliberately kept alive so preview URLs
survive a pitch are still consuming that budget afterwards. Ten orphans
accumulated across earlier runs took a live 4-agent round to **0/4 provisioned**.
On stage that reads as total failure, seconds after pressing Start.

Two mitigations, both in place:

- `provision()` runs a **preflight** that counts existing sandboxes and warns
  before the round starts. It warns rather than deletes, because the orphans may
  be exactly the sandboxes behind the pitch you are about to give.
- `pnpm --filter arena cleanup` reclaims everything, or one round by label.

**Run cleanup immediately before the demo round.** It is the single cheapest
insurance in the project.

## FakeArena is not a sandbox

Worth stating plainly, because a real agent round found it the hard way.

`FakeArena` runs `bash` on the **developer's machine**. With scripted agents that
is harmless. With real agents it is not: three Haiku agents each tried to bind
port 3000 on one laptop, detected the collision, and spent 12 of their 68 tool
calls running `lsof -i :3000 | xargs kill -9` at each other. They burned the
build phase fighting over a port, and those kills landed on the host.

Two guards, both in `arena-fake.ts`:

- **Each fake agent owns a distinct port**, and `bash` rewrites `3000` onto it,
  so agents cannot collide in the first place.
- **Host-hazardous commands are refused** (`pkill`, `killall`, `kill -9`,
  `lsof | xargs kill`, `shutdown`, `systemctl`) with an error that tells the
  agent nothing is competing for its port.

`DaytonaArena` needs neither guard, because a dedicated kernel and network
namespace already are the boundary. That contrast is worth keeping in mind: the
fake arena is a development convenience, and **real agents belong in real
sandboxes**. Use `ARENA=fake` for the office and the event plumbing, and
`ARENA=daytona` whenever a model is in the loop.

## FakeArena

Ship this first. It is what unblocks Patrik.

- `bash` runs via `child_process.exec` in a per-agent temp dir
- `write` writes to that temp dir
- `preview` starts a real `http.server` on a free local port and returns
  `http://localhost:<port>`, health-checked with the same polling loop

The health-check and phase logic are then shared between fake and real, which
means the code path Patrik develops against is the code path that ships. Expose
it with `ARENA=fake pnpm dev`.

---

## Testing ladder

Never debug the full run. Each rung isolates one failure domain.

| Rung | Command | Costs | Proves |
|------|---------|-------|--------|
| 1 | `pnpm smoke` | a few cents | The whole Daytona path: create, write, serve, sign, fetch, delete. **Already written and passing.** |
| 1½ | `pnpm --filter arena smoke:studio` | cents, plus a little TTS | The studio: screenshot, narrate, render, download, serve. ~30s. |
| 2 | `ARENA=fake pnpm dev` | nothing | Arena plus agent loop plus office, no Daytona, no tokens |
| 3 | one real agent, `ROUND_SPEED=4` | some tokens | A model can actually drive the tools |
| 4 | full six-agent run | real tokens | The demo. Run once, keep `events.jsonl`. |
| any | `pnpm replay events.jsonl` | nothing | The office, at 10x, no agents |

`smoke.mjs` is committed and green. Re-run it any time Daytona misbehaves; it
tells you in thirty seconds whether the problem is us or them.

There is no unit-test runner. `smoke.mjs` covers the Daytona substrate and
`pnpm --filter arena smoke:teams` covers the submit lock and cross-sandbox file
delivery, which are the two pieces with logic worth asserting.

**Toolchain does not exist yet.** `package.json` has only `@daytona/sdk` and
`dotenv`. Before any of this is runnable: a TS runner (`tsx`), a server for the
SSE route, and the agent SDK plus `zod` for Patrik's lane. Do that install once,
first, rather than discovering it three times.

---

## File layout

pnpm workspace. Every package lives under `apps/`, the root holds only workspace config.

```
apps/arena/
  src/
    events.ts        AgentEvent, AgentId, Track, Phase   <- shared, both lanes import
    arena.ts         Arena interface
    arena-base.ts    shared health-check and phase logic
    arena-daytona.ts DaytonaArena
    arena-fake.ts    FakeArena
    log.ts           EventLog
    phases.ts        clock + ROUND
    studio.ts        screenshots, slides, ffmpeg -> the pitch video
    voice.ts         ElevenLabs, one voice per agent
    media.ts         where rendered media lands and how it is addressed
    server.ts        SSE + static + /media
    dev.ts           full fake round, rung 2
    smoke-studio.ts  rung 1½, the studio on its own
    env.ts           loads the repo-root .env
  smoke.mjs          rung 1, committed and passing
  runs/              one events jsonl per run, gitignored
  public/media/      one directory of pitch videos per round, gitignored
apps/frontend/       the office, Vite + React
```

Secrets stay in a single repo-root `.env`. Packages resolve it relative to their
own file, not the cwd, because pnpm runs scripts with the cwd set to the package:
TypeScript imports `./env.js`, `smoke.mjs` calls dotenv itself. Anything else
cwd-relative also lands inside the package, so arena writes `apps/arena/runs/`.

---

## Failure modes, and what to do

| Failure | Handling |
|---------|----------|
| `create` rejects for one agent | Run the round without it. Never abort six agents because one sandbox failed. Emit a `phase` note so the office can show an empty desk. |
| Preview never becomes healthy | `submit` fails, agent scores zero, office renders it as a missed deadline. This is a legitimate outcome, not a bug to hide. |
| Agent leaves a blocking foreground process | `executeCommand` has a `timeout` param. Pass one, roughly 60s, so a wedged command cannot eat the build phase. |
| Huge command output | Truncate to ~2KB before returning to the agent. |
| Sandbox delete fails on teardown | `allSettled`, log it, and clean up in the Daytona dashboard by the `round` label afterwards. |
| Signed URL expired before the pitch | Re-mint with `preview()`. **Only works if the sandbox still exists**, which is what `KEEP_ALIVE` is for. Against a deleted sandbox there is no recovery, so fall back to replay. |
| Sandbox gone before the pitch | You forgot `KEEP_ALIVE=1`. Pitch from the replay log instead and say the run was recorded. Do not improvise a live re-run on stage. |
