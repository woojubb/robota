---
title: 'MEM-001: memory recall provenance is dead — the memory_retrieved event is emitted by nothing and usedMemoryReferences is never written (so /memory used is permanently empty), and IAutomaticMemoryConfig.retrieval is a required contract field read only by dead code'
status: skipped
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-command, packages/agent-cli
depends_on: []
completed: 2026-08-29
handoff: https://github.com/woojubb/robota/issues/2055
---

# MEM-001: recall provenance and a duplicate recall-budget contract

## Problem

With memory enabled, every recall injects `<recalled-memory>` content into the turn invisibly: the
declared `memory_retrieved` event never fires, the `usedMemoryReferences` provenance is never written,
and `/memory used` is constitutionally empty. Separately, two recall-budget contracts claim ownership —
the one embedded in `IAutomaticMemoryConfig.retrieval` (a required field) is read only by a controller
method with no production callers, so tuning it changes nothing.

## Evidence (round-2 framework-subsystems audit, 2026-08-13)

- **Provenance dead (F11):** `docs/SPEC.md:1300-1302` — `memory_event` covers "capture/approval/
  **retrieval**"; `:1216` documents the `used` subcommand; contract
  `agent-interface-transport/src/event-contracts.ts:58` declares `'memory_retrieved'`; the formatter
  treats it as user-visible (`memory-event-format.ts:8,21-22`). But no emit site for `memory_retrieved`
  exists outside tests; the recall path discards provenance — `interactive-session.ts:443-447` calls
  `store.recall()` and returns only the rendered string, dropping `result.references`;
  `usedMemoryReferences` is only restored/cleared/persisted, never appended
  (`interactive-session-history-tracker.ts:62,81-108,264-266`), so `/memory used` permanently answers
  "(no memory used in current turn)" (`agent-command/src/memory/memory-command.ts:183`).
- **Duplicate recall-budget contract (F12):** `memory/automatic-memory-types.ts:13-19` — `retrieval:
{ maxTopics, maxTopicChars }` is a REQUIRED field of the surface-supplied config; the CLI fills it
  (`agent-cli/src/startup/memory-enablement.ts:120-123`). Its only reader is
  `AutomaticMemoryController.retrieve()` (`automatic-memory-controller.ts:72-77`), which has zero
  production callers; live per-turn recall budgeting comes from the separate `recallMemory.budget`
  seam (`interactive-session.ts:445`). Masked today only because the CLI sets both from one
  `DEFAULT_MEMORY_BUDGET`.

## Direction

1. On recall, record `result.references` into the history tracker's `usedMemoryReferences` and
   emit/record a `memory_retrieved` event (it already flows through `recordMemoryEvent` → history +
   `memory_event` + persistence), so `/memory used` and the retrieval event work.
2. Collapse the duplicate recall-budget contract: drop `retrieval` from `IAutomaticMemoryConfig`
   (recall is `IPerTurnRecallConfig`'s job) or route `recallTurnMemory` through `controller.retrieve()`
   so the field and its `disabled`-policy gate are live.

## Test Plan

- Red-first: a turn that recalls memory records the references and emits `memory_retrieved`, and
  `/memory used` lists them (fails today — always empty).
- Red-first: tuning the surviving recall-budget contract changes recall behavior; the removed/aliased
  one no longer exists as a dead field.
- `pnpm harness:verify -- --scope packages/agent-framework` green.

## User Execution Test Scenarios

**Applies** (`/memory used` is a user-facing command; memory is a CLI feature).

- Prerequisites: built CLI + provider key; memory enabled; a stored memory the next prompt will recall.
- Steps: send a prompt that recalls the stored memory, then run `/memory used`.
- Expected (after fix): `/memory used` lists the recalled memory reference(s).
- Expected (before fix, contrast): `/memory used` says "(no memory used in current turn)" even though a
  memory was injected into the turn.
- Cleanup: clear the stored memory.
- Evidence (fill in after implementation): the `/memory used` output after a recall.

## Terminal disposition

Skipped as duplicate of canonical open GitHub issue #2055: https://github.com/woojubb/robota/issues/2055.
The issue owns the memory provenance and recall contract work for future conversion to a fresh backlog item.
