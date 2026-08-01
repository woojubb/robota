---
title: 'HARNESS-DIET-005: skills — remove dead/textbook/vendored, consolidate, slim rule-restating'
status: done
created: 2026-07-23
completed: 2026-07-24
priority: medium
urgency: soon
area: .agents/skills, .agents/skills/index.md
depends_on: []
---

# HARNESS-DIET-005: skills diet

## Progress (2026-07-23)

- **DONE — REMOVE (11 skills):** deleted `async-concurrency-patterns`, `cqrs-event-projection-basics`,
  `ddd-tactical-patterns`, `execution-caching`, `state-machine-design`, `logging-level-guide`,
  `tailwind-truncation`, `plugin-development`, `deploy-to-vercel`, `vercel-react-native-skills`,
  `web-design-guidelines` + their `index.md` rows. Each re-verified as referenced only by `index.md` (and one
  archived completed-task record). 63/63 scans green.

## Progress (2026-07-24) — NEUTRALIZE + MERGE batch

- **DONE — `robota-sdk-usage` REMOVED** (index row too). Pre-deletion relocation check: the skill was
  fully stale v2-era guidance that CONTRADICTED current package docs (`systemMessage` is top-level per
  `packages/agent-core/README.md`, not under `defaultModel`; `createZodFunctionTool` lives in
  `@robota-sdk/agent-tools`, not agent-core — the skill's migration table pointed the opposite way from
  the README's "What Moved Out in v3"; `examples/INDEX.md` does not exist; agent-session is first-class).
  Nothing unique to relocate — current truth already lives in `packages/agent-core/README.md` +
  `packages/agent-tools/README.md`, so no new package doc was added.
- **DONE — `scenario-verification-harness` NEUTRALIZED:** `ownerPath`, `[STRICT-POLICY]`,
  `[EMITTER-CONTRACT]`, `[EDGE-ORDER-VIOLATION]`, and `@robota-sdk/*` names removed; generic
  "verify against a recorded scenario" verify/re-record leaf kept; anchor points at `verification.md`.
- **DONE — `contract-audit` NEUTRALIZED:** hardcoded package tier table replaced with generic
  dependency-order guidance + `.agents/project-structure.md` named as the package-listing SSOT.
- **DONE — `backlog-execution-orchestrator` NEUTRALIZED (route-only rewrite):** restated
  `backlog-execution.md` policy (gate content, stop-condition list, PR-body list) replaced with pointers
  to the rule's sections; "Robota CLI/TUI/browser UI" replaced with generic product-surface phrasing +
  project-structure pointer; `repo-writing` routing replaced with `naming-style.md` + `git-branch.md`
  rule pointers.
- **DONE — `dependency-graph-extraction` NEUTRALIZED (text only, skill kept):** `@robota-sdk/*` /
  `agent-* → agent-*` / core-specific rule names generalized; project-structure named as SSOT.
- **DONE — MERGE `semver-api-surface` → `version-management`:** breaking-change decision table +
  deprecate-before-remove + coordinated-bump principles + semver anti-patterns merged; skill dir +
  index row removed.
- **DONE — `repo-writing` REMOVED** (index row too): its content only pointed at `naming-style.md` /
  `git-branch.md`; the sole live referencers (`index.md`, `backlog-execution-orchestrator`) were updated
  in the same change. Remaining name-hits are test fixtures / doc examples using it as a sample skill
  name, not links to the skill file.

## Progress (2026-07-24) — CONSOLIDATE + SLIM batch (final)

- **DONE — INFRA-002 conformance skill-tree CONSOLIDATED into the agent loop:** grep-verified the five
  skills were referenced only by each other, `index.md`, archived spec-docs/tasks, and one rules pointer
  (`spec-workflow.md` GATE-CONFORMANCE "Analytic layer" — rules file, flagged for the rules-owner pass).
  `architecture-conformance-audit` → thin router (mechanical conformance scan + the `architecture-refresh`
  pipeline with `architecture-conformance-auditor`/`architecture-auditor`); `doc-claim-verification`,
  `conformance-finding-report`, `design-quality-audit` → pointer stubs at the agents that own the behavior
  natively (files kept so inbound links resolve); `dependency-graph-extraction` kept as the mechanical-floor
  leaf, repointed off the stubbed skill; `improvement-proposal-authoring` kept (remediation planning leaf).
  None of the five is registered in `orchestration-map.md` — no map change. `index.md` rows updated.
- **DONE — SLIMs (11 skills):** `post-implementation-checklist` (141→44, router: order+gates only; details
  → spec-code-conformance / delegated-refactor-green-gate / version-management / git-branch.md),
  `package-code-review` (150→86, kept MUST/SHOULD/CONSIDER/NIT + six perspectives + output format; dropped
  restated code-quality rule bullets), `pre-refactor-test-harness` (141→54, kept Analyze→Test→Extract→Verify
  - stop conditions; links shared loops), `architecture-patterns` (128→41, principle list + rule pointers;
    code skeletons/checklist deleted), `effect-style-error-modeling` (77→31, kept Result-vs-throw decision
    table + no-fallback pointer), `api-error-standard` (77→31, kept SSOT-ownership + urn namespace + usage
    rules), `contract-testing` (76→24, short leaf), `architecture-decision-records` (91→55, template +
    location only; guard `check-adr-completeness.mjs` noted), `lesson-to-harness` (123→66, kept full
    procedure incl. sweep-class/mechanism/prove; preamble + anti-pattern table compressed),
    `pnpm-monorepo-build` (66→41, kept lifecycle-hook + lockfile-surgery lessons; command listing dropped),
    `branch-guard` (144→33, "hook + husky are the mechanical SSOT" pointer; policy → git-branch.md). Every
    `AGENTS.md > "..."` asserted anchor line kept; scan suite green.
- **DEFERRED (not this file's ownership):** `.agents/rules/spec-workflow.md` GATE-CONFORMANCE "Analytic
  layer" bullet still narrates the retired 4-step prose chain — should be repointed at the
  `architecture-conformance-audit` router / `architecture-refresh` loop in a rules-side change.

## Problem

Of 60 skills, a large fraction are index-only (never invoked by any orchestrator/hook/agent/sibling), generic
textbook the model already knows, vendored copies of globally-available skills, or heavy-preamble skills that
re-state a rule a rule already owns. The design ideal (memory `gstack-skillset-design-principle`,
`harness-mechanical-not-skilltree`) is thin routing + single-responsibility leaf skills; reliability comes from
mechanical hooks/scans, not deep skill-tree prose.

## What

### REMOVE — index-only dead weight (grep-verified: referenced only by `index.md`)

`async-concurrency-patterns`, `cqrs-event-projection-basics`, `ddd-tactical-patterns`, `execution-caching`
(generic textbook), `state-machine-design`, `logging-level-guide`, `tailwind-truncation` (trivial generic prose),
`plugin-development` (non-neutral, content belongs in the package's PLUGINS.md), `deploy-to-vercel` (296-line
vendored copy duplicating the global `deploy-to-vercel` plugin), `vercel-react-native-skills` (repo has **zero**
React-Native/Expo usage), `web-design-guidelines` (vendored, WebFetches an external URL each run, duplicates the
global gstack skill). Drop each `index.md` row too.

### NEUTRALIZE — Robota-specifics baked into "general" skills

- `robota-sdk-usage` → move to `packages/agent-core/docs`, delete from skills (the clearest north-star violation).
- `scenario-verification-harness` → strip Robota tokens (`ownerPath`, `[STRICT-POLICY]`, `[EMITTER-CONTRACT]`) →
  generic "verify against a recorded scenario", or fold into `repo-change-loop`.
- `contract-audit`, `backlog-execution-orchestrator`, `dependency-graph-extraction` → genericize hardcoded
  `@robota-sdk/*` package names / "Robota CLI/TUI/browser" product surfaces (source from `project-structure`).

### CONSOLIDATE — the INFRA-002 conformance skill-tree into the agent loop

`architecture-conformance-audit` + `dependency-graph-extraction` + `doc-claim-verification` +
`conformance-finding-report` (+ `design-quality-audit`) re-implement, as sequenced prose skills, what the
`architecture-refresh` + `architecture-conformance-auditor` / `architecture-auditor` **agents** now do natively.
Keep the mechanical floor (`harness:conformance`, the completeness gates) and one thin agent loop; retire the
parallel skill-tree.

### MERGE

- `semver-api-surface` → `version-management` (breaking-change table).
- `repo-writing` → pointer into `naming-style` + `git-branch` rules (it already names them SSOT).

### SLIM — heavy rule-restating / textbook skills (keep the unique bit + a pointer)

`post-implementation-checklist`, `package-code-review`, `pre-refactor-test-harness`, `architecture-patterns`,
`effect-style-error-modeling`, `api-error-standard`, `contract-testing`, `architecture-decision-records`,
`lesson-to-harness`, `pnpm-monorepo-build`, `branch-guard`.

## Test Plan

- Every REMOVE grep-proven unreferenced outside `index.md` before deletion; update `index.md` in the same PR.
- `scan-consistency` skill-anchor checks + any orchestrator that dispatches a consolidated skill still resolve
  (update `orchestration-map.md` if an agent/skill wiring changes).
- `harness:scan` green.

## User Execution Test Scenarios

- Not applicable (skill/documentation change; the scan suite is the maintained gate).
