---
title: 'CORE-031: a compaction with nothing to summarise still clears the conversation and injects an empty summary'
status: done
created: 2026-08-03
completed: 2026-08-17
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

### The measurement this item asked for, taken

Two questions were open: whether a system-messages-only history occurs in practice, and what
`ContextWindowTracker.shouldAutoCompact()` reports for one.

**Auto-compaction is not the route.** `AUTO_COMPACT_THRESHOLD` is `0.835`
(`packages/agent-session/src/context-window-tracker.ts`) and the default window is `200_000`
(`packages/agent-core/src/context/models.ts`), so a system-only history would have to be ~167k tokens
before `shouldAutoCompact()` returns true. The whole system prompt measured 4,984 characters in the
run below. Not reachable.

**The CLI is not the route either, and that is worth recording** — it was the expected one. The
built CLI was driven headlessly on a fresh project directory with an isolated `HOME`, a provider
configured against a fake key, and `/compact` as the first and only input:

```
$ robota -p "/compact"
Context compacted.
  Removed messages: 0 (0% of total)
  Context: 0% → 0%
```

The persisted session record shows why nothing was clobbered: `messages: []`, `history: []`,
`systemPrompt` 4,984 chars. The CLI keeps the system prompt in a field of its own and never puts it
in `robota.getHistory()`, so a fresh session takes the caller's `history.length === 0` guard, not the
defect. The only in-repo code that injects a `role: 'system'` message into history is
`session-history-ops.compact()` itself (`packages/agent-session/src/session-history-ops.ts`), and it
always injects an assistant summary immediately after — so a post-compaction history is
`[system, assistant]`, never system-only.

**The route is the public SDK surface, and the one product path that replays it.** `Session`
publishes `injectMessage(role, content)` (`packages/agent-session/src/session-base.ts`), documented
as the session-restore path, and `--resume` / `--fork` re-inject a saved `messages` array verbatim
through it (`packages/agent-framework/src/interactive/interactive-session-restore.ts`). Inject a
system message, call `compact()`, and the conversation is replaced with an empty summary. That is the
scenario below, and it is what red-proved the fix.

So the answer to "which case is real" is: **an SDK/restore case, not an auto-compaction case** — and
the guard is placed accordingly, on the messages actually being compacted rather than on the
threshold.

## Why this is foundational (or not)

**LOCAL.** One shortcut in one function, with one caller. It shares a THEME with CORE-019 and
RUNTIME-004 — history is append-only source data and must survive a compaction that produced no
usable summary — but nothing underneath it is wrong.

## Direction

Two candidates were posed as alternatives; the measurement shows they are two halves of one fix, and
both landed.

- **The caller does not replace history with an empty summary.** `session-history-ops.compact()` now
  guards on `nonSystemHistory` — the array it will actually compact — instead of on the full history.
  The defect was never the shortcut; it was that the guard tested a DIFFERENT array from the one that
  got compacted. Nothing to summarise is a no-op, not an error, so the conversation is left exactly
  as found: no hook fires, no `context_compact` event is written, the provider is not called.
- **The orchestrator throws instead of returning `''`.** Kept as well, because `''` contradicted the
  contract two lines above it in its own docblock ("always a non-empty string") and was the value the
  caller wrote over the conversation. With the caller's guard corrected, an empty history arriving at
  the orchestrator means the caller's judgement was wrong — a broken invariant, which belongs on the
  `CompactionError` path CORE-019 already built, not on a silent shortcut. It has exactly one call
  site in the workspace, so this costs no caller a migration.

## Test Plan

`packages/agent-session/src/__tests__/compaction-nothing-to-summarise.test.ts` — six assertions,
red-first. Run against the unfixed code it fails 3 of the original 5, and fails on exactly the
defect:

```
FAIL  ... > leaves a system-messages-only conversation untouched
      expected mockClearCount to be 0, received 1
FAIL  ... > the orchestrator treats an empty history as a broken invariant, never a summary
      AssertionError: promise resolved "''" instead of rejecting
Test Files  1 failed (1) | Tests  3 failed | 2 passed (5)
```

After the fix: `42 test files, 223 tests passed` across the whole `agent-session` package — the two
neighbouring compaction suites (`compaction-failure-preservation`, `compaction-honours-abort`) stay
green, which is what pins that the new `CompactionError` did not disturb CORE-019's or RUNTIME-004's
contracts.

The ordinary path is asserted in the same file, not assumed: a conversation with something to
summarise is still cleared, still gets its system message re-injected, and still receives the real
summary.

The sixth assertion came out of reviewing this change's own diff. The early return happens BEFORE the
orchestrator, which is where RUNTIME-004's first `throwIfAborted()` lives — so a cancelled compaction
of a system-only conversation would have started resolving quietly instead of rejecting. That is a
silent narrowing of an existing promise, not a new one, so `session-history-ops.compact()` now checks
the signal itself before the guard. Red-proved by removing that one line: the assertion fails and the
other five still pass, which is what pins it to the abort contract rather than to the no-op.

## User Execution Test Scenarios

**Applies.** The measurement above settled which of the two it is: reachable, through the public SDK
surface `Session.injectMessage` — which is also what `--resume` / `--fork` drive on every restore.
`agent-executable`, and provider-free: in the no-op case the provider is never called, so no API key
and no network are needed. (Probed: no `ANTHROPIC_*` / `OPENAI_*` / `GEMINI_*` in the environment, no
`.env`, no `~/.robota` — only `.env.example`. The scenario was designed not to need them.)

### Scenario — a compaction with nothing to summarise leaves the conversation alone

**Command:** `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-031.ts`

Injects a system message into a fresh `Session` (what a restore does), calls `compact()`, and prints
the conversation before and after. Then does the same for a conversation that DOES have something to
summarise, so the fix cannot pass by disabling compaction. The stub provider counts its calls.

**Evidence:** EXIT:0

```
case 1 — system-messages-only conversation
  before: system:"project context: cwd, AGENTS.md, CLAUDE."
  after : system:"project context: cwd, AGENTS.md, CLAUDE."
  provider calls: 0
case 2 — a conversation that HAS something to summarise
  after : system:"project context: cwd, AGENTS.md, CLAUDE." | assistant:"[Context Summary]\na real summary of a re"
  provider calls: 1
PASS the conversation is returned exactly as it was found
PASS no empty [Context Summary] block was injected
PASS the provider was never called — there was nothing to summarise
PASS a real conversation is still compacted
PASS and the summary replaces it as before
PASS the system message survives the replacement
CORE-031 SCENARIO PASS
```

**Red-proof.** The same scenario was run with the two source edits stashed, to prove it is not
accidentally green. It fails, and prints the defect verbatim — the empty summary block appended to a
conversation that had nothing to summarise:

```
  after : system:"project context: cwd, AGENTS.md, CLAUDE." | assistant:"[Context Summary]\n"
FAIL the conversation is returned exactly as it was found
FAIL no empty [Context Summary] block was injected
CORE-031 SCENARIO FAIL (2)
```
