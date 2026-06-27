---
title: 'CORE-010: derive the system prompt at request-build time (true single source)'
status: todo
created: 2026-06-27
priority: low
urgency: later
area: packages/agent-core, packages/agent-session
depends_on: []
---

# Derive the system prompt at request-build time

Surfaced by the code review of the system-prompt SSOT change (PR #845). This is a follow-up
architectural improvement, not a bug.

## What

The current SSOT keeps the system prompt physically in three synchronized places —
`config.systemMessage`, the `ConversationStore` head, and `SessionBase.systemMessage` — written by
two paths (`Robota.updateSystemPrompt` + the per-turn `setSystemPrompt` re-seed), with compaction
re-injecting from the session copy. It is "synced copies", not a single physical source.

Risks of the synced-copy model:

- Any update of `config.systemMessage` that bypasses `Robota.updateSystemPrompt` (a future
  `setConfig`/preset reload, or a direct `RobotaConfigManager.setSystemMessage` call) leaves the
  store head stale → the next request ships the old prompt, or the pipeline's content-equality check
  injects a duplicate.
- The per-turn re-seed exists only to keep the head in sync.

## Why

A true single source of truth would store the system prompt **once** (in `config.systemMessage`) and
**derive** the head at request-build time — prepend it when assembling the provider request rather
than persisting it in the conversation store. This eliminates the per-turn re-seed, the dual-write
coupling, compaction's manual re-inject, and the whole drift class.

This is a larger change to the execution pipeline (how the messages array is assembled for the
provider) and intersects with the append-only history model and compaction. It needs a design pass
and explicit confirmation before implementation.

## Proposed approach (design, to confirm)

- Stop storing the system prompt as a head message in `ConversationStore`; assemble it at
  request-build time from `config.systemMessage`.
- Remove the per-turn `setSystemPrompt` re-seed and the `Robota.updateSystemPrompt` store-head write;
  keep only `config.systemMessage` (and `SessionBase.systemMessage` as the session's record for
  display/compaction input).
- Reconcile with compaction (which currently re-injects a system message into history).

## Test Plan

- Re-point the agent-framework functional tests (`preset-application`, etc.) at the new assembly path
  and confirm single, current system message per request.
- agent-core/agent-session/agent-framework suites + `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable to the refactor itself (no intended behavior change). Validated by the existing
`functional-coverage` suite proving live system-prompt updates still reach the real provider request
as a single message.
