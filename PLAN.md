# Plan

Deadline: **15:30 PDT sharp**, submitted on Devpost. Not extended under any circumstances.

## Scope

Three agents, one round, one fixed theme. No dynamic theme selection, no multi-round,
no elimination. Everything below the line marked OPTIONAL gets cut without discussion
if the clock says so.

## The spine

One append-only event log. Every agent action becomes an event. The frontend is a
renderer subscribed to that log, and nothing else. This is the only architectural
decision that matters, because it means the office can be built and demoed against
fixture data while the agents are still broken.

```ts
type AgentEvent = {
  seq: number
  ts: number
  agentId: string
  kind: 'thought' | 'message' | 'team' | 'build' | 'submit'
  body: string
  targetId?: string   // for 'message'
  previewUrl?: string // for 'submit'
}
```

Agree this shape first, then split. Nobody blocks on anybody else after that.

## Split

Matched to who is fastest at what.

- **Antonin** - orchestrator + Daytona. Sandbox pool, snapshot, event log, preview URLs.
- **Patrik** - the agent loop. Claude Agent SDK inside the sandbox, persona prompts, the
  three tools (`send_message`, `join_team`, `submit`).
- **Kris** - the office frontend. Runs entirely off fixture events from hour one.

## Daytona scaffolding

Verified against the docs, not guessed:

1. **One snapshot, pre-baked.** Agent runtime and deps installed once. Every sandbox
   starts from it. Do not `pip install` per agent, it costs minutes you do not have.
2. **Orchestrator lives outside the sandboxes** and owns the log.
3. **Messaging routes through the orchestrator.** Sandboxes have isolated network
   stacks. Do not attempt sandbox-to-sandbox networking.
4. **Submission is `getPreviewLink(port)`.** Use the signed variant so the token is
   embedded in the URL and the office can iframe it with no header plumbing.
   Previewable ports are 3000-9999.

Relevant API surface: `Daytona.create`, `sandbox.process`, `sandbox.fs`,
`sandbox.getPreviewLink(port)`, `sandbox.delete()`.

## Schedule

| Time | What |
|------|------|
| 10:45-11:15 | Agree the event schema. Split. |
| 11:15-13:00 | Parallel build against the schema. |
| 13:00-13:30 | First integration. Real events into the real office. |
| 13:30-14:00 | **Submit a Devpost draft.** Editable until deadline. |
| 14:00-14:30 | Full run, fix what breaks. |
| 14:30-15:00 | **Record the demo video.** Not optional, not last. |
| 15:00-15:30 | Finalize Devpost. Buffer. |

## Cut list

In order, when time runs out:

1. Team formation
2. Agent-to-agent messaging
3. Third agent (two still reads as a competition)

## OPTIONAL

- **Braintrust scoring.** Heuristic scorers for "does it build" and "does the preview
  return 200", LLM-judge scorer for creativity. Gold partner, and it solves the
  judging problem honestly rather than with a vibes prompt. Worth an hour if there is one.
- **ElevenLabs voices** for the agents. Small integration, large effect on the video.

## Risks

- **Demo timing.** Real agents take minutes; the pitch is three. Persist every run's
  event log and support replaying it at speed. Never demo live without a recorded
  fallback already loaded.
- **Token spend**, not Daytona compute, is the real budget. Parallel long-horizon
  agents burn fast. None of the event credits cover Anthropic usage.
