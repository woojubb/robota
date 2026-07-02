---
title: 'ERR-001: transient network errors — surface clearly to the user, never kill or freeze the TUI'
status: todo
created: 2026-07-03
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-transport-tui, packages/agent-framework, packages/agent-provider
depends_on: []
---

# Network error surfacing + process liveness

A momentary network drop while using agent-cli can error a turn. Auto-retry is a follow-on; the
immediate requirements are: **(1) the user clearly SEES that and why it failed**, and **(2) the
program never freezes or dies** — when the network returns, the user just types the next prompt.

## Architecture review (2026-07-03, code-verified)

The layered structure already assigns most responsibilities correctly. Per layer, what exists today:

| Layer                          | Role in error flow                                                                                                                                                                                                                                                                                                        | Today                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-provider`               | classify → typed errors (`NetworkError`, `RateLimitError`, `AuthenticationError`…)                                                                                                                                                                                                                                        | ✅ exists (`provider.ts` maps SDK/HTTP errors)                                                                                                                                                                                                                                                                                                                                                                                 |
| `agent-session`                | run-loop: log + re-throw; 120s provider idle timeout (`DEFAULT_PROVIDER_IDLE_TIMEOUT_MS`) guards a dead-air hang                                                                                                                                                                                                          | ✅ exists                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `agent-framework`              | **turn recovery boundary**: `interactive-session-prompt.ts` catches the turn error → `humanizeApiError()` (friendly message incl. ECONNRESET/ENOTFOUND/timeout patterns) → pushes `Error: …` system entry to history → emits `error`; controller `finally` releases `executing`, emits `thinking:false`, drains the queue | ✅ exists — the session survives and accepts the next prompt                                                                                                                                                                                                                                                                                                                                                                   |
| `agent-transport-tui`          | render the failure                                                                                                                                                                                                                                                                                                        | ⚠️ **gap G2**: `TuiInteractionChannel`'s `'error'` handler drops the `Error` object (`onError()` takes no argument), clears the stream buffer, and relies solely on the history-synced system entry; no styled error block, no status-bar signal — a mid-stream failure looks like the answer just evaporated                                                                                                                  |
| `agent-cli` (product assembly) | **process survival boundary**                                                                                                                                                                                                                                                                                             | ❌ **gap G1**: `bin.ts` re-throws every non-IME `uncaughtException` and installs **no `unhandledRejection` handler** — on Node 22 an unhandled rejection **terminates the process**. Any async path OUTSIDE the turn boundary (background task/subagent promises, catalog refresh fetch, persistence) that hits a transient network error can kill the whole TUI. This is the biggest violation of "the program must not die". |

Additional gap — **G3 (dead-air feedback)**: a mid-stream partition with no RST shows only
`Thinking…` for up to 120s before the idle timeout fires. Esc-interrupt works, but the user gets no
signal that the connection may be stalled.

### Design (where to change what)

Principle: **classification lives in the provider, humanization in the framework (SSOT:
`humanizeApiError`), turn recovery in the framework controller (already done), RENDERING in each
transport, and PROCESS survival in the product assembly.** No layer above duplicates a lower
layer's job.

1. **G1 — agent-cli (`bin.ts` / TUI mode bootstrap):** install `unhandledRejection` (and widen the
   `uncaughtException` guard) for the interactive TUI mode only: route the error into the live
   session/channel as a rendered error event (reuse the same humanize→history path) and keep the
   process alive; headless/print mode keeps today's fail-fast exit-code contract. The handler must
   not mask programmer errors silently — every swallowed error is still written to the session log.
   Long-term ownership note: each async subsystem (background tasks, subagents, persistence) should
   also terminate its own promises; the process-level handler is the last-resort boundary, not the
   primary one — an audit of `void`-ed / un-`catch`-ed promises in the framework is part of this item.
2. **G2 — agent-transport-tui:** pass the `Error` through the channel's `'error'` wiring into TUI
   state; render a **styled error block** in the transcript (distinct from a system note: icon/color
   - the humanized message + "network restored? just type your next prompt" affordance) and a
     transient status-bar error state; when a stream was interrupted mid-answer, keep the partial text
     visible and mark it as interrupted rather than clearing it.
3. **G3 — agent-framework/TUI:** surface dead-air: after N seconds with no stream delta, flip the
   status line to "waiting on the provider (network may be stalled) — Esc to interrupt"; consider
   lowering/making configurable the 120s idle timeout for interactive mode.
4. **G4 — agent-provider (follow-on, separate scope):** bounded in-place auto-retry with backoff for
   idempotent transient failures (connection reset before first byte), honoring `RateLimitError.retryAfter`.
   Explicitly OUT of this item's scope; capture as its own backlog item when this lands.

### Why NOT other layers

- Not agent-core: it owns typed errors already; core must stay UI-free.
- Not agent-session: the run loop correctly re-throws — recovery policy is the interactive layer's.
- Not the framework for rendering: environments differ (Ink block vs stderr vs web toast) — CMD-004
  precedent: per-transport rendering over a shared contract.

## Test Plan

- Unit: TUI error-state reducer (error block + status-bar flag + partial-stream preservation);
  `humanizeApiError` already covered.
- Functional (TEST-003 harness): a scripted provider that throws `NetworkError` mid-turn → history
  gains the humanized entry, `thinking:false` fires, the NEXT submit succeeds (liveness).
- Process-level: a test that rejects an un-awaited promise inside the running TUI (fixture hook) and
  asserts the process stays alive and the error renders; headless mode still exits non-zero.
- PTY E2E (tui-e2e gate): real binary + replay fixture whose provider errors once → styled error
  visible, prompt usable, second turn completes.

## User Execution Test Scenarios

- Prereq: built CLI, real provider configured.
- Steps: start `robota`, submit a prompt, kill the network mid-response (e.g. toggle Wi-Fi off),
  observe; restore the network; submit another prompt.
- Expected: a clearly-styled error explains the network failure (not a silent stop, not a stack
  trace, not a dead UI); any partial answer stays visible marked interrupted; the input prompt is
  immediately usable; the post-restore prompt round-trips normally; the process never exits.
- Evidence: _to fill at implementation (live run — capability-absence claims require a probe)._
