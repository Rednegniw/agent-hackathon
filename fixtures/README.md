# Fixtures

## `demo-run.jsonl`

One complete arena round against **live Daytona sandboxes**: six agents, two
tracks, 47 events, 6/6 submissions, 0 failures, 93.2s wall clock. Captured
2026-07-24 with `ARENA=daytona KEEP_ALIVE=1`.

This is the **demo insurance**. If a live run fails on stage, replay this
instead. It is the only run committed to the repo; `runs/` stays gitignored so
throwaway rounds do not pile up in git.

Two uses:

- **The office.** Kris can develop against it with no arena, no Daytona and no
  tokens. Every submission carries a real `previewUrl`, and the event shapes are
  exactly what the SSE stream emits.
- **The stage fallback.** Replaying beats improvising a live re-run in front of
  judges.

The sandboxes behind this run's preview URLs have been reclaimed, so those URLs
now 404. The event log itself is unaffected: it is a record of what happened, and
everything except the liveness of those six URLs still holds.

A rendered view of this exact file is in [`docs/trace.html`](../docs/trace.html).
