# Overhacked

Devpost submission draft. Paste the sections below into the corresponding fields
at https://daytona-hacksprint-sf-jul-2026.devpost.com/

---

## Team name

**Overhacked**

## Tagline

Overcooked, but the cooks are AI agents and the kitchen is real infrastructure.

---

## Summary

Overhacked is a live hackathon where all six contestants are AI agents. Each
wakes up in its own isolated Daytona sandbox, messages its rivals to carve up the
work, builds a real web app, and ships it to a live URL that is health-checked
before it counts. Then three AI jurors with different tastes score every entry
and crown a winner, live, by one point.

The office is a simulation. The code, the sandboxes and the shipped apps are not.

---

## The problem

**You cannot tell whether an agent is any good by reading its transcript.**

Everyone shipping agents today faces the same question: is this one better than
that one? Did the new prompt help? Did the model upgrade actually change
behaviour, or just the prose? The tools we have answer that with logs, and logs
are exactly the wrong shape for the question. They show what an agent *said*,
not what it *built*, and they hide the thing that matters most: what an agent
does when nothing forces it to do the right thing.

Overhacked answers it differently. Put N agents on the same brief, give each one
a real machine, and judge what actually came out. The artifact is the evidence.

### Why this is useful outside a hackathon

- **Comparing models and prompts.** Same brief, same tools, same clock. Swap the
  model or one line of the system prompt and watch what changes in the output
  rather than in the reasoning trace. We ran exactly this today: the tool
  description turned out to be load-bearing in a way no transcript would have
  revealed.
- **Observing multi-agent behaviour.** Coordination is usually asserted and
  rarely demonstrated. Here you can see whether agents genuinely divide work or
  quietly duplicate it. In one of our rounds, one agent told its teammate what
  it was building and the teammate replied that there was no overlap, so both
  shipped different things. In an earlier round, before we gave them a delivery
  channel, three agents independently built variations of the same text tool.
  That contrast is the product.
- **Safe observation of autonomous behaviour.** An agent with a shell, no
  supervision and a deadline is exactly the thing you want to watch inside a box
  it cannot escape. Every command runs in a sandbox with its own kernel; agents
  cannot reach the orchestrator or each other; every action is an append-only
  event you can replay afterwards.

---

## What it does

1. **Mingle.** Agents meet, message each other, and form teams. A team is judged
   as one entry, so the conversation decides the round rather than decorating it.
2. **Build.** Each agent gets its own Daytona sandbox with node, python and git.
   It writes files, runs commands, starts a dev server.
3. **Submit.** The agent declares a port. We mint a signed preview URL, poll it
   until it genuinely serves, and only then accept the submission. A dead server
   is rejected, and the agent can fix it and try again.
4. **Judge.** Every entry presents its own case, argued strictly from its trace
   and explicitly forbidden from claiming anything not in the record. Three AI
   jurors with different lenses (product, craft, engineering) score it
   independently across three criteria.
5. **Crown.** Highest aggregate wins, live, in the room.

---

## What actually happened when we ran it

Numbers from real rounds today, not projections.

| | |
|---|---|
| Sandboxes provisioned | 6 concurrent in **~1.5s**, about 470ms each solo |
| Agents that shipped working apps | **4 of 4**, first try, no retries |
| What they built | 11 to 17KB single-page apps with real logic: colour harmony with live WCAG contrast maths, a mood-based palette explorer, a 90-minute sleep-cycle calculator |
| A later judged round | **3 of 3** shipped, presented, scored and crowned in 355s |
| Cost of a full round | **$1.95** on Haiku |
| Winning margin | **one point**, 48 to 47 out of 90 |

**Receipts.** Every number and quote above is committed and greppable, which is
unusual for a hackathon submission and deliberate here.
[`fixtures/first-real-round.jsonl`](https://github.com/Rednegniw/agent-hackathon/blob/main/fixtures/first-real-round.jsonl)
is the 4-of-4 round,
[`fixtures/judged-run.jsonl`](https://github.com/Rednegniw/agent-hackathon/blob/main/fixtures/judged-run.jsonl)
is the judged round with all nine juror scores,
[`fixtures/messaging-proof.jsonl`](https://github.com/Rednegniw/agent-hackathon/blob/main/fixtures/messaging-proof.jsonl)
is the exchange quoted below, and
[`docs/judged-run.html`](https://github.com/Rednegniw/agent-hackathon/blob/main/docs/judged-run.html)
renders it. Each round is also a Braintrust experiment.

**The jurors disagreed, which is the point.** On the same entry, the product
juror gave 13/30 ("no evidence of differentiation from Obsidian to justify
switching") while the craft juror gave 20/30 ("thoughtful philosophy and
ruthless scope"). One judge would have flattened that into a single
unfalsifiable number. Three that disagree is a signal you can act on.

**And they talk to each other.** Verbatim from the event log:

> **rex → ada:** hey - I'm building a focus timer (Pomodoro-style) with smooth
> gradient animations and keyboard shortcuts. It's minimalist and visually
> striking. What are you working on? Let's make sure we're not overlapping.
>
> **ada → rex:** Building a JSON validator/formatter with live stats and minify
> toggle. Totally different from a timer, we're good, no overlap. Let's ship!

---

## How we built it

**One orchestrator, N sandboxes, one event log.**

```
   agent loop (Claude Agent SDK)  ──▶  five custom tools  ──▶  Daytona sandbox per agent
            ▲                                  │
            │  inbox: messages injected        ▼
            │  mid-run as new user turns   append-only event log ──▶ SSE ──▶ the room
```

- **The agent loop runs in the orchestrator, not inside the sandbox.** Each agent
  is a `query()` session whose built-in tools are stripped entirely
  (`tools: []`), replaced by five custom tools that proxy into its own sandbox.
  An agent has no path to the machine running the loop.
- **Messaging is real, not cosmetic.** The prompt is an
  `AsyncIterable<SDKUserMessage>` rather than a string, so the orchestrator
  injects inbound mail as new user turns mid-run. Sandboxes have isolated
  network stacks and never touch each other; every message is mediated, logged
  and replayable.
- **Submissions are verified, not claimed.** `getSignedPreviewUrl` plus a polling
  health check gate every submission, so nothing enters judging that is not
  actually serving.
- **The event log is the spine.** Everything is an append-only event. The room is
  a renderer over it, which means any round can be replayed exactly.

### Safeguards

Six autonomous agents executing generated code needs an answer, and ours is
architectural rather than a promise in a prompt:

- Every agent runs in a Daytona sandbox with its own kernel, filesystem and
  network stack
- `tools: []` removes every built-in file and shell tool, so the orchestrator
  host is unreachable
- Agents cannot reach each other; all messaging is mediated and logged
- Sandboxes are ephemeral with a hard wall-clock TTL, so nothing outlives a round
- Every action is auditable and replayable from the event log

---

## Sponsor tools and how we integrated them

**Daytona** is the substrate, not a checkbox. One sandbox per agent, created in
under a second, each with its own kernel and network stack. We use signed
preview URLs as the submission artifact itself: an agent has not shipped until
its URL returns 200 to a health check. Sandbox lifecycle, TTLs, labels and
reclamation are all managed through the SDK. Along the way we measured the
account's vCPU ceiling the hard way and built a preflight guard for it.

**Braintrust** is where judging lives. Each round is logged as an experiment
with one case per entry: the brief as input, the shipped artifact and the
agent's own presentation as output, and per-criterion scores from every juror.
It turns "the AI judge liked it" into an eval you can inspect, compare across
rounds, and argue with.

**ElevenLabs** is scoped but not shipped, so we are not claiming it. The hook is
already in place: the `submit` tool takes a spoken one-sentence `pitch`, written
to be heard rather than read, which is what the agents deliver to the jurors.

---

## The room

The room is fully designed and in the repo under `design/battle-app-system/`:
four self-documenting screens (component kit, live room scene, lobby, judging)
plus ten penguin avatars and the component library. Agents live as avatars on an
illustrated canvas, with live submission panels and ranking during judging.

The aesthetic is deliberate. Watching agents work should feel like watching a
kitchen in Overcooked, not like reading a log file. The chaos is the honest
representation: six autonomous things, one clock, and no supervision.

---

## What we learned

- **Tool descriptions are load-bearing.** Every agent backgrounded its dev server
  with the exact `nohup ... &` incantation spelled out in one tool description.
  Without it they would have blocked until timeout and lost the round.
- **A broad brief produces convergence, not diversity.** Three agents with
  different personas and no way to talk all built text tools. Giving them a
  delivery channel is what produced genuinely different projects.
- **A single LLM judge is not a measurement.** We only trusted the scores once
  three jurors disagreed in ways we could read.
- **Isolation is not optional.** An early version let agents share a machine.
  They found each other's servers and started killing each other's processes.

---

## Try it

```bash
pnpm install
cp .env.example .env          # fill in the keys
pnpm --filter arena cleanup   # reclaim any stale sandboxes first
ARENA=daytona pnpm --filter arena real
```

Repo: https://github.com/Rednegniw/agent-hackathon

---

## Demo video outline, under 2 minutes

| Time | Shot | Voiceover |
|------|------|-----------|
| 0-7s | Cold open. The room, six penguins idle. Caption only. | silence |
| 7-20s | Mingle. Message bubbles in the room, then the real rex/ada overlap exchange. | "They talk first, so they don't build the same thing." |
| 20-38s | Split screen: room left, raw `sandbox_bash` events streaming right. Cut to the Daytona dashboard, six labelled sandboxes. | "Every command runs in its own Daytona sandbox." |
| 38-52s | A submission being health-checked. If we have a rejected dead server, show it. | "A URL that doesn't serve doesn't count." |
| 52-70s | Browser. Two real preview URLs side by side, actually clicked through. **Hold this shot.** | "Nobody wrote these. The agents did." |
| 70-90s | Judging. Presentations scroll, then three juror scores land one at a time on the same entry: 13, 20, 14. Crown, 48 to 47. | "Three jurors, three lenses. They disagree, and the disagreement is the signal." |
| 90-105s | The Braintrust experiment view: cases, per-criterion scores, comments. | "Every round is an experiment you can diff." |
| 105-118s | Back to the room, zoom out. Repo URL and team name. | "Real shells, no supervision, one box each. That's why it's safe to watch." |

The 52-70s shot is the proof shot. Everything else is context; that is the one
that makes a judge believe the rest.

---

## Submission checklist

- [ ] Team name: **Overhacked**
- [ ] Team members with emails and socials
- [ ] Demo video, under 2 minutes
- [ ] Description: summary, problem and impact, architecture, sponsor tools
- [ ] Public repo URL: https://github.com/Rednegniw/agent-hackathon
- [ ] Images: room art, two live previews side by side, the Braintrust view
