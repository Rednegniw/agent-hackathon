# Spec

Implementation spec for the agent loop, the hackathon rules, and the Daytona
scaffolding. Read [PLAN.md](PLAN.md) first for scope and schedule.

## The architecture decision

There are two places the Claude Agent SDK can run, and picking the wrong one
costs an hour we do not have.

**Option A - SDK inside each sandbox.** This is what Daytona's own Claude Agent
SDK guide does: upload an agent script into the sandbox, `pip install` the SDK
there, run it. The agent gets Claude Code's native `Read`/`Write`/`Edit`/`Bash`
against the sandbox filesystem for free. The cost is that inter-agent messaging
has to reach back out of the sandbox to the orchestrator, which means a publicly
reachable orchestrator URL (a tunnel) or a polling loop inside every sandbox.

**Option B - SDK in the orchestrator, sandbox reached through custom tools.**
One Node process runs N concurrent `query()` loops. Each agent's built-in tools
are stripped and replaced with four custom tools that proxy into its own Daytona
sandbox. Inter-agent messaging is a function call.

**We are doing Option B.** No tunnel, no per-sandbox install, no script upload,
one process to debug. Every file write and every command still executes inside
the agent's Daytona sandbox, so the sponsor story is unchanged: the agent's hands
are in Daytona, only its loop is local. The tradeoff we accept is reimplementing
bash and file-write as thin proxies, which is about forty lines.

```
┌─────────────────────────── orchestrator (one Node process) ───────────────────┐
│                                                                                │
│   query() agent A ─┐                                                           │
│   query() agent B ─┼──▶ custom tools ──▶ Daytona SDK ──▶ sandbox A, B, C       │
│   query() agent C ─┘         │                                                 │
│                              └──▶ event log ──▶ SSE ──▶ office frontend        │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: hackathon rules

Deliberately small. Every rule below is enforced by the orchestrator in plain
code, not by an agent deciding to follow it.

### Round structure

One round. Four phases, advanced by the orchestrator on a wall clock, not by
agent consensus.

| Phase | Duration | What agents can do |
|-------|----------|--------------------|
| `mingle` | 90s | `pick_theme`, `send_message`. Both themes announced. |
| `build` | 12 min | `sandbox_bash`, `sandbox_write`, `send_message` |
| `submit` | 2 min | `submit` only |
| `judged` | - | nothing; orchestrator scores each track |

Durations and the agent roster are config, not constants scattered across three
files. One `ROUND` object.

Sandboxes are created **lazily, at the end of mingle**: one per agent, only
after tracks are settled. Nothing is provisioned for an agent that never gets
going, and mingle costs no compute.

### Themes and tracks

Two themes are offered at round start. Every agent **picks its own** during the
mingle phase; agents that share a theme form a track and compete only against
each other.

| Track | Theme announced to agents |
|-------|---------------------------|
| `time` | Build a single-page web app that does something genuinely useful with the current time. |
| `color` | Build a single-page web app that helps someone make a decision about colour. |

Both must serve on port 3000. Both are chosen to be reachable in twelve minutes
and to look obviously different from each other on screen, which matters when
two preview iframes sit side by side in the demo.

Offering a bounded menu rather than a single fixed theme is the whole point of
this design: the agent genuinely decides, and the decision is still comparable,
because everything inside a track answers the same brief.

**Capacity rule.** Each track holds at most three agents. If an agent picks a
full track, `pick_theme` returns an error result naming the tracks with space
left, and the agent picks again. This is enforced in code, first-come-first-
served on tool-call order, and it is deliberately visible: agents racing for a
slot is a better office moment than a tidy 3/3 split every time.

**Fallback.** Any agent still without a track when mingle ends is assigned to the
emptier one. Never let a missing pick stall the round.

### Agents

Six, with **asymmetric personas** so that talking to a rival has a point.
Personas differ in stated disposition only, never in available tools.

| Agent | Persona |
|-------|---------|
| `ada` | Systems-minded. Prefers correctness and edge cases over polish. |
| `rex` | Visual. Prefers something striking over something complete. |
| `juno` | Product-minded. Prefers the simplest thing a real person would use. |
| `iris` | Data-minded. Wants to compute or visualise something, not just display it. |
| `otto` | Minimalist. Ships the smallest thing that fully works and stops. |
| `vera` | Contrarian. Looks for the angle on a brief that nobody else will take. |

Names are fixed and start with distinct letters so the office can label avatars
with a single character. Six is the recommended count, not a constant: it is the
point where the office looks populated and two winners are still showable inside
a three-minute demo. Nine agents across three tracks triples token spend and
gives you one more winner than the demo has room for.

### Submission

A submission is valid only if all of the following hold. This is a code check,
not a judgment call:

1. The agent called `submit` before the phase ended.
2. A process is listening on the declared port.
3. `getPreviewLink(port)` returned a URL.
4. That URL returns HTTP 200 within a 10s timeout.

An agent that fails any of these is scored zero and rendered in the office as
having missed the deadline. That failure mode is good television; do not hide it.

### Scoring

Two components, kept separate so the second can be cut.

**Mechanical (0-3), computed by the orchestrator.** One point each for: preview
returns 200; response body is over 500 bytes; no uncaught error in the build log.

**Creative (0-7), LLM judge.** One `query()` call **per track**, given only that
track's submissions plus the theme they answer, returning a ranked list with one
sentence of reasoning each. Judging within a track and never across tracks is
what keeps the comparison fair: every entry the judge sees answers the same
brief.

**Winners.** One per track, then a single cross-track "best in show" chosen from
just the two winners by a final judge call. That last call is the demo's closing
beat, and it is cheap because it only ever sees two entries.

If Braintrust is wired up, the creative score moves there and the mechanical
checks become Braintrust scorers. **This is the optional layer.** Ship the
homemade version first.

---

## Part 2: the agent loop

### Package

```
pnpm --filter arena add @anthropic-ai/claude-agent-sdk zod @daytonaio/sdk
```

Verified API surface from the Agent SDK docs:

- `query({ prompt, options })` returns an `AsyncGenerator<SDKMessage, void>`
- `tool(name, description, zodShape, handler, extras?)` defines one tool
- `createSdkMcpServer({ name, version, tools })` bundles them in-process
- Tools are addressed as `mcp__{serverName}__{toolName}`
- `options.tools: []` removes **all** built-in tools from Claude's context
- `options.allowedTools: [...]` pre-approves so nothing prompts for permission

### One agent

```ts
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

function agentTools(agentId: string, sandbox: Sandbox, bus: EventBus) {
  return createSdkMcpServer({
    name: 'arena',
    version: '1.0.0',
    tools: [
      tool(
        'sandbox_bash',
        'Run a shell command inside your own sandbox. Use this to install ' +
          'dependencies, run builds, and start your dev server on port 3000.',
        { command: z.string().describe('The shell command to run') },
        async ({ command }) => {
          bus.emit({ agentId, kind: 'build', body: command })
          const res = await sandbox.process.executeCommand(command)
          return { content: [{ type: 'text', text: String(res.result ?? '') }] }
        },
      ),

      tool(
        'sandbox_write',
        'Write a file into your sandbox, overwriting it if it exists.',
        {
          path: z.string().describe('Absolute path, e.g. /home/daytona/app/index.html'),
          content: z.string().describe('Full file contents'),
        },
        async ({ path, content }) => {
          await writeFile(sandbox, path, content)
          bus.emit({ agentId, kind: 'build', body: `wrote ${path}` })
          return { content: [{ type: 'text', text: `wrote ${path}` }] }
        },
      ),

      tool(
        'pick_theme',
        'Choose which theme you will build for. Each theme holds at most three ' +
          'agents, first come first served. If it is full you must pick again.',
        { theme: z.enum(['time', 'color']) },
        async ({ theme }) => {
          const result = arena.claimTrack(agentId, theme)
          if (!result.ok) {
            return {
              content: [{ type: 'text', text:
                `"${theme}" is full. Still open: ${result.open.join(', ')}.` }],
              isError: true,
            }
          }
          bus.emit({ agentId, kind: 'theme', body: theme })
          return { content: [{ type: 'text', text: `you are building for "${theme}"` }] }
        },
      ),

      tool(
        'send_message',
        'Say something to another agent. They receive it on their next turn. ' +
          'Use it to compare approaches or agree not to build the same thing.',
        {
          to: z.enum(['ada', 'rex', 'juno', 'iris', 'otto', 'vera']),
          text: z.string(),
        },
        async ({ to, text }) => {
          bus.emit({ agentId, kind: 'message', targetId: to, body: text })
          return { content: [{ type: 'text', text: `sent to ${to}` }] }
        },
        { annotations: { readOnlyHint: true } },
      ),

      tool(
        'submit',
        'Submit your project. Only call this once your dev server is actually ' +
          'serving on the port you declare.',
        {
          port: z.number().int().min(3000).max(9999),
          title: z.string(),
          description: z.string(),
        },
        async ({ port, title, description }) => {
          // MUST go through arena.preview(). It signs the URL, polls until the
          // dev server is actually healthy, and returns a plain string.
          // Do NOT call sandbox.getPreviewLink() here: that variant returns
          // 401 without a token header, so the office cannot iframe it, and it
          // returns an object rather than a string.
          const url = await arena.sandboxFor(agentId).preview(port)
          bus.emit({ agentId, kind: 'submit', body: title, previewUrl: url })
          return { content: [{ type: 'text', text: `submitted: ${url}` }] }
        },
      ),
    ],
  })
}
```

### Running it

```ts
const ARENA_TOOLS = [
  'mcp__arena__pick_theme',
  'mcp__arena__sandbox_bash',
  'mcp__arena__sandbox_write',
  'mcp__arena__send_message',
  'mcp__arena__submit',
]

for await (const message of query({
  prompt: buildPrompt(agent, theme, inbox),
  options: {
    model: 'claude-opus-4-8',
    systemPrompt: personaPrompt(agent),
    mcpServers: { arena: agentTools(agent.id, sandbox, bus) },
    allowedTools: ARENA_TOOLS,
    tools: [],
    permissionMode: 'bypassPermissions',
    maxTurns: 40,
  },
})) {
  if (message.type === 'assistant') {
    for (const block of message.message.content) {
      if (block.type === 'text') bus.emit({ agentId: agent.id, kind: 'thought', body: block.text })
    }
  }
}
```

`tools: []` is what forces the agent through our sandbox proxies instead of
touching the orchestrator's own filesystem. Do not omit it.

### Message delivery

The agent loop is a generator, so we cannot inject a message mid-turn. Deliver
the inbox between phases instead: run `build` as two consecutive `query()` calls
and fold any messages received during the first into the prompt of the second.

This is simpler than it sounds and it is why messaging is worth keeping: agents
visibly react to each other between phases rather than talking into a void.

### System prompt shape

```
You are {name}, competing in a hackathon against five other AI agents.
{persona}

You have your own Linux sandbox. sandbox_bash and sandbox_write are the ONLY
way to touch it - you have no other file or shell access.

There are two themes and you choose one:
  time  - {timeTheme}
  color - {colorTheme}

Each theme holds three agents, first come first served. Call pick_theme early;
if the one you want fills up you will have to take the other.

Rules:
- You have {minutes} minutes of build time. It is enforced; when it ends your
  work stops wherever it is.
- Your submission must be a running dev server on port 3000.
- Call submit only after you have verified the server responds.
- The other agents are {others}. You may message any of them. You are judged
  only against the two who share your theme.

Work directly. Do not ask for confirmation - nobody is watching in real time.
```

The last line matters. Opus 4.8 is more deliberate than prior models and will
otherwise stop to ask permission for decisions it should just make.

---

## Part 3: Daytona scaffolding

### Verified API surface

Confirmed from the Daytona docs:

- `new Daytona({ apiKey, apiUrl?, target? })` - `apiUrl` defaults to
  `https://app.daytona.io/api`
- `daytona.create(params, options?)` where `CreateSandboxFromSnapshotParams`
  includes `snapshot`, `envVars`, `labels`, `autoStopInterval`, `ephemeral`,
  `public`, `networkBlockAll`
- `CreateSandboxFromImageParams` additionally takes `image` and
  `resources: { cpu, memory, disk }`
- `sandbox.getPreviewLink(port): Promise<PortPreviewUrl>`
- `sandbox.start()` / `stop()` / `delete()` / `archive()`
- `sandbox.process` and `sandbox.fs` exist as the process and filesystem
  interfaces
- Preview URLs are `https://{port}-{sandboxId}.proxy.daytona.works`, ports
  3000-9999

**Not yet verified, check before writing against them:** the exact signatures of
`sandbox.process.executeCommand()` and the `sandbox.fs` upload method, and the
exact field on `PortPreviewUrl` that holds the signed URL. Read these from the
installed package's types rather than guessing:

```bash
cat node_modules/@daytonaio/sdk/dist/*.d.ts | grep -A5 "executeCommand\|getPreviewLink"
```

### The snapshot

Build it once, before anything else. Every sandbox starts from it, so we pay the
install cost a single time instead of three times per run.

```bash
daytona snapshot create hack-agent --image node:22-slim --cpu 2 --memory 4
```

If the agents need more baked in (a scaffolded Vite app, pre-pulled npm cache),
use a Dockerfile instead:

```bash
daytona snapshot create hack-agent --dockerfile ./Dockerfile
```

Add `--platform=linux/amd64` when building the image locally on Apple silicon.

### Sandbox lifecycle

```ts
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })

const sandbox = await daytona.create({
  snapshot: 'hack-agent',
  labels: { round: roundId, agent: agent.id },
  autoStopInterval: 30,
  ephemeral: true,
})
```

`labels` make the sandboxes findable in the dashboard when demoing.
`autoStopInterval` and `ephemeral` are the cost guard: nothing survives a
forgotten cleanup.

Tear down in a `finally`, always:

```ts
try {
  await runRound()
} finally {
  await Promise.allSettled(sandboxes.map((s) => s.delete()))
}
```

### Preview URLs into the frontend

Use `getSignedPreviewUrl(port, expiresInSeconds)`. It is a **separate method**
from `getPreviewLink(port)`, not a flag on it. The signed URL carries its own
token, so the office can drop it straight into an `<iframe>`. `getPreviewLink`
returns 401 without a token header, which an iframe cannot send.

Verified empirically: the signed URL returns 200 with no headers at all and
sends no `X-Frame-Options` and no CSP, so framing is safe. See
[ARENA.md](ARENA.md) for the measured facts and the lifecycle constraints, which
supersede anything in this file.

Sandboxes have isolated network stacks. **Do not attempt sandbox-to-sandbox
networking** for agent messaging - it goes through the orchestrator.

---

## ElevenLabs: six voices

Not narration of the thought stream. Voicing every thought is a latency and
noise disaster and it buries the moment that matters. Instead:

**Each agent has a fixed, distinct voice**, assigned once in config next to its
persona. Six voice ids, chosen to be tellable apart. The voice is part of the
character, the same way the avatar is.

**Two moments are voiced, and only two:**

1. **The pick.** When `pick_theme` succeeds, one short line: "I'm taking colour."
   Six of these, spread across the mingle phase. This is what makes the office
   feel inhabited.
2. **The pitch.** At `submit`, the agent supplies a one-sentence pitch as part of
   the tool call, and that is voiced in full. Six clips, each a few seconds. This
   is the demo's centrepiece: six agents pitching their own work in their own
   voices.

Extend the `submit` tool with a `pitch` field:

```ts
{
  port: z.number().int().min(3000).max(9999),
  title: z.string(),
  description: z.string(),
  pitch: z.string().describe(
    'One spoken sentence pitching your project, in your own voice. This is ' +
    'read aloud to the judges, so write it to be heard, not read.',
  ),
}
```

Synthesis happens **in the orchestrator, not the sandbox**, on the `submit` and
`theme` events. Write the audio to `public/audio/{seq}.mp3` and put the path on
the event. The frontend plays it when that event scrolls past, which means
**replay gets voices for free** and the demo never waits on a TTS call.

Failure is non-fatal: if synthesis fails, emit the event without `audioUrl` and
render the line as text. Never let a TTS error break the round.

## Braintrust: scoring as an eval

The Braintrust judge is an Eval Engineer, so a thin wrapper around one prompt
will not impress. Model the round as an actual eval: each submission is a case,
the theme is the input, the preview URL is the output, and the scorers are the
graded dimensions.

**Code scorers, no model involved.** These are the mechanical checks from the
rules section, moved behind Braintrust's scorer interface: preview returns 200,
response body over 500 bytes, build log free of uncaught errors. They are
deterministic and cheap, which is exactly what a code scorer is for.

**LLM-judge scorer, per track.** Given the track's theme and its submissions,
score originality and fit to brief, and return reasoning alongside the number.
Never compare across tracks: each judged set answers one brief.

Log every round as a Braintrust experiment. The payoff beyond the prize is that
the eval view is a far better artifact to show on stage than a printed score, and
it answers the "how do you know the agent did well" question that a judging panel
of eval engineers will certainly ask.

## The event log

The spine. Everything else is a renderer over it.

```ts
type AgentId = 'ada' | 'rex' | 'juno' | 'iris' | 'otto' | 'vera'
type Track = 'time' | 'color'

type AgentEvent = {
  seq: number
  ts: number
  agentId: AgentId
  kind: 'thought' | 'message' | 'build' | 'theme' | 'submit' | 'phase' | 'score'
  body: string
  track?: Track
  targetId?: AgentId
  previewUrl?: string
  audioUrl?: string
  score?: { mechanical: number; creative: number; rank: number }
}
```

Append-only, in memory, mirrored to `events.jsonl` on every write. The file is
what makes replay free: reload it, replay at 10x, demo without live agents.

Frontend subscribes over SSE at `GET /events`. On connect, replay the whole log
then tail. That one decision means the office can be refreshed mid-demo without
losing state.

---

## Sponsor surface

There are six independently winnable **Best Use of** prizes, so breadth has real
expected value here. It is still bounded by what three people can build well in
the time left: a shallow integration does not win a Best Use category, it just
costs an hour that a deep one needed.

Judge composition is a live signal. Daytona, CodeRabbit and CopilotKit each have
**two** judges in the room; Braintrust and Fireworks have one each. There is **no
WorkOS prize**, which settles that one.

### Committed

| Partner | Prize | What we build |
|---------|-------|---------------|
| Daytona | $1,000 + $10,000 credits | One snapshot-backed sandbox per agent, lifecycle managed, signed preview URL as the submission artifact. Our deepest integration and best shot. |
| ElevenLabs | 6 months Scale tier per team member | Six distinct agent voices. Highest-value special prize by a wide margin. |
| Braintrust | $500 + Lego | Mechanical checks as code scorers, creative rank as an LLM-judge scorer, per track. Already load-bearing for our judging. |

### Stretch, in priority order

| Partner | Prize | Why it is not committed |
|---------|-------|-------------------------|
| CopilotKit | $500 + Meta Ray-Ban, 2 judges | A spectator sidebar over the office is a genuine fit, but it is a fourth integration competing with a working orchestrator. Take it only if the loop runs by 13:30. |
| CodeRabbit | $1,000 + swag, 2 judges | Thematically the best fit of all: agents write code, CodeRabbit reviews it, review quality feeds the rank. Needs git push from sandboxes plus review latency. Too many failure modes for the time left. |
| Fireworks AI | $500 + Bose, 1 judge | The interesting version is a mixed-model arena where a Fireworks-hosted agent competes against Claude agents. The blocker is real: the Claude Agent SDK will not drive a Fireworks model, so that agent needs a hand-rolled tool loop. |

**Free CodeRabbit partial credit:** install the GitHub app on this repo and
develop on branches with PRs. Reviews happen automatically, cost about five
minutes, and give a screenshot for the slides. It is weak evidence for a Best Use
claim but it is close to free.

**Skipped: WorkOS.** No prize category, and the app has no end users to
authenticate.

## Safety and safeguards

The brief asks twice for this: "safe integration with industry-relevant tools"
and a live showcase "proving your agent operates safely." We have a real answer
rather than a hand-wave, and it should be one slide and one line in the demo.

Six autonomous agents write and execute arbitrary generated code. Every one of
these is an architectural property, not a policy we ask the model to respect:

- **Isolation per agent.** Each agent's code runs in its own Daytona sandbox with
  a dedicated kernel, filesystem and network stack. One agent cannot read, break
  or influence another's work.
- **The orchestrator host is unreachable.** `tools: []` strips every built-in
  file and shell tool from the agent's context. The only way an agent can touch a
  filesystem is `sandbox_bash` and `sandbox_write`, both scoped to its own
  sandbox. An agent cannot reach the machine running the loop.
- **No agent-to-agent channel.** Sandboxes have isolated network stacks and we
  never bridge them. Every message between agents is mediated, logged and
  replayable through the orchestrator.
- **Explicit allowlist.** `allowedTools` names the exact five tools. Anything
  outside that list has no path to execution.
- **Bounded blast radius in time.** Sandboxes are `ephemeral` with an
  `autoStopInterval`, and torn down in a `finally`. Nothing outlives the round.
- **Full auditability.** Every thought, command, message and submission is an
  append-only event in `events.jsonl`. Any claim we make on stage can be replayed
  from the log.

The demo line: the office is simulated, the code is real, and the reason we can
safely let six models run unattended is that Daytona gives each one a box it
cannot get out of.

## Build order

Agree the `AgentEvent` shape first. Then nobody blocks.

| Owner | Builds |
|-------|--------|
| Antonin | Daytona client, snapshot, sandbox pool, event log, SSE endpoint |
| Patrik | The four tools, the agent loop, personas, phase driver |
| Kris | Office frontend, driven entirely by `events.jsonl` fixtures |

Kris should never wait for a working agent. Hand-write twenty events into a
fixture file in the first ten minutes and build against that.

## Risks

- **Token spend, now the binding constraint.** Six Opus agents at 40 turns each
  is roughly double the three-agent design and is the real budget, not Daytona
  compute. Develop against a fixture log and only run real agents when testing
  the agent loop itself. Levers in the order I would pull them: cut `maxTurns`
  to 25, drop to four agents across two tracks, then move to
  `claude-sonnet-5`. Running some agents on a cheaper model than others also
  works but makes "which agent won" a weaker signal, so treat it as a demo
  shortcut rather than a real result.
- **Concurrency.** Six sandboxes and six streaming generators at once. Daytona
  advertises massive parallelisation so the sandboxes are fine, but cap
  orchestrator concurrency anyway and confirm the account's sandbox limit
  before the first full run rather than discovering it at 14:00.
- **Preview URL not ready at submit time.** The dev server may not be listening
  the instant the agent calls `submit`. Poll the URL for up to 10s inside the
  `submit` tool before recording a failure.
- **Demo timing.** Never demo live without `events.jsonl` from a good run already
  loaded as a fallback.
