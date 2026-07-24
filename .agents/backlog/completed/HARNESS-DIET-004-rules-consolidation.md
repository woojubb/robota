---
title: 'HARNESS-DIET-004: rules — consolidate, neutralize, de-duplicate, de-stale'
status: done
completed: 2026-07-24
created: 2026-07-23
priority: medium
urgency: soon
area: .agents/rules
depends_on: []
---

# HARNESS-DIET-004: rules consolidation & neutralization

## Outcome (DONE 2026-07-24)

Consolidation via #1296 (runbook merge, routing collapse, dedup, de-stale) + #1300 (project-data →
project-structure.md SSOT with stale fixes). Rule files never deleted — pointer stubs keep all inbound
references resolving. Cosmetic leftovers (naming-style styling-summary dup, operational doc-paths pointer)
are below the diet bar and intentionally not tracked.

## Problem

The 22 rule files are all referenced (no dead rules), but they carry heavy non-neutrality, internal repetition,
a triple routing layer, and stale content. All enforcement claims were verified real (the named scans exist), so
this is about slimming prose and relocating repo-data — NOT weakening gates.

## What

### Relocate release runbooks out of general `rules/`

- `publish.md` + `release-operations.md` are ~100% `@robota-sdk`/`pnpm`/`npm`/OTP operational procedure and
  overlap each other. Merge into one release runbook under a runbook/skill namespace (keep it enforced by
  `check-publish-safety` / `check-release-governance`). Biggest neutrality win.

### Collapse the routing layer

- Fold `process.md` (a 20-line routing table already in `index.md`) into `index.md`; repoint `AGENTS.md`'s
  Process link. (Pairs with DIET-007's AGENTS.md slim.)
- Merge `api-boundary.md` (14 lines, no scan/hook enforces SIGTERM/OpenAPI) into `operational.md`.

### De-duplicate internally

- `backlog-execution.md` (491 lines) restates "never cite build/test/lint as User-Execution evidence" ~5×
  (Done-Gate, Stop Conditions, Common-Mistakes table, Checklist). Collapse to one statement + the single enforced
  gate.
- `common-mistakes.md` — prune #1–#55 (generic restatements of code-quality/publish/spec rules); keep the dated
  incident entries (#57+) with worked examples (the genuinely useful part).

### Neutralize baked project-data

- `frontend.md` App-Inventory table (hardcodes `apps/agent-web`, the dissolved `agent-web-monitor`, …) → move to
  `project-structure.md`; keep the React/Next/Tailwind stack rules.
- `documentation-sync.md` Documentation-Source-Map (robota.io `content/` path list) → move to a doc-map config;
  keep the neutral "update docs in the same PR" gate; dedupe vs `spec-workflow` Document Authority.
- `code-quality.md` Layered-Assembly section (full agent-core→agent-cli stack + command-layering) → move to the
  architecture SPEC; keep the neutral type/pattern rules.

### De-stale / de-scope

- `operational.md` — refresh/remove Idea-Capture (points at empty `.agents/tasks/`; real flow is
  `spec-docs/draft`) and the `{DOMAIN}-{BL|TK}-{NNN}` ID table (repo uses `{DOMAIN}-{NNN}`, e.g. `GUI-001`).
- `naming-style.md` — the Korean 적/의/것/들 micro-style list has no enforcement and is owner-personal; move it
  to a skill, keep Language/Identity/Styling SSOT.
- `git-branch.md` (295 lines, well-enforced) — compress the multi-line incident narratives to one-line
  rationales; the hooks already enforce.

## Progress (2026-07-24, chore/diet-004-rules-consolidation)

Completed in this pass (all stubs keep old links resolving — no file deleted or renamed):

- Release runbook merged: `release-operations.md` content moved INTO `publish.md` (single runbook,
  `# Publish & Release Rules`); `release-operations.md` is a 10-line pointer stub.
  `check-release-governance.mjs` re-pointed to guard the merged content in `publish.md`
  (+ `harness-scripts.test.mjs` release-governance test path — one-line change).
- Routing layer collapsed: `process.md` reduced to a pointer stub at `index.md`
  (20 → 11 lines); `index.md` carries the full Process Sub-Rules routing.
- `api-boundary.md` moved into `operational.md` § "API Boundary & Process Lifecycle"; stub left.
- `backlog-execution.md` deduped (491 → 457 lines): ONE authoritative
  "engineering verification is never User-Execution evidence" statement in Done Gate Stage 2;
  restatements in Stop Conditions / Checklist / scenario definition collapsed to cross-references.
- `common-mistakes.md`: rows #1–#56 pruned to compact pointer rows (numbering stable — hook
  reference to #9 and scan-required #50/#51 mistake texts kept); dated incidents #57+ untouched;
  stale `release-operations.md` / `process.md` pointers re-pointed to `publish.md` / `spec-workflow.md`.
- `operational.md` de-staled: Idea-Capture now records to `.agents/backlog/` / `.agents/spec-docs/draft/`
  (not the empty `.agents/tasks/` flow); ID convention corrected to `{DOMAIN}-{NNN}` (no `BL|TK` segment).
- `naming-style.md`: Korean 적/의/것/들 micro-style list compressed to a 3-line guideline.
- `git-branch.md` (309 → 293 lines): multi-line incident narratives compressed to one-line
  rationales; Worktree section and One-Branch exceptions unchanged.

## Progress (2026-07-24, chore/diet-004-neutralize-data — second pass)

Neutralize-baked-project-data bucket completed (all moved sections keep their headings as pointer
stubs — no link target deleted):

- `frontend.md`: App-Inventory + Interactive-Tools tables moved to `project-structure.md`
  § "App Inventory and Approved Stack"; stale entries fixed while relocating
  (`apps/agent-web-monitor` — dissolved in GUI-007, now `packages/agent-cli-web`; added the
  missing real UI surfaces `apps/agent-app`, `apps/starter-nextjs`, `packages/agent-playground`).
  The rule keeps the React/Next/Tailwind invariants; the app-specific Common-Mistakes row and the
  Styling cross-reference were neutralized.
- `documentation-sync.md`: Documentation-Source-Map moved to `project-structure.md`
  § "Documentation Map"; stale generated-output paths fixed (`apps/docs/.temp/` +
  `.vitepress/dist/` — VitePress was removed in SITE-005; now `apps/docs/out/` + `.next/`).
  The rule keeps the same-PR doc gates + Document-Role sync gate, which now POINTS at
  `spec-workflow.md` § "Document Authority and Content Placement" for class authority.
- `code-quality.md`: Layered-Assembly section (stack diagram + command-layering rules) moved to
  `project-structure.md` § "Layered Assembly Architecture" (merged with the dependency-direction
  content there); the rule keeps the neutral type/pattern rules + a pointer stub (heading kept —
  `common-mistakes.md` #16/#20 reference it).

Remaining: none for this item's rule buckets.

## Test Plan

- No enforcement regression: every scan/hook that references a moved/renamed rule still resolves (`check-spec-paths`,
  `check-harness-config-paths`, `scan-consistency` required-anchor checks) — update references in the same PR.
- `harness:scan` green; AGENTS.md + `rules/index.md` links resolve.

## User Execution Test Scenarios

- Not applicable (rule/documentation change; the scan suite is the maintained gate).
