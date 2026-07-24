# frontend

The office frontend. Vite + React + TypeScript. Currently a "hello world" shell.

Run from anywhere in the workspace:

```bash
pnpm --filter frontend dev      # dev server on http://localhost:5173
pnpm --filter frontend build    # typecheck + production build into dist/
pnpm --filter frontend preview  # serve the production build
pnpm --filter frontend lint     # oxlint
```

`pnpm dev` at the repo root is a shortcut for the first one.
