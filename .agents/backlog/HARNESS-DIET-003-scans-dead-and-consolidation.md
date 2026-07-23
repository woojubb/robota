---
title: 'HARNESS-DIET-003: remove dead/vacuous scans + consolidate thin ones'
status: todo
created: 2026-07-23
priority: high
urgency: soon
area: scripts/harness, scripts/harness/run-all-scans.mjs
depends_on: []
---

# HARNESS-DIET-003: scans — remove dead/vacuous + consolidate

## Problem

Several harness scans are dead, vacuous (structurally cannot fail), orphaned, or thin single-rule checks that
belong inside a neighbour. They add registry weight and false assurance without catching anything.

## What

### REMOVE (dead / orphaned)

- `bootstrap.mjs` — `APP_DEFINITIONS` targets `apps/web` + `apps/api-server`, **neither exists** (renamed to
  `agent-web`/`agent-server`); every run is a vacuous SKIP. Delete, or rewrite to derive apps dynamically.
- `record-owner-scenario.mjs` — orphan; referenced only in `scripts/harness/README.md` (absent from
  package.json, ci.yml, husky, skills). Its logic already lives in `scenario-records.mjs`. Delete.

### FIX never-failing gates (enforce or drop — a scan that cannot fail is noise)

- `scan-file-size` (`file-size`) — never sets `exitCode=1` (warn-only, per a stale "once CLI-BL-022 complete"
  comment); 3 live >300-line files pass green. Flip to enforcing with a pinned baseline of the current 3, or drop
  from `run-all-scans`.
- `check-document-authority` (`document-authority`) — warn-only AND `getChangedFiles()` returns `[]` in the
  base-ref-less `scans` job, so it can never fail. Make it blocking (and fetch the base) or drop from the
  blocking suite.

### SHRINK / SPLIT

- `check-spec-public-surface` — its **641-line `@robota-sdk#symbol` reverse allowlist** has turned the
  undocumented-export edge off for the whole surface ("do not grow casually" — it grew). Keep the cheap forward
  phantom-export check; retire or radically shrink the reverse allowlist.
- `scan-consistency` (394 lines) — a grab-bag mixing workspace-drift + required-script presence + skill anchors +
  scenario-record validation + one-off Robota `PHRASE_CHECKS` literals. Split by responsibility; move phrase
  blocklists to config or delete the stale one-offs.

### MERGE thin/overlapping scans (trim the registry by ~4, no coverage loss)

- `check-architecture-conformance` → fold its package-name-token check into `check-dependency-direction`
  (`deps`); drop the spawn-wrapper (its docstring says "not wired into run-all-scans" but line 176 wires it).
- `check-entry-point-only` → fold the single aggregator-import edge into `deps` / `capability-placement`.
- `check-spec-publish-claims` → fold the single-incident private-pkg-claims-publish tripwire into
  `check-publish-safety`.
- `check-sdk-react-free` → fold the single-package React-free rule into a config-driven package-purity check.

## Test Plan

- Red-before-green for the enforce-now flips (`scan-file-size`, `check-document-authority`): prove they FAIL on
  an injected violation, pass on the baseline.
- Each MERGE: the absorbing scan must catch what the removed scan caught (add a fixture per merged rule).
- `run-all-scans` registry updated; `harness:scan` green; no orphaned files; `check-harness-config-paths` green.

## User Execution Test Scenarios

- Not applicable (harness scans; fixtures + `harness:scan` are the maintained gate).
