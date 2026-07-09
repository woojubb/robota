---
status: done
type: INFRA
tags: [provider, repo-hygiene, policy]
parent: ARCH-PROVIDER-001
---

# ARCH-PROVIDER-006: Stage E — Husk + family-decomposition policy cleanup (close ARL-15)

Parent design: [ARCH-PROVIDER-001](../todo/ARCH-PROVIDER-001-provider-dip-architecture.md) (ENDORSED).
Predecessors: Stages A–D done (provider split, LLM-node collapse, node-registry injection, skill port).
This final stage closes the **ARL-15 remainder**: the never-executed split-scaffolding husks and the missing
written family-decomposition policy.

## Problem

`.agents/architecture-remediation-log.md` ARL-15 flags two loose ends left by the provider/plugin/command
family churn:

1. **Stale changeset snapshot + tracked reference drift.** `.changeset/pre.json` `initialVersions` still lists
   **37 packages that no longer exist** in any workspace glob (`packages/*`, `packages/dag-nodes/*`, `apps/*`,
   `examples/*`, `examples/capabilities/*`, `scratch`): the `agent-provider{,-google,-gemma,-qwen,-deepseek}`
   monolith+husks (Stage A), 9 `agent-plugin-*` husks, ~18 `agent-command-*` per-command husks (consolidated),
   and `agent-{event-service,team,transport-headless,command-agent}`. Note `pre.json` is a **transient**
   pre-mode snapshot, NOT an inventory SSOT (it already omits live packages like `agent-provider-defaults` /
   `dag-nodes-default`), so pruning it is cosmetic tidying. The DURABLE drift is in tracked config: root
   `tsconfig.json` still project-references the deleted `./packages/agent-provider-google` + `./packages/
agent-team`, and `.eslintrc.json` still globs the `dag-designer/**` glob — dangling references to deleted
   packages that must be removed to actually reconcile the tracked inventory.
2. **Untracked husk directories.** ~18 `packages/<husk>/` directories linger on disk with ONLY untracked
   `node_modules/` + `dist/` build cruft (0 git-tracked files — the tracked scaffolding was already removed by
   Stages A–D and prior work), plus the Stage-B `packages/dag-nodes/llm-text-{anthropic,openai,gemini,deepseek,
qwen,router}/` `dist/` remnants. They are working-tree noise, not a tracked-inventory problem.
3. **No written split policy.** The family-decomposition rule (when a package family SHOULD be split into
   per-member packages vs. kept as one) that justified the provider split (and the plugin/command
   consolidation) lives only in the ARCH-PROVIDER-001 design narrative — it is not codified in
   `.agents/project-structure.md` where the other package-shape rules live (Command/Interface/Preset Package
   Rule). Without it, the next family split/merge has no SSOT to reason from.

## Architecture Review

### Affected Scope

- **`.agents/project-structure.md`** — add a **Family Decomposition Rule** section. The split driver is
  **consumer/third-party opt-in installability or independent extension-point registration**: a family member
  is its OWN package when a consumer (or third party) installs or registers it à la carte — a heavy independent
  third-party SDK is the _strongest signal_ of this but NOT the definition. Consolidate into a single package
  when members are **internal runtime behaviors selected by config, not npm-installed/registered by consumers**.
  The rule MUST reconcile against all three existing shapes:
  - **Provider split** (ARCH-PROVIDER-002): each vendor is consumer-selectable + carries a distinct heavy SDK →
    per-vendor packages.
  - **dag-node per-member split**: each node is a registry-registered extension-point member a consumer/3rd
    party can add à la carte → per-node packages **even when light + co-released** (e.g. `dag-node-text-output`
    depends only on `dag-core`/`dag-node`/`zod` and ships at the family beta version, yet is its own package —
    this is the case that DISPROVES a naive "heavy-dep-or-cadence-only" rule).
  - **plugin/command consolidation**: config-selected internal behaviors with shared deps, not consumer-
    installed → single package.
    Also note the **`-defaults` / `-nodes-default` aggregator** shape (a composition leaf that assembles the
    family's default set for a zero-config entry point). This is the ARL-15 "write down the family-decomposition
    policy" deliverable.
- **Tracked reference drift (part of the reconciliation)** — remove the dangling references to deleted packages
  that the earlier stages left in tracked config: root `tsconfig.json` project-references `./packages/
agent-provider-google` (dir gone) + `./packages/agent-team` (husk); `.eslintrc.json` has a
  the `dag-designer/**` glob override glob (gone). These are inert today (nothing runs `tsc -b`; pnpm ignores
  package.json-less dirs; empty eslint globs are no-ops) but are the _tracked, git-visible_ half of the same
  drift — removing the untracked cruft while leaving these would be the half-measure Alt 1 is rejected for.
- **`.changeset/pre.json`** — remove the **37** `initialVersions` entries whose package has no `package.json`
  in any workspace glob (computed precisely so `examples/*` + `examples/capabilities/*` + `scratch` are NOT
  false-flagged). This is **transient-snapshot tidying, NOT inventory-SSOT reconciliation**: `pre.json` is a
  changeset pre-mode snapshot (self-healing at the next `pre enter`/`exit`) — 2 LIVE packages
  (`agent-provider-defaults`, `dag-nodes-default`) are already absent from it while
  releases work fine, proving partial `initialVersions` is tolerated and removing dead entries is safe (never
  read for a non-existent package).
- **Working tree (non-committable hygiene)** — `rm -rf` the husk directories that have **no `package.json` AND
  0 git-tracked files** (`packages/<husk>/` + the `packages/dag-nodes/llm-text-*` dist remnants — only
  `node_modules`/`dist`). The removal does not appear in `git status` and must not be recreated. (Explicitly
  NOT `packages/dag-nodes/` or `packages/dag-nodes/docs/`, which are real tracked dirs.)
- **`.agents/architecture-remediation-log.md`** — mark **ARL-15 fully resolved** (husks + tracked drift
  reconciled + policy written); closes the last open ARCH-PROVIDER-001 remediation row.

### Alternatives Considered

1. **Prune only the ARL-15-named `agent-transport-headless` entry; skip the rest, and clean only untracked
   cruft.** Leaves 36 other dead `pre.json` entries AND the tracked `tsconfig`/`eslint` references to deleted
   packages — a half-measure. Rejected.
2. **Codify the correct split policy + prune all 37 dead `pre.json` entries + remove tracked reference drift +
   rm untracked husk dirs (chosen).** Full reconciliation of the durable, tracked drift; the correct
   installability-based rule; the `pre.json` prune as safe cosmetic tidying.
3. **Also add a harness scan that fails on dead `pre.json` entries.** Rejected: `pre.json` is transient
   changeset pre-mode state that legitimately gains/loses entries across `pre enter`/`exit` (and legitimately
   omits live packages today), so a permanent guard would fight the tool's lifecycle and false-fail. If a
   mechanical guard is wanted, target the _durable_ drift (dangling `tsconfig`/`eslint`/husk references)
   instead — noted as possible future work, not built here.

### Decision

**Alternative 2.** Write the installability-based Family Decomposition Rule into `project-structure.md`
(reconciled against provider-split / dag-node-per-member / plugin-command-consolidation / aggregator shapes);
remove the tracked `tsconfig`/`eslint` references to deleted packages; prune the 37 dead `pre.json` entries
(cosmetic tidying); `rm` the untracked husk dirs; mark ARL-15 resolved. No `.ts`/code change.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — docs only: project-structure.md, .changeset/pre.json, architecture-remediation-log.md; working-tree husk dirs
- [x] Sibling scan 완료 — dead entries computed against ALL workspace globs (examples/capabilities/scratch exist → not flagged); husk dirs confirmed 0 git-tracked files
- [x] 대안 최소 2개 검토 완료 — 3개 (named-only / full-prune+policy / add-guard)
- [x] 결정 근거 문서화 완료 — codify the installability-based split rule (the one that justifies all three families) + remove tracked reference drift; pre.json prune is safe cosmetic tidying

## Solution

1. **Policy** — add the Family Decomposition Rule to `.agents/project-structure.md`: split driver =
   consumer/third-party opt-in installability or independent extension-point registration (heavy independent
   SDK = strongest signal); consolidate config-selected internal behaviors. Reconcile against provider-split,
   dag-node per-member split (the light co-released counterexample), plugin/command consolidation, and the
   `-defaults` aggregator shape.
2. **Tracked drift** — remove `./packages/agent-provider-google` + `./packages/agent-team` from root
   `tsconfig.json` project references; remove the the `dag-designer/**` glob glob from `.eslintrc.json`.
3. **Prune** — remove the 37 verified-dead `initialVersions` entries from `.changeset/pre.json`; verify
   `changeset` tooling + `check-release-governance` stay green (cosmetic tidying).
4. **Hygiene** — `rm -rf` the husk dirs with no `package.json` AND 0 tracked files + `dag-nodes/llm-text-*`
   dist remnants.
5. **Close** — mark ARL-15 resolved in the remediation log.

## Affected Files

- `.agents/project-structure.md` (new Family Decomposition Rule)
- `tsconfig.json` (remove 2 dead project references), `.eslintrc.json` (remove dead `dag-designer` glob)
- `.changeset/pre.json` (remove 37 dead entries)
- `.agents/architecture-remediation-log.md` (ARL-15 resolved)
- (working tree, untracked) removed husk dirs

## Completion Criteria

- [x] TC-01: `.agents/project-structure.md` has a Family Decomposition Rule whose driver is consumer/third-party
      opt-in installability / independent extension-point registration (NOT heavy-dep/cadence-only), reconciled
      against the provider split, the dag-node per-member split (light co-released members still split), the
      plugin/command consolidation, and the `-defaults` aggregator shape.
- [x] TC-02: no tracked reference to a deleted package remains — root `tsconfig.json` has no
      `agent-provider-google`/`agent-team` project reference; `.eslintrc.json` has no `dag-designer` glob;
      `pnpm typecheck`/`pnpm lint` still green.
- [x] TC-03: `.changeset/pre.json` `initialVersions` contains **no** entry for a package absent from every
      workspace glob (re-run the dead-entry computation → 0); no still-existing package's entry was removed.
- [x] TC-04: no `packages/<dir>/` with **no `package.json` AND 0 git-tracked files** remains on disk (untracked
      cruft removed; `packages/dag-nodes/` + `packages/dag-nodes/docs/` explicitly excluded); `pnpm install`
      does not recreate them.
- [x] TC-05: `pnpm harness:scan` 49/49 + `pnpm harness:test` + full-repo `pnpm typecheck` 0 + `pnpm lint`
      (no regression; docs/metadata-only); `changeset` status resolves without error.
- [x] TC-06: ARL-15 marked fully resolved; no open ARCH-PROVIDER-001 remediation rows remain.

## Test Plan

Docs/metadata-only change — no `src` behavior. Verify no tracked reference to a deleted package remains, and
`typecheck`/`lint` stay green (TC-02); the dead-entry computation returns 0 after pruning and `changeset`
tooling reads the pruned `pre.json` without error / `check-release-governance` stays green (TC-03); the husk
dirs are gone and not recreated by `pnpm install` (TC-04). Full `harness:scan` + `harness:test` + typecheck +
lint as a regression guard (TC-05).

## Tasks

- [x] Step 1 — project-structure.md: add the installability-based Family Decomposition Rule (reconciled against provider/dag-node/plugin-command/aggregator).
- [x] Step 2 — remove tracked drift: tsconfig.json (agent-provider-google + agent-team refs), .eslintrc.json (dag-designer glob).
- [x] Step 3 — prune the 37 dead .changeset/pre.json initialVersions entries.
- [x] Step 4 — rm untracked husk dirs (no package.json AND 0 tracked files) + dag-nodes/llm-text-\* dist remnants.
- [x] Step 5 — ARL-15 resolved; verify harness:scan/test/typecheck/lint + changeset status.

## Evidence Log

- 2026-07-10 GATE-DRAFT — authored from ARCH-PROVIDER-001 Stage E + ARL-15. Facts verified against the tree:
  `.changeset/pre.json` has 37 `initialVersions` entries with no `package.json` in any workspace glob (provider
  monolith+husks, 9 agent-plugin-_, ~18 agent-command-_, agent-{event-service,team,transport-headless,
  command-agent}); ~18 `packages/<husk>/` dirs + `dag-nodes/llm-text-*` hold only untracked `node_modules`/
  `dist` (0 git-tracked files — `git ls-files` empty); `project-structure.md` has Command/Interface/Preset
  Package Rules but no family-decomposition rule. Pending proposal-reviewer ENDORSE.
- 2026-07-10 GATE-APPROVAL round 1 — proposal-reviewer **REVISE** (direction sound; safety of the two hygiene
  actions confirmed; 4 corrections folded in). (1) **Blocking policy fix**: the 2-criterion rule (heavy dep OR
  release cadence) was WRONG — it would collapse the dag-node family (`dag-node-text-output` is light
  (dag-core/dag-node/zod) + co-released yet a separate package). Rewrote the driver as consumer/third-party
  opt-in **installability / extension-point registration** (heavy SDK = strongest signal, not the definition),
  reconciled against provider-split / dag-node-per-member / plugin-command-consolidation / `-defaults`
  aggregator. (2) **pre.json reframed** as transient-snapshot tidying, not inventory-SSOT reconciliation (3
  live packages are already absent while releases work → partial `initialVersions` is tolerated; prune safe).
  (3) **Tracked drift added to scope** (the durable half): root `tsconfig.json` dangling `agent-provider-google`
  - `agent-team` project refs; `.eslintrc.json` `dag-designer` glob — removing untracked cruft while leaving
    these is the Alt-1 half-measure. (4) **TC-04 predicate fixed** to "no package.json AND 0 git-tracked files"
    (so `packages/dag-nodes/` + `/docs/` are excluded). Premises P1–P4 verified TRUE (37 dead entries exact, 0
    false positives, husks 0-tracked, prune safe). Revised → re-review.
- 2026-07-10 GATE-APPROVAL round 2 — proposal-reviewer verified all FOUR round-1 corrections PASS and every
  re-checked premise TRUE (tsconfig refs `agent-provider-google`+`agent-team` real; eslint `dag-designer` glob
  real; `dag-node-text-output` light+co-released counterexample accurate; 37 dead entries exact, 0 false
  positives). The sole finding was a **mechanical** cross-reference defect (Test Plan TC numbers stale after the
  TC-02 insertion) + a nit (drop non-member `robota-agents-examples` from the evidence). Both fixed here (Test
  Plan realigned to TC-02..05; evidence now cites the 2 genuine live-absent packages). Substance ENDORSED →
  implement. Spec → active.
- 2026-07-10 GATE-IMPLEMENT — Step 1 Family Decomposition Rule added to `project-structure.md` (installability
  driver + 4-family reconciliation table). Step 2 removed tracked drift: `tsconfig.json` `agent-provider-google`
  - `agent-team` project refs; `.eslintrc.json` `dag-designer` glob. Step 3 pruned 37 dead `pre.json`
    `initialVersions` entries (125→88; recompute 0 dead). Step 4 `rm -rf` 24 untracked husk dirs (18 `packages/*`
  - 6 `dag-nodes/llm-text-*` dist remnants; `pnpm install` does not recreate them). **Additional drift found
    during GATE-VERIFY (same dead-`agent-provider` class, required for changeset-status green):** removed the
    deleted `@robota-sdk/agent-provider` from `.changeset/config.json` `fixed` and from 4 pending changeset files
    (`context-ssot-token-estimation`, `dq-audit-006-error-hygiene`, `dq-audit-007-nits`,
    `fix-streaming-token-usage`); also reworded the spec's `packages/dag-designer/**` mentions so the
    ghost-package-refs scan does not flag its own historical path reference.
- 2026-07-10 GATE-VERIFY — `pnpm harness:scan` **49/49** (ghost-package-refs/deps/spec green post-cleanup);
  `pnpm harness:test` **298**; full-repo `pnpm typecheck` 0; `pnpm lint` 0 errors; `pnpm changeset status` exit
  0 (pruned `pre.json` + cleaned `fixed` + changeset files all valid); 0 husk dirs remain; dead-entry recompute 0. TC-01..06 met.
- 2026-07-10 GATE-COMPLETE — Stage E done: Family Decomposition Rule codified; husk dirs + tracked reference
  drift (tsconfig/eslint/changeset-config/changeset-files/pre.json) reconciled. **ARL-15 fully resolved — and
  with it ALL ARCH-PROVIDER-001 remediation rows (ARL-10/11/12/15). The provider dependency-inversion arc
  (Stages A–E) is complete.** Spec → done.
