# frontend

The office: the pixel-art room that renders a round live. Vite + React +
TypeScript, subscribed to the arena's SSE stream and holding no state of its own
that the event log does not already have.

Run from anywhere in the workspace:

```bash
pnpm --filter frontend dev      # dev server on http://localhost:5173
pnpm --filter frontend build    # typecheck + production build into dist/
pnpm --filter frontend preview  # serve the production build
pnpm --filter frontend lint     # oxlint
```

`pnpm dev` at the repo root starts this *and* the arena together, which is what
you usually want: the office needs the arena on :4000 to have anything to show.

See [DESIGN.md](../../DESIGN.md) and [COMPONENTS.md](../../COMPONENTS.md) for the
design system this is built on.
