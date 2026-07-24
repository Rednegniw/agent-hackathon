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
| `mingle` | 90s | `send_message` only. Theme is announced. |
| `build` | 12 min | `sandbox_bash`, `sandbox_write`, `send_message` |
| `submit` | 2 min | `submit` only |
| `judged` | - | nothing; orchestrator scores |

Durations are config, not constants in three files. One `ROUND` object.

### The theme

Announced at round start, identical for every agent, hard-coded for the demo:

> Build a single-page web app that does something genuinely useful with the
> current time. It must serve on port 3000.

Constraining the theme is what makes submissions comparable. Agents still choose
their own project inside it, which preserves the "they decided" story.

### Agents

Three, with **asymmetric personas** so that talking to each other has a point.
Personas differ in stated strength only, not in available tools.

| Agent | Persona |
|-------|---------|
| `ada` | Systems-minded. Prefers correctness and edge cases over polish. |
| `rex` | Visual. Prefers something that looks striking over something complete. |
| `juno` | Product-minded. Prefers the simplest thing a real person would use. |

Names are fixed. Avatars in the office key off the agent id.

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

**Creative (0-7), LLM judge.** One `query()` call with the three submissions'
titles, descriptions and preview URLs, returning a ranked list with one sentence
of reasoning each.

If Braintrust is wired up, the creative score moves there and the mechanical
checks become Braintrust scorers. **This is the optional layer.** Ship the
homemade version first.

---

## Part 2: the agent loop

### Package

```
npm i @anthropic-ai/claude-agent-sdk zod @daytonaio/sdk
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
        'send_message',
        'Say something to another agent. They receive it on their next turn. ' +
          'Use it to compare approaches or agree not to build the same thing.',
        {
          to: z.enum(['ada', 'rex', 'juno']),
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
          const url = await sandbox.getPreviewLink(port)
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
You are {name}, competing in a hackathon against two other AI agents.
{persona}

You have your own Linux sandbox. sandbox_bash and sandbox_write are the ONLY
way to touch it - you have no other file or shell access.

The theme is: {theme}

Rules:
- You have {minutes} minutes of build time. It is enforced; when it ends your
  work stops wherever it is.
- Your submission must be a running dev server on port 3000.
- Call submit only after you have verified the server responds.
- The other agents are {others}. You may message them. They can see the same
  theme and are building at the same time.

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

Use the **signed** preview URL variant. It embeds the auth token in the URL, so
the office frontend can drop it straight into an `<iframe>` with no header
plumbing. The standard variant needs a token in a header, which an iframe cannot
send.

Sandboxes have isolated network stacks. **Do not attempt sandbox-to-sandbox
networking** for agent messaging - it goes through the orchestrator.

---

## The event log

The spine. Everything else is a renderer over it.

```ts
type AgentEvent = {
  seq: number
  ts: number
  agentId: 'ada' | 'rex' | 'juno'
  kind: 'thought' | 'message' | 'build' | 'submit' | 'phase' | 'score'
  body: string
  targetId?: string
  previewUrl?: string
  score?: { mechanical: number; creative: number }
}
```

Append-only, in memory, mirrored to `events.jsonl` on every write. The file is
what makes replay free: reload it, replay at 10x, demo without live agents.

Frontend subscribes over SSE at `GET /events`. On connect, replay the whole log
then tail. That one decision means the office can be refreshed mid-demo without
losing state.

---

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

- **Token spend.** Three Opus agents at 40 turns each is the real budget, not
  Daytona compute. Develop against a fixture log; only run real agents when
  testing the agent loop itself. If spend becomes the constraint,
  `claude-sonnet-5` is the lever, and that is a deliberate call to make, not a
  default.
- **Preview URL not ready at submit time.** The dev server may not be listening
  the instant the agent calls `submit`. Poll the URL for up to 10s inside the
  `submit` tool before recording a failure.
- **Demo timing.** Never demo live without `events.jsonl` from a good run already
  loaded as a fallback.
