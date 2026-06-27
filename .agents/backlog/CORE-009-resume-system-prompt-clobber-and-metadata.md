---
title: 'CORE-009: define resume semantics for the system prompt (clobber + metadata loss)'
status: todo
created: 2026-06-27
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

Resume is reachable from the CLI/headless API. Scenario (to finalize during implementation):

- Prereq: a persisted session with a known system prompt; the environment then changes AGENTS.md.
- Steps: resume the session and run one turn; inspect the provider_request transcript system content.
- Expected: the documented rule holds (current `config.systemMessage` is delivered, single system
  message), evidence captured from the session transcript.
- Evidence: _to be filled after implementation._
