---
title: 'ARCH-016: the "canonical" session-log event vocabulary omits seven real events, and one manual /compact reports two different triggers to its own hooks'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-session, packages/agent-core, packages/agent-framework
depends_on: []
---

# ARCH-016: session-log vocabulary + compaction trigger coherence

## Problem

Two same-subsystem contradictions in agent-session's event story:

1. `SESSION_LOG_EVENT` claims to be the canonical, type-safe schema "the writer, the replay
   validator, and the session-log replay provider share" — but at least seven event names the system
   actually writes and reads are outside it, three of them documented in the package's own SPEC.
2. A single bare `/compact` invocation reports `trigger: 'auto'` to the PreCompact hook and
   `trigger: 'manual'` to PostCompact and every session-level event — two derivations of one fact
   that disagree.

## Evidence

Vocabulary (CONTRACT↔CONTRACT):

- `packages/agent-session/src/session-log-events.ts:1-49` — "Canonical session-log event names …
  one type-safe schema."
- Outside the enum, written/read in production: `provider_stream_raw_delta`
  (`agent-core/src/services/execution-round-streaming.ts:28`), `tool_batch_started` and
  `tool_message_committed` (`execution-round-tools.ts:113,182`), `session_shutdown_step_error`
  (`agent-session/src/session.ts:233`), and `background_task_event` / `background_job_group_event` /
  `memory_event`, which the package's own reader matches as raw strings
  (`session-log-replay.ts:100-114`). Three are documented as part of the log format in
  `packages/agent-session/docs/SPEC.md:263-269`. Consumers of `TSessionLogEventName` /
  `isSessionLogEvent` cannot narrow real log lines.

Compaction trigger (CONTRACT↔IMPLEMENTATION):

- `packages/agent-session/docs/SPEC.md:174` — manual `compact()` reports `trigger: "manual"`;
  `src/session.ts:275-287` defaults `'manual'` and PostCompact/`context_compact`/`onCompactEvent`
  use it (`session-history-ops.ts:109-130`).
- `src/compaction-orchestrator.ts:108` — the orchestrator re-derives the PreCompact trigger as
  `instructions !== undefined ? 'manual' : 'auto'`; the session-level trigger is never passed down
  (`compact()` signature :94-99). A bare `/compact` passes `instructions: undefined`
  (`agent-command/src/compact/compact-command.ts:7-8` → framework `interactive-session-base.ts:151`),
  so PreCompact says `auto` while PostCompact says `manual` for the same operation.

## Direction

1. Complete `SESSION_LOG_EVENT` with the missing names — or explicitly scope the enum's claim to the
   replay substrate and introduce a second named group (used by `session-log-replay.ts`) so no
   production writer/reader uses a string the vocabulary does not know. A test should enumerate all
   `logger.log(`-style call sites' event names and assert membership.
2. Thread the session-level `TCompactTrigger` into `CompactionOrchestrator.compact()` and delete the
   instructions-based inference.

## Test Plan

- Red-first: a scan/test collecting every literal event name passed to the session logger across
  agent-core/agent-session/agent-framework fails today for the seven names; green after.
- Red-first: bare manual `compact()` → PreCompact and PostCompact hook inputs carry the same
  `trigger: 'manual'`; auto-compaction path still reports `'auto'` on both.
- `pnpm harness:verify -- --scope packages/agent-session` green.

## User Execution Test Scenarios

**Applies** (hooks are user-configurable behavior).

- Prerequisites: built CLI; a project with a PreCompact and PostCompact `command` hook that echoes
  the received `trigger` to a file (hook config exists as a product surface; the fixture hook will be
  authored by this work).
- Steps: start the TUI, produce a short conversation, run `/compact` with no arguments, inspect the
  two hook outputs.
- Expected (after fix): both hooks record `trigger: manual`.
- Expected (before fix, contrast): PreCompact records `auto`, PostCompact records `manual`.
- Cleanup: remove the fixture hooks.
- Evidence (fill in after implementation): the two hook output files.
