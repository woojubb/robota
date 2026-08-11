---
title: 'CORE-031: a compaction with nothing to summarise still clears the conversation and injects an empty summary'
status: todo
created: 2026-08-03
priority: medium
urgency: next
area: packages/agent-session
depends_on: []
---

# CORE-031: the empty-history shortcut returns `''`, and the caller replaces history with it

## Problem

`CompactionOrchestrator.compact()` short-circuits on an empty history and returns the empty string:

```ts
if (history.length === 0) return '';
```

`session-history-ops.compact()` then does what it does for every summary — `clearHistory()`,
re-inject the system message, inject `` `[Context Summary]\n${summary}` `` — producing a conversation
consisting of a system message and a summary block containing nothing.

The CORE-019 validity check (`throw CompactionError` on empty provider content) does not protect
against this, because the shortcut returns before the provider is ever called.

## Evidence

Found by review on PR #1608 (RUNTIME-004 stage 1) while examining a neighbouring abort ordering bug.
The abort half was fixed there; this half is a different defect and was left rather than folded in.

The reachable path, exactly: `session-history-ops.compact()` guards on the FULL history
(`if (history.length === 0) return;`) and then filters system messages out
(`history.filter((msg) => msg.role !== 'system')`) before calling the orchestrator. So a conversation
consisting only of system messages passes the caller's guard with a non-empty history, arrives at the
orchestrator with an EMPTY one, takes the shortcut, and gets replaced.

Not yet measured: whether a system-messages-only history occurs in practice, and what
`ContextWindowTracker.shouldAutoCompact()` reports for one. Both should be established before
choosing between the two directions below — the fix is cheap either way, and picking one without
knowing which case is real is how a guard ends up protecting nothing.

## Why this is foundational (or not)

**LOCAL.** One shortcut in one function, with one caller. It shares a THEME with CORE-019 and
RUNTIME-004 — history is append-only source data and must survive a compaction that produced no
usable summary — but nothing underneath it is wrong.

## Direction

Two candidates; the choice depends on the measurement above.

- **The caller does not replace history with an empty summary.** Most faithful to CORE-019's rule:
  the replacement runs only when a valid summary exists, and `''` is not one.
- **The orchestrator throws instead of returning `''`.** Puts the case on the same path as every
  other invalid summary, at the cost of turning a previously-silent no-op into an error a caller must
  handle.

Preference, weakly: the first — an empty history genuinely has nothing to compact, and that is not an
error, it is a no-op. The bug is that the caller treats a no-op as a summary.

## Test Plan

- **Required red-first regression:** call `session-history-ops.compact()` with a history of system
  messages only, and assert the conversation is unchanged. Against current code it is cleared and an
  empty `[Context Summary]` is injected.
- Red-first: assert the same for a history that is entirely empty, whichever guard fires.
- Assert the ordinary path is unaffected — a real summary still replaces history.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies, conditionally.** If the system-messages-only case is reachable from the product, the
observable is a conversation that empties itself; if measurement shows it is not reachable, this is an
internal invariant and the scenario is the regression test above. Establish reachability first — the
gate is only meaningful once it is known which of the two this is.
