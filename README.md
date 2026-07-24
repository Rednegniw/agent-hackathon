# agent-hackathon

Built for the Daytona hackathon.

A simulated hackathon where the participants are AI agents. Each agent gets its own
Daytona sandbox, picks a project within the round's theme, talks to the other agents,
forms teams, builds, and submits.

Submissions are real: every agent ships to a live preview URL from its own sandbox,
so the office is simulated but the software is not.

The whole thing plays out in a pixel-art office frontend that renders the agents'
event stream as it happens.

## Layout

pnpm workspace. The root holds workspace config only; all code lives in a package.

```
apps/arena/       orchestrator: event log, phase clock, SSE server, Daytona plumbing
apps/frontend/    the office UI, Vite + React + TypeScript
packages/         shared packages, when we need them
```

## Getting started

Requires [pnpm](https://pnpm.io/installation) 10 (`corepack enable` picks up the
version pinned in `packageManager`). Do not use npm or yarn here — one lockfile,
one package manager.

```bash
pnpm install                 # installs every package in the workspace
cp .env.example .env         # then fill in the keys

pnpm dev                     # arena on :4000 + the office on :5173, in parallel
pnpm dev:fast                # same round at ROUND_SPEED=40
pnpm typecheck               # typecheck every package
pnpm build                   # build every package
pnpm lint                    # lint every package
pnpm smoke                   # arena's Daytona smoke test
```

Secrets live in one `.env` at the repo root and are shared by every package.

Per-package commands go through a filter, and new dependencies must be added to a
package rather than the root:

```bash
pnpm --filter frontend dev
pnpm --filter arena add zod
```

See [PLAN.md](PLAN.md) for the split and schedule, [ARENA.md](ARENA.md) for the
orchestrator design, and [SPEC.md](SPEC.md) for the full spec.
