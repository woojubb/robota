# SELFHOST-003 — codebase retrieval: contract + tool + reference adapter (EPIC, v1)

Spec: [`.agents/spec-docs/done/SELFHOST-003-codebase-index-rag.md`](../../spec-docs/done/SELFHOST-003-codebase-index-rag.md)
GATE-APPROVAL: PASSED (iteration 4 ENDORSE). GATE-IMPLEMENT: v1 P1+P2+P3. GATE-VERIFY + GATE-COMPLETE: PASSED — spec in `spec-docs/done/`, this task archived. P4 (vector backend) DEFERRED to a backlog.

## Recommendation (gate)

Mirror the **sandbox port precedent** in `packages/agent-tools/src/sandbox/`: the retrieval **port + types** live in
`agent-tools/src/retrieval/types.ts` (like `ISandboxClient`/`ISandboxToolOptions`), the neutral **repo-map
graph-centrality ranking adapter** lives in `agent-tools/src/retrieval/` (like `InMemorySandboxClient`) with the
**source parser injected as a duck-typed port** (like `IE2BSandboxAdapter`) and the **corpus supplied from the
surface** (no repo paths in `agent-tools`). `createRetrievalTool({ adapter })` mirrors `create*Tool(options)` and
**joins the default set adapter-gated** (absent when no adapter) via `createDefaultTools(options)` — threaded like
`sandboxClient`. v1 commits to ONE backend (repo-map graph ranking); the embedding-vector backend is deferred to P4.

## P1 — contract + tool + repo-map reference adapter (this slice)

- [x] `agent-tools/src/retrieval/types.ts`: retrieval adapter port (`IRetrievalAdapter`) + request/ranked-result/
      token-budget types + the duck-typed `IRetrievalSourceParser` port. Exported from the barrel.
- [x] `agent-tools/src/retrieval/`: neutral repo-map graph-centrality ranking adapter (mirror `InMemorySandboxClient`)
      — token-budget-aware, source parser injected, corpus supplied at construction (no repo paths in the package).
- [x] `createRetrievalTool({ adapter })` (mirror `create*Tool`); assembly threads `retrievalAdapter?` through
      `ICreateDefaultToolsOptions`/`createDefaultTools` adapter-gated (absent/no-op with no adapter).
- [x] Tests: TC-01 (budget respected + ranked), TC-02 (repo-map fixture ranking for an active-file set), TC-03
      (assembly threading + adapter-gating), TC-04 (no corpus/domain content in agent-tools — grep), TC-05 (adapter
      swap — fake-adapter unit).
- [x] Verify: build + typecheck + tests + lint + `pnpm harness:scan`.
- [x] ENDORSE non-blocking follow-up filed: [`.agents/backlog/HARNESS-027-agent-tools-neutrality-floor.md`](../backlog/HARNESS-027-agent-tools-neutrality-floor.md) (mechanical agent-tools neutrality/dep-allowlist floor — TC-04 no longer rests on the manual grep alone).

## P2 — index build + persistence ✅ IMPLEMENTED

- [x] `agent-tools/src/retrieval/repo-map-index.ts`: `buildRepoMapIndex({ parser, corpus })` parses the corpus once
      into a versioned, serializable `IRepoMapIndex`; `serializeRepoMapIndex`/`deserializeRepoMapIndex` round-trip it
      as neutral JSON for surface persistence (deserialize throws on an unsupported `version`). `IRepoMapIndex`/
      `IRepoMapIndexEntry` types + `REPO_MAP_INDEX_VERSION`. Exported; SPEC + spec-public-surface baseline updated.
- [x] `RepoMapRetrievalAdapter` refactored to build the index ONCE at construction (or accept a prebuilt/persisted
      `{ index }`) and rank over it — no longer re-parsing on every `retrieve()`. Back-compat: `{ parser, corpus }`
      still works.
- [x] Tests (`repo-map-index.test.ts`): parse-once index build, serialize↔deserialize round-trip, unsupported-version
      throw, corpus-vs-persisted ranking parity, parse-once-not-per-retrieve, construction-arg validation. 12/12.
- [x] Verify: build + typecheck + tests + lint (0 errors) + `pnpm harness:scan` (54/54).

## P3 — incremental re-index on file change ✅ IMPLEMENTED

- [x] `updateRepoMapIndex(index, changes, parser)` (`repo-map-index.ts`) + `IRepoMapIndexChanges` type: re-parse
      ONLY the `upserted` files and drop `removed` paths, reusing every unchanged entry — no full-corpus re-parse on
      a file change. Returns a new index (input not mutated); a path in both `removed`+`upserted` is upserted.
      Exported; SPEC + spec-public-surface baseline updated.
- [x] Tests (`repo-map-index.test.ts`): re-parses only changed files (call-count) + matches a full rebuild; drops
      removed + adds new; input not mutated; upsert-wins. 17/17 retrieval tests.
- [x] Verify: build + typecheck + tests + lint (0 errors) + `pnpm harness:scan` (54/54).

## P4 — embedding-vector backend (may revise the port) — DEFERRED

Consciously deferred per the spec (the vector backend is not interchangeable behind the repo-map signature and
**may revise the port**). Filed as a follow-on backlog:
[`.agents/backlog/SELFHOST-003-P4-embedding-vector-backend.md`](../backlog/SELFHOST-003-P4-embedding-vector-backend.md).
v1 (P1–P3) satisfies the epic's Completion Criteria TC-01..05, so GATE-VERIFY/GATE-COMPLETE run on v1 with P4 tracked separately.

## Test Plan

Maps the spec's Completion Criteria to the planned verification:

- **TC-01** (budget respected + ranked) → vitest unit over `IRetrievalAdapter` / the repo-map adapter.
- **TC-02** (repo-map fixture ranking) → functional test over a small in-repo fixture corpus + a fake parser.
- **TC-03** (adapter threaded via assembly + adapter-gating) → vitest unit on `createDefaultTools` (tool present iff adapter).
- **TC-04** (no corpus in agent-tools) → grep/review (mechanical floor tracked as HARNESS-027).
- **TC-05** (adapter swap needs no agent-tools change) → fake-adapter unit test.
