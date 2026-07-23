---
title: 'HARNESS-DIET-004: rules — consolidate, neutralize, de-duplicate, de-stale'
status: todo
created: 2026-07-23
priority: medium
urgency: soon
area: .agents/rules
depends_on: []
---

# HARNESS-DIET-004: rules consolidation & neutralization

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

## Test Plan

- No enforcement regression: every scan/hook that references a moved/renamed rule still resolves (`check-spec-paths`,
  `check-harness-config-paths`, `scan-consistency` required-anchor checks) — update references in the same PR.
- `harness:scan` green; AGENTS.md + `rules/index.md` links resolve.

## User Execution Test Scenarios

- Not applicable (rule/documentation change; the scan suite is the maintained gate).
