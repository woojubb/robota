---
title: 'MEM-2055: make memory retrieval provenance a live end-to-end contract'
issue: https://github.com/woojubb/robota/issues/2055
status: done
created: 2026-09-07
completed: 2026-09-07
priority: medium
urgency: soon
area: packages/agent-framework, packages/agent-cli
depends_on: []
---

# MEM-2055: make memory retrieval provenance a live end-to-end contract

Spec: `.agents/spec-docs/done/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md`

## Objective

With memory enabled, every recall injects `<recalled-memory>` content into the turn invisibly: the
declared `memory_retrieved` event never fires, `usedMemoryReferences` provenance is never written, and
`/memory used` is constitutionally empty. Separately, two recall-budget contracts claim ownership — the
one embedded in `IAutomaticMemoryConfig.retrieval` (a required field) is read only by a controller
method (`AutomaticMemoryController.retrieve()`) with no production callers, so tuning it changes
nothing; live per-turn recall budgeting comes from the separate `recallMemory.budget` seam.

Continues the work originally recorded as `MEM-001` (`.agents/tasks/completed/MEM-001-memory-recall-provenance-is-dead-and-duplicate-recall-budget-contract-is-inert.md`,
skipped 2026-08-29 as a duplicate of this same GitHub issue #2055). That record stays untouched as the
historical audit finding; this Task is the fresh, issue-backed record that actually carries the fix.

## Evidence (round-2 framework-subsystems audit, 2026-08-13; re-confirmed 2026-09-07)

- **Provenance dead (F11):** `docs/SPEC.md:1300-1302` — `memory_event` covers "capture/approval/
  **retrieval**"; `:1216` documents the `used` subcommand; contract
  `agent-interface-session/src/session-contracts.ts` declares the `memory_event` callback and
  `IMemoryEvent['memory_retrieved']`; the formatter treats it as user-visible
  (`memory-event-format.ts:8,21-22`). But no emit site for `memory_retrieved` existed outside tests;
  the recall path discarded provenance — `interactive-session.ts` `recallTurnMemory` called
  `store.recall()` and returned only the rendered string, dropping `result.references`;
  `usedMemoryReferences` was only restored/cleared/persisted, never appended
  (`interactive-session-history-tracker.ts`), so `/memory used` permanently answered "(no memory used
  in current turn)" (`agent-command/src/memory/memory-command.ts:183`).
- **Duplicate recall-budget contract (F12):** `memory/automatic-memory-types.ts` — `retrieval:
{ maxTopics, maxTopicChars }` was a REQUIRED field of the surface-supplied config; the CLI filled it
  (`agent-cli/src/startup/memory-enablement.ts`). Its only reader was
  `AutomaticMemoryController.retrieve()`, which had zero production callers; live per-turn recall
  budgeting comes from the separate `recallMemory.budget` seam (`interactive-session.ts`). Masked only
  because the CLI set both from one `DEFAULT_MEMORY_BUDGET`.

## Plan

- [x] F11: `InteractiveSessionHistoryTracker.recordUsedMemoryReferences()` appends a turn's used
      `IMemoryReference[]` (mirrors the existing `recordMemoryEvent` SSOT-recording pattern).
- [x] F11: `InteractiveSession.recallTurnMemory()` records the used references and emits one
      `memory_retrieved` `memory_event` per reference (topic/path/score/truncated) after a non-empty
      recall.
- [x] F11: fix a reset-ordering hazard — `resetUsedMemoryReferences()` moved from inside
      `executePromptTurn` (which runs AFTER recall) to the execution controller, immediately BEFORE
      the recall call, so a just-written reference survives to persist.
- [x] F12: delete the dead `AutomaticMemoryController.retrieve()` method and drop the `retrieval` field
      from `IAutomaticMemoryConfig` (recall's budget contract stays solely `IPerTurnRecallConfig`,
      chosen over routing recall through `controller.retrieve()` to avoid introducing a new
      capture-policy-gates-recall behavior nothing in the Problem asked for).
- [x] Update `agent-cli`'s `buildMemorySessionOptions` and every affected test (agent-framework +
      agent-cli) for the simplified `IAutomaticMemoryConfig` shape.
- [x] Add regression coverage: a recall populates `usedMemoryReferences` and emits matching
      `memory_retrieved` events; the used-references set resets each turn; an empty recall records and
      emits nothing.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Applies** (`/memory used` is a user-facing command; memory is a CLI feature).

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

- Surface: `public-sdk-example` — a scripted `InteractiveSession` run through its public constructor,
  a fake `IMemoryStore`, and `createScriptedProvider` (from `@robota-sdk/agent-core/testing`), so the
  scenario needs no live provider credential.
- Command: `pnpm exec tsx examples/verify-memory-recall-provenance.ts` (run inside
  `packages/agent-framework`).
- Prerequisites: none — the script builds its own temporary project directory and cleans it up.
- Expected: the printed result's `usedMemoryReferences` contains the recalled reference and
  `emittedMemoryEventTypes` contains one `memory_retrieved` entry — the same `getUsedMemoryReferences()`
  and `memory_event` path `/memory used` reads.
- Cleanup: the script removes its own temporary directory before exiting (`cleanupRemoved: true`).
- Evidence: ran the command above — printed `{"scenario":"MEM-2055","usedMemoryReferences":[{"topic":
"deploy","path":"deploy.md","score":5,"truncated":false}],"emittedMemoryEventTypes":
["memory_retrieved"],"cleanupRemoved":true}`.
