---
title: 'CORE-008: updateSystemPrompt before first run can drop restored conversation history'
status: todo
created: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# updateSystemPrompt before the first run drops restored history

Surfaced by the code review of the system-prompt SSOT change (PR #845).

## What

`Robota.updateSystemPrompt(content)` calls
`this.conversationHistory.getConversationStore(this.conversationId)`, which **lazily creates and
seeds** an empty store with a single head system message. After that, `getMessageCount()` returns 1.

`initializeConversationStore` (execution-service-helpers.ts) only restores the caller-provided
`messages[]` when `session.getMessageCount() === 0 && messages.length > 0`. So if
`updateSystemPrompt` runs **before the first `run()`** on a session constructed with restore history,
the guard is already false and the entire restored conversation is silently dropped — the model sees
only the system prompt.

Repro shape:

1. Construct/resume an agent with restore `messages` delivered at first run.
2. Call `agent.updateSystemPrompt('persona')` (e.g. a preset applied before the first turn).
3. Run → restored history is missing.

## Why

The SSOT fix made `updateSystemPrompt` write the live store head directly. That write must not
defeat first-run restore. The fix should either defer the store-head write until the store exists
with its restored messages, or make restore independent of `getMessageCount()` (seed from `messages`
even when only a system head is present).

## Proposed approach (to confirm during implementation)

- Make first-turn restore robust to a pre-existing system-only store: restore when the store has no
  non-system messages yet, rather than `getMessageCount() === 0`. Re-apply `setSystemPrompt` after
  restore so the head stays single and current.

## Test Plan

- New agent-core unit test: construct a store/agent, call updateSystemPrompt before first run with
  restore messages, assert the restored user/assistant messages survive AND the system head is the
  updated prompt (single system message).
- `pnpm --filter @robota-sdk/agent-core test`, typecheck, `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — internal SDK runtime behavior validated by unit tests (no user-facing command/TUI
surface). The Test Plan unit test is the evidence.
