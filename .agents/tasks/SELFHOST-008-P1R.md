# SELFHOST-008 P1R — memory-port remediation (async + command-wiring + role segregation)

Spec: [`.agents/spec-docs/todo/SELFHOST-008-P1R-memory-port-remediation.md`](../spec-docs/todo/SELFHOST-008-P1R-memory-port-remediation.md)
GATE-WRITE: PASS. GATE-APPROVAL: PASS (proposal-reviewer ENDORSE; owner sign-off "포트 재정비 슬라이스 먼저 (P1.5)").
GATE-IMPLEMENT: PASS. Implementation: DONE (agent-framework 1176, agent-command 237, workspace typecheck clean, harness:scan 55/55). Driven by the owner-requested architecture audit (2 HIGH + MED/LOW).

## Slices (map to Completion Criteria)

- [x] **TC-01 — async port + zero-behavior-change adapter.** `IMemoryStore` + its role sub-interfaces are async
      (every read/recall/write/curate returns `Promise`); `FileSystemMemoryStore` wraps the unchanged sync stores in
      resolved Promises; the P1 round-trip/budget/curate tests pass unchanged after `await`.
- [x] **TC-02 — semantic seam functions.** A fake async `IMemoryStore` backed by a fake `ISemanticMemoryAdapter`
      satisfies every consumer with no `agent-framework` change (ghost-seam closed).
- [x] **TC-03 — `/memory` routes through the injected port.** With an injected fake store, `/memory add|list|approve|
reject` read+write THAT store; with none injected the fs reference adapter is the default (split-brain closed).
- [x] **TC-04 — role segregation.** `IMemoryStore` = `IDurableMemoryReader` + `IMemoryWriter` + `IMemoryRecaller` +
      `IMemoryCurationQueue`; the command path consumes the segregated interfaces (no duplicate
      `ICommandProjectMemoryStore`/`ICommandPendingMemoryStore` contract); a reader-only consumer depends on no
      curate/write methods.
- [x] **TC-05 — recall seam cleaned.** `MemoryRetrievalService.retrieve(query, budget: IMemoryBudget)` (no fabricated
      config); `FileSystemMemoryStore` holds ONE `ProjectMemoryStore` honoring the injected clock (injected `now`
      reaches the recall read path).
- [x] **TC-06 — doc drift reconciled + green.** the `done/` P1 spec names the interactive-options seam (not
      `ICreateSessionOptions`) + narrows the injectability claim; typecheck + agent-framework + agent-command suites +
      `pnpm harness:scan` all green.

## Implementation cautions (from the GATE-APPROVAL ENDORSE — carry into the code)

1. **Thread ONE shared `IMemoryStore` instance** to all three consumers (context-loader, controller, and the new
   command host-context accessor). Today each does `?? createFileSystemMemoryStore(cwd)` independently — harmless for
   the stateless fs default, but for a STATEFUL injected store SSOT requires the SAME reference reaching the command
   path. Add a host-context accessor returning the injected instance, not a re-default.
2. **Unify the curation-queue method naming** — the command side uses `get/list/mark/upsert`; the port uses
   `getPending/listPending/markPending/upsertPending`. `IMemoryCurationQueue` is the single spelling the command
   handlers adopt.

## Increment plan (commit each green)

1. async `types.ts` (port + 4 role interfaces) + async `FileSystemMemoryStore` (wrap sync) + recall-seam cleanup
   (`IMemoryBudget`, single ProjectMemoryStore w/ injected now). Update memory unit tests. Commit.
2. async `AutomaticMemoryController` + `context-loader` `await`. Commit.
3. `/memory` command path through the injected port (host-context accessor + segregated interfaces + `await` handlers).
   Update command tests. Commit.
4. `docs/SPEC.md` async/segregated rows + reconcile the `done/` P1 spec doc-drifts. Commit.

## Test Plan

- **vitest unit** — async port + fs-adapter zero-behavior-change (TC-01); fake async semantic-backed store injectable
  (TC-02); role segregation + reader-only dependency (TC-04); recall budget + injected-clock (TC-05).
- **functional** — `/memory` command routes through an injected fake store; default fs when none (TC-03).
- **regression** — `pnpm --filter @robota-sdk/agent-framework typecheck` + agent-framework + agent-command suites +
  `pnpm harness:scan` green; doc-drift review (TC-06).

## Affected Files

Per the spec Affected Files table: `memory/{types,file-system-memory-store,memory-retrieval-service,automatic-memory-controller}.ts`,
`context/context-loader.ts`, `command-api/memory/memory-command-api.ts` + `command-api/host-context.ts`,
`agent-command/src/memory/memory-command.ts`, `docs/SPEC.md`, the `done/` P1 spec, and the affected `__tests__/`.
