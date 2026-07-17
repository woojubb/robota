---
status: draft
type: DATA
tags: [rag, codebase-index, retrieval, agent-tools, selfhost]
---

# SELFHOST-003 (EPIC): codebase retrieval — contract + tool + reference adapter (v1)

## Problem

Promotes backlog [SELFHOST-003](../../backlog/SELFHOST-003-codebase-index-rag.md) toward
[VISION.md](../../../VISION.md). Concrete symptom: when Robota develops Robota, the agent has no way to retrieve
the **most relevant slice of the Robota codebase within a token budget** for a given task — it can only `grep`/read
by hand. Every competitive coding agent ships codebase-aware retrieval; Robota has none.

## Prior Art Research

From product documentation: Cursor local codebase index for semantic retrieval (https://cursor.com/docs); aider
**repo map** — a token-budgeted, graph-ranked map of the most relevant symbols/files, needing no embedding
infrastructure (https://aider.chat/docs/repomap.html); GitHub Copilot code-search retrieval
(https://docs.github.com/en/copilot/). **Two backend shapes exist and they are NOT interchangeable behind one
signature:** an embedding vector store answers `query(nl_text) → top-k chunks`; aider's repo-map takes the _active
files / mentioned identifiers_ (no NL query) and ranks symbols by graph centrality within a budget. Per
spec-workflow.md "Validated Recommendation Before Approval" (capability preservation), a single port cannot be
claimed to hide both without demonstration — so **v1 commits to ONE backend** (repo-map graph ranking: no embedding
infra, fits self-hosting a code repo) and designs the port to it, deferring the vector backend consciously.

## Architecture Review

### Affected Scope

- **`agent-tools`**: the retrieval **adapter port + request/response/ranked-result/token-budget types** live HERE
  (`src/retrieval/types.ts`), **mirroring the sandbox precedent** (`ISandboxClient`/`ISandboxToolOptions` in
  `agent-tools/src/sandbox/types.ts`) — NOT a new interface package. `createRetrievalTool({ adapter })` mirrors
  `create*Tool(options)`. **The neutral repo-map ranking adapter also lives HERE** (`src/retrieval/`), mirroring
  `InMemorySandboxClient` in `agent-tools/src/sandbox/in-memory-sandbox-client.ts`: graph-centrality ranking within a
  token budget is a NEUTRAL mechanism that works on any repo given a corpus, so it stays in the shared core. Only the
  heavy/domain pieces are injected — the **source parser** as a duck-typed port (exactly as `E2BSandboxClient`
  duck-types the E2B SDK via `IE2BSandboxAdapter`, so no heavy parser SDK becomes an `agent-tools` dependency) and the
  **corpus** (repo paths) supplied from the surface.
- **assembly threading**: the retrieval adapter is threaded through the assembly layer exactly as `sandboxClient` is
  (`createDefaultTools` / `ICreateSessionOptions`), with the **product (`agent-cli`/`apps/agent-app`) supplying the
  concrete source-parser port + corpus** (the neutral ranking adapter itself comes from `agent-tools`).
  `createRetrievalTool` **joins the default tool set adapter-gated**, mirroring how the sandbox-aware
  Read/Edit/Write/Shell tools receive the adapter through `createDefaultTools(options)`: with no retrieval adapter the
  tool is absent/no-op (there is no host fallback for retrieval), so sibling surfaces reuse the shared core without a
  library-side corpus choice.
- Corpus (which repo/paths) + concrete source parser wired in `agent-cli`/`apps/agent-app`.
- **Extraction trigger:** extract the port/types to a new `agent-interface-retrieval` package at **P4 iff** the
  vector backend makes retrieval adapters a third-party-installable family (like `agent-provider-*`) — not before
  (avoids premature publish-registry/project-structure/SPEC ceremony for a non-family).

### Alternatives Considered

1. **Retrieval port+types folded into agent-tools (mirror the sandbox port); tool in agent-tools; neutral repo-map
   ranking adapter in `agent-tools/src/retrieval/` (mirror `InMemorySandboxClient`) with the source parser injected as
   a duck-typed port and corpus from the surface; v1 = one backend (CHOSEN).**
   - ✅ Correct interface-package placement (not conditional); neutral (corpus in surface); no heavy dep in libs;
     the neutral ranking mechanism stays in the shared core so sibling surfaces (`apps/agent-app`, DAG tooling) reuse
     it instead of depending on the `agent-cli` product; port designed to a concrete backend (capability-preservation
     satisfied).
   - ❌ The vector backend is deferred; the port may need revision when it lands (stated, not hidden).
2. **One `query(text)` port hiding both vector store and repo-map.**
   - ✅ Looks maximally flexible.
   - ❌ Unvalidated LCD contract that fits neither (repo-map has no NL query); violates capability-preservation.
     REJECTED.
3. **Bake a vector store into a library.**
   - ✅ Single impl.
   - ❌ Heavy dep + domain choice in `packages/`; violates neutrality + Family Decomposition. REJECTED.

### Decision

Adopt (1): the retrieval port+types live IN `agent-tools` (mirroring `ISandboxClient` in `sandbox/types.ts`) — NOT a new interface package; a neutral
`createRetrievalTool({ adapter })` in `agent-tools`, joining the default tool set adapter-gated; the neutral repo-map graph-rank ranking adapter ALSO lives in `agent-tools/src/retrieval/` (mirroring `InMemorySandboxClient`), with the source parser injected as a duck-typed port and the corpus supplied from the surface; the adapter is threaded through the assembly layer like `sandboxClient` (product supplies the source parser + corpus). The embedding-vector backend is a consciously deferred follow-up
(the port may be revised when it lands). Epic slices below.

### Validated Recommendation

- **Reachability:** the neutral ranking adapter ships from `agent-tools`; the surface (agent-cli/apps/agent-app)
  supplies the source parser + corpus and the tool joins the default set adapter-gated — reachable without a
  library-side domain choice. Verified against the `create*Tool(options)` + `createDefaultTools(options)` patterns in
  agent-tools/agent-framework.
- **Capability preservation:** v1 preserves repo-map ranking (token-budgeted); the deferred vector backend is
  recorded, not silently dropped, with the note the port may need revision.
- **Adversarial:** risk = a heavy vector/parser SDK creeping into libs → prevented by keeping only the neutral
  mechanism in `agent-tools` and injecting the parser as a duck-typed port + corpus from the surface. Because no
  existing `pnpm harness:scan` rule mechanically fences `agent-tools`' third-party dependencies (see TC-04), a
  mechanical floor is filed as a follow-up rather than resting neutrality on the manual grep.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-tools (port+types+tool + neutral repo-map ranking adapter, mirror sandbox), assembly threads the adapter, concrete source parser + corpus supplied by agent-cli/apps/agent-app. NO new interface package for v1 (extract at P4 iff a family).
- [x] Sibling scan 완료 — mirrors the **sandbox port precedent**: port+types + `createRetrievalTool({adapter})` + the neutral ranking adapter live IN `agent-tools` (like `ISandboxClient` + `createReadTool` + `InMemorySandboxClient`), adapter threaded through assembly like `sandboxClient`; NO new interface package for v1 (extract at P4 iff a family). Independent architecture-placement validation recorded in the Evidence Log.
- [x] 대안 최소 2개 — 3 considered (one-backend+interface-contract CHOSEN; unify-both REJECTED capability, baked-vector REJECTED neutrality), each Pro+Con.
- [x] 결정 근거 — capability-preservation forces one backend for v1; interface-package placement per rule; independent GATE-APPROVAL re-review pending.

## Solution

v1: retrieval port+types in `agent-tools/src/retrieval` (mirror sandbox); `createRetrievalTool({ adapter })` in agent-tools,
joining the default tool set adapter-gated; the neutral repo-map graph-rank ranking adapter (token-budget aware) in
`agent-tools/src/retrieval/` (mirror `InMemorySandboxClient`), with the source parser injected as a duck-typed port;
concrete source parser + corpus config supplied by the surface (agent-cli/apps/agent-app).

**Epic slices:** P1 (this) = contract + tool + repo-map reference adapter. P2 = index build + persistence. P3 =
incremental re-index on file change. P4 = embedding-vector backend (may revise the port).

## Affected Files

| File                                                               | Change                                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `packages/agent-tools/src/retrieval/types.ts` (new)                | retrieval adapter port + types (mirror sandbox/types.ts)                                                 |
| `packages/agent-tools/src/retrieval/` (new)                        | neutral repo-map ranking adapter (mirror `InMemorySandboxClient`) — source parser injected               |
| `packages/agent-tools/src/retrieval/` + `agent-framework` assembly | `createRetrievalTool({ adapter })`, joins default set adapter-gated; thread adapter like `sandboxClient` |
| `packages/agent-cli/` / `apps/agent-app`                           | concrete source parser + corpus wiring (the neutral adapter comes from agent-tools)                      |

## Completion Criteria

- [ ] TC-01: the retrieval contract returns ranked results and never exceeds the given token budget (unit test).
- [ ] TC-02: the repo-map reference adapter ranks the most relevant symbols/files of a fixture repo for a given active-file set within a budget (functional test).
- [ ] TC-03: the retrieval adapter is threaded through the assembly layer (like `sandboxClient`) and `createRetrievalTool` joins the default set adapter-gated — absent/no-op with no adapter — while the product (`agent-cli`/`apps/agent-app`) supplies the concrete source parser + corpus; the neutral ranking adapter itself comes from `agent-tools` and carries no corpus (unit test on the assembly wiring + adapter-gating).
- [ ] TC-04: no corpus/domain content in `agent-tools` — the neutral ranking adapter takes the source parser + corpus by injection; a code review / a targeted grep confirms no repo paths in the package. This is a MANUAL floor today: no existing `pnpm harness:scan` rule mechanically fences `agent-tools`' third-party dependencies — `deps` (`check-dependency-direction.mjs`) only checks inter-workspace direction/cycles + agent-core/agent-plugin constraints, and `interface-imports`/`interface-runtime` only cover `agent-interface-*` packages. Per [enforcement-architecture.md](../../rules/enforcement-architecture.md) (every guardian needs a mechanical floor), a follow-up is filed for a mechanical `agent-tools` neutrality floor (a dependency-allowlist / no-heavy-retrieval-SDK scan); neutrality does not rest on the manual grep alone.
- [ ] TC-05: swapping the adapter needs no `agent-tools` change (design + a fake-adapter unit test).

## Test Plan

| TC    | Verification                  | Type/Tool                                       |
| ----- | ----------------------------- | ----------------------------------------------- |
| TC-01 | budget respected + ranked     | vitest unit                                     |
| TC-02 | repo-map fixture ranking      | functional test                                 |
| TC-03 | adapter threaded via assembly | vitest unit (assembly wiring)                   |
| TC-04 | no corpus in agent-tools      | manual grep/review + follow-up mechanical floor |
| TC-05 | adapter swap                  | fake-adapter unit test                          |

## Tasks

`.agents/tasks/SELFHOST-003*.md` — 미생성 (GATE-APPROVAL 통과 후 생성). Epic P1 (contract+tool+repo-map adapter) /
P2 (index+persistence) / P3 (incremental) / P4 (vector backend).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Flagged: DIP boundary
  unvalidated (vector ≠ repo-map behind one `query(text)`); contract placement left conditional; adapter placement
  undecided; epic not split; TC-03 used the wrong scan; some Prior Art URLs suspected fabricated; thin Problem.
- 2026-07-16 — **Revisions applied (this draft):** v1 commits to ONE backend (repo-map), port designed to it,
  vector deferred (capability-preservation); contract pinned to a new `agent-interface-retrieval` package; adapter
  placed at the agent-cli root per Family Decomposition; epic split P1..P4; TC-03 now targets `interface-runtime`
  correctly (type-only) and TC-04 is a justified manual neutrality check; Prior Art trimmed to canonical product-doc
  URLs (cursor.com/docs, aider.chat/docs/repomap.html, docs.github.com/copilot); concrete self-hosting Problem.
  Re-review pending.
- 2026-07-16 — **iteration 2: RE-REVIEW → REVISE, applied.** Re-reviewer: the new `agent-interface-retrieval`
  package is over-decomposition (mirror-an-analog failure) — the sandbox precedent keeps the port (`ISandboxClient`)
  - tool IN `agent-tools`, adapter threaded through assembly. Fixed: retrieval port+types folded into
    `agent-tools/src/retrieval/types.ts`; adapter threaded like `sandboxClient`; extraction to an interface package
    deferred to P4 iff a third-party-installable family; TC-03 retargeted to the assembly-threading. Iteration-3 re-review pending.
- 2026-07-17 — **iteration 3: RE-REVIEW → REVISE, applied.** Re-reviewer: the reference-adapter placement under-mirrored
  the invoked analog — neutral reference adapters like `InMemorySandboxClient` live INSIDE `agent-tools`, not at the
  product root. Fixed: the **neutral repo-map ranking adapter now lives in `agent-tools/src/retrieval/`** (mirroring
  `InMemorySandboxClient`), with the source parser injected as a duck-typed port (as `E2BSandboxClient` duck-types the
  E2B SDK) and the corpus supplied from the surface, so sibling surfaces reuse the shared core instead of depending on
  `agent-cli`. Committed the default-tool-set membership: `createRetrievalTool` **joins the default set adapter-gated**
  (absent/no-op with no adapter), mirroring the sandbox-aware tools through `createDefaultTools(options)`. Stated the
  neutrality enforcement floor: no existing `pnpm harness:scan` rule (deps/interface-imports/interface-runtime) fences
  `agent-tools`' third-party dependencies, so a mechanical `agent-tools` neutrality floor is filed as a follow-up (TC-04
  no longer rests on the manual grep alone). Housekeeping: dropped the stale `agent-interface` tag (no interface package
  is created); the chosen alternative (fold port+types+tool into `agent-tools`) is unchanged.
- 2026-07-17 — **iteration 4: RE-REVIEW → ENDORSE** (independent proposal-reviewer). All 4 punch-list items verified
  against the source: the `InMemorySandboxClient`/`E2BSandboxClient`/`IE2BSandboxAdapter` precedent is real and the
  retrieval design mirrors it; `createDefaultTools(options)` adapter-gating confirmed; no existing scan fences
  `agent-tools` third-party deps (follow-up correctly filed); tag/type housekeeping consistent. Placement + dependency
  direction + capability-preservation all clean; no new defect. **GATE-APPROVAL PASSED.** (Non-blocking: file the
  `agent-tools` neutrality-floor follow-up as a tracked backlog item at task-authoring time.)
