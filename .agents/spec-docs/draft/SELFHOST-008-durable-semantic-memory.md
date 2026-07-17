---
status: draft
type: DATA
tags: [memory, semantic-recall, persistence, agent-core, agent-cli, selfhost]
---

# SELFHOST-008 (EPIC): durable project + semantic long-term memory — port + reference adapter + curation seam (v1)

## Problem

Promotes backlog [SELFHOST-008](../../backlog/SELFHOST-008-durable-semantic-memory.md) toward
[VISION.md](../../../VISION.md). Robota already ships a `/memory` command and an auto-capture pipeline, but the
whole subsystem is **hardcoded to the local filesystem and to one recall mechanism**. Concrete symptom: today
`ProjectMemoryStore` writes `<cwd>/.robota/memory/MEMORY.md` + `topics/*.md` with direct `fs` calls
(`packages/agent-framework/src/memory/project-memory-store.ts` uses `existsSync/readFileSync/appendFileSync`), and
`MemoryRetrievalService` (`packages/agent-framework/src/memory/memory-retrieval-service.ts`) recalls by **token-overlap
scoring over topic files** — there is no port, no swappable store, and no path to semantic/vector recall. The advertised
differentiator is memory that **grows with you** — auto-curated project/workspace memory plus optional semantic recall
across sessions — and the current shape cannot deliver the "semantic" half or let a surface supply its own durable
store without editing the library. When Robota develops Robota, cross-session recall of durable project facts is exactly
the self-hosting flywheel; it must sit behind DIP so a store can be swapped, and its curation policy + content must stay
out of `packages/`.

## Prior Art Research

From product documentation: Nous **Hermes** agent-curated memory with cross-session FTS recall and user modeling
(https://hermes-agent.nousresearch.com/docs/); **Windsurf** Cascade "Memories" — workspace-scoped, auto-generated,
persisted across sessions (https://docs.windsurf.com/windsurf/cascade/memories); **Mastra** working memory + semantic
memory over a pluggable store (https://mastra.ai/docs); **OpenAI Agents SDK** Sessions with pluggable backends behind a
stable session interface (https://openai.github.io/openai-agents-python/). **Common shape:** (a) a durable store
persisted across sessions/workspaces; (b) **agent-curated** auto-capture of salient facts (not just user-pinned notes),
gated by a policy; (c) recall by relevance **within a budget**; (d) the store behind a **stable pluggable interface** so
the backend (files, FTS, embedding/vector) can change without touching callers.

**Robota constraint / delta:** library-neutrality (no memory _content_ and no app-voice curation _policy_ in
`packages/` — content lives in the consumer workspace, policy/prompt in the surface); the store must sit behind a DIP
port **folded into the package that owns memory's consumers**, mirroring the sandbox precedent, not a new interface
package. **Two recall backends are NOT interchangeable behind one signature** (the same insight that pinned SELFHOST-003
to one backend): the present `retrieve(query, config)` does keyword/token-overlap scoring over topic files, whereas a
semantic backend does `embed(text) → nearest-neighbor`. A single port cannot be _claimed_ to hide both without
demonstration (spec-workflow "Validated Recommendation Before Approval" — capability preservation). So **v1 commits to
ONE recall backend** — the neutral keyword/FTS reference adapter (no embedding infra; fits self-hosting a code repo) —
designs the write/recall/curate port to it, and **consciously defers the semantic/vector backend** (the port may be
revised when it lands). Memory recall and SELFHOST-003 codebase-retrieval are adjacent but **deliberately distinct
ports** (see Decision): memory owns write + curate + durable persistence; retrieval is read-only over re-derivable code.

## Architecture Review

### Affected Scope

- **`agent-framework`** (the package that already owns the memory subsystem and its consumers): the neutral **memory
  port** — `IMemoryStore` (write / recall / curate) + request/response/budget types — lives HERE
  (`src/memory/types.ts`), **mirroring the STRUCTURE of the sandbox precedent** (`ISandboxClient`/`ISandboxToolOptions`
  in `agent-tools/src/sandbox/types.ts`) — NOT a new interface package, and NOT `agent-core`. The sandbox port lives in
  `agent-tools` because that is the package that **owns its consumer subsystem (the tools)**; memory's consumers are the
  session-lifecycle assembly (`context-loader.ts:113` injects `loadStartupMemory()` into the system prompt) and the
  command-api (`command-api/memory/memory-command-api.ts` surfaces `/memory`) — **both already in `agent-framework`**.
  So the analog places the port with memory's consumer subsystem: `agent-framework`.
- **The neutral fs-backed reference adapter also lives HERE** (`src/memory/`), mirroring `InMemorySandboxClient` in
  `agent-tools/src/sandbox/in-memory-sandbox-client.ts`: the existing `ProjectMemoryStore` (+ `PendingMemoryStore` +
  the keyword-overlap `MemoryRetrievalService`) is refactored to **implement `IMemoryStore` behind the port**. Durable
  filesystem persistence + budgeted keyword recall + dedup + the sensitive-content **safety filter**
  (`containsSensitiveMemoryContent`, `memory-policy-evaluator.ts`) are NEUTRAL mechanisms that work for any workspace,
  so they stay in the shared library — exactly as `InMemorySandboxClient` stays in `agent-tools`.
- **Only the heavy/domain pieces are injected:** the **semantic/vector store** as a **duck-typed port**
  (`ISemanticMemoryAdapter`, mirroring how `E2BSandboxClient` duck-types the E2B SDK via `IE2BSandboxAdapter`, so no
  vector-DB SDK becomes an `agent-framework` dependency) — deferred to a later slice; and the **curation policy +
  memory content** supplied from the surface.
- **assembly threading:** the memory adapter is threaded through the assembly layer exactly as `sandboxClient` is
  (`ICreateSessionOptions` in `create-session-types.ts` already carries `sandboxClient?: ISandboxClient`; add
  `memoryStore?: IMemoryStore`), and consumed by `context-loader` startup-memory injection + the post-turn
  `AutomaticMemoryController` capture path — **adapter-gated**: with no adapter injected the neutral fs reference
  adapter is the default (memory keeps working exactly as today), and injecting a semantic adapter upgrades recall
  without a library change.
- **`agent-cli` / `apps/agent-app`** own the **curation POLICY** (auto-capture heuristics/thresholds and any
  model-facing capture prompt — currently the English/Korean regex heuristics in `memory-candidate-extractor.ts` and the
  `AUTO_SAVE_CONFIDENCE_THRESHOLD` in `memory-policy-evaluator.ts` are library-default _reference_ policy the surface may
  override) and the **memory CONTENT location** (already the consumer's `<cwd>/.robota/memory/`, never `packages/`), and
  optionally wire a concrete `ISemanticMemoryAdapter`. `apps/agent-app` has **no `agent-framework` dep**; it consumes
  memory **through the runtime host** (`startRuntimeHost` over `robota --serve`), which supplies policy + content at the
  composition root — reachable without importing the port.
- **Extraction trigger:** extract the port/types to a new `agent-interface-memory` package **at a later slice iff** the
  semantic/vector backend makes memory store adapters a **third-party-installable family** (like `agent-provider-*`) —
  not before (avoids premature interface-package/publish ceremony for a non-family; mirrors SELFHOST-003's P4 rule).

### Alternatives Considered

1. **Memory port `IMemoryStore` (write/recall/curate) + the neutral fs reference adapter folded into
   `agent-framework/src/memory/` (mirror the STRUCTURE of the sandbox port — `ISandboxClient` + `InMemorySandboxClient`
   co-located in their owning package); heavy semantic/vector store duck-typed (`ISemanticMemoryAdapter`) and injected;
   adapter threaded through the assembly like `sandboxClient`, adapter-gated; curation policy + content supplied by
   `agent-cli`/`apps/agent-app`; v1 = ONE recall backend (keyword/FTS), semantic deferred (CHOSEN).**
   - ✅ Correct mirror-an-analog: the port + its reference adapter sit in the package that **owns memory's consumers**
     (context-loader + command-api), just as the sandbox port + `InMemorySandboxClient` sit in `agent-tools` which owns
     the tools; port and reference adapter stay co-located in ONE package (not split); neutral (content in the workspace,
     policy in the surface); no heavy vector SDK in the library (duck-typed); capability-preservation satisfied (port
     designed to a concrete backend, semantic consciously deferred); sibling surfaces reuse the shared core via the
     runtime host.
   - ❌ The semantic/vector backend is deferred; the port may need revision when it lands (stated, not hidden).
2. **Memory port in `agent-core`** (the backlog seed's asserted placement).
   - ✅ Foundational-looking; a single low layer everyone can import.
   - ❌ **Mirror-an-analog failure.** `agent-core` is the zero-deps foundation for engine primitives (providers, hooks,
     events); the project-structure Interface Package Rule explicitly says **"Do not place interface packages in
     `agent-core` — `agent-core` is zero-deps and owns foundational primitives only."** A capability port with a durable
     store is not an engine primitive, and the fs reference adapter needs `fs` I/O it **cannot** co-locate in zero-dep
     `agent-core` — which would split the port from its reference adapter (the opposite of the sandbox analog, where
     both live together) and strand it away from its actual consumers (assembly + command-api in `agent-framework`).
     The analog put the sandbox port in its consumer subsystem's package (`agent-tools`), **not** in `agent-core`.
     REJECTED.
3. **Memory port in `agent-tools`** (the analog's literal package).
   - ✅ Maximally literal mirror of `ISandboxClient`; `createMemoryTool({ adapter })` could join the default tool set.
   - ❌ Memory is **not a function-tool**. Its real consumers are the session-lifecycle assembly
     (`context-loader.ts:113` feeds startup memory into the **system prompt**) and the post-turn capture controller and
     the `/memory` **command** — none of which is a `create*Tool` consumed by `createDefaultTools(options)`. Placing the
     port in `agent-tools` would **invert ownership** and fracture the existing memory subsystem across two packages
     (port in `agent-tools`, reference adapter + policy + retrieval already in `agent-framework`). The analog's lesson is
     "co-locate the port with its **consumer subsystem**," which for memory is `agent-framework`, not the tool layer.
     REJECTED.
4. **One `query(text)` port claimed to hide both keyword/FTS recall AND semantic/vector recall.**
   - ✅ Looks maximally flexible; one signature.
   - ❌ Unvalidated LCD contract — keyword overlap and embedding nearest-neighbor are different backends with different
     inputs; the same capability-preservation defect that pinned SELFHOST-003 to one backend. REJECTED.

### Decision

Adopt (1): the neutral memory port `IMemoryStore` (write/recall/curate) + request/response/budget types live IN
`agent-framework/src/memory/types.ts` (mirroring the STRUCTURE of `ISandboxClient` in `agent-tools/src/sandbox/types.ts`
— folded into the package that owns memory's consumers, NOT `agent-core`, NOT `agent-tools`, NOT a new interface
package). The existing fs-backed `ProjectMemoryStore`/`PendingMemoryStore`/`MemoryRetrievalService` are refactored to
implement `IMemoryStore` as the **neutral reference adapter** (mirroring `InMemorySandboxClient`). The heavy
**semantic/vector store** is a **duck-typed injected port** `ISemanticMemoryAdapter` (mirroring `IE2BSandboxAdapter`),
consciously **deferred** to a later slice — v1 commits to the keyword/FTS recall backend and the port is designed to it.
The adapter is threaded through the assembly like `sandboxClient` (`ICreateSessionOptions.memoryStore`), adapter-gated
(default = the neutral fs reference adapter). The **curation policy** (capture heuristics/thresholds/prompt) and any
**memory content** are supplied by the surface (`agent-cli`/`apps/agent-app`, the latter through the runtime host); the
library ships only default _reference_ policy + neutral mechanism.

**Memory vs SELFHOST-003 retrieval — deliberately distinct ports.** Both "return the most relevant slice within a token
budget," and memory's recall MAY reuse a budgeted-ranking mechanism internally (avoid reinventing ranking). But the
ports are **distinct, not shared**: SELFHOST-003's retrieval port is **read-only** over the repo's **code** (a corpus
that is ephemeral and re-derivable), whereas the memory port is a **superset** — it owns **write + curate + durable
cross-session persistence** of **user/project facts** that must be captured and kept. Forcing one port to hide both
read-only retrieval and write/curate memory would repeat SELFHOST-003's rejected LCD trap. Epic slices below.

### Validated Recommendation

- **Reachability:** the neutral fs reference adapter ships from `agent-framework` and is the default when no adapter is
  injected, so memory keeps working with zero surface wiring; a surface (agent-cli / apps/agent-app via the runtime
  host) supplies the curation policy + content and optionally a semantic adapter — all reachable without a library-side
  domain choice. Verified against `create-session-types.ts` (which already threads `sandboxClient?: ISandboxClient`) and
  `context-loader.ts:113` (which already consumes `ProjectMemoryStore.loadStartupMemory()`).
- **Capability preservation:** v1 preserves today's durable filesystem write + budgeted keyword recall + auto-capture
  curation exactly (the reference adapter is the refactored existing code); the deferred semantic/vector backend is
  recorded, not silently dropped, with the note the port may need revision when it lands.
- **Adversarial:** risk = a heavy vector/embedding SDK, or app-voice curation prompt/seeded content, creeping into
  `packages/` → prevented by keeping only the neutral mechanism (port + fs reference adapter + safety filter) in the
  library, duck-typing the semantic store as `ISemanticMemoryAdapter`, and injecting policy + content from the surface.
  Because **no existing `pnpm harness:scan` rule mechanically fences the runtime memory subsystem's neutrality**
  (`scan-memory-mirror.mjs` governs the DIFFERENT `.agents/memory` harness mirror; `deps`/`interface-imports`/
  `interface-runtime` do not check content), a mechanical floor is filed as a follow-up per
  [enforcement-architecture.md](../../rules/enforcement-architecture.md) rather than resting neutrality on the manual grep (see TC-06).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `agent-framework` (memory port `IMemoryStore` + types + neutral fs reference adapter, mirror
      sandbox), assembly threads the adapter via `ICreateSessionOptions.memoryStore` like `sandboxClient`, curation policy +
      content + optional `ISemanticMemoryAdapter` supplied by `agent-cli`/`apps/agent-app`. NO new interface package for v1
      (extract at a later slice iff a family); NOT `agent-core` (zero-dep foundation, fs adapter can't co-locate); NOT
      `agent-tools` (memory is not a function-tool).
- [x] Sibling scan 완료 — mirrors the **sandbox port precedent**: port + types + neutral reference adapter live IN the
      package that owns the consumers (`ISandboxClient` + `InMemorySandboxClient` → `agent-tools`; `IMemoryStore` + fs
      reference adapter → `agent-framework`), adapter threaded through assembly like `sandboxClient`; heavy store duck-typed
      like `IE2BSandboxAdapter`. Grounded against `agent-framework/src/memory/*`, `context-loader.ts:113`,
      `create-session-types.ts`. Independent architecture-placement validation to be recorded in the Evidence Log at GATE-APPROVAL.
- [x] 대안 최소 2개 — 4 considered (fold-into-`agent-framework` CHOSEN; `agent-core` REJECTED mirror-failure/zero-dep;
      `agent-tools` REJECTED not-a-tool/ownership-inversion; one-`query()`-LCD REJECTED capability), each Pro+Con.
- [x] 결정 근거 — mirror-an-analog places the port with its consumer subsystem (`agent-framework`); capability-preservation
      forces ONE recall backend for v1 (keyword/FTS), semantic deferred; memory port is a distinct superset of SELFHOST-003's
      read-only retrieval port. GATE-APPROVAL pending.

## Solution

v1: memory port `IMemoryStore` (write/recall/curate) + request/response/budget types in `agent-framework/src/memory/types.ts`
(mirror sandbox); the existing fs-backed `ProjectMemoryStore`/`PendingMemoryStore`/`MemoryRetrievalService` refactored to
implement it as the neutral reference adapter (mirror `InMemorySandboxClient`), preserving durable filesystem persistence

- budgeted keyword recall + dedup + the sensitive-content safety filter; the semantic/vector store injected as a
  duck-typed `ISemanticMemoryAdapter` (mirror `IE2BSandboxAdapter`), deferred; the adapter threaded through
  `ICreateSessionOptions.memoryStore` and consumed by `context-loader` startup injection + the post-turn capture
  controller, adapter-gated; curation policy + memory content supplied by the surface (`agent-cli`/`apps/agent-app`).

**Epic slices:** P1 (this) = memory port + refactor the existing store behind it as the reference adapter + assembly
threading + surface-owned curation-policy seam. P2 = persistence hardening + cross-session recall guarantees. P3 =
duck-typed `ISemanticMemoryAdapter` + a fake semantic adapter proving the swap. P4 = a concrete semantic/vector backend
in a surface (may revise the port) + extraction to `agent-interface-memory` iff a third-party-installable family.

## Affected Files

| File                                                                                                                       | Change                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-framework/src/memory/types.ts` (new)                                                                       | memory port `IMemoryStore` (write/recall/curate) + budget/request/response types + duck-typed `ISemanticMemoryAdapter` (mirror `sandbox/types.ts`) |
| `packages/agent-framework/src/memory/project-memory-store.ts` (+ `pending-memory-store.ts`, `memory-retrieval-service.ts`) | refactor existing fs store to **implement `IMemoryStore`** as the neutral reference adapter (mirror `InMemorySandboxClient`)                       |
| `packages/agent-framework/src/assembly/create-session-types.ts` + assembly wiring                                          | add `memoryStore?: IMemoryStore` and thread it like `sandboxClient`, adapter-gated (default = fs reference adapter)                                |
| `packages/agent-framework/src/context/context-loader.ts`                                                                   | consume startup memory through the port instead of `new ProjectMemoryStore(cwd)` directly                                                          |
| `packages/agent-framework/src/memory/automatic-memory-controller.ts` + `memory-candidate-extractor.ts`                     | make the auto-capture curation policy (heuristics/thresholds/prompt) surface-injectable; library keeps a neutral default reference policy          |
| `packages/agent-cli/` / `apps/agent-app` (via runtime host)                                                                | supply curation policy + memory-content location + optional concrete `ISemanticMemoryAdapter` (the neutral adapter comes from `agent-framework`)   |

## Completion Criteria

- [ ] TC-01: the memory port **round-trips durably across sessions** — a fact written via `IMemoryStore` in one session is recalled in a fresh session over the same workspace (functional test).
- [ ] TC-02: recall returns ranked references and **never exceeds the given token/char budget** (unit test).
- [ ] TC-03: the memory adapter is threaded through the assembly (like `sandboxClient` via `ICreateSessionOptions.memoryStore`) and both startup-memory injection and post-turn capture use the port; with **no adapter injected the neutral fs reference adapter is the default** (memory works unchanged), while the surface supplies the curation policy + content (unit test on the assembly wiring + adapter-gating).
- [ ] TC-04: the **curate** path queues/saves candidates per the injected policy and **refuses sensitive content** via the safety filter (unit test).
- [ ] TC-05: **swapping the store adapter** (a fake `ISemanticMemoryAdapter` / fake `IMemoryStore`) needs **no `agent-framework` change** (design + fake-adapter unit test) — capability-preservation for the deferred semantic backend.
- [ ] TC-06 (**NEUTRALITY GUARD**): **no memory CONTENT and no app-voice curation prompt/seeded corpus in `packages/`** — a targeted grep/review confirms memory content lives only under the consumer workspace (`<cwd>/.robota/memory/`) and any capture-prompt/policy content lives in `agent-cli`/`apps/agent-app`, not the library. This is a **MANUAL floor today**: no existing `pnpm harness:scan` rule fences the runtime memory subsystem's neutrality — `scan-memory-mirror.mjs` governs the **different** `.agents/memory` harness mirror, and `deps`/`interface-imports`/`interface-runtime` do not check content. Per [enforcement-architecture.md](../../rules/enforcement-architecture.md) (every guardian needs a mechanical floor), a follow-up is filed for a mechanical `packages/` memory-neutrality scan; neutrality does not rest on the manual grep alone.

## Test Plan

| TC    | Verification                                   | Type/Tool                                       |
| ----- | ---------------------------------------------- | ----------------------------------------------- |
| TC-01 | cross-session write→recall round-trip          | functional test                                 |
| TC-02 | budget respected + ranked references           | vitest unit                                     |
| TC-03 | adapter threaded via assembly + adapter-gating | vitest unit (assembly wiring)                   |
| TC-04 | curate queue/save + sensitive-content refusal  | vitest unit                                     |
| TC-05 | adapter swap needs no library change           | fake-adapter unit test                          |
| TC-06 | no memory content/policy in `packages/`        | manual grep/review + follow-up mechanical floor |

## Tasks

`.agents/tasks/SELFHOST-008*.md` — 미생성 (GATE-APPROVAL 통과 후 생성). Epic P1 (port + refactor store as reference
adapter + assembly threading + curation-policy seam) / P2 (persistence + cross-session recall guarantees) / P3
(duck-typed `ISemanticMemoryAdapter` + fake-adapter swap) / P4 (concrete semantic/vector backend in a surface; may
revise the port; extract `agent-interface-memory` iff a family).

## Evidence Log

- 2026-07-17 — **Draft authored.** Grounded in the actual memory subsystem: `ProjectMemoryStore` fs-hardcoded to
  `<cwd>/.robota/memory/` (`packages/agent-framework/src/memory/project-memory-store.ts`); keyword-overlap recall
  (`memory-retrieval-service.ts`); auto-capture policy + sensitive-content filter (`memory-policy-evaluator.ts`,
  `automatic-memory-controller.ts`, `memory-candidate-extractor.ts`); consumers = `context/context-loader.ts:113`
  (startup-memory → system prompt) and `command-api/memory/memory-command-api.ts` + `agent-command/src/memory/`
  (`/memory`). Placement grounded against the sandbox precedent (`agent-tools/src/sandbox/types.ts` `ISandboxClient`,
  `in-memory-sandbox-client.ts`, `e2b-sandbox-client.ts` `IE2BSandboxAdapter`) and the assembly seam
  (`create-session-types.ts` already threads `sandboxClient?: ISandboxClient`); neutrality-floor gap confirmed
  (`scan-memory-mirror.mjs` covers the different `.agents/memory` mirror; no runtime-memory content scan). **Decision:
  fold the memory port + reference adapter into `agent-framework` (mirror the sandbox STRUCTURE in the package that owns
  memory's consumers), REJECTING the seed's `agent-core` (mirror-failure/zero-dep) and `agent-tools` (not-a-tool).**
  GATE-APPROVAL pending (independent proposal-reviewer sign-off + architecture-placement validation to be recorded here).
  </content>
  </invoke>
