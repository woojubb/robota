---
title: 'CORE-010: establish the system prompt once per session, then reuse the log'
status: done
created: 2026-06-27
completed: 2026-06-27
priority: low
urgency: later
area: packages/agent-core, packages/agent-session
depends_on: []
---

# Establish the system prompt once per session, then reuse the log

Surfaced by the code review of the system-prompt SSOT change (PR #845).

## Resolution (chosen approach)

The review framed this as "derive the system prompt at request-build time (never store it)". On
discussion the **opposite, correct model** was chosen: once a system prompt has been sent in a
session it is part of that session's log, so it is **injected once and the log is reused** — not
re-attached or re-derived on every turn/call.

Implemented:

- `initializeConversationStore` injects `config.systemMessage` **only when the session log has no
  system message yet** (session start, or the first turn after resume). Subsequent turns reuse the
  log as-is — no per-turn re-seed.
- Persisted `system` messages are **not** restored; the prompt is established fresh from
  `config.systemMessage` on the first post-resume turn (staleness refresh — composes with CORE-009).
- `ConversationStore.setSystemPrompt` simplified (no per-turn fast path needed); it is called once on
  inject and in place on a live change.
- `Robota.updateSystemPrompt` still updates `config.systemMessage` and the log head together, so
  persona / self-verification / AGENTS.md refresh mutate the head in place (a real, infrequent change).
- agent-core SPEC → _System Prompt (single source of truth)_ updated ("Injected once, then the log is
  reused").

This keeps the system prompt in the session log (so context estimation, persistence, and compaction
are unaffected) while removing the per-turn redundancy the review flagged.

## Why not "derive every call"

Deriving at the provider boundary on every call would re-attach the prompt the session already
recorded, and would have forced changes to context-token estimation (the serialized fallback would
undercount the system prompt), the dual chat/chatStream paths, persistence, and compaction — real
risk for a session log that should simply be reused.

## Test Plan

- agent-core: `initializeConversationStore` inject-once + reuse test; restore-skips-system test.
- agent-framework functional `preset-application` proves a live persona update still reaches the real
  provider request as a single system message under reuse.
- agent-core/agent-session/agent-framework suites + `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — no user-facing behavior change (the live system prompt still reaches the model as a
single message). Validated by the `functional-coverage` suite as Test Plan evidence.
