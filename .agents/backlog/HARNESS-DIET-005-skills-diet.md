---
title: 'HARNESS-DIET-005: skills — remove dead/textbook/vendored, consolidate, slim rule-restating'
status: todo
created: 2026-07-23
priority: medium
urgency: soon
area: .agents/skills, .agents/skills/index.md
depends_on: []
---

# HARNESS-DIET-005: skills diet

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
