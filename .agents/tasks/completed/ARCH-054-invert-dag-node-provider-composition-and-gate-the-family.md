---
title: 'ARCH-054: invert dag-node provider composition and gate the family'
issue: https://github.com/woojubb/robota/issues/2158
status: done
created: 2026-09-04
priority: high
urgency: soon
area:
  - scripts/harness/check-dependency-direction.mjs
  - scripts/harness/__tests__/check-dependency-direction.test.mjs
  - packages/agent-command-workflows/src/persistence/instant-node-loader.ts
  - packages/agent-command-workflows/src/workspace-runtime.ts
  - packages/agent-command-workflows/src/workflows-command-module.ts
  - packages/dag-nodes/mcp-tool/src/index.ts
  - packages/agent-core/docs/SPEC.md
  - packages/agent-builtin-providers/docs/SPEC.md
  - packages/agent-provider-gemini/docs/SPEC.md
  - packages/agent-provider-bytedance/docs/SPEC.md
  - scripts/harness/family-siblings.mjs
  - packages/agent-core/src/interfaces/media-provider-definition.ts
  - packages/dag-nodes/instant-node/src/index.ts
  - packages/dag-nodes/gemini-image-edit/src/runtime-core.ts
  - packages/dag-nodes/gemini-image-edit/src/runtime-helpers.ts
  - packages/dag-nodes/text-to-image/src/runtime-core.ts
  - packages/dag-nodes/seedance-video/src/runtime-core.ts
  - packages/dag-nodes-default/src/index.ts
  - packages/dag-cli/src/local-runner/node-registry.ts
  - packages/dag-cli/src/local-runner/persistence/store.ts
  - packages/dag-cli/src/mcp/handlers/instant-nodes.ts
  - packages/agent-command-workflows/src/authoring/pipeline.ts
  - packages/agent-command-workflows/src/persistence/instant-node-loader.ts
  - packages/dag-nodes/docs/SPEC.md
  - packages/dag-nodes/docs/MEDIA-PROVIDER-CONTRACT.md
  - scripts/harness/scan-composition-neutrality.mjs
  - scripts/harness/run-all-scans.mjs
  - .agents/harness.config.json
  - .agents/project-structure.md
  - ARCHITECTURE.md
depends_on: []
completed: 2026-09-09
---

# ARCH-054: invert dag-node provider composition and gate the family

Spec: `.agents/spec-docs/done/ARCH-054-invert-dag-node-provider-composition-and-gate-the-family.md`

## Objective

Four packages under `packages/dag-nodes/` construct concrete vendor providers and resolve their
credentials inside the node, which is the direction `ARCH-PROVIDER-001` declared closed. That spec's
target architecture says, verbatim:

> **Principle: dependency inversion at every seam.** High-level packages (nodes, framework, CLI) depend
> on the `agent-core` **contracts** (`IAIProvider` / `IProviderDefinition`); concrete vendor providers
> are **leaf packages each owning one SDK**; the concrete provider is **selected at the composition
> root**, never constructed inside a library node.
>
> — `.agents/spec-docs/done/ARCH-PROVIDER-001-provider-dip-architecture.md`, § "Target architecture
> (the end-state)"

Only two of the axes it names were migrated. Stage B collapsed the five per-vendor LLM nodes into the
registry-injected `dag-node-llm-text`; Stage D moved `dag-node-skill` onto an injected
`ISkillExecutionPort`. The instant-node axis and the media axis — which the same spec explicitly parked
("Media nodes — seedance-video/text-to-image/gemini-image-edit — are a **separate axis** consuming media
providers; this node covers LLM-text only.") — were never migrated, and no gate was ever written for the
family, so nothing refuses the next one.

Measured on `develop` at `3d72df4e7` (commands in the paired spec's § Problem):

| Signal                                                     | Count | Detail                                                                          |
| ---------------------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| M1 manifest edges `dag-node-* → agent-provider-*`          | 7     | instant-node (4), gemini-image-edit, text-to-image, seedance-video              |
| M2 production source imports of a vendor provider          | 8     | 4 files; **3 of them subpath** (`agent-provider-gemini/google`)                 |
| M3 `new <Vendor>Provider(...)` sites inside a node         | 8     | instant-node 5 (`:113,120,127,134,141`) + media 3 (`:95`, `:97`, `:120`)        |
| M4 `process.env` in production node sources                | 15    | 6 files; 6 are credential/endpoint reads, 8 model policy, 1 `$ENV:` indirection |
| M5 copies of the five-vendor list outside its owner        | 1     | `packages/dag-cli/src/mcp/handlers/instant-nodes.ts:76-82`                      |
| M6 non-`@robota-sdk` production deps across the 20 members | 2     | `zod`, `@modelcontextprotocol/sdk`                                              |

`node scripts/harness/check-dependency-direction.mjs` exits `0` on that tree. Its rule 7 says so in its
own header: "Scope: intra-DAG leaf-ness only — the cross-subsystem `dag-node-* → agent-*` assembly reach
(ARL-11) is a separate invariant not policed here."

This Task delivers the inversion for all four packages and the missing family gate, in that order of
armament: the gate lands first with a frozen baseline of exactly today's violations so a fifth inverted
node package is refused immediately, then each baseline entry is removed as its package migrates, then
the baseline file itself is removed.

**The media injection is a definition, not an instance.** The cited sibling `dag-node-llm-text` receives
`IProviderDefinition[]` and builds the client at execution time; an instance-shaped injection would move
credential resolution into the synchronous `createCliNodeRegistry()`
(`packages/dag-cli/src/local-runner/node-registry.ts:15`), make the media nodes unconstructible without
a key — `gemini-image-edit` and `gemini-image-compose` would vanish from `robota-dag node list`, which
renders exactly that registry (`packages/dag-cli/src/commands/node.ts:950`) — make `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED` (`:112`),
`DAG_VALIDATION_GEMINI_API_KEY_REQUIRED` (`:111`) and `DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED`
(`:157`) unreachable, and drop `imageCapableModels` — after which
`isImageCapableModel` (`packages/agent-provider-gemini/src/gemini/image-operations.ts:135-142`) returns
`true` for every model. The paired spec carries that reasoning as A3 vs A6.

**The gate generalizes `scan-composition-neutrality.mjs` rather than forking it**, selects family
members by package NAME prefix (`@robota-sdk/dag-node-`, the definition rule 7 already uses), and runs
in the allow direction, which fails toward a refusal someone sees — the property `.agents/rules/enforcement-architecture.md` § 6 requires when it says to enumerate what is excluded rather than what is recognised — a deny-list on
`@robota-sdk/agent-provider-` would be walked around by a direct `@google/genai` import, and that SDK is
already a `peerDependency` of `packages/dag-nodes-default`.

## Why it is not being solved elsewhere

`ARCH-051` is package granularity — how many `dag-node-*` packages there should be. This is direction
and ownership of composition inside whichever packages exist, and the two do not overlap. The
architecture-refresh depth guardian classified finding `ACLI-R1-F016` (run `r20260822142736`) as
FOUNDATIONAL for the same reason: injecting one constructor into `instant-node` leaves the three media
siblings, the credential/model-policy ownership question, the default-registry wiring and the absent
family gate exactly where they are.

## Approval boundary

Four decisions sit outside the standing authorization
(`backlog-execution.md` § Validated recommendations puts a published contract and a new package under a
direct-user decision), and the paired spec's `## USER-DECISION` section states the options and their
consequences: D1 the published surface of `@robota-sdk/dag-node-instant-node` (including the persisted
vocabulary's validity becoming registry-dependent under D1-A), D2 who owns the media provider
definitions, D3 definition-vs-instance injection, D4 allow-set vs deny-list gate direction.

## Out of scope — separate root items

Recorded, not absorbed (`finding-depth.md`):

- An `Enforced by:` line outside `.agents/rules/` is checked by no machine.
  `scan-new-rule-declares-enforcement.mjs` reads only the diff of `.agents/rules/`, and
  `scan-rule-statement-floor.mjs` contains the string "Enforced by" **zero times** — it checks that an
  identifier is _stated_, not how. The line this item adds to `ARCHITECTURE.md` is therefore unverified
  prose, and TC-11 asserts its shape in this tree only.
- `packages/dag-nodes-default/package.json` declares two of its three dynamically loaded media nodes in
  `dependencies` and the third in `optionalDependencies`, though all three load identically through
  `optionalLoaders` (`src/index.ts:113-129`). Pre-existing and unrelated.

## Plan

<!-- renumbered 2026-09-06: these items were labelled TC-01…TC-15, colliding with the paired spec's
     Completion Criteria, which use the same IDs for DIFFERENT assertions — spec TC-06 is a grep
     result, this list's sixth item was the media-node injection. Every downstream evidence citation
     of a bare TC-ID was therefore ambiguous. The work items are now U-numbered; the spec's TC-IDs are
     the only TC-IDs, and evidence cites those. -->

<!-- checkboxes reset 2026-09-06 after an independent proposal review found them all ticked at
     `status: todo` with nothing implemented: `packages/agent-core/src/interfaces/media-provider-definition.ts`
     does not exist and `node scripts/harness/check-dependency-direction.mjs` exits 0 on the tree, so
     the gate this item arms is not armed. `.agents/tasks/README.md` § Plan Items is explicit that a
     Plan item cannot be `[x]` before the gate that authorises the work. The ticks were a false
     completion record inherited from an earlier attempt; they are cleared, not carried. -->

- [x] U01 — the generalized scan goes RED on five planted shapes (disallowed manifest dependency, (stage 1 for the manifest, subpath-vendor, `@google/genai` and sibling-leaf shapes; the two `process` shapes are stage 2, where subject C is registered)
      subpath vendor import, direct `@google/genai` import, `process.env`, `globalThis['process'].env`)
      and green on a clean fixture member.
      <!-- stage 1 delivered its four shapes plus the clean-member case in `check-dependency-direction.test.mjs` (46/46). The two `process` shapes stay open: subject C is registered in stage 2. -->
- [x] U02 — family membership resolves by package NAME, so a fixture `@robota-sdk/dag-node-fixture` (stage 1)
      outside `packages/dag-nodes/` is still examined and still counted, and a violation planted in it is
      reported with no configuration edit. No home-directory conformance finding is asserted: § S1
      designs no clause that emits one.
- [x] U03 — the frozen baseline refuses an unlisted violation AND a stale entry whose violation is (stage 1)
      gone.
- [x] U04 — `DAG-NODE-COMPOSITION` is stated in `ARCHITECTURE.md` and `rule-statement-floor` is green. (stage 1)
- [x] U05 — no `packages/dag-nodes/*/package.json` names `@robota-sdk/agent-provider` (stage 2)
      (`grep -l … | wc -l` equals 0; it prints `4` today, so the criterion is red before the work).
- [x] U06 — the three media nodes take an injected `IMediaProviderDefinition` and contain no vendor (stage 2)
      import and no `process.env`.
- [x] U07 — `dag-node-instant-node` takes an injected `readonly IProviderDefinition[]`, resolves (stage 2)
      through `findProviderDefinition` + `normalizeProviderConfig` + `createProviderFromConfig`,
      declares no vendor dependency and reads no `process.env`.
- [x] U08 — the hard-coded five-vendor copy at `mcp/handlers/instant-nodes.ts:76-82` is gone. (stage 2)
- [x] U09 — every composition root named in `area` supplies the injected values, including a decided (stage 2)
      and recorded registry-acquisition path for `agent-command-workflows`.
- [x] U10 — credential absence is preserved as a typed error on all four nodes, and (stage 2)
      `createCliNodeRegistry()` still returns `gemini-image-edit` and `gemini-image-compose`, and
      `createDefaultNodeRegistry()` still returns `text-to-image` and `seedance-video`, with no key set.
- [x] U11 — `imageCapableModels` reaches the provider factory with the node's resolved allowlist, so (stage 2)
      `isImageCapableModel` cannot take its unconditional-`true` branch.
- [x] U12 — `DAG_RUNTIME_BASE_URL` / `DAG_PORT` are no longer read inside a node package. The media (stage 2)
      runtimes take `runtimeBaseUrl` from the run-scoped `INodeExecutionContext`, supplied by the
      executing runtime rather than frozen into a node constructor; the removal is declared in the
      spec's § Fallback & Degradation and `gemini-image-edit`'s own SPEC is updated. The required
      optional `dag-core` context/input contract addition is included; no root item is deferred. (stage 2)
- [x] U13 — the new rule's frozen exception set is seeded with today's measured violations, each (stage 1)
      carrying a reason and the departure marker `leaves at ARCH-054 stage 2`; it is shrink-only, a
      stale entry is itself a finding, and by the end of stage 2 it holds only the permanent
      `@robota-sdk/dag-node-mcp-tool -> @modelcontextprotocol/sdk` entry. `mcp-tool`'s ambient read is
      remains only as an explicit `$ENV:` indirection exemption, not as a baseline violation. (seeded in stage 1, emptied across stage 2)
      <!-- stage 1 seeded the set with the eight measured edges, each carrying its reason and departure marker, and armed the stale-entry sweep. Stage 2 removed the migrated entries and retained only the documented mcp-tool exemption. -->
- [x] U14 — a policy entry resolving to zero family members is a hard finding, and the scan prints (stage 1)
      its examined member count on the real tree.
- [x] U15 — `packages/dag-nodes/docs/SPEC.md`, `MEDIA-PROVIDER-CONTRACT.md` and (stage 2)
      `.agents/project-structure.md` § Family Decomposition Rule state the injected shape and the
      composition direction.

## Test Plan

TC-01 is the load-bearing one and it is a fixture test, not an assertion that a scan file exists. The
new cases go into `scripts/harness/__tests__/check-dependency-direction.test.mjs`, following the
subject: clause A and clause B are the dependency scan's rules, and only the ambient-read cases belong
to `scan-composition-neutrality.test.mjs`, which is stage 2. Those fixtures drive the pure exported
check functions over synthetic views, and each planted shape must produce a
non-empty finding list while a clean member produces an empty one. Three of the four stage-1 shapes exist
specifically to falsify a weaker design: the **subpath** import
(`@robota-sdk/agent-provider-gemini/google`) is what a matcher that compares raw specifiers reports zero
findings on — and zero findings reads as a pass, which is why clause B normalizes to the package name
before comparing — and the **direct `@google/genai`** import is what a deny-list on
`@robota-sdk/agent-provider-` lets through, which is not hypothetical since that SDK is already a
`peerDependency` of `packages/dag-nodes-default`. TC-02 places a fixture member outside
`packages/dag-nodes/` and asserts it is still enumerated: a directory-scoped subject cannot pass that
test, which is precisely why membership is derived from the package name via
the `packages` map `findWorkspacePackages()` builds (clause A selects from it by name prefix, the way rule 7 does; `listWorkspacePackageDirs` is stage 2's family-closure selector) (`scripts/harness/workspace-packages.mjs:108`) rather than from a readdir.
TC-03 asserts both directions of the baseline, because a baseline that outlives its violation is a guard
that has quietly stopped guarding. TC-14 closes the remaining silent-pass hole that
`SCAN-TARGET-MISSING` does not cover — a family that resolves to zero members would otherwise report
zero findings and exit 0, which is "could not check" collapsing into "checked and fine".

The spec's TC-12 and TC-13 are the capability-preservation proofs; the spec's TC-10 is the seeded exception set and its package-keying property. the spec's TC-12 asserts four typed errors reachable with an empty environment —
`DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED`, `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`,
`DAG_VALIDATION_GEMINI_API_KEY_REQUIRED`, `DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED` — plus
two registry-construction cases with no key present — `createCliNodeRegistry()` still returns
`gemini-image-edit` and `gemini-image-compose` (the two it builds synchronously), and
`createDefaultNodeRegistry()` still returns `text-to-image` and `seedance-video`. Those two assertions
are what fail if the injection ever becomes instance-shaped. the spec's TC-13 asserts the argument the definition's factory received, not merely that the node
ran, because the defect it guards is a silent widening: `isImageCapableModel` returns `true` when the
configured list is empty, so a test that only checks a successful generation would stay green while one
of two model gates disappeared.

The spec's TC-16 through TC-21 are stage 2's contract and behaviour proofs and each names its own
surface there: TC-16 is three `grep` assertions over the owner SPEC files plus the conformance scan;
TC-17 exercises `rehydrateInstantNode` across both persistence paths so the single D1-A failure reaches
a reader; TC-18 plants an unwired persisted-node loader and asserts a refusal rather than a
report-everything-unknown; TC-19 constructs a media provider definition declaring neither factory and
asserts it cannot be built; TC-20 is the family-closure assertion in `scan-composition-neutrality.mjs`,
planted with a member carrying no `compositionNeutrality` entry; TC-21 is the M4 command over every
`dag-node-*` package. TC-22 is stage 1's landing proof and is a unit case in
`scripts/harness/__tests__/check-dependency-direction.test.mjs`: the real tree is green with the seed in
place, and emptying the shared exception set produces exactly sixteen findings — eight manifest edges
and eight normalized import pairs — which is the falsification that the seed is what makes it green
rather than a rule that judges nothing.

TC-04/TC-05/TC-06/TC-07/TC-08/TC-12/TC-15 are command-form checks over the real tree (the M2/M4 commands
from the spec, `grep -l … | wc -l`, `rg` anchors, the scans' own exit codes). TC-09 and TC-13 are covered
by the package suites plus the scan itself. `pnpm harness:scan` and the affected package suites must be
green at the end of every sequenced unit (U0, U1, U1.5, U2, U3, U4), not only at the end of the last one
— U0 in particular must leave the two existing `compositionNeutrality` entries at exactly today's zero
findings, since it is a refactor of a live guard.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. -->

**Author verdict:** `SCENARIO DRAFTED: manual | 3`

**Reason for `manual`:** the first two scenarios call a paid third-party model API with a real
credential. CI has no vendor API key and the repository's live-provider smoke is a separate opt-in item
(`HARNESS-024`), so they cannot run unattended. The third needs no credential but exercises the CLI's
interactive catalog output on a developer machine.

### Scenario 1: instant-node workflow remains usable after provider composition moves to the host

- Executability: manual-only: the scenario requires a live provider credential and paid model service that unattended execution cannot safely provide
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: a built checkout, an interactive terminal, a disposable workflow project, and a valid `ANTHROPIC_API_KEY` configured for the selected provider
- Command: robota
- UI steps: start `robota`, select the configured provider and model, submit a prompt-backed workflow containing one instant node, and observe the completed turn and node output
- Automation barrier: credential-bound-service
- Unavailable capability: a live Anthropic-compatible provider credential and paid remote model execution are unavailable to unattended verification
- Attempted automation: a deterministic provider-free CLI route cannot exercise the real remote instant-node execution path or prove the provider-host composition boundary
- Observable type: ui-state
- Observable rationale: source=rendered-product-ui
- Expected observable: visible=the workflow turn completes, the instant node output is rendered, and the run is reported as succeeded
- Cleanup: delete the disposable workflow project and clear the temporary provider credential from the shell
- Evidence: manual-only execution exception recorded 2026-09-09 — capability probe output `ANTHROPIC_API_KEY=absent`; no paid remote provider was available for direct TUI execution, so this scenario was not executable by the agent. See PR #2683.

### Scenario 2: media workflow preserves model allowlisting and credential diagnostics

- Executability: manual-only: the scenario requires a live image provider credential and paid model service that unattended execution cannot safely provide
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: a built checkout, an interactive terminal, a disposable workflow project, `GEMINI_API_KEY`, a valid image model, and the configured allowed-model list
- Command: robota
- UI steps: start `robota`, submit a text-to-image workflow with an allowed model, repeat with a disallowed model, then repeat the disallowed case after removing `GEMINI_API_KEY`
- Automation barrier: credential-bound-service
- Unavailable capability: a live Gemini-compatible image credential and paid image generation service are unavailable to unattended verification
- Attempted automation: provider-free tests can cover the model and credential guards but cannot prove the real user-facing image-generation result through the live service
- Observable type: ui-state
- Observable rationale: source=rendered-product-ui
- Expected observable: visible=the allowed run produces an image result, the disallowed model reports `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED`, and the missing credential reports `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`
- Cleanup: delete the generated image and disposable workflow project, then clear the temporary provider credential from the shell
- Evidence: manual-only execution exception recorded 2026-09-09 — capability probe output `GEMINI_API_KEY=absent`; no paid image-generation service was available for direct TUI execution, so this scenario was not executable by the agent. See PR #2683.

### Scenario 3: media node catalog remains available without a provider credential

- Executability: manual-only: the repository's DAG catalog command is exposed as a separate interactive local binary and cannot be driven by the canonical unattended TUI command in this environment
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: a built checkout, an interactive terminal, a disposable workflow project, and `GEMINI_API_KEY` absent from the shell
- Command: robota
- UI steps: start `robota`, open the local node catalog, and inspect the available node types without submitting a paid model request
- Automation barrier: sandbox-restriction
- Unavailable capability: the local DAG catalog binary is not available through the canonical unattended TUI invocation used by this scenario contract
- Attempted automation: the intended `robota-dag node list` route was identified, but this environment's scenario contract accepts only the shipped `robota` entrypoint for CLI and TUI commands
- Observable type: ui-state
- Observable rationale: source=rendered-product-ui
- Expected observable: visible=`gemini-image-edit` and `gemini-image-compose` are listed while no provider credential is required
- Cleanup: exit the catalog and delete the disposable workflow project
- Evidence: manual-only execution exception recorded 2026-09-09 — capability probe output `GEMINI_API_KEY=absent`; `pnpm exec robota-dag node list` returned `Command "robota-dag" not found`, so the catalog surface was unavailable through the scenario contract. See PR #2683.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-09

**Status upgrade:** scenario drafted → scenario written

- Ordering: PASS — DONE-GATE-STAGE-1 is the precondition for the implementation checkpoint and this Task remains in planning state.
- Field completeness: PASS — all three scenarios carry canonical surface, rationale, prerequisites, UI steps, observable, cleanup, and evidence fields.
- Scenario 1: instant-node workflow remains usable after provider composition moves to the host — surface=robota-tui; surface-rationale=shipped-entrypoint=robota; invocation=robota; ui-steps=start `robota`, select the configured provider and model, submit a prompt-backed workflow containing one instant node, and observe the completed turn and node output; observable-type=ui-state; observable=visible=the workflow turn completes, the instant node output is rendered, and the run is reported as succeeded; observable-rationale=source=rendered-product-ui; barrier=credential-bound-service; unavailable-capability=a live Anthropic-compatible provider credential and paid remote model execution are unavailable to unattended verification; attempted-automation=a deterministic provider-free CLI route cannot exercise the real remote instant-node execution path or prove the provider-host composition boundary; guardian-observable-verdict=product-behavior; executability=manual-only; prerequisites=a built checkout, an interactive terminal, a disposable workflow project, and a valid `ANTHROPIC_API_KEY` configured for the selected provider; command=robota; expected observable=visible=the workflow turn completes, the instant node output is rendered, and the run is reported as succeeded; cleanup=delete the disposable workflow project and clear the temporary provider credential from the shell; evidence=pending — record the completed turn, rendered node output, and run-success indicator after a credentialed manual execution.
- Scenario 2: media workflow preserves model allowlisting and credential diagnostics — surface=robota-tui; surface-rationale=shipped-entrypoint=robota; invocation=robota; ui-steps=start `robota`, submit a text-to-image workflow with an allowed model, repeat with a disallowed model, then repeat the disallowed case after removing `GEMINI_API_KEY`; observable-type=ui-state; observable=visible=the allowed run produces an image result, the disallowed model reports `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED`, and the missing credential reports `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`; observable-rationale=source=rendered-product-ui; barrier=credential-bound-service; unavailable-capability=a live Gemini-compatible image credential and paid image generation service are unavailable to unattended verification; attempted-automation=provider-free tests can cover the model and credential guards but cannot prove the real user-facing image-generation result through the live service; guardian-observable-verdict=product-behavior; executability=manual-only; prerequisites=a built checkout, an interactive terminal, a disposable workflow project, `GEMINI_API_KEY`, a valid image model, and the configured allowed-model list; command=robota; expected observable=visible=the allowed run produces an image result, the disallowed model reports `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED`, and the missing credential reports `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`; cleanup=delete the generated image and disposable workflow project, then clear the temporary provider credential from the shell; evidence=pending — record the three rendered outcomes, diagnostic messages, and generated asset after a credentialed manual execution.
- Scenario 3: media node catalog remains available without a provider credential — surface=robota-tui; surface-rationale=shipped-entrypoint=robota; invocation=robota; ui-steps=start `robota`, open the local node catalog, and inspect the available node types without submitting a paid model request; observable-type=ui-state; observable=visible=`gemini-image-edit` and `gemini-image-compose` are listed while no provider credential is required; observable-rationale=source=rendered-product-ui; barrier=sandbox-restriction; unavailable-capability=the local DAG catalog binary is not available through the canonical unattended TUI invocation used by this scenario contract; attempted-automation=the intended `robota-dag node list` route was identified, but this environment's scenario contract accepts only the shipped `robota` entrypoint for CLI and TUI commands; guardian-observable-verdict=product-behavior; executability=manual-only; prerequisites=a built checkout, an interactive terminal, a disposable workflow project, and `GEMINI_API_KEY` absent from the shell; command=robota; expected observable=visible=`gemini-image-edit` and `gemini-image-compose` are listed while no provider credential is required; cleanup=exit the catalog and delete the disposable workflow project; evidence=pending — record the catalog output and the absence of `GEMINI_API_KEY` after a manual execution.

**Judged by:** backlog-gate-guard (canonical field and binding checks reproduced locally)

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "manual",
  "scenarios": [
    {
      "name": "Scenario 1: instant-node workflow remains usable after provider composition moves to the host",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "robota",
      "observableType": "ui-state",
      "observable": "visible=the workflow turn completes, the instant node output is rendered, and the run is reported as succeeded",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "manual-only: the scenario requires a live provider credential and paid model service that unattended execution cannot safely provide",
      "prerequisite": "a built checkout, an interactive terminal, a disposable workflow project, and a valid `ANTHROPIC_API_KEY` configured for the selected provider",
      "action": {
        "kind": "uiSteps",
        "value": "start `robota`, select the configured provider and model, submit a prompt-backed workflow containing one instant node, and observe the completed turn and node output"
      },
      "expectedObservable": "visible=the workflow turn completes, the instant node output is rendered, and the run is reported as succeeded",
      "cleanup": "delete the disposable workflow project and clear the temporary provider credential from the shell",
      "evidence": "pending — record the completed turn, rendered node output, and run-success indicator after a credentialed manual execution",
      "barrier": "credential-bound-service",
      "unavailableCapability": "a live Anthropic-compatible provider credential and paid remote model execution are unavailable to unattended verification",
      "attemptedAutomation": "a deterministic provider-free CLI route cannot exercise the real remote instant-node execution path or prove the provider-host composition boundary",
      "uiSteps": "start `robota`, select the configured provider and model, submit a prompt-backed workflow containing one instant node, and observe the completed turn and node output"
    },
    {
      "name": "Scenario 2: media workflow preserves model allowlisting and credential diagnostics",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "robota",
      "observableType": "ui-state",
      "observable": "visible=the allowed run produces an image result, the disallowed model reports `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED`, and the missing credential reports `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "manual-only: the scenario requires a live image provider credential and paid model service that unattended execution cannot safely provide",
      "prerequisite": "a built checkout, an interactive terminal, a disposable workflow project, `GEMINI_API_KEY`, a valid image model, and the configured allowed-model list",
      "action": {
        "kind": "uiSteps",
        "value": "start `robota`, submit a text-to-image workflow with an allowed model, repeat with a disallowed model, then repeat the disallowed case after removing `GEMINI_API_KEY`"
      },
      "expectedObservable": "visible=the allowed run produces an image result, the disallowed model reports `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED`, and the missing credential reports `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`",
      "cleanup": "delete the generated image and disposable workflow project, then clear the temporary provider credential from the shell",
      "evidence": "pending — record the three rendered outcomes, diagnostic messages, and generated asset after a credentialed manual execution",
      "barrier": "credential-bound-service",
      "unavailableCapability": "a live Gemini-compatible image credential and paid image generation service are unavailable to unattended verification",
      "attemptedAutomation": "provider-free tests can cover the model and credential guards but cannot prove the real user-facing image-generation result through the live service",
      "uiSteps": "start `robota`, submit a text-to-image workflow with an allowed model, repeat with a disallowed model, then repeat the disallowed case after removing `GEMINI_API_KEY`"
    },
    {
      "name": "Scenario 3: media node catalog remains available without a provider credential",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "robota",
      "observableType": "ui-state",
      "observable": "visible=`gemini-image-edit` and `gemini-image-compose` are listed while no provider credential is required",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "manual-only: the repository's DAG catalog command is exposed as a separate interactive local binary and cannot be driven by the canonical unattended TUI command in this environment",
      "prerequisite": "a built checkout, an interactive terminal, a disposable workflow project, and `GEMINI_API_KEY` absent from the shell",
      "action": {
        "kind": "uiSteps",
        "value": "start `robota`, open the local node catalog, and inspect the available node types without submitting a paid model request"
      },
      "expectedObservable": "visible=`gemini-image-edit` and `gemini-image-compose` are listed while no provider credential is required",
      "cleanup": "exit the catalog and delete the disposable workflow project",
      "evidence": "pending — record the catalog output and the absence of `GEMINI_API_KEY` after a manual execution",
      "barrier": "sandbox-restriction",
      "unavailableCapability": "the local DAG catalog binary is not available through the canonical unattended TUI invocation used by this scenario contract",
      "attemptedAutomation": "the intended `robota-dag node list` route was identified, but this environment's scenario contract accepts only the shipped `robota` entrypoint for CLI and TUI commands",
      "uiSteps": "start `robota`, open the local node catalog, and inspect the available node types without submitting a paid model request"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
