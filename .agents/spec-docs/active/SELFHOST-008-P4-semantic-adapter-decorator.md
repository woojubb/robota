---
status: verifying
type: DATA
tags: [memory, semantic-recall, adapter, agent-framework, selfhost-008]
---

# SELFHOST-008 P4: the semantic-memory adapter decorator (tiered recall + index, adapter-gated)

> **Renumbered P3 → P4 (2026-07-18, owner "분할" decision).** The GATE-APPROVAL proposal-reviewer (REVISE)
> found that the memory RECALL path was not wired into the turn lifecycle (`AutomaticMemoryController.retrieve()` had
> zero live callers; startup uses `loadStartupMemory()`, not `recall()`), so a semantic decorator built then would have
> upgraded a **dead** recall path. The owner chose to SPLIT: the per-turn recall→context-injection wiring shipped as
> **P3** (`SELFHOST-008-P3-per-turn-recall.md`, **DONE #1224** — keyword store, per-turn recall now LIVE), and THIS
> decorator slice lands on that now-live recall+index path so semantic recall is genuinely user-observable. The
> reviewer's non-scope corrections are now **FOLDED IN**: (1) the false "startup uses recall" rationale corrected — the
> live consumers are P3 per-turn recall + P2 capture; (2) the overstated HARNESS-029 npm-dep fencing claim corrected —
> neutrality rests on the duck-typed design + review (dep-allowlist floor a noted follow-up); (3) idempotent index —
> the decorator skips `adapter.index()` when base `append` returns `deduplicated: true`. Its earlier GATE-WRITE PASS
> (as P3) is retained in the Evidence Log for reference; it re-runs the pipeline from `draft` as P4.

## Problem

Continues the SELFHOST-008 epic ([spec](../done/SELFHOST-008-durable-semantic-memory.md); P1 port + fs reference
adapter DONE #1218, P1R async-port remediation DONE #1220, P2 live auto-capture DONE #1221, HARNESS-029 neutrality
floor DONE #1223, **P3 per-turn recall wiring DONE #1224**) toward [VISION.md](../../../VISION.md)'s "memory that
**grows with you**". P1 defined a **deferred, duck-typed**
`ISemanticMemoryAdapter { index(entry): Promise<void>; query(text, budget): Promise<{content, references}> }` in
`packages/agent-framework/src/memory/types.ts` — the seam a surface injects to upgrade recall from keyword to embedding
search — but **nothing in the library consumes it** (`grep` for `ISemanticMemoryAdapter` across `packages/` finds only
its type definition + doc references, zero call sites). Concrete symptom: durable-memory RECALL is keyword-only
(`MemoryRetrievalService` token-overlap ranking), so a fact phrased differently from the query (synonyms, paraphrase,
cross-language) is not recalled even when it was durably captured. **P3 made recall a LIVE path**: per-turn recall now
calls `IMemoryStore.recall(input, budget)` (and post-turn capture calls `IMemoryStore.append` — P2), both through the
surface-injected store. P4 supplies the **backend upgrade**: a neutral `SemanticMemoryStore` decorator that composes any
base `IMemoryStore` with an injected `ISemanticMemoryAdapter`, so `recall()` uses embedding search and `append()` also
indexes — transparently upgrading the now-live P2/P3 recall+index paths with **no `agent-framework` change**, and
without the neutral library taking any vector-DB SDK dependency (the HARNESS-029-fenced neutrality invariant). This
realizes the P1 design-only "swap the store" contract (its TC-05) as a consumer-exercised path.

## Prior Art Research

**Topic:** wiring a semantic/embedding-vector memory backend behind a pluggable adapter port (`ISemanticMemoryAdapter`),
so durable-memory RECALL can upgrade from keyword/FTS ranking to embedding nearest-neighbor, without the neutral library
taking a vector-DB SDK dependency.

### References consulted (product documentation)

- **Mem0 — Search Memory** — https://docs.mem0.ai/core-concepts/memory-operations/search — search embeds the query and
  returns top-K semantically similar memories ranked by similarity; results carry a **relevance/confidence score**, and
  OSS `explain=True` surfaces `score_details` (semantic + normalized BM25 + entity boost + combined). Scored,
  hybrid-capable recall.
- **Mem0 — Async Memory** — https://docs.mem0.ai/open-source/features/async-memory — `add` runs fact-extraction +
  embedding as a **background worker**; platform `async_mode=True` returns an event id to track processing. Indexing is
  explicitly decoupled from the write call (eventual consistency).
- **Mastra — Semantic Recall** — https://mastra.ai/docs/memory/semantic-recall — semantic recall is **disabled by
  default**; enabling requires injecting a `vector` store + `embedder` (adapter-gated, absent ⇒ off). Knobs `topK`,
  `messageRange`, `scope`. Directly parallels Robota's "absent option ⇒ default/OFF" gating.
- **Mastra — Memory.recall()** — https://mastra.ai/reference/memory/recall — `recall()` is **async**, returns
  `{ messages }`; recent-history and semantic recall are separate config paths operating independently, not auto-merged;
  the caller sees final text, no scores.
- **Zep / Graphiti — Searching the graph** — https://help.getzep.com/graphiti/working-with-data/searching — default
  retrieval is **hybrid**: semantic (cosine) + keyword (BM25) + graph, combined via **Reciprocal Rank Fusion** (also
  MMR / graph rerankers); no LLM in the retrieval path. Canonical "run both, fuse" design — requires per-source scores.
- **Letta / MemGPT — agent memory** — https://www.letta.com/blog/agent-memory/ — tiered memory (core / recall /
  archival-pgvector); archival exposes **three query modes** — timestamp, text, embedding — retrieved server-side
  without invoking the LLM. Vector recall is an added mode alongside text, not a wholesale replacement.
- **LlamaIndex — vector store / retriever** — https://docs.llamaindex.ai/en/stable/api_reference/retrievers/vector/ —
  `BasePydanticVectorStore` protocol = **add / get / delete** + `VectorStoreQuery → VectorStoreQueryResult`; retriever
  returns `List[NodeWithScore]` (top-K, **per-hit scores**).
- **LangChain — VectorStore** — https://docs.langchain.com/oss/python/integrations/vectorstores — minimal unified
  surface = **`add_documents` + `similarity_search` + `delete` (by id)**; `similarity_search_with_score` is the scored
  variant; metadata filtering / async / multi-tenancy are optional extensions. The abstraction exists to swap backends
  without touching app logic.
- **Weaviate — Hybrid search** — https://docs.weaviate.io/weaviate/search/hybrid — vector + BM25 run **in parallel**,
  fused via RRF or Relative Score Fusion. Vendor confirmation that hybrid = parallel-then-fuse and needs per-source scores.

### Observed common shape

- **(a) Recall strategy.** Hybrid (run both + fuse) dominates at the mature tier (Zep/Graphiti RRF, Weaviate,
  Mem0 combined). Added-mode / caller-selected (not auto-merged) at the simpler tier (Letta one-of-three modes, Mastra
  independent paths). **Pure replace is essentially nobody's default** — even vector-first systems keep keyword/FTS
  reachable; no peer _drops_ keyword recall when vectors are enabled.
- **(b) Index timing.** Async/background embedding is the norm (Mem0 background worker; eventual consistency — a
  just-captured entry may not be immediately queryable). Store-first frameworks (LlamaIndex/LangChain `add_documents`)
  make indexing an await-able call, i.e. async at the boundary.
- **(c) Swappable adapter is universal.** Every framework hides the backend behind a provider interface (Mastra
  `vector`+`embedder`; LlamaIndex `BasePydanticVectorStore`; LangChain `VectorStore`; Mem0 factory over 20+ stores).
  The **minimal converged surface is three verbs: index/add, query/search, delete-by-id**; get/update/namespace are
  optional extensions (commonly metadata filters, not distinct methods).
- **(d) Result shape.** Per-hit scores appear almost everywhere (LlamaIndex `NodeWithScore`, LangChain
  `_with_score`, Mem0 `score_details`, Weaviate fusion). The exception is a caller-facing agent-memory `recall()`
  (Mastra) that returns just `{ messages }` and hides scores — because the framework ranks internally. **Scores are
  load-bearing only when the caller itself fuses/reranks.**

### Recommendation for Robota (adopted below)

- **(a) Recall = TIERED now, hybrid-ready seam; do NOT pure-replace.** No peer drops keyword recall when vectors are
  added. For P3's scope (single injected adapter whose `query()` returns already-ranked `{content, references}`), adopt
  **tiered/added-mode**: when an adapter is injected, semantic `query()` is the primary recall; the keyword fs ranker
  stays the **default** (no adapter) and the **declared** path if the adapter query fails. Full hybrid RRF is the
  mature end-state but needs per-hit scores from both sources — **deferred**; keeping the keyword ranker intact behind
  the same port leaves the RRF seam open without a redesign.
- **(b) Index = awaited, eventually-consistent, degradation-declared.** Post-turn capture (`append`) calls
  `adapter.index()` on the async path. The durable keyword write must NOT be lost, so `append` awaits the base durable
  write FIRST, then awaits `index()` — an `index()` failure is a **declared degradation** (durable write kept, semantic
  index skipped; re-indexable later), never a lost write and never a turn break. A detached fire-and-forget is rejected
  (unhandled rejection + the P2 persist-race lesson). Capture→queryability is treated as eventually consistent.
- **(c) Adapter surface = keep `index` + `query` (correct v1 floor); document `delete` as the known v2 next-verb.**
  Two verbs match the converged minimal shape. Both LangChain and LlamaIndex treat delete-by-id as part of the
  _minimal_ surface (a write-only index leaks on retract/update), so ensure indexed entries carry a stable reference id
  now and reserve `delete(reference)` for a later slice; namespace/scope rides as a field, not a new method.
- **(d) Result shape = `{content, references}` is sufficient; reserve optional `score?`.** The adapter owns ranking
  (like Mastra's scoreless `recall()`), so the caller does not fuse and needs no scores in P3. Add per-hit `score?`
  only when moving to in-library hybrid RRF fusion (the deferred slice).

## Architecture Review

### Affected Scope

- **The async seam already exists at the port (verified against code).** `AutomaticMemoryController.retrieve()` and
  `.capture()` are already `async` and go through the async `IMemoryStore.recall()` / `.append()`
  (`automatic-memory-controller.ts:71,78`); `FileSystemMemoryStore.recall` (`file-system-memory-store.ts:63`) merely
  wraps the synchronous `MemoryRetrievalService.retrieve` in a resolved Promise. The sync/async tension flagged in the
  roadmap is therefore **resolved at the `IMemoryStore` boundary** — the semantic adapter plugs in at the port level,
  NOT into the sync `MemoryRetrievalService`. No async ripple through the sync retrieval service is required.
- **New neutral mechanism — a decorator store.** `SemanticMemoryStore implements IMemoryStore`
  (`packages/agent-framework/src/memory/semantic-memory-store.ts`, new) wraps a **base `IMemoryStore`** + an injected
  `ISemanticMemoryAdapter`:
  - `recall(query, budget)` → **tiered**: `await adapter.query(query, budget)` as primary; on adapter error, degrade to
    `base.recall(...)` (declared, see Fallback Declaration).
  - `append(input)` → `await base.append(input)` (durable, authoritative) **then**, only if the base result's
    `deduplicated` flag is falsy, `await adapter.index(input)` guarded (index failure = declared degradation, durable
    write kept). Skipping `index()` on `deduplicated: true` (or requiring the adapter to upsert by the entry's stable
    reference id) prevents duplicate vectors when a fact is re-captured.
  - every other `IMemoryStore` method (`loadStartupMemory`/`list`/`readTopic`/pending-queue methods) → pure delegation
    to `base`. Semantic search touches only recall + index.
  - factory `createSemanticMemoryStore(base, adapter)` (mirrors `createFileSystemMemoryStore`).
- **Injection seam — ZERO new threading (the elegance).** Because the decorator IS an `IMemoryStore`, the surface
  composes `createSemanticMemoryStore(createFileSystemMemoryStore(cwd), concreteAdapter)` and injects it through the
  **existing** `memoryStore` seam (interactive session options, P1) + `ICommandHostContext.getMemoryStore()` (P1R). The
  live `IMemoryStore` consumers — **P3 per-turn recall** (execution controller → `getMemoryStore().recall`), **P2
  post-turn capture** (`getMemoryStore().append`), the `/memory` command, and startup `loadStartupMemory` (delegated to
  base) — all consume the port, so the decorator is transparent to every consumer — no new option, no new controller
  field. (`recall()`/`append()` are the paths the decorator upgrades; `loadStartupMemory` is pure base delegation.)
- **NOT the library's job:** the concrete `ISemanticMemoryAdapter` (embedder + vector DB SDK), the embedding model
  choice, and any content live in the SURFACE (`agent-cli` / `apps/agent-app`). `packages/` gains only the neutral
  decorator MECHANISM — no vector SDK dep, no prompt, no content (HARNESS-029-fenced).
- **Capability-preservation:** absent an adapter, surfaces keep injecting the plain `FileSystemMemoryStore` — keyword
  recall unchanged (zero behavior change). The P1 "swap the store" contract becomes a real, consumer-exercised path.

### Alternatives Considered

1. **Decorator `SemanticMemoryStore implements IMemoryStore` composing base + adapter; tiered recall
   (semantic-primary, keyword-default/declared-fallback); `append` awaits base durable write then guarded
   `adapter.index()`; injected through the existing `memoryStore` seam (CHOSEN).**
   - ✅ Open/closed: no change to `FileSystemMemoryStore` / `MemoryRetrievalService` (they stay a pure keyword backend);
     transparent to every `IMemoryStore` consumer (controller, startup recall, `/memory`) — no new threading. Mirrors
     the sandbox/retrieval adapter precedent + the P1 port design. Neutral (no vector SDK dep). Adapter-gated by
     composition (absent ⇒ plain fs store = today). Keeps the keyword ranker intact → hybrid-RRF seam stays open.
   - ❌ Two declared degradations (index-error skip, query-error → keyword) add surface area — mitigated by declaring +
     `allow-fallback`-annotating both, and both degrade a best-effort enhancement over an always-present keyword baseline.
2. **Thread a `semanticAdapter?` option into `FileSystemMemoryStore` and branch inside its `recall`/`append`.**
   - ✅ One fewer class.
   - ❌ Bloats the neutral reference adapter with backend-selection logic (violates single-responsibility /
     open-closed); every future backend variant edits the fs store. The decorator keeps each backend a separate,
     composable layer. REJECTED.
3. **Pure-replace recall: when an adapter is present, drop keyword recall entirely.**
   - ✅ Simplest recall path.
   - ❌ No peer does this; loses the keyword baseline (and any recall at all when the adapter errors), and forecloses
     the hybrid-RRF end-state without a redesign. REJECTED (prior art (a)).
4. **Fire-and-forget `adapter.index()` in `append` (detached, not awaited).**
   - ✅ Matches the "async/background embedding" norm; zero added turn latency.
   - ❌ Unhandled promise rejection on index failure; and detaching from the awaited capture path repeats the P2
     persist-race class of bug (best-effort side work escaping the turn's ordering). The awaited-guarded index (option 1)
     gets eventual-consistency semantics without detachment. REJECTED (correctness).
5. **In-library hybrid fusion (run keyword + semantic, merge via RRF) now.**
   - ✅ The mature end-state (Zep/Weaviate).
   - ❌ Requires per-hit scores from BOTH sources (a `score?` on results + a scored keyword ranker) — a larger change
     than P3 warrants, and the adapter's `{content, references}` result is scoreless by design. Deferred; the tiered
     design leaves the seam open. REJECTED for P3 (scope).

### Decision

Adopt (1): a neutral **`SemanticMemoryStore` decorator** that `implements IMemoryStore` by composing a base
`IMemoryStore` (the keyword fs reference adapter) with an injected `ISemanticMemoryAdapter`. **Recall is tiered** —
semantic `query()` primary when an adapter is present, the keyword base as the default (no adapter) and the **declared**
degradation path if `query()` fails. **Index is awaited + guarded** — `append()` awaits the authoritative base durable
write, then awaits `adapter.index()`, and an index failure is a declared degradation (durable write kept, semantic
index skipped) rather than a lost write or a turn break; a detached fire-and-forget is rejected. All non-search methods
delegate to the base. The decorator is injected through the **existing** `memoryStore` / `getMemoryStore()` seam, so it
is transparent to every consumer (adapter-gated by composition — absent ⇒ the plain fs store, zero behavior change).
The concrete adapter (embedder + vector DB SDK) is **surface-owned**; the library ships only the neutral decorator
mechanism (no vector SDK dependency, no prompt/content — HARNESS-029-fenced). The two-verb adapter surface
(`index`/`query`) is kept; `delete(reference)` and per-hit `score?` are reserved for the deferred hybrid slice.

### Validated Recommendation

- **Reachability + ORDERING (verified against code):** `IMemoryStore.recall`/`.append` are async
  (`types.ts`); `AutomaticMemoryController` already awaits them (`automatic-memory-controller.ts:71-101`);
  `FileSystemMemoryStore` wraps sync fs work in resolved Promises (`file-system-memory-store.ts:42-90`). The decorator
  therefore fits the existing async port with no ripple into the sync `MemoryRetrievalService`. The LIVE consumers that
  drive the upgraded paths are **P3 per-turn recall** (execution controller → `getMemoryStore().recall`) and **P2
  capture** (`getMemoryStore().append`); the `/memory` command also consumes the port; startup uses
  `loadStartupMemory` (pure base delegation, adapter untouched). Decorating the injected store therefore reaches every
  recall + index site that exists.
- **Capability preservation:** manual `/memory`, startup memory injection, P2 capture, P3 per-turn recall, and keyword
  ranking are unchanged when no adapter is injected; the decorator is additive composition. The P1 design-only "swap the
  store" contract (its TC-05) becomes a consumer-exercised path here.
- **Adversarial:** (a) a semantic query failure breaking **per-turn recall** (P3) → the decorator degrades to keyword
  `base.recall()` (declared, annotated) so recall is always available (and P3 itself already guards recall errors → skip
  injection, a second safety net); (b) an index failure losing a durable fact → base durable write is awaited FIRST and
  authoritative, index is best-effort after it; (c) a vector SDK leaking into `packages/` → the concrete adapter is
  surface-injected, the decorator is pure mechanism (the neutrality guard is the **duck-typed design + review**, since
  HARNESS-029 detects seeded content/prompts but does NOT scan `package.json` deps — a mechanical dep-allowlist floor is
  a noted follow-up); (d) eventual consistency surprising a caller → documented (a just-captured entry may not be
  immediately semantically queryable; the keyword baseline still returns it); (e) duplicate vectors on re-append → base
  `append` may return `deduplicated: true` (no new durable entry); the decorator MUST skip `adapter.index()` on that
  signal so a re-captured fact does not create a duplicate vector. **Known v1 limitation (documented):** an entry
  durably written BEFORE the adapter was injected (or during a prior `index()` failure) will later return
  `deduplicated: true` on re-capture and thus be permanently skipped from the vector index — a healthy semantic
  `query()` (which falls back to keyword only on ERROR, not on an incomplete result) would silently omit it. This is
  NOT a regression (such entries are keyword-recallable exactly as today) and is bounded by the eventual-consistency
  posture; the robust fix is **`upsert-by-id`** (the reserved v2 `delete`/upsert verb). Recorded in SPEC.md's
  eventual-consistency note; TC-02 asserts the deduped-skip is intentional.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-framework` only — a new neutral `SemanticMemoryStore` decorator in
      `src/memory/` composing the injected `IMemoryStore` + `ISemanticMemoryAdapter`; injected through the EXISTING
      `memoryStore` / `getMemoryStore()` seam (no new threading). NO vector SDK / prompt / content in `packages/`.
      Surface (`agent-cli`/`apps/agent-app`) owns the concrete adapter (embedder + vector DB).
- [x] Sibling scan 완료 — mirrors the sandbox precedent (`E2BSandboxClient`/`IE2BSandboxAdapter`), the retrieval
      precedent (`RepoMapRetrievalAdapter`/injected parser), and the P1 `FileSystemMemoryStore`/`IMemoryStore` design;
      reuses the P1 `memoryStore` injection seam; the two sanctioned degradations are declared + `allow-fallback:`-annotated
      per HARNESS-028.
- [x] 대안 최소 2개 — 5 considered (decorator+tiered+guarded-index CHOSEN; option-thread-into-fs REJECTED SRP;
      pure-replace REJECTED loses baseline; fire-and-forget-index REJECTED unhandled-rejection/race; in-library-hybrid
      REJECTED scope), each Pro+Con.
- [x] 결정 근거 — tiered recall (prior art (a): no peer drops keyword) + awaited-guarded index (prior art (b) eventual
      consistency without detachment; the P2 persist-race lesson) + decorator composition (open/closed; reuses the
      async port) + neutrality (concrete adapter surface-owned; HARNESS-029-fenced). New-surface placement N/A — no new
      package/app/surface; a neutral mechanism within existing `agent-framework`.

## Fallback & Degradation Declaration

**Two sanctioned degradations**, both of a best-effort SEMANTIC enhancement layered over an always-present KEYWORD
baseline — neither is a silent alternative for core behavior, both are declared here and `// allow-fallback: <reason>`-annotated
at the code site per HARNESS-028:

1. **Recall query degradation:** if the injected `adapter.query()` throws/rejects, `SemanticMemoryStore.recall()`
   degrades to the keyword `base.recall()` (the DECLARED default recall path — a genuine equivalent mechanism, not a
   fabricated result). Rationale: `recall()` drives **P3 per-turn recall** (and the `/memory` recall command); a
   semantic-backend outage must not break a turn — keyword recall is always available and correct. (P3 additionally
   guards recall errors at the call site → skip injection, so this is defense-in-depth, not the only net.)
2. **Index write degradation:** in `append()`, the base durable write is awaited FIRST and is authoritative; if the
   subsequent `adapter.index()` throws/rejects, the error is caught and the semantic index is skipped (the entry is
   still durably written and keyword-recallable, and is re-indexable later). Rationale: a semantic-index failure must
   never lose a durable fact or break the user's turn.

No other fallback is introduced. Both degradations are of the ADDED semantic capability; the keyword store remains the
correct, always-present floor.

## Solution

Add a neutral `SemanticMemoryStore` decorator (`packages/agent-framework/src/memory/semantic-memory-store.ts`) that
`implements IMemoryStore` over a base `IMemoryStore` + an injected `ISemanticMemoryAdapter`: `recall()` uses the
adapter's `query()` as primary recall (degrading to the keyword base on error), `append()` awaits the authoritative
base durable write then guarded `adapter.index()`, and all other methods delegate to the base. A
`createSemanticMemoryStore(base, adapter)` factory mirrors `createFileSystemMemoryStore`. The surface composes the
decorator and injects it through the existing `memoryStore` / `getMemoryStore()` seam, so recall + index upgrade
transparently for every `IMemoryStore` consumer with no other library change (adapter-gated by composition — absent ⇒
the plain fs keyword store, zero behavior change). The concrete adapter is surface-owned; the library adds no vector
SDK dependency, prompt, or content.

## Affected Files

| File                                                                                | Change                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-framework/src/memory/semantic-memory-store.ts` (new)                | neutral `SemanticMemoryStore implements IMemoryStore` decorator (tiered recall, guarded-index append, delegate rest) + `createSemanticMemoryStore(base, adapter)` factory                |
| `packages/agent-framework/src/memory/index.ts` (or the memory barrel)               | export `SemanticMemoryStore` + `createSemanticMemoryStore` (public mechanism, mirroring `createFileSystemMemoryStore`)                                                                   |
| `packages/agent-framework/src/memory/types.ts`                                      | (docs only) note `ISemanticMemoryAdapter` is now consumed by `SemanticMemoryStore`; reserve `delete(reference)` + result `score?` as the deferred hybrid next-verbs (comment, no change) |
| `packages/agent-framework/src/memory/__tests__/semantic-memory-store.test.ts` (new) | TC-01..07 — tiered recall, index-on-append, gating, both declared degradations, fake-adapter swap, neutrality                                                                            |
| `packages/agent-framework/docs/SPEC.md`                                             | document the `SemanticMemoryStore` decorator + the surface-owned adapter composition + the two declared degradations                                                                     |

## Completion Criteria

- [x] TC-01: with an injected `ISemanticMemoryAdapter`, `SemanticMemoryStore.recall(q, budget)` returns the adapter's
      `query()` result (semantic-primary), NOT the keyword base result — proven by a fake adapter returning a hit the
      keyword ranker would not (functional test, fake adapter + fake base).
- [x] TC-02: `SemanticMemoryStore.append(entry)` performs the base durable write AND calls `adapter.index(entry)` with
      that entry (unit test, spy fake adapter + spy base — both invoked, base before index); and when the base result is
      `deduplicated: true`, `adapter.index()` is **NOT** called (no duplicate vector).
- [x] TC-03: **adapter-gating by composition** — a plain `FileSystemMemoryStore` (no decorator) recalls via keyword and
      appends without any `index()` call exactly as today (unit test — decorator is opt-in; base unchanged).
- [x] TC-04: **recall query degradation (declared)** — when `adapter.query()` throws, `recall()` returns the keyword
      `base.recall()` result and does NOT throw (unit test, throwing fake adapter).
- [x] TC-05: **index write degradation (declared)** — when `adapter.index()` throws, `append()` still performs the base
      durable write and does NOT throw (unit test, throwing fake adapter; base write asserted present).
- [x] TC-06 (**capability-preservation / swap**): a hand-written fake `ISemanticMemoryAdapter` composed via
      `createSemanticMemoryStore` upgrades recall with **no `agent-framework` change**, and the decorated store is
      consumed transparently by an `IMemoryStore` consumer (e.g. `AutomaticMemoryController.retrieve`) — realizing the
      P1 design-only "swap the store" contract as an exercised path (unit/functional test).
- [x] TC-07 (**NEUTRALITY**): `SemanticMemoryStore` is pure mechanism — no capture/recall prompt or memory CONTENT and
      no vector-DB SDK dependency in `packages/agent-framework`. HARNESS-029 `memory-neutrality` scan green. NOTE:
      HARNESS-029 detects seeded content/prompts but does **not** scan `package.json` dependencies, so the no-SDK-dep
      guarantee rests on the duck-typed design + a targeted `package.json` review (a mechanical dep-allowlist floor is a
      noted follow-up, mirroring the filed HARNESS-027 for agent-tools).

## Test Plan

| TC    | Verification                                                      | Type/Tool                              | Test reference                                                           |
| ----- | ----------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| TC-01 | adapter present ⇒ recall returns semantic `query()` result        | functional (fake adapter + base)       | `semantic-memory-store.test.ts` › "TC-01 — semantic-primary recall"      |
| TC-02 | append: base write then `adapter.index`; skip index on dedup      | vitest unit (spies)                    | same file › "TC-02 — index on append" (+ dedup skip case)                |
| TC-03 | plain fs store (no decorator) unchanged; no `index()` call        | vitest unit                            | same file › "TC-03 — adapter-gating by composition"                      |
| TC-04 | `query()` throws ⇒ recall degrades to keyword base, no throw      | vitest unit                            | same file › "TC-04 — recall query degradation"                           |
| TC-05 | `index()` throws ⇒ base durable write kept, append does not throw | vitest unit                            | same file › "TC-05 — index write degradation"                            |
| TC-06 | fake adapter upgrades recall, consumed transparently, no lib edit | vitest functional                      | same file › "TC-06 — adapter swap needs no library change"               |
| TC-07 | no prompt/content (scan) + no vector SDK dep (design+review)      | HARNESS-029 scan + package.json review | `pnpm harness:scan` (memory-neutrality) + targeted `package.json` review |

## Tasks

[`.agents/tasks/SELFHOST-008-P4.md`](../../tasks/SELFHOST-008-P4.md) — created at GATE-IMPLEMENT; slices S1–S4
(decorator+factory → barrel export → tests → docs) mapped to TC-01..07 + the Test Plan.

## Evidence Log

_GATE entries appended by the pipeline._

### [GATE-WRITE] — ✅ PASS | 2026-07-18

**Status upgrade:** draft → review-ready

- Frontmatter: begins with `---`; `status: draft`; `type: DATA` (valid 11-prefix value); `tags: [memory, semantic-recall, adapter, agent-framework, selfhost-008]` present. PASS.
- Problem: concrete symptom (`grep` for `ISemanticMemoryAdapter` finds only the type def + doc refs, zero call sites; keyword-only RECALL misses paraphrase/synonym/cross-language facts); reproduction condition (a fact phrased differently from the query is not recalled even when durably captured); no TBD/TODO/vague. PASS.
- Prior Art Research: `## Prior Art Research` present and substantiated — cites 8 product-documentation sources (Mem0 search + async, Mastra semantic-recall + recall(), Zep/Graphiti, Letta/MemGPT, LlamaIndex, LangChain, Weaviate); observed common shape (a–d) feeds an evidence-based Recommendation that drives Alternatives/Decision. PASS.
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with completion evidence (mirrors sandbox/retrieval precedents + P1 fs-store/IMemoryStore design, reuses `memoryStore` seam); Alternatives Considered has 5 entries each with Pro+Con (decorator+tiered+guarded-index CHOSEN; option-thread-into-fs, pure-replace, fire-and-forget-index, in-library-hybrid all REJECTED); Decision references the driving trade-offs (open/closed, prior-art (a)/(b), neutrality). New-surface placement N/A — explicitly stated (neutral mechanism within existing `agent-framework`, no new package/app/surface/boundary). PASS.
- Completion Criteria: TC-01..TC-07 all `TC-N`-prefixed; ≥1 per distinct feature; each in observable/command form; no banned vague phrasing ("works correctly"/"no errors"/"implemented"/"displays correctly"). PASS.
- Test Plan: `## Test Plan` present; 7 rows (TC-01..TC-07) — matches the 7 Completion Criteria (count confirmed); each row has non-empty Type/Tool and Test reference; no "manual"-tool rows requiring a Notes justification. PASS.
- Structure: `## Tasks` present with placeholder; `## Evidence Log` present (was empty before this entry); no `## Status`/`## Classification` sections in body. PASS.

### [GATE-WRITE] — ✅ PASS | 2026-07-18

**Status upgrade:** draft → review-ready

_P4 re-gate after the owner "분할" split: this spec passed GATE-WRITE previously as SELFHOST-008 P3 (semantic-adapter-wiring); it was renumbered P4 and returned to `draft/` when the per-turn recall wiring was carved out as P3 (DONE #1224). This is a FRESH GATE-WRITE of the refreshed P4 (recall now LIVE; the proposal-review non-scope corrections folded in). The prior P3-era PASS above is retained for reference._

- Frontmatter: begins with `---`; `status: draft`; `type: DATA` (valid 11-prefix value); `tags: [memory, semantic-recall, adapter, agent-framework, selfhost-008]` present. `check-spec-doc-frontmatter.mjs` exit 0 (only the expected non-blocking SELFHOST-008 duplicate-ID warn). PASS.
- Problem: concrete symptom (`grep` for `ISemanticMemoryAdapter` across `packages/` finds only the type def + doc refs, zero call sites; keyword-only RECALL via token-overlap ranking misses paraphrase/synonym/cross-language facts); reproduction condition (a fact phrased differently from the query is not recalled even when durably captured); refresh correctly re-scopes onto the now-LIVE P2/P3 recall+index path; no TBD/TODO/vague. PASS.
- Prior Art Research: `## Prior Art Research` present and substantiated — 8 product-documentation citations (Mem0 search + async, Mastra semantic-recall + recall(), Zep/Graphiti, Letta/MemGPT, LlamaIndex, LangChain, Weaviate); observed common shape (a–d) feeds an evidence-based Recommendation that drives Alternatives/Decision. `scan-spec-research.mjs` exit 0. PASS.
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan `[x]` with completion evidence (mirrors sandbox `E2BSandboxClient`/`IE2BSandboxAdapter` + retrieval `RepoMapRetrievalAdapter` precedents + P1 fs-store/IMemoryStore design; reuses the `memoryStore`/`getMemoryStore()` seam; degradations `allow-fallback`-annotated per HARNESS-028); Alternatives Considered has 5 entries each with Pro+Con (decorator+tiered+guarded-index CHOSEN; option-thread-into-fs, pure-replace, fire-and-forget-index, in-library-hybrid all REJECTED); Decision references the driving trade-offs (open/closed, prior-art (a)/(b), neutrality). New-surface placement N/A — explicitly stated (neutral mechanism within existing `agent-framework`, no new package/app/surface/boundary). PASS.
- Completion Criteria: TC-01..TC-07 all `TC-N`-prefixed; ≥1 per distinct feature; each in observable/command form (incl. the folded-in dedup-skip in TC-02 and neutrality-scope note in TC-07); no banned vague phrasing. PASS.
- Test Plan: `## Test Plan` present; 7 rows (TC-01..TC-07) — matches the 7 Completion Criteria (count confirmed: 7 = 7); each row has non-empty Type/Tool and Test reference; no "manual"-tool rows requiring a Notes justification. PASS.
- Structure: `## Tasks` present with placeholder; `## Evidence Log` present; no `## Status`/`## Classification` sections in body. (Evidence Log is non-empty by design here — the retained prior P3-era PASS — which is correct for a re-gate, not a first run.) PASS.

### [GATE-APPROVAL] — ENDORSE (proposal-reviewer) | 2026-07-18

Independent `proposal-reviewer` (re-review after the P3/P4 split) verified every load-bearing premise against the
current code and returned **ENDORSE**: (1) recall + index are now GENUINELY LIVE (P3 per-turn recall → `getMemoryStore().recall`
at `interactive-session-execution-controller.ts:291-293`; P2 capture → `.append`), so a `SemanticMemoryStore` injected as
`memoryStore` is exercised — the dead-path defect that split this slice is resolved; (2) decorator transparency + zero
new threading confirmed (all consumers port-typed via the single `getMemoryStore()` SSOT; no concrete-type dependency);
(3) both declared degradations (query-error → keyword base; index-error → skip, durable write kept) are legitimate
HARNESS-028-sanctioned degradations over the keyword baseline, mirroring the P3 call-site guard (defense-in-depth), not
banned fallbacks; (4) idempotent index implementable (`IAppendMemoryResult.deduplicated` exists) — skip-on-dedup is the
right v1 default; (5) neutrality claim now honest (HARNESS-029 does not scan npm deps; guarantee rests on duck-typed
design + review, dep-allowlist floor a follow-up); (6) append ordering / eventual consistency / two-verb surface sound.
Architecture-placement: correct (second `IMemoryStore` impl beside the fs reference adapter; reuse at the CONTRACT
level; mirrors the sandbox/retrieval precedents). One non-blocking refinement folded in: the skip-on-dedup
pre-indexed-gap is now documented as a known keyword-floored v1 limitation with `upsert-by-id` reserved as the v2 fix
(Adversarial (e)). Rule-alignment: SSOT, dep-direction/neutrality, no-pass-through, HARNESS-028 — all aligned. Awaiting
owner sign-off to complete GATE-APPROVAL.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-18

**Status upgrade:** review-ready → approved

- Prior-gate precondition: fresh `[GATE-WRITE] — ✅ PASS | 2026-07-18` entry present (the P4 re-gate); frontmatter `status: review-ready` matches the expected input stage. PASS.
- Explicit owner approval: the owner answered the GATE-APPROVAL question verbatim with **"승인 (추천)"** — a direct, unambiguous confirmation of this P4 design authorizing implementation. PASS.
- Approval directed at THIS spec (SELFHOST-008-P4 semantic-adapter decorator), not a clarifying-question answer and not approval of a different item. PASS.
- No Architecture Review or frontmatter `type`/`tags` modified after approval. PASS.
- Independent design review: `[GATE-APPROVAL] — ENDORSE (proposal-reviewer)` entry present — re-reviewed after the P3/P4 split, all load-bearing premises verified against current code (recall/index now LIVE via P3/P2; decorator transparency + zero new threading; both declared degradations HARNESS-028-legit; idempotent skip-on-dedup implementable via `IAppendMemoryResult.deduplicated`; neutrality claim honest; placement correct). PASS.
- Independent architecture validation (conditional): N/A — no new package/app/surface or layer/product-family reclassification (a second `IMemoryStore` impl inside the existing `agent-framework/src/memory/`, reuse at the contract level). Recorded N/A. PASS.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-18

**Status upgrade:** approved → in-progress

- Prior-gate precondition: `[GATE-APPROVAL] — ✅ PASS | 2026-07-18` entry present in the Evidence Log; frontmatter `status: approved` matches the expected input stage for GATE-IMPLEMENT. PASS.
- Tasks file created: `.agents/tasks/SELFHOST-008-P4.md` exists on disk (3646 bytes, verified via `ls`). PASS.
- Path recorded in spec: the `## Tasks` section links `.agents/tasks/SELFHOST-008-P4.md` and states slices S1–S4 mapped to TC-01..07 + the Test Plan. PASS.
- Tasks map to Completion Criteria: task file's Slices S1 (decorator+factory: tiered recall, guarded append-then-index, skip-on-dedup, delegate rest) → TC-01/TC-02/TC-04/TC-05; S2 (barrel export + types.ts doc note) supports TC-06; S3 (tests) covers TC-01..07; S4 (docs SPEC.md) supports TC-07 — every TC-01..TC-07 covered. PASS.
- Test Plan present in task file: `## Test Plan` section present with per-TC (TC-01..07) verification lines + a regression line (>50 chars). PASS.
- No implementation commits yet for P4 source: recent commits are docs-only (`docs(spec): ...` for GATE-WRITE/proposal-reviewer/GATE-APPROVAL + task breakdown); `packages/agent-framework/src/memory/semantic-memory-store.ts` does NOT exist, and `semantic-memory-store.test.ts` does NOT exist (both verified via `ls`). PASS.

### [GATE-VERIFY] — ✅ PASS | 2026-07-18

**Status upgrade:** in-progress → verifying

- Prior-gate precondition: `[GATE-IMPLEMENT] — ✅ PASS | 2026-07-18` entry present in the Evidence Log; frontmatter `status: in-progress` matches the expected input stage for GATE-VERIFY. PASS.
- Tasks complete / none blocked or pending: `.agents/tasks/SELFHOST-008-P4.md` uses a slice-narrative format (S1–S4 numbered list, no `[x]` checkbox markers — `grep` for checkbox tokens returns none). Completion is therefore verified by confirming each slice's deliverable exists and is green: S1 decorator+factory (`src/memory/semantic-memory-store.ts` exists, 5957 B), S2 barrel export (`src/index.ts:304` exports `SemanticMemoryStore` + `createSemanticMemoryStore`), S3 tests (`src/memory/__tests__/semantic-memory-store.test.ts` exists, 7 tests green), S4 docs (`docs/SPEC.md` documents `SemanticMemoryStore` + `createSemanticMemoryStore` + `ISemanticMemoryAdapter` consumer note). All four slices delivered; no task blocked or pending. PASS (checkbox literal N/A for this file's slice format; substance verified).
- Build passes for affected package: `pnpm --filter @robota-sdk/agent-framework build` — green (`✔ Build complete`, CJS + ESM). PASS.
- Typecheck: `pnpm --filter @robota-sdk/agent-framework typecheck` (`tsc --noEmit`) — green, no errors. PASS.
- Tests pass for affected package: `npx vitest run packages/agent-framework/src/memory/__tests__/semantic-memory-store.test.ts` — 7 tests passed (TC-01..07 + factory/instance checks), 1 file passed. PASS.
- Scans: `pnpm harness:scan` — all 56 scans passed (incl. memory-neutrality, orphan-exports, spec-publish-claims, test-plans, conformance). PASS.
- Lint: `pnpm --filter @robota-sdk/agent-framework lint` — 0 errors (150 pre-existing warnings, unrelated allowed-unused-var style). PASS.
- Completion Criteria state: TC-01..TC-07 all `[x]` in `## Completion Criteria`, each with a Test Plan reference (TC-07 = HARNESS-029 memory-neutrality scan + package.json review). PASS.
