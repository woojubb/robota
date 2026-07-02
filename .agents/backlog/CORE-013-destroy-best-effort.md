---
title: 'CORE-013: destroy() rethrows cleanup failures — fire-and-forget becomes a process-killing unhandled rejection'
status: todo
created: 2026-07-03
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# `destroy()` should be best-effort

External adoption feedback (speech project, `.design/feedback-speech-adoption-2026-07-03.md` §3.3,
source-verified 2026-07-03): `destroyAgent` logs a cleanup error and **rethrows**
(`robota-lifecycle.ts:124-128`). A consumer writing the natural `void agent.destroy()` for
short-lived instances gets an unhandled rejection on failure — on Node 20+ that terminates the
process. The reporter's code review caught it as a crash vector; they now wrap every call in
`.catch(() => {})`.

Same defect class as ERR-001 G1 (async failure escaping to process death); this is the
library-side fix — the disposal path itself must not be a crash vector.

## What

- Make `destroy()` best-effort: log each cleanup failure (existing logger) and resolve; never
  reject for cleanup errors. If a hard failure signal is still wanted, expose it as a return value
  (e.g. `Promise<{ errors: Error[] }>`) rather than a rejection.
- Sweep the same pattern across other disposal surfaces (`Session.shutdown`, channel `stop()`,
  background-task `close()`): disposal must be safe to fire-and-forget or explicitly documented
  otherwise — one convention, applied everywhere.

## Test Plan

- Unit: a plugin/module whose cleanup throws — `destroy()` resolves, the error is logged, remaining
  cleanups still run (no early abort of the disposal sequence).
- Sweep check: disposal-surface inventory recorded in the PR with each surface's behavior.

## User Execution Test Scenarios

- Prereq: consumer script creating a `Robota` with a failing-cleanup stub plugin.
- Steps: `void agent.destroy()` then keep the process alive doing other work.
- Expected: process survives; failure visible in logs only.
- Evidence: _to fill at implementation._
