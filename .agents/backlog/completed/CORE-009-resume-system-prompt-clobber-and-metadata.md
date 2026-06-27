---
title: 'CORE-009: define resume semantics for the system prompt (clobber + metadata loss)'
status: done
created: 2026-06-27
completed: 2026-06-27
priority: medium
urgency: soon
area: packages/agent-core
depends_on: []
---

# Resume semantics for the live system prompt

Surfaced by the code review of the system-prompt SSOT change (PR #845).

## What

On resume, `initializeConversationStore` first re-seeds persisted `messages[]` (including any
`role:'system'` message via `addSystemMessage`, with its persisted metadata), then unconditionally
calls `setSystemPrompt(config.systemMessage)` when `config.systemMessage` is truthy. `setSystemPrompt`
collapses all system messages to one head built from `config.systemMessage` + the current
`{ executionId }` metadata.

Consequences to decide on:

1. **Clobber**: a restored system prompt that differs from the freshly-built `config.systemMessage`
   is replaced. This is arguably correct (the rebuilt prompt reflects current cwd/AGENTS.md/CLAUDE.md
   — a staleness refresh), but it must be an intentional, documented rule.
2. **Guard divergence**: if `config.systemMessage` is empty/undefined, the guard skips
   `setSystemPrompt` and the restored system message survives instead — same input, opposite outcome
   depending on a truthiness check.
3. **Metadata loss**: the replaced head keeps only `{ executionId }`; any persisted provenance
   metadata on the restored system message is dropped.

## Why

The SSOT model says `config.systemMessage` is the single owner and the head reflects it. Resume is
the one place where a previously-persisted system prompt and the freshly-built one can disagree. The
correct, documented semantics need to be settled in the agent-core SPEC and enforced, instead of
falling out of an incidental truthiness guard.

## Proposed approach (to confirm)

- Decide and document in agent-core SPEC: on resume the live `config.systemMessage` is authoritative
  (staleness refresh) — make the behavior uniform regardless of whether `config.systemMessage` is
  empty (i.e. an empty live prompt should still win, or restore should win — pick one and enforce).
- Decide whether system-message metadata should be preserved across a `setSystemPrompt` replace.

## Test Plan

- agent-core unit tests covering: resume with a differing restored system prompt; resume with empty
  `config.systemMessage`; metadata-preservation expectation. SPEC updated to match.
- `pnpm --filter @robota-sdk/agent-core test`, typecheck, `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — the resume rule (live `config.systemMessage` is authoritative; conversation content
preserved) was already the implemented behavior. This item only **documented** that rule in the
agent-core SPEC ("System Prompt (single source of truth)" → Resume semantics) and added a unit
regression test (`execution-service-helpers.test.ts` → CORE-009). No user-facing behavior changed, so
the Test Plan unit test is the evidence. The metadata-preservation question was resolved as
intentional: the system head carries the current turn's `{ executionId }`, since the system prompt is
live instruction state, not persisted provenance.
