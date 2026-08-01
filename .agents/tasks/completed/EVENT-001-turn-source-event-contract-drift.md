---
title: 'EVENT-001: Add turn_source to the interactive-session event contract (emitted but untyped)'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework
depends_on: []
---

## Evidence Log (2026-06-27)

- `agent-interface-transport/session-contracts.ts`: added `export type TTurnSource =
'user' | 'agent-wakeup'` and `turn_source: (source: TTurnSource) => void` to
  `IInteractiveSessionEvents`; re-exported `TTurnSource` from the package index.
- `agent-framework` controller now imports `TTurnSource` from the contract package (SSOT) and
  re-exports it for compatibility; the local duplicate declaration was removed. The
  `emit('turn_source', …)` call is now contract-backed, so consumers can `on('turn_source', …)`
  type-safely.
- WS forwarding: `turn_source` is intentionally not forwarded to WS clients (consistent with
  other in-process-only events like `memory_event`/`compact`); the drift was the missing
  contract entry, now fixed.
- Verified: `pnpm build:deps` + `pnpm typecheck` PASS; `pnpm harness:scan` 30/30
  (spec-public-surface + interface-imports PASS).

# Add `turn_source` to the event contract

## What

`agent-framework` emits a `turn_source` event
(`interactive/interactive-session-execution-controller.ts:205` —
`this.callbacks.emit('turn_source', turnOptions.turnSource ?? 'user')`, intent noted as
FLOW-002: "surface the turn origin so consumers (hooks, TUI) can distinguish a human prompt
from an agent-wakeup re-entry"), but the event is **not declared** in the
`IInteractiveSessionEvents` contract (`agent-interface-transport/src/session-contracts.ts:124`,
verified absent). Consequently no consumer can subscribe to it type-safely, and the intended
TUI/hook consumers can't receive it.

Add `turn_source` to `IInteractiveSessionEvents` with its proper payload type (a turn-source
union, e.g. `'user' | 'agent-wakeup' | …` — match the actual `turnSource` type), so the emit
is contract-backed and consumers can listen with type safety. Wire at least the intended
consumer (or confirm/document who listens).

## Why

An emitted-but-uncontracted event is dead on arrival for typed consumers and a silent contract
drift — exactly what the event-contract-continuity harness check (HARNESS-010) exists to
prevent. The FLOW-002 feature is incomplete until the contract carries the event.

## Done When

- `turn_source` is in `IInteractiveSessionEvents` with the correct payload type; the emit
  typechecks against the contract.
- A consumer can subscribe to `turn_source` type-safely (and the intended consumer is wired or
  the absence is documented).
- If the event-contract harness check can detect emit-without-contract, extend it so a future
  uncontracted emit fails.
- `pnpm typecheck` + `pnpm harness:scan` pass.

## Test Plan

- Grep emit vs contract for `turn_source` → both present; a typed `.on('turn_source', …)`
  compiles.
- Confirm no other event is emitted without a contract entry (sweep the emit sites).

## User Execution Test Scenarios

1. A consumer (hook/TUI) subscribes to `turn_source` and receives the origin on each turn,
   distinguishing a human prompt from an agent-wakeup re-entry. Evidence: _to fill._
