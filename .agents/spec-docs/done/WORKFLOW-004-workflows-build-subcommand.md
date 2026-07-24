---
status: approved
type: FLOW
tags: [cli, agent]
capability: true
user_execution: agent-run
user_execution_scenario: .agents/evals/scenarios/workflow-004-build-agent-run.md
---

# WORKFLOW-004: `workflows build` subcommand — LLM-assisted authoring without execution

## Problem

The `workflows` command module ships `create` / `list` / `catalog` / `validate` / `run`
(`packages/agent-command-workflows/src/workflows-command-module.ts:24-67` — `SUBCOMMANDS` + `USAGE`).
The `build` subcommand — deferred from WORKFLOW-003 TC-01 ("needs an LLM-integration path, i.e. how a
command module reaches the session's model provider") — still does not exist:
`rg -n '"build"' packages/agent-command-workflows/src` → 0 hits, and `/workflows build …` returns
`Unknown subcommand "build"` (`workflows-command-module.ts:99-100`).

Since the backlog item was filed, FLOW-007 shipped `/workflows create`, which DID resolve the
LLM-integration question for its own path: it authors a workflow from natural language via the active
provider. But `create` is create-AND-RUN by contract: after saving, it always executes the workflow
in-process (`create-command.ts:296` `executeDefinition(...)`) — there is no author-without-run path.
Concretely:

- **Symptom:** a user (or the agent, via the model-invocable `create`) cannot scaffold a workflow,
  review the saved artifact, and only then run it. Any authoring request immediately executes the
  freshly generated graph — including prompt-backed LLM nodes (real provider calls, cost) and
  side-effecting nodes (e.g. media-generation nodes) that the user never saw before they ran.
- **Reproduction:** in agent-cli, `/workflows` prints
  `Usage: /workflows <create|list|catalog|validate|run>`; the only authoring entry is `create`, whose
  success path reports run outputs unconditionally (`create-command.ts:305-308`).

This spec (a) adds `build` — author → validate → save, **never execute** — and (b) records the
provider-seam decision WORKFLOW-003 deferred, now weighed against the two seams that exist in code
today (FLOW-007's authoring seam; CMD-004's `ICommandHostAdapters`).

## Prior Art Research

Comparable products separate **generation** from **execution**: assisted authoring produces a
reviewable artifact; running it is a distinct, explicit step.

- **n8n — AI Workflow Builder** (<https://docs.n8n.io/build/ways-of-building-workflows/ai-workflow-builder>):
  natural-language description → the builder constructs the workflow (node selection, placement,
  configuration) on the canvas, then the documented step 3 is review, not execution: "Review required
  credentials and other parameters. Refine the workflow using prompts." Generation ends at a
  reviewable graph; the user runs it separately.
- **GitHub Actions — workflow templates** (<https://docs.github.com/en/actions/writing-workflows/using-workflow-templates>):
  the "Choose a workflow" page scaffolds a starter workflow YAML which the user edits and then
  commits ("Click **Start commit**", "Write a commit message") — the scaffolded file is reviewed and
  committed, never run as part of scaffolding.
- **Claude Code — subagent authoring** (<https://code.claude.com/docs/en/sub-agents>): the model
  generates the agent definition as a file on disk and the docs make review the next step: "Open
  `~/.claude/agents/code-improver.md` and confirm the frontmatter matches what you asked for." /
  "Use them as starting points, or generate a customized version with Claude."

**Constraint applied to Robota:** the observed common shape is _generate → inspect/refine → run
explicitly_. Robota already has the _generate-and-run-now_ shape (`create`, owner-approved in
FLOW-007); `build` supplies the missing _generate-for-review_ shape, reusing the same authoring
pipeline and handing off to the existing `validate`/`run` subcommands for the explicit next steps.
(Internal prior art: dag-cli's `describe` was already rejected as a template in FLOW-007 — hardcoded
provider — and stays rejected here.)

## Architecture Review

### Affected Scope

- **`packages/agent-command-workflows` only (additive).** New `src/build-command.ts` composed from the
  existing FLOW-007 authoring modules (`authoring/author.ts`, `authoring/spec.ts`,
  `authoring/assemble.ts`, `authoring/node-catalog.ts`, `persistence/workspace-writer.ts`,
  `persistence/instant-node-loader.ts`); dispatch + `SUBCOMMANDS` + `USAGE` rows in
  `workflows-command-module.ts`; tests. No re-architecting of shipped subcommands (backlog
  constraint).
- **No framework or composition change.** The module already receives everything `build` needs:
  agent-cli's `packages/agent-cli/src/startup/command-setup.ts:36-41` threads `providerDefinitions` into
  `createWorkflowsCommandModule({ providerDefinitions })` (FLOW-007 C1), and provider resolution is
  lazy at invocation time. `agent-framework`'s command-api is untouched.
- **On-disk formats.** `build` **writes** the legible `IDagDefinition` format only — the same
  `saveWorkflowFile` that `create` uses (`persistence/workspace-writer.ts:17-26`). The **read** side
  already accepts both supported formats and is not changed: `validate` detects and converts
  (`validate-command.ts:40-49`, `isWorkflowFileFormat`/`isLegacyDefinitionFormat` from
  `dag-builder`), and `run` converts on read (`run-command.ts` `readDagFile`). One write format, dual
  read format — identical to shipped behavior, no new format surface.

### The provider seam (the deferred central decision)

How an `ICommandModule` reaches the session's model provider. Three real options exist in code:

- **(a) FLOW-007 authoring seam (exists, proven).** Deps injected at the composition root
  (`IWorkflowsCommandModuleDeps.providerDefinitions`), provider resolved lazily per invocation via
  `createProviderFromSettings(cwd, undefined, { providerDefinitions })` + model from
  `readProviderSettings` (`create-command.ts:205-228`), with a `resolveProvider` test seam
  (`create-command.ts:39-49`). The module sees only the `IAIProvider` / `IProviderDefinition`
  abstractions from `agent-core`.
- **(b) `ICommandHostAdapters` extension (CMD-004).** Commands can reach host-wired adapters via
  `context.getCommandHostAdapters?.()` (`agent-framework/src/command-api/host-context.ts:158`);
  the adapter set today is `settings` / `process` / `permissionMode` / `plugin` / `remoteControl`
  (`agent-framework/src/command-api/host-adapters.ts:72-78`, landed via PR #1338). A new
  `model`/`authoring` adapter (e.g. `chat(messages, options)` bound to the live session's provider)
  would be the host-adapter-shaped answer.
- **(c) Direct provider injection into the module registry.** Construct the module with a resolved
  `IAIProvider` instance at startup.

### Alternatives Considered

1. **Seam (a) — reuse the FLOW-007 authoring seam (chosen).**
   Pro: already shipped and live-verified (FLOW-007 evidence: 5/5 real-LLM scenarios); one seam for
   both authoring subcommands (`create` + `build`) — no divergence; neutral (module imports zero
   concrete provider packages — the only `agent-provider-defaults` import in the package is the
   opt-in live test); works identically on every surface (`create` already runs in TUI/print/serve,
   since resolution needs only `cwd`); zero framework-contract growth.
   Con: resolves the provider from **settings** at invocation, so a live in-session model switch
   (`ICommandSessionRuntime.applyModelOptions`, PRESET-013) is not reflected — a fidelity gap, but
   one `create` already has; introducing a second seam only for `build` would make the two authoring
   paths diverge, which is worse than sharing the gap and closing it once for both (see Decision).
2. **Seam (b) — add a `model` adapter to `ICommandHostAdapters`.**
   Pro: session-live fidelity (the host wires the adapter to the running session's provider/model);
   consistent with CMD-004's "host executes host-owned actions" architecture; one framework seam any
   future module could use.
   Con: CMD-004's adapters are host-owned **state actions** (settings write, process exit,
   permission mode, remote-control enable/stop) — an LLM chat call is a capability call, not host
   state; adding `chat()` to the framework command-api duplicates the provider abstraction
   `agent-core` already owns (a second way to reach a provider); `build` alone does not justify
   widening the framework contract while CMD-004 is still `active/`; and unless `create` migrates in
   the same change, the package carries two live provider seams. Rejected **for now** — designated
   as the migration target if session-live authoring fidelity becomes a requirement (then `create` +
   `build` move together in one follow-up).
3. **Seam (c) — inject a resolved `IAIProvider` instance at module construction.**
   Pro: simplest call site. Con: freezes the provider at startup (composition happens once in
   `command-setup.ts`; later settings/session changes are never seen); constructs a provider even
   for sessions that never author; FLOW-007 explicitly chose lazy per-invocation resolution over
   this. Rejected.
4. **Surface: `create --no-run` flag instead of a `build` subcommand.**
   Pro: no new subcommand; trivially shares everything. Con: inverts `create`'s owner-approved
   FLOW-007 contract ("create-and-run in one step") behind a flag — the same verb would either run or
   not run depending on an option, which is exactly the ambiguity the prior art avoids by separating
   the verbs; the deferred surface is named `build` in WORKFLOW-003 TC-01 and the backlog. Rejected.
5. **Surface: reject WORKFLOW-004 as subsumed by FLOW-007.**
   Pro: honest about the overlap — `create` did resolve LLM-assisted authoring. Con: the
   author-without-run gap is real (Problem above): every authoring path today executes unreviewed,
   side-effecting graphs immediately; prior art treats generate-for-review as the default shape.
   Rejected — but the overlap is why `build` is specified as a thin recomposition, not a parallel
   pipeline.

### Decision

**`build` = author → assemble → validate → save — never execute**, added to
`agent-command-workflows` as a recomposition of the FLOW-007 authoring pipeline, using **seam (a)**
(injected `providerDefinitions`, lazy `createProviderFromSettings` resolution, `resolveProvider`
test seam) — the trade-off that drove the choice is _one proven neutral seam shared by both
authoring subcommands_ over _framework-contract growth for a single consumer_ (seam b) and over
_startup-frozen resolution_ (seam c).

- `/workflows build "<description>" [--input key=value ...] [--name <name>]`: resolve the active
  provider **first** (no provider → actionable error, nothing written — the shipped TC-04 contract);
  author the spec (`authorWorkflowSpec`); parse + validate (`parseAuthoredSpec`); assemble
  deterministically (`assembleWorkflow`) — assembly failure means nothing is written; bake
  `--input`/`sampleInput` into the artifact's `input` node (same self-containment rule as `create`);
  save any authored prompt-backed `newNodes` to `<workspace>/nodes/` (inert definitions — persisting
  them executes nothing) and the workflow to `<workspace>/<name>.json`; report the saved path, node/
  edge counts, and the explicit next steps (`/workflows validate <path>`, `/workflows run <path>`).
- **No execution path exists in `build`** — it does not import/invoke
  `authoring/execute-workflow.ts`. That is the whole delta vs `create`, and the test plan pins it.
- **Formats:** write legible `IDagDefinition` only (identical to `create`); reading both formats
  stays where it already lives (`validate`/`run`).
- **`modelInvocable: true`** — the agent may scaffold a reviewable workflow from chat; strictly less
  privileged than the already-model-invocable `create` (it cannot execute anything).
- **Neutrality:** the module keeps zero concrete-provider imports; provider knowledge stays behind
  `IAIProvider`/`IProviderDefinition` + the composition root, per the command-module isolation rules
  WORKFLOW-003 established (and TC-06 re-pins the `dag-cli` boundary).
- **Tracked follow-up (not this spec):** if session-live authoring fidelity is required (live
  `/preset` model switches affecting authoring), migrate `create` **and** `build` together onto a
  CMD-004 `model` host adapter in one change, after CMD-004 completes.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `packages/agent-command-workflows` only; framework/composition untouched (Affected Scope).
- [x] Sibling scan 완료 — siblings are the shipped subcommand family (`create`/`list`/`catalog`/`validate`/`run`) and the FLOW-007 authoring modules; `build` joins the family reusing the same authoring pipeline, persistence writer, and provider seam. New-surface placement: N/A — no new package/app/surface; additive subcommand inside an existing module.
- [x] 대안 최소 2개 검토 완료 — 5 (3 provider seams + 2 surface alternatives), each pro/con.
- [x] 결정 근거 문서화 완료 — one shared proven seam over framework growth; author-without-run delta pinned; formats unchanged.

## Fallback & Degradation Declaration

None. `build` reuses the module's existing never-throw contract — every failure (bad args, no
provider, invalid/unassemblable spec, write failure) is a **failed `ICommandResult`** (blessed
error-RESULT return, not a silent fallback). The only sanctioned catch→result site it reuses is the
already-declared `// allow-fallback` in `authoring/author.ts` (provider/transport failure →
structured authoring error); this change introduces no new fallback site.

## Solution

Single stage (P1); each numbered step lands red-first (see Test Plan).

1. `src/build-command.ts` — `executeWorkflowsBuild(argStr, cwd, deps)` with an
   `IWorkflowsCreateDeps`-shaped deps seam (workspace, providerDefinitions, `resolveProvider`,
   `model`, `now`); flow per Decision; shares `parseCreateArgs` (identical arg grammar).
2. `workflows-command-module.ts` — `build` in `SUBCOMMANDS` (modelInvocable: true) + `USAGE` + the
   dispatch `switch`.
3. Tests — `src/__tests__/build-command.test.ts` (stub provider via `resolveProvider`) + module
   dispatch rows; opt-in live scenario appended to `create-command.live.test.ts` pattern only if a
   key is available (not gating).
4. `packages/agent-command-workflows/docs/SPEC.md` — document the new subcommand + the provider-seam
   decision.

Deferred (explicit non-goal, needs its own item if wanted): `build <file> "<refinement>"` —
LLM-assisted editing of an existing workflow file.

## Affected Files

- New: `packages/agent-command-workflows/src/build-command.ts`,
  `packages/agent-command-workflows/src/__tests__/build-command.test.ts`,
  `.agents/evals/scenarios/workflow-004-build-agent-run.md` (agent-run UE evidence, at completion).
- Edited: `packages/agent-command-workflows/src/workflows-command-module.ts` (+ its test),
  `packages/agent-command-workflows/src/create-command.ts` only if `parseCreateArgs` is exported
  from a shared location, `packages/agent-command-workflows/docs/SPEC.md`.

## Completion Criteria

- [ ] TC-01: with a stubbed provider (`resolveProvider` deps seam), `/workflows build "uppercase the
text" --input text=hi` saves `<workspace>/<name>.json` and returns success whose message
      contains the saved path and NO run output; the test proves non-execution mechanically (the DAG
      runtime/execute path is never invoked — spy/canary asserts 0 calls), red-first: this test fails
      before `build-command.ts` exists.
- [ ] TC-02: the artifact TC-01 produced round-trips through the existing subcommands unmodified —
      `/workflows validate <path>` reports valid and `/workflows run <path>` executes it with the
      baked input producing the expected output.
- [ ] TC-03: a stub provider returning an invalid/unassemblable spec → failed result naming the
      validation error, and `<workspace>/` receives no new file (fs asserted before/after).
- [ ] TC-04: with no provider configured (no deps seam, no settings), `/workflows build "…"` returns
      the actionable no-provider error and writes nothing.
- [ ] TC-05: a stub spec with `newNodes` → the prompt-backed node manifest is saved under
      `<workspace>/nodes/`, the saved workflow references it, and still nothing executes.
- [ ] TC-06: boundaries hold — `rg -l "@robota-sdk/dag-cli" packages/agent-*/src` → 0;
      `rg -l "@robota-sdk/agent-provider-" packages/agent-command-workflows/src --glob '!**/__tests__/**'`
      → 0 (single prefix covers `agent-provider-defaults` AND every concrete `agent-provider-*`;
      the GATE-APPROVAL review found the draft's original `\|`-alternation pattern was mechanically
      unfailable — rg treats `\|` as a literal pipe — and its second alternative named a nonexistent
      package prefix). **Proven-can-fail requirement:** at IMPLEMENT, plant a violating
      `agent-provider-defaults` import once, observe the rg hit, remove it — same red-first
      discipline as TC-01; `pnpm --filter @robota-sdk/agent-command-workflows typecheck`
      and `test` exit 0; `pnpm harness:scan` exit 0.

## Test Plan

FLOW + cli/agent → module dispatch + integration on the deps seam; LLM authoring is deterministic in
tests via the injected `resolveProvider` stub (the established FLOW-007 pattern —
`create-command.test.ts`); every TC is automated (no manual rows); TC-01 is written red-first.

| TC-ID | Test Type   | Tool / Approach                                                                | Notes                       |
| ----- | ----------- | ------------------------------------------------------------------------------ | --------------------------- |
| TC-01 | Integration | vitest — stub provider; assert save + message; execution spy/canary at 0 calls | red-first                   |
| TC-02 | Integration | vitest — validate + run the TC-01 artifact via the existing executors          | round-trip                  |
| TC-03 | Integration | vitest — stub emits invalid spec; assert failed result + no fs write           | validate-before-save        |
| TC-04 | Unit        | vitest — no-provider path: actionable error, no write                          | mirrors FLOW-007 TC-04      |
| TC-05 | Integration | vitest — stub emits `newNodes`; assert node manifest saved, no execution       | inert persistence           |
| TC-06 | RULE/INFRA  | `rg` boundary asserts + typecheck/test + `harness:scan` exit codes             | neutrality + dag-cli bounds |

## User Execution Test Scenarios

Agent-run (HARNESS-030; evidence file `.agents/evals/scenarios/workflow-004-build-agent-run.md`
written at GATE-COMPLETE):

- Prereq: built agent-cli with a configured provider, in a scratch project.
- Steps: run `robota`; `/workflows build "trim then uppercase the input text" --input text=" hi "`;
  open and inspect the saved `.workflows/<name>.json` (no run occurred); `/workflows validate <path>`;
  `/workflows run <path>`; `/workflows catalog`.
- Expected: `build` reports the saved path with next-step hints and produces no run output; the file
  validates cleanly; `run` outputs `HI`; the workflow appears in the catalog. A failure at any step
  surfaces an actionable error naming the artifact path.

## Tasks

- [ ] `.agents/tasks/WORKFLOW-004.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-APPROVAL] — REVISE → revisions folded → approved | 2026-07-25

- Independent proposal-reviewer verdict: **REVISE** — every load-bearing premise verified in code
  (create's unconditional `executeDefinition`, the FLOW-007 seam at the cited lines, the CMD-004
  host-adapters characterization, provider-neutral runtime deps, dual-read/legible-write). The
  decision set (seam (a); separate `build` verb; never-execute contract; joint create+build
  migration to a CMD-004 `model` adapter as the named follow-up) was endorsed as correct.
- One blocking defect, folded: TC-06's neutrality gate was mechanically unfailable — rg treats
  `\|` as a literal pipe, and `@robota-sdk/provider-` matches no real package. Replaced with the
  single-prefix `@robota-sdk/agent-provider-` pattern plus an explicit proven-can-fail step at
  IMPLEMENT (plant → observe hit → remove).
- Minor precision fold-in: composition-root citation now uses the full
  `packages/agent-cli/src/startup/command-setup.ts:36-41` path.
- Approved on the reviewer's conditional; `status: approved`, moved draft → todo.
