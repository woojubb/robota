---
status: in-progress
type: FLOW
tags: [cli, agent]
---

# FLOW-007: natural-language workflow authoring & immediate run via `/workflows`

## Problem

`/workflows` today (WORKFLOW-003) only **lists / catalogs / validates / runs** existing workflow
files — there is no path from a natural-language description to a runnable workflow. A user (or the
agent itself, in chat) must hand-write DAG JSON. Reproduction: `/workflows` exposes
`<list|catalog|validate|run>` only; there is no `create`/authoring subcommand, and the command is
`modelInvocable: false`, so the agent cannot author a workflow from a chat request either.

Goal: **describe a workflow in natural language → the system authors it, saves it as a reusable
artifact, and runs it immediately** — composing existing nodes and, when a fitting node does not
exist, creating a prompt-backed node on the fly. The agent can invoke this from normal chat.

Secondary: the persisted layout `.dag/workflows/` repeats the same concept twice (`.dag` ≈
`workflows`), and the workspace directory name is hardcoded across two products (dag-cli and the
agent-cli `/workflows` bridge). Make the workspace layout a **configurable option** (single shared
machinery, per-product folder name) with a de-jargoned default.

## Architecture Review

### Affected Scope

- **Workspace layout parameterization (DATA-002 refactor).** The workspace root dir + workflow-file
  extension become **configurable options** (shared machinery, per-product folder name), not hardcoded
  `.dag`/`.dag.json` constants. New defaults: root **`.workflows/`**, workflow ext **`.json`**, workflow
  definitions **flat** at `<root>/<name>.json`, nodes at `<root>/nodes/` (`<type>.node.json` manifest +
  `<type>.dag.node.js` companion). Path helpers (`paths.ts`) take an optional `root`; `store.ts`,
  `catalog/catalog-scanner.ts`, `commands/{save,run,node}.ts` (the `.dag/` walk-up + dir constants), and
  `agent-command-workflows` (`catalog-command.ts` `DEFAULT_CATALOG_DIR`) thread/consume it. Each product
  sets its own root (both default `.workflows/`); dag-cli MAY keep `.dag/` via the option. Behavior-
  preserving; feature is unreleased so **no migration**.
- **NL authoring (new).** `packages/agent-command-workflows/src/` gains a `create` subcommand + an
  authoring module (build node-catalog context → prompt the active provider → validate the emitted
  spec → assemble `IDagDefinition` → save → run). The reusable **spec→DAG assembly** is relocated into
  `@robota-sdk/dag-framework` (or `dag-builder`) — **NOT** `dag-cli` (private). No new `@robota-sdk`
  runtime edge for agent-cli beyond what is already bundled (INFRA-028).
- **Provider access.** The authoring LLM call uses agent-cli's **active provider** (resolved via the
  command host context / session), never a hardcoded provider.
- **Instant nodes.** Reuse `createPromptBackedNodeDefinition` + the persistence store to define, save
  (`.workflows/nodes/`), and register new prompt nodes for reuse.
- **Model-invocable.** The create action is exposed `modelInvocable: true` so the agent authors + runs
  a workflow from a natural chat request.

### Alternatives Considered

1. **Port `dag describe` as-is.** Pro: exists, proven. Con: lives in private `dag-cli`; hardcodes
   `llm-text-anthropic` + `ANTHROPIC_API_KEY`; existing-nodes-only; the owner explicitly does not want
   it as the template. Rejected.
2. **Fresh authoring: LLM emits a schema-validated workflow spec, assembled deterministically and run
   in-process; new prompt nodes created on demand; uses the active provider (chosen).** Pro: clean
   separation (LLM _authors_, runtime _executes_ deterministically); respects the user's configured
   provider; produces a legible, reusable saved artifact; not coupled to `dag-cli`. Con: provider-access
   integration + relocating the shared spec→DAG assembly.
3. **Agent-only (no explicit command; the chat agent builds workflows purely via tools).** Pro: most
   "natural". Con: the owner wants an explicit `create` command that the agent then _uses_; harder to
   test/verify deterministically. Rejected as the sole approach (kept as the Phase-4 model-invocable
   layer on top of the command).

### Decision

Alternative 2. A fresh NL→workflow authoring path in `agent-command-workflows`: build the node-catalog
context → prompt the **active provider** → the LLM returns a **schema-validated workflow spec** → the
runtime **deterministically assembles** an `IDagDefinition` (plus any new prompt-node manifests) → save
to `.workflows/` → run in-process on `LocalDagRuntimeProvider` → surface outputs. Storage de-jargoned
to `.workflows/` (flat `.json` workflows + `nodes/`).

Design principles adopted (concept only, from prior-art review): keep the orchestration in a **legible
saved artifact** rather than model context; **structured/validated** authoring output (not free text);
**deterministic execution** of the authored artifact; **save / reuse / re-run**; progress + result
visibility.

**Validated (wide blast radius — new agent-facing capability + storage rename):**

- **Reachability** — both surfaces reach the same authoring path: the explicit `/workflows create`
  subcommand and (Phase 4) the model-invocable tool. Authored workflows run on the same
  `LocalDagRuntimeProvider` the existing `run` uses; saved artifacts are re-runnable via `run`/`catalog`.
- **Capability preservation** — existing `list/catalog/validate/run` behavior unchanged; the storage
  rename is behavior-preserving (unreleased layout, no on-disk contract to break); INFRA-028 bundle +
  CLI-077 boundary hold (no new `@robota-sdk` runtime dep).
- **Adversarial pass** — (a) LLM emits invalid/unassemblable spec → validation error surfaced, no
  broken run; (b) no active provider / missing key → clear actionable error, never a silent guess; (c)
  a generated prompt-node `nodeType` collides with an existing node → deterministic resolution
  (reject or suffix, logged); (d) authored workflow fails at run → run error surfaced with the saved
  artifact path so the user can inspect/re-run.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the sibling is the existing `/workflows` subcommand family (list/catalog/validate/run); the new `create` joins it and the storage rename is shared by all
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 (fresh authoring; active provider; deterministic assembly; `.workflows/` layout; no dag-cli dependency)

## Solution

Phased; each phase independently green.

- **Phase 1a — workspace layout parameterization (DONE).** Layout as a configurable option (default
  `.workflows/` flat `.json` + `.workflows/nodes/`); persistence/catalog/walk-up consume it. Verified.
- **Phase 1b — injection wiring + catalog unification (architecture-reviewed; scope "b").** Given
  dag-cli's **functional, decentralized** composition (thin `runDagCli` dispatcher; pure-function
  commands that build their own runtime and read `process.cwd()`), the canonical injection is
  options-threading with a **single resolution point per product** — not a DI container:
  (C1) `runDagCli` resolves the layout once (a `--workspace <dir>` global flag / default) and threads
  `{ io, workspace }` into every command; `createWorkflowsCommandModule({ workspace })` receives it and
  agent-cli's `command-setup.ts` provides it. (C2) production callers pass the resolved layout to the
  persistence/catalog functions (which keep the optional default for standalone use); `LocalDagRuntime
Provider` options gain `workspace?` + local-node discovery. (C3) **unify the three workflow-read paths**
  (DATA-002 `loadWorkflows`, dag-cli `catalog-scanner`, `/workflows` inline scan) behind **one shared
  workspace-catalog reader in `dag-framework`**, layout-injected, consumed by all.
- **Phase 2 — NL authoring (existing nodes).** `/workflows create "<description>"`: gather node-catalog
  context → call the active provider → parse + **validate** the emitted workflow spec → assemble
  `IDagDefinition` → save `.workflows/<name>.json` → run in-process → print outputs.
- **Phase 3 — instant prompt-node creation.** The authoring output may define new prompt-backed nodes
  when no existing node fits; each is saved to `.workflows/nodes/` (reusing DATA-002 persistence),
  registered, and used in the workflow (and reusable later).
- **Phase 4 — model-invocable.** Expose the create action `modelInvocable: true`; the agent authors +
  runs a workflow from a natural chat request, surfacing the saved artifact + result.

## Affected Files

- `packages/agent-command-workflows/src/*` (new `create` subcommand + authoring module; module wiring)
- `packages/dag-framework/src/*` (relocated shared spec→DAG assembly + node-catalog context helper)
- `packages/dag-cli/src/local-runner/persistence/paths.ts`, `store.ts`, `catalog/catalog-scanner.ts`,
  `commands/{save,run,node}.ts` (storage rename)
- `packages/agent-command-workflows/docs/SPEC.md`, `packages/dag-cli/docs/SPEC.md`
- Tests across the above.

## Completion Criteria

- [ ] TC-01: after Phase 1, with the default workspace root, `dag save`/`run`/scaffold + `/workflows
catalog|run` operate on `.workflows/` (flat `.json` workflows, `.workflows/nodes/`); passing a custom
      root option redirects all reads/writes to that dir (unit test asserts both default and override);
      `pnpm --filter @robota-sdk/dag-cli test` green.
- [x] TC-02: `/workflows create "uppercase the input text"` → authors + saves `.workflows/<name>.json`
      and runs it → output is the input uppercased; exit success. (unit + compiled live UE)
- [x] TC-03: the authored artifact is re-runnable — `/workflows run .workflows/<name>.json` reproduces
      the result without re-authoring (run input baked into the artifact). (unit + compiled live UE)
- [x] TC-04: with no active provider, `/workflows create "..."` returns a clear actionable error and
      writes nothing. (unit test)
- [x] TC-05: Phase 3 — a bespoke step ("rewrite as a pirate") creates a prompt-backed node saved under
      `.workflows/nodes/`, used in the run, reusable on a second `create`. (unit + compiled live UE:
      save/reuse verified; the prompt-node LLM run needs a provider key.)
- [x] TC-06: Phase 4 — the `workflows`/`create` command is `modelInvocable: true` (kind
      `builtin-command`), so the agent can author + run from chat. (module unit test + descriptor
      projection verified; a full live scripted agent turn requires a provider key.)

## Test Plan

FLOW + cli/agent → command process-integration + agent-simulation. LLM-dependent authoring is tested
with a stubbed/injected provider (deterministic response) for unit/integration; one live UE per phase.

| TC-ID | Test Type              | Tool / Approach                                                           | Notes |
| ----- | ---------------------- | ------------------------------------------------------------------------- | ----- |
| TC-01 | Integration (fs+spawn) | vitest — storage-rename round-trip (save→catalog→run) on `.workflows/`    |       |
| TC-02 | Integration            | vitest — `create` with an injected provider stub → assert saved + run out |       |
| TC-03 | Integration            | vitest — re-run the saved artifact, assert identical result               |       |
| TC-04 | Unit                   | vitest — no-provider path returns actionable error, no write              |       |
| TC-05 | Integration            | vitest — prompt-node creation path (injected provider emits a new node)   |       |
| TC-06 | Agent simulation       | vitest — model-invocable create via a scripted agent turn                 |       |

## Tasks

- [ ] `.agents/tasks/FLOW-007.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- **GATE-WRITE — PASS (2026-07-06).** All sections present; Problem has concrete symptom (only `list/catalog/validate/run`, `modelInvocable:false`) + reproduction; Architecture Review has 3 alternatives + validated Decision; checklist all [x]; TC-01…TC-06 command/observable; one Test Plan row per TC (no `manual`). No third-party product named (prior-art reviewed conceptually only).
- **GATE-APPROVAL — PASS (2026-07-06).** Design iterated with owner across the session: NL create-and-run in one step (re-run optional), existing nodes + on-the-fly prompt nodes, model-invocable, active provider; fresh design (dag-cli `describe` is a reference not a template); prior-art concepts adopted without naming the product; storage de-jargoned to `.workflows/` (flat `.json` + `nodes/`). Owner sign-off, verbatim: **"승인함"**. Implementation authorized (phased).
- **Phase 1a — SHIPPED (2026-07-06, commit 3e4ae929b).** Workspace layout parameterized (default `.workflows/`); persistence/catalog/walk-up consume it. dag-cli 1007 + agent-command-workflows 9 tests, 45 scans, live UE (`save`→`catalog run`, `scaffold`→`run` incl. subdir walk-up) all consistent on `.workflows/`.
- **ARCHITECTURE REVIEW — PASS (2026-07-06).** Audited existing dag-\* (clean layering; functional/decentralized composition — thin `runDagCli` dispatcher, pure-function commands; **fragmentation: 3 workflow-read paths**) and the Phase-1a impl (parameterized/injectable but not yet threaded from composition roots; default repeated per-function). Re-proposed the canonical injection (options-threading + single per-product resolution root + shared reader). Owner chose scope **"b"** — C1 injection wiring + C2 receivers + C3 unify the 3 readers into one `dag-framework` workspace-catalog. Verbatim: **"b"**. Phase 1b authorized.
- **Phases 2–4 — IMPLEMENTED (2026-07-06, branch `feat/workflows-nl-authoring`).** NL authoring built in `agent-command-workflows`: `create-command.ts` orchestrates node-catalog (`authoring/node-catalog.ts`, manifests via `buildNodeDefinitionAssembly`) → author via the **active provider** (`authoring/author.ts`, `createProviderFromSettings` + injected `providerDefinitions`; JSON-only spec) → validate (`authoring/spec.ts`) → assemble (`authoring/assemble.ts`, `buildDagFromPipeline`) → save legible `IDagDefinition` (`persistence/workspace-writer.ts`) → run (`authoring/execute-workflow.ts`, converts to workflow-file via `toDagWorkflowFile`). **Phase 3:** `newNodes` → `createPromptBackedNodeDefinition`, saved to `.workflows/nodes/` and reloaded by `persistence/instant-node-loader.ts` (reused on later `create`; `run` reloads them too). **Phase 4:** `workflows` + `create` are `modelInvocable: true` (kind `builtin-command`); `providerDefinitions` threaded from agent-cli `command-setup.ts`. The resolved run input is baked into the artifact's `input` node so a bare re-run reproduces. 24 unit tests (injected provider stub), 45/45 scans, 0 lint errors, agent-cli typecheck green. **Live UE (compiled dist):** TC-02/03 `input|text-upper|text-output` authored→saved→ran→`HELLO FROM A LIVE RUN`, self-contained re-run reproduced it; TC-05 prompt node saved to `.workflows/nodes/` + reused, missing-key run surfaced a clear actionable error with the saved path. (Live LLM authoring + live prompt-node run require a provider key — unavailable in this environment — so the network LLM call is stubbed; every deterministic layer runs live.)
- **Phase 1b — DONE (2026-07-06).** C3 shared reader `scanWorkspaceCatalog` in `dag-framework` (commit 714b9a272) now backs all three former read paths (persistence `loadWorkflows`, dag-cli `catalog-scanner`, `/workflows catalog`). C2 receiver: `LocalDagRuntimeProvider` accepts `workspace`. C1 injection: `/workflows` command module resolves+threads `workspace` (commit d225fef12); **dag-cli** resolves a leading `--workspace <dir>` global flag at the `runDagCli` composition root and threads the layout to run/save/catalog/node (commit 75062cc57). dag-cli 1007 tests + agent-command-workflows green, 45 scans, 0 lint errors. **Live UE:** a custom `--workspace .myws` round-trip — `save` → `catalog list` → `catalog run` (correct output) → `node scaffold` — all read/write `.myws/` while the default `.workflows/` stays untouched (isolation confirmed). Phase 1 complete.
