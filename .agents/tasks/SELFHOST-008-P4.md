# SELFHOST-008 P4 — semantic-memory adapter decorator (task breakdown)

Spec: [`.agents/spec-docs/active/SELFHOST-008-P4-semantic-adapter-decorator.md`](../spec-docs/active/SELFHOST-008-P4-semantic-adapter-decorator.md)
(GATE-APPROVAL ENDORSE + owner "승인"). Single-package change (`agent-framework`), small + self-contained.
Commit per logical slice as it goes green.

## Design (from the approved spec)

- New neutral `SemanticMemoryStore implements IMemoryStore`
  (`packages/agent-framework/src/memory/semantic-memory-store.ts`) composing a **base `IMemoryStore`** + an injected
  `ISemanticMemoryAdapter`:
  - `recall(query, budget)` → **tiered**: `await adapter.query(query, budget)` primary; on adapter error, degrade to
    `base.recall(...)` (declared, `// allow-fallback:`).
  - `append(input)` → `await base.append(input)` (durable, authoritative) then, **only if `!result.deduplicated`**,
    `await adapter.index(input)` guarded (index error → skip; durable write kept; declared, `// allow-fallback:`).
  - all other `IMemoryStore` methods → pure delegation to `base`.
  - `createSemanticMemoryStore(base, adapter)` factory (mirrors `createFileSystemMemoryStore`).
- Injected via the EXISTING `memoryStore` seam (surface composes it); the live consumers (P3 per-turn recall, P2
  capture, `/memory`) reach it transparently — zero new threading.
- Concrete adapter (embedder + vector DB SDK) is surface-owned; `packages/` gains no vector SDK dep / prompt / content.

## Slices (each green + committed)

1. **S1 — decorator + factory.** `SemanticMemoryStore` + `createSemanticMemoryStore`; tiered recall, guarded
   append-then-index (skip on dedup), delegate rest. (agent-framework)
2. **S2 — barrel export.** Export `SemanticMemoryStore` + `createSemanticMemoryStore` from the memory barrel /
   package index (mirror `createFileSystemMemoryStore`); `types.ts` doc note that `ISemanticMemoryAdapter` is now
   consumed + `delete`/`score?` reserved for v2.
3. **S3 — tests.** `semantic-memory-store.test.ts` — TC-01..07.
4. **S4 — docs.** `agent-framework/docs/SPEC.md`: the decorator + surface-owned adapter composition + the two declared
   degradations + the dedup-skip eventual-consistency limitation (upsert-by-id reserved v2).

## Test Plan

- TC-01: adapter present ⇒ `recall` returns the adapter's `query()` result (semantic-primary), not keyword — functional
  (fake adapter returns a hit the keyword ranker would not) + fake base.
- TC-02: `append` does base durable write then `adapter.index(entry)` (base before index, spies); and when base returns
  `deduplicated: true`, `adapter.index()` is NOT called (intentional skip — pre-indexed-gap is a known keyword-floored
  v1 limitation).
- TC-03: adapter-gating by composition — a plain `FileSystemMemoryStore` (no decorator) recalls via keyword + appends
  with no `index()` call (base unchanged).
- TC-04: recall query degradation — `adapter.query()` throws ⇒ `recall()` returns keyword `base.recall()`, no throw.
- TC-05: index write degradation — `adapter.index()` throws ⇒ `append()` still does the base durable write, no throw.
- TC-06: capability-preservation/swap — a fake `ISemanticMemoryAdapter` composed via `createSemanticMemoryStore`
  upgrades recall with no `agent-framework` change, consumed transparently by an `IMemoryStore` consumer.
- TC-07: neutrality — no prompt/content (HARNESS-029 scan) + no vector-DB SDK dep in `agent-framework/package.json`
  (targeted review; dep-allowlist floor = follow-up).
- Regression: `pnpm --filter @robota-sdk/agent-framework test`, `typecheck`, `lint`, `pnpm harness:scan`.
