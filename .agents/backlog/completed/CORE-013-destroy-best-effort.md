---
title: 'CORE-013: destroy() rethrows cleanup failures — fire-and-forget becomes a process-killing unhandled rejection'
status: done
completed: 2026-07-03
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
- Evidence: **PASS (live, 2026-07-03).** Implemented the approved best-effort + result-value
  design: `destroyAgent` runs every cleanup step in its own guard, logs each failure, always
  resets state, and returns `IDestroyResult` (`{ errors: Error[] }`) — `Robota.destroy()` now
  types as `Promise<IDestroyResult>` and never rejects for cleanup errors (`IDestroyResult`
  exported from core). Disposal-surface sweep (one convention, applied everywhere), inventory:
  `Session.shutdown` (agent-session) — was rejectable via persist/SessionEnd-hook failures with
  a cached rejected promise; now step-guarded, failures recorded as
  `session_shutdown_step_error` log events, always resolves. `TransportRegistry.stopAll`
  (agent-transport + `ITransportRegistryView` contract) — was abort-on-first-throw; now stops
  every transport and returns `IDestroyResult`. `createInteractiveRuntime.stop` — channel-stop
  failure no longer skips `session.shutdown()`. `ProgrammaticInteractionChannel.stop`/headless
  `stop` — already no-throw (no change). Operation-style closes (`closeTask`/`cancelTask`/
  `closeAgentJob`) intentionally keep throwing — caller-meaningful errors, documented in SPEC.
  Unit: failing-cleanup plugin → `destroy()` resolves with the collected error and the healthy
  plugin's cleanup still ran; registry stopAll failing transport → second transport still
  stopped + error collected; Session shutdown with throwing SessionEnd hook executor → resolves
  (+ cached-promise identity). Full repo typecheck + test + doc-examples green. Docs synced:
  SPEC "Disposal Contract (CORE-013)" section, guide destroy() section rewritten (DOCS-014's
  interim throw-contract text replaced), llms.txt behavior-contract line updated. Live User
  Execution: consumer script (agent-playground, inline echo provider — no key needed) with a
  failing-cleanup stub plugin ran `void agent.destroy()` then kept working —
  `unhandledRejection` listener observed 0 events, process survived 3 timer ticks, PASS.
