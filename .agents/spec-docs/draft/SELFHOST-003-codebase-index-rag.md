---
status: draft
type: DATA
tags: [rag, codebase-index, retrieval, agent-tools, agent-interface, selfhost]
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
  `create*Tool(options)`.
- **assembly threading**: the concrete repo-map reference adapter is threaded through the assembly layer exactly as
  `sandboxClient` is (`createDefaultTools` / `ICreateSessionOptions`), with the **product (`agent-cli`) supplying the
  concrete instance**. (Decide at design time whether retrieval joins the default tool set in `agent-framework` like
  Read/Edit, or is product-specific corpus wiring — the Prior Art frames it as a general capability, favoring the
  default set.)
- Corpus (which repo/paths) wired in `agent-cli`/`apps/agent-app`.
- **Extraction trigger:** extract the port/types to a new `agent-interface-retrieval` package at **P4 iff** the
  vector backend makes retrieval adapters a third-party-installable family (like `agent-provider-*`) — not before
  (avoids premature publish-registry/project-structure/SPEC ceremony for a non-family).

### Alternatives Considered

1. **Retrieval port+types folded into agent-tools (mirror the sandbox port); tool in agent-tools; thin repo-map reference adapter at
   the agent-cli root; v1 = one backend (CHOSEN).**
   - ✅ Correct interface-package placement (not conditional); neutral (corpus in surface); no heavy dep in libs;
     port designed to a concrete backend (capability-preservation satisfied).
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
`createRetrievalTool({ adapter })` in `agent-tools`; a thin repo-map graph-rank reference adapter threaded through the assembly layer like `sandboxClient` (product supplies the concrete); corpus in surfaces. The embedding-vector backend is a consciously deferred follow-up
(the port may be revised when it lands). Epic slices below.

### Validated Recommendation

- **Reachability:** the tool is composed at the agent-cli root where the adapter + corpus are configured — reachable
  without a library-side domain choice. Verified against the `create*Tool(options)` pattern in agent-tools.
- **Capability preservation:** v1 preserves repo-map ranking (token-budgeted); the deferred vector backend is
  recorded, not silently dropped, with the note the port may need revision.
- **Adversarial:** risk = a heavy vector SDK creeping into libs → prevented by the composition-root adapter +
  neutrality guard.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-tools (port+types+tool, mirror sandbox), assembly threads the adapter, repo-map reference adapter + corpus supplied by agent-cli. NO new interface package for v1 (extract at P4 iff a family).
- [x] Sibling scan 완료 — mirrors the **sandbox port precedent**: port+types + `createRetrievalTool({adapter})` live IN `agent-tools` (like `ISandboxClient` + `createReadTool`), adapter threaded through assembly like `sandboxClient`; NO new interface package for v1 (extract at P4 iff a family). Independent architecture-placement validation recorded in the Evidence Log.
- [x] 대안 최소 2개 — 3 considered (one-backend+interface-contract CHOSEN; unify-both REJECTED capability, baked-vector REJECTED neutrality), each Pro+Con.
- [x] 결정 근거 — capability-preservation forces one backend for v1; interface-package placement per rule; independent GATE-APPROVAL re-review pending.

## Solution

v1: retrieval port+types in `agent-tools/src/retrieval` (mirror sandbox); `createRetrievalTool({ adapter })` in agent-tools;
a repo-map graph-rank reference adapter (token-budget aware) at the agent-cli root; corpus config in the surface.

**Epic slices:** P1 (this) = contract + tool + repo-map reference adapter. P2 = index build + persistence. P3 =
incremental re-index on file change. P4 = embedding-vector backend (may revise the port).

## Affected Files

| File                                                               | Change                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `packages/agent-tools/src/retrieval/types.ts` (new)                | retrieval adapter port + types (mirror sandbox/types.ts)                 |
| `packages/agent-tools/src/retrieval/` + `agent-framework` assembly | `createRetrievalTool({ adapter })` + thread adapter like `sandboxClient` |
| `packages/agent-cli/`                                              | repo-map reference adapter + corpus wiring                               |

## Completion Criteria

- [ ] TC-01: the retrieval contract returns ranked results and never exceeds the given token budget (unit test).
- [ ] TC-02: the repo-map reference adapter ranks the most relevant symbols/files of a fixture repo for a given active-file set within a budget (functional test).
- [ ] TC-03: the concrete repo-map adapter is threaded through the assembly layer (like `sandboxClient`) and the product (`agent-cli`) supplies it — the tool itself carries no concrete adapter/corpus (unit test on the assembly wiring).
- [ ] TC-04: no corpus/domain content in `agent-tools` — the tool takes the adapter by injection; a code review / a targeted grep confirms no repo paths in the package (manual check, justified: no mechanical neutrality scan covers agent-tools).
- [ ] TC-05: swapping the adapter needs no `agent-tools` change (design + a fake-adapter unit test).

## Test Plan

| TC    | Verification                  | Type/Tool                      |
| ----- | ----------------------------- | ------------------------------ |
| TC-01 | budget respected + ranked     | vitest unit                    |
| TC-02 | repo-map fixture ranking      | functional test                |
| TC-03 | adapter threaded via assembly | vitest unit (assembly wiring)  |
| TC-04 | no corpus in agent-tools      | manual grep/review (justified) |
| TC-05 | adapter swap                  | fake-adapter unit test         |

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
