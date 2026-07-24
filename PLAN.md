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
| 14:30-15:00 | **Record the demo video** and **build the slides.** Neither is optional. |
| 15:00-15:30 | Finalize Devpost. Buffer. |
| 15:30 | Submission closes. Finalists selected. |
| 16:00 | Finalist presentations, 3 minutes each. |
| 16:45 | Awards. |

Submit at: https://daytona-hacksprint-sf-jul-2026.devpost.com/

### Judging is two rounds, and the first one never sees the demo

Round one is scored **on the Devpost submission alone**. Eight teams are picked
from that to pitch. Round two is the stage pitch, 3 minutes plus 2 minutes Q&A.

**The Devpost writeup is the gate, not the live demo.** Budget for it like a
deliverable, not an afterthought. It must contain:

- Team name and every member with email and socials
- Demo video, screen recording, **under 2 minutes**
- 2 to 3 sentence summary; the problem and its impact; key technical
  architecture; **a list of every sponsor tool used and how it was integrated**
- Public GitHub repo URL (this repo, already public)

Weighted criteria: Impact Potential 25%, Technical Execution 25%, Creativity
25%, Presentation 25%, Sponsor Tool Usage as a bonus.

**Best Use awards are open to every team, not only the eight finalists.** Sponsor
integrations pay off even if we do not make the pitch round.

### Positioning: lead with the harness, not the office

Impact Potential is 25% and it is our weakest criterion. "AI agents in a
simulated office" reads as a toy. The same system described as **a harness for
evaluating autonomous coding agents** reads as a real problem: run N agents
against one brief in isolated sandboxes, score them on shipped artifacts rather
than transcripts, and keep a replayable audit log of everything each one did.

That framing is not spin. It is what the thing actually is, and it makes Daytona
and Braintrust load-bearing rather than decorative. The pixel office is the
interface to it. Lead with the harness in the Devpost, show the office in the
video.

### Credits: redeem before you build

Codes are per participant and single-use, so each of us redeems our own from the
**Hacker Resources** page linked in the Luma event. They are deliberately not
checked into this repo, which is public.

Order to do them in, by how long they take:

1. **ElevenLabs** first. There is no code: you join the Discord, open the
   coupon-codes channel, start a redemption, fill a form with your registration
   email, and a bot DMs you a code. The most steps by far.
2. **Braintrust.** The coupon only applies if you go through the **Pro upgrade
   path** in billing settings. Redeeming outside that path silently does nothing.
3. **Daytona.** Account, then Billing Dashboard, then redeem.
4. **CopilotKit**, only if we take the stretch: `npx copilotkit@latest license`.

Skip WorkOS. It requires adding a credit card and emailing their credits team,
and there is no WorkOS prize category.

### Slides are a required deliverable

The brief is explicit: three minutes, "impactful slides outlining your idea,
advantages, and safeguards," plus a live showcase "proving your agent operates
safely and drives meaningful results." Five slides is plenty:

1. The idea, in one sentence and one screenshot of the office.
2. How it works: six agents, two tracks, one Daytona sandbox each.
3. **Safeguards.** Straight from the safety section of the spec. The brief asks
   for this twice, so it is not padding.
4. What the agents actually shipped: the winning preview URLs, live.
5. How we scored it: the Braintrust eval view.

Slide 3 is the one most teams will skip. Do not skip it.

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
