# SELFHOST-008 P1 — durable memory port `IMemoryStore` + neutral fs reference adapter

Spec: [`.agents/spec-docs/todo/SELFHOST-008-durable-semantic-memory.md`](../spec-docs/todo/SELFHOST-008-durable-semantic-memory.md)
GATE-APPROVAL: PASS (proposal-reviewer ENDORSE iteration 1). GATE-IMPLEMENT: PASS. Implementation: DONE (all TC; agent-framework 1174/1174, harness:scan 55/55).

EPIC slice **P1** only: the memory port + refactor the existing fs store into a reference adapter behind it +
assembly threading (adapter-gated) + curation-policy seam. P2 (persistence/recall hardening), P3 (duck-typed
`ISemanticMemoryAdapter` + fake-adapter swap), P4 (concrete semantic backend; extract `agent-interface-memory`
iff a family) are tracked as later slices, not this task.

## Slices (map to Completion Criteria)

- [x] **TC-01 — cross-session durable round-trip.** A fact written via `IMemoryStore.append` in one session is
      recalled in a fresh store over the same workspace (functional test on the fs reference adapter).
- [x] **TC-02 — budgeted recall.** `IMemoryStore.recall(query, budget)` returns ranked references and never
      exceeds the given `maxTopics`/`maxTopicChars` budget (unit test).
- [x] **TC-03 — assembly threading + adapter-gating.** `ICreateSessionOptions.memoryStore?: IMemoryStore`
      threaded like `sandboxClient`; startup-memory injection (`context-loader`) consumes the port; with NO
      adapter injected the neutral fs reference adapter is the default (memory works unchanged) (unit test on
      the wiring + default gating).
- [x] **TC-04 — curate + sensitive refusal.** The curate path queues/saves candidates per the injected policy
      and refuses sensitive content via the existing safety filter (`containsSensitiveMemoryContent`) (unit test).
- [x] **TC-05 — adapter swap needs no library change.** A fake `IMemoryStore` (and the deferred duck-typed
      `ISemanticMemoryAdapter` type) can be injected with no `agent-framework` edit (fake-adapter unit test) —
      capability-preservation for the deferred semantic backend.
- [x] **TC-06 — NEUTRALITY GUARD.** No memory CONTENT and no app-voice curation prompt/seeded corpus in
      `packages/`: targeted grep/review confirms content lives only under the consumer workspace
      (`<cwd>/.robota/memory/`) and capture-policy content stays in the surface. Manual floor today; a mechanical
      `packages/` memory-neutrality scan is filed as a follow-up (per enforcement-architecture.md).

## Design

- **`packages/agent-framework/src/memory/types.ts` (new)** — neutral port `IMemoryStore` (flat, mirroring
  `ISandboxClient`): durable project ops (`loadStartupMemory`/`list`/`readTopic`/`append`), budgeted
  `recall(query, IMemoryBudget)`, curation queue (`getPending`/`listPending`/`markPending`/`upsertPending`).
  Plus `IMemoryBudget` and the duck-typed, DEFERRED `ISemanticMemoryAdapter` (mirror `IE2BSandboxAdapter`).
- **`file-system-memory-store.ts` (new)** — `FileSystemMemoryStore implements IMemoryStore`, the neutral fs
  reference adapter (mirror `InMemorySandboxClient`), composing the existing `ProjectMemoryStore` +
  `PendingMemoryStore` + `MemoryRetrievalService` (no behavior change). Factory
  `createFileSystemMemoryStore(cwd, now?)`.
- **assembly** — `memoryStore?: IMemoryStore` threaded like `sandboxClient` through the INTERACTIVE session
  options (`IInteractiveSessionStandardOptions` + `IInitOptions`) into `createInteractiveSession`; default =
  `createFileSystemMemoryStore(cwd)` when none injected. (Empirical correction to the spec's Affected Files: the
  startup-memory consumer is `loadContext` on the interactive path — `createSession`/`ICreateSessionOptions` never
  reads memory, so adding `memoryStore` there would be a dangling never-consumed option. Threaded through the real
  consumer instead.)
- **`context-loader.ts`** — `loadContext(cwd, memoryStore?)` startup-memory injection consumes the injected port
  (or the default fs adapter).
- **curation seam** — the auto-capture policy default stays neutral in the library; the surface may override.

## Test Plan

- **Functional** — `file-system-memory-store` cross-session round-trip on a tmp workspace (TC-01).
- **vitest unit** — recall budget respected + ranked (TC-02); assembly threading + default-gating (TC-03);
  curate queue/save + sensitive-content refusal (TC-04); fake `IMemoryStore` swap needs no lib change (TC-05).
- **manual grep/review** — no memory content/policy corpus under `packages/` (TC-06) + follow-up scan filed.

## Affected Files

- `packages/agent-framework/src/memory/types.ts` (new — port + budget + `ISemanticMemoryAdapter`)
- `packages/agent-framework/src/memory/file-system-memory-store.ts` (new — reference adapter)
- `packages/agent-framework/src/memory/__tests__/file-system-memory-store.test.ts` (new)
- `packages/agent-framework/src/interactive/interactive-session-options.ts` (add `memoryStore` to the interactive
  standard options + `IInitOptions`) + `interactive-session-init.ts` (forward it → `loadContext`)
- `packages/agent-framework/src/context/context-loader.ts` (+ `__tests__/context-loader-memory.test.ts`) — consume the port
- `packages/agent-framework/src/index.ts` + `docs/SPEC.md` (export the new port + adapter + types)
- `.agents/backlog/HARNESS-029-memory-neutrality-scan.md` (TC-06 follow-up mechanical floor)
