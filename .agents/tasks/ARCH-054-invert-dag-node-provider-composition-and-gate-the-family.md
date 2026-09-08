---
title: 'ARCH-054: invert dag-node provider composition and gate the family'
issue: https://github.com/woojubb/robota/issues/2158
status: todo
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
---

# ARCH-054: invert dag-node provider composition and gate the family

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

- [ ] U01 — the generalized scan goes RED on five planted shapes (disallowed manifest dependency, (stage 1 for the manifest, subpath-vendor, `@google/genai` and sibling-leaf shapes; the two `process` shapes are stage 2, where subject C is registered)
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
- [ ] U05 — no `packages/dag-nodes/*/package.json` names `@robota-sdk/agent-provider` (stage 2)
      (`grep -l … | wc -l` equals 0; it prints `4` today, so the criterion is red before the work).
- [ ] U06 — the three media nodes take an injected `IMediaProviderDefinition` and contain no vendor (stage 2)
      import and no `process.env`.
- [ ] U07 — `dag-node-instant-node` takes an injected `readonly IProviderDefinition[]`, resolves (stage 2)
      through `findProviderDefinition` + `normalizeProviderConfig` + `createProviderFromConfig`,
      declares no vendor dependency and reads no `process.env`.
- [ ] U08 — the hard-coded five-vendor copy at `mcp/handlers/instant-nodes.ts:76-82` is gone. (stage 2)
- [ ] U09 — every composition root named in `area` supplies the injected values, including a decided (stage 2)
      and recorded registry-acquisition path for `agent-command-workflows`.
- [ ] U10 — credential absence is preserved as a typed error on all four nodes, and (stage 2)
      `createCliNodeRegistry()` still returns `gemini-image-edit` and `gemini-image-compose`, and
      `createDefaultNodeRegistry()` still returns `text-to-image` and `seedance-video`, with no key set.
- [ ] U11 — `imageCapableModels` reaches the provider factory with the node's resolved allowlist, so (stage 2)
      `isImageCapableModel` cannot take its unconditional-`true` branch.
- [ ] U12 — `DAG_RUNTIME_BASE_URL` / `DAG_PORT` are no longer read inside a node package. The media (stage 2)
      runtimes take `runtimeBaseUrl` as a constructor option supplied by `dag-nodes-default`; the
      removal is declared in the spec's § Fallback & Degradation and `gemini-image-edit`'s own SPEC is
      updated. No `dag-core` contract changes and no root item is deferred. (stage 2)
- [ ] U13 — the new rule's frozen exception set is seeded with today's measured violations, each (stage 1)
      carrying a reason and the departure marker `leaves at ARCH-054 stage 2`; it is shrink-only, a
      stale entry is itself a finding, and by the end of stage 2 it holds only the permanent
      `@robota-sdk/dag-node-mcp-tool -> @modelcontextprotocol/sdk` entry. `mcp-tool`'s ambient read is
      removed rather than exempted. (seeded in stage 1, emptied across stage 2)
      <!-- stage 1 seeded the set with the eight measured edges, each carrying its reason and departure marker, and armed the stale-entry sweep. The emptying and the `mcp-tool` removal are stage 2's. -->
- [x] U14 — a policy entry resolving to zero family members is a hard finding, and the scan prints (stage 1)
      its examined member count on the real tree.
- [ ] U15 — `packages/dag-nodes/docs/SPEC.md`, `MEDIA-PROVIDER-CONTRACT.md` and (stage 2)
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

**Scenario 1 — an instant node still runs after the composition moves out of the node.**
Prerequisites: a checkout with `pnpm install && pnpm build` complete, and `ANTHROPIC_API_KEY` exported.
Steps: in an empty directory run `npx robota-dag init`, then
`npx robota-dag run .dag/workflows/hello-world.dag.json` (the file `init` actually writes,
`packages/dag-cli/src/commands/init.ts:542-546`) to confirm the baseline path works; then use `robota-dag node` + `robota-dag save` to author a
workflow containing one prompt-backed instant node, and run it. <!-- corrected 2026-09-06: the `/workflows create` branch was offered first and is NOT executable on a default checkout — `packages/agent-cli/src/startup/command-setup.ts:56-62` builds the workflow project only when project access is `trusted`, and absence is Restricted. Establishing that trust has no shipped producer; SECURITY-005 owns it. The `robota-dag` path needs no trust and is now the only path. --> Expected observable result, before and after this item
identically: the run completes, the node's text output is printed, and the run summary reports the node
as succeeded. Additional expectation after this item only: with `ANTHROPIC_API_KEY` unset, the failure
still names the missing credential and still suggests a provider whose key IS set — the diagnostic
`resolveProviderInstance` produces today at `packages/dag-nodes/instant-node/src/index.ts:88-104` must
survive the move to the registry. Cleanup: delete the scratch directory. Evidence to record after
implementation: both terminal transcripts (key set, key unset) and the exit codes.

**Scenario 2 — a media node still runs, and both model gates still apply.**
Prerequisites: `GEMINI_API_KEY` exported and `DAG_TEXT_TO_IMAGE_DEFAULT_MODEL` set to a real image
model. Steps: author a two-node workflow (`input` → `text-to-image`) and run it with
`npx robota-dag run <file>`; re-run it with the node config naming a model outside
`DAG_TEXT_TO_IMAGE_ALLOWED_MODELS`; then re-run that same second case with `GEMINI_API_KEY` unset.
Expected observable result: the first run writes an image asset and reports success; the second fails
with `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED`; the third fails with
`DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`. All three must hold identically before and after this
item — the second is the node-side allowlist and the third is the credential path that an
instance-shaped injection would have made unreachable. Cleanup: delete the generated asset and the
scratch directory. Evidence to record after implementation: the three run transcripts and the generated
asset path.

**Scenario 3 — the media nodes are still offered when no credential exists.**
Prerequisites: a built checkout and a shell with `GEMINI_API_KEY` unset. Steps: in a scratch project run
`npx robota-dag node list`. Expected observable result, before and after this item identically:
`gemini-image-edit` and `gemini-image-compose` appear in the listed node types. Those two are the media
nodes `createCliNodeRegistry()` builds synchronously (`node-registry.ts:19-20`), and `node list` renders
exactly that registry (`packages/dag-cli/src/commands/node.ts:950`) — `text-to-image` and
`seedance-video` are deliberately NOT expected here, because they reach a runtime only through
`dag-nodes-default`'s async `optionalLoaders` and this command never builds them. This is the scenario
that fails if the injection is ever changed from a definition to a constructed instance, and it needs no
credential and no paid call. Cleanup: delete the scratch directory. Evidence to record after
implementation: the `node list` output with both node types visible, and `env | grep -c GEMINI_API_KEY`
printing `0`.
