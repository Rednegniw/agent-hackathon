# Overhacked

Devpost submission. Paste each section into the matching field at
https://daytona-hacksprint-sf-jul-2026.devpost.com/

---

## Team name

**Overhacked**

## Tagline

Overcooked, but the cooks are AI agents and the kitchen is real infrastructure.

---

## Summary

Overhacked is a hackathon where every contestant is an AI agent. Each one wakes
up in its own Daytona sandbox, messages its rivals to form teams and split the
work, builds a real web app, and ships it to a live URL that is health-checked
before it counts. Three AI jurors with different tastes then score every entry
and crown a winner.

The office is a simulation. The sandboxes, the shells, the shipped apps and the
scores are not.

![The office during the build phase](docs/images/office.png)

---

## Why

You cannot tell whether an agent is any good by reading its transcript. Logs
show what an agent *said*, not what it *built*, and they hide the thing that
matters most: what an agent does when nothing forces it to do the right thing.

Overhacked answers that differently. Put N agents on one brief, give each a real
machine, and judge what actually came out. The artifact is the evidence.

That makes it a rig for three things teams do badly today: comparing models and
prompts on identical conditions, observing whether agents genuinely coordinate
or quietly duplicate, and watching autonomous behaviour inside a box it cannot
escape.

---

## What actually happened when we ran it

Real rounds today, all committed and greppable.

| | |
|---|---|
| Biggest round | **10 agents, 3 self-formed teams, 10/10 shipped** a live health-checked URL, judged and crowned in **7m47s** |
| Provisioning | 6 sandboxes concurrently in **~1.5s** |
| One team round | 6 agents, **47 agent-to-agent messages, 88 sandbox commands**, 13 screenshots the agents took of their own apps |
| Cost | **$1.95** per full round on Haiku |
| Closest finish | **57 / 52 / 51** out of 90 across three teams |

**They negotiate interfaces across machines.** rex, integrating for team-1, sent
juno a contract before either had code: the `DriftTimer` namespace, `.timer-`
class prefix, `drift_*` localStorage keys, and `DriftAudio.setVolume(soundId,
0-1)`. Two agents on two different machines agreeing on an API, unprompted.

**They deduplicate on purpose.** From the same round, rex to juno:

> Heads up: ada was about to build the same timer engine, I redirected her to
> own stats/streaks + keyboard shortcuts + completion chime instead, so you're
> the sole owner of the countdown.

**They test without being asked.** otto, on his timezone-overlap math:

> Unit-tested longestRun in isolation (wraparound 22-23-0-1 → start:22,len:4 ✓;
> normal case ✓; all-day overlap ✓; zero-overlap → null ✓).

**They debugged our infrastructure for us.** Two agents noticed a delivered file
was byte-identical to one they had just sent, and diagnosed the race in our own
`share_file` implementation:

> Ah, mystery solved: your share landed in my sandbox right before I called
> share_file to you, so I unknowingly bounced your own file back. My original
> build got overwritten too.

**The jurors disagree, which is the point.** On one entry: 13/30 from the
engineer juror ("polished pitch, chaotic build (three conflicting file
rewrites), zero functional verification") and 23/30 from the craft juror
("restraint in positioning elevates an otherwise incremental tool"). A single
judge would have flattened a 10-point disagreement into one unfalsifiable
number.

**Receipts.**
[`fixtures/big-round.jsonl`](https://github.com/Rednegniw/agent-hackathon/blob/main/fixtures/big-round.jsonl)
(10 agents),
[`fixtures/team-round.jsonl`](https://github.com/Rednegniw/agent-hackathon/blob/main/fixtures/team-round.jsonl)
(the quotes above),
[`fixtures/judged-run.jsonl`](https://github.com/Rednegniw/agent-hackathon/blob/main/fixtures/judged-run.jsonl)
(all nine juror scores). Every round is also a Braintrust experiment.

---

## How it works

```
   agent loop (Claude Agent SDK)  ──▶  five custom tools  ──▶  Daytona sandbox per agent
            ▲                                  │
            │  inbox: messages injected        ▼
            │  mid-run as new user turns   append-only event log ──▶ SSE ──▶ the room
```

- **The loop runs in the orchestrator, not the sandbox.** Each agent is a
  `query()` session with its built-in tools stripped entirely (`tools: []`) and
  replaced by five custom tools that proxy into its own sandbox. An agent has no
  path to the machine running the loop.
- **Messaging is real.** The prompt is an `AsyncIterable<SDKUserMessage>`, so the
  orchestrator injects inbound mail as new user turns mid-run.
- **Submissions are verified, not claimed.** A signed preview URL plus a polling
  health check gates every submission. A dead server is rejected and the agent
  can fix it and retry.
- **The event log is the spine.** Everything is append-only, so any round
  replays exactly.

### Safeguards

Six autonomous agents running generated code needs an architectural answer, not
a promise in a prompt: one Daytona sandbox per agent with its own kernel,
filesystem and network stack; `tools: []` so the orchestrator host is
unreachable; no agent-to-agent network path, all messaging mediated and logged;
ephemeral sandboxes with a hard wall-clock TTL; every action auditable and
replayable.

---

## Sponsor tools

**Daytona** is the substrate. One sandbox per agent, created in under a second,
each isolated. Signed preview URLs *are* the submission artifact: an agent has
not shipped until its URL returns 200 to a health check. Lifecycle, TTLs, labels
and reclamation all run through the SDK.

**Braintrust** is where judging lives. Each round is an experiment, one case per
entry: the brief as input, the shipped app and the agent's own presentation as
output, per-criterion scores from every juror. "The AI judge liked it" becomes
an eval you can diff across rounds.

**ElevenLabs** is scoped, not shipped, so we are not claiming it. The hook is in
place: `submit` takes a spoken one-sentence `pitch`, written to be heard.

---

## Try it

```bash
pnpm install
cp .env.example .env          # fill in the keys
pnpm --filter arena cleanup   # reclaim any stale sandboxes
ARENA=daytona pnpm --filter arena real
```

Repo: https://github.com/Rednegniw/agent-hackathon

---

## Images to upload, in order

| # | Image | Caption |
|---|-------|---------|
| 1 | `docs/images/office.png`, the office mid-build | "Ten agents, three teams, one brief, no humans." |
| 2 | Two live preview URLs side by side in a browser | "Nobody wrote these pages. Two agents did, in their own sandboxes, in one round." |
| 3 | The judging panel, three juror scores on one entry | "Three jurors, three lenses, and they disagree by ten points." |
| 4 | Daytona dashboard, ten labelled sandboxes | "One isolated machine per agent, provisioned in about a second." |
| 5 | The Braintrust experiment view | "Every round is an experiment you can diff against the last one." |
| 6 | `design/battle-app-system/uploads/Penguin Avatar Art.png` | "Every agent has a face and a stated disposition that shapes what it builds." |

Images 2 and 3 do the most work. A judge who sees a real preview URL and a real
disagreement between jurors believes everything else.

---

## Demo video, under 2 minutes

| Time | Shot | Voiceover |
|------|------|-----------|
| 0-7s | The office, penguins idle. Caption only. | silence |
| 7-20s | Mingle, then the real dedup message: "I redirected her to own stats instead." | "They talk first, so they don't build the same thing." |
| 20-38s | Split screen: office left, raw `sandbox_bash` events right. Cut to the Daytona dashboard. | "Every command runs in its own Daytona sandbox." |
| 38-52s | A submission being health-checked. | "A URL that doesn't serve doesn't count." |
| 52-70s | Two real preview URLs side by side, clicked through. **Hold this shot.** | "Nobody wrote these. The agents did." |
| 70-90s | Judging. Three juror scores land on one entry: 13, 16, 23. Crown. | "They disagree, and the disagreement is the signal." |
| 90-105s | The Braintrust experiment view. | "Every round is an experiment you can diff." |
| 105-118s | Zoom out on the office. Repo URL, team name. | "Real shells, no supervision, one box each. That's why it's safe to watch." |

The 52-70s shot is the proof shot.

---

## Checklist

- [ ] Team name: **Overhacked**
- [ ] Team members with emails and socials
- [ ] Demo video, under 2 minutes
- [ ] Description pasted
- [ ] Repo: https://github.com/Rednegniw/agent-hackathon
- [ ] Images 1-6 uploaded in order
