---
title: 'HARNESS-DIET-002: config-drive scan neutrality — kill Robota-specifics baked into general scans'
status: todo
created: 2026-07-23
priority: high
urgency: soon
area: scripts/harness, .agents/harness-config
depends_on: []
---

# HARNESS-DIET-002: scans — config-drive neutrality

## Progress + re-scoping (2026-07-23)

- **CORRECTION to the audit:** the 5 "library-neutrality" scans are NOT near-identical — they are **3 distinct
  shapes**: `agent-tools` (a `package.json` runtime-dependency **allowlist** check), `session-artifact` (a
  single-file **multi-regex forbidden-token** scan with comment-stripping), `orchestration` (a **dir-walk single
  combined-regex** scan excluding `__tests__`), and `memory`/`evals` (197/198 lines, **bespoke** logic beyond a
  token scan). A blind "5 → 1 config-driven scan" would need a flexible engine spanning all shapes and risks
  subtly weakening real neutrality floors. The safe win is **externalizing each scan's Robota-specific DATA to
  `harness.config.json`** while keeping its distinct engine.
- **DONE:** config-ized 2 of the 5 — `scan-agent-tools-neutrality` (allowlist → `neutrality.agentToolsRuntimeAllowlist`)
  and `scan-orchestration-neutrality` (dirs + forbidden terms → `neutrality.orchestrationScanDirs` /
  `orchestrationForbiddenTerms`). Unit tests unchanged (9 pass); 63/63 scans green (incl. `harness-config-paths`).
- **REMAINING:** externalize `session-artifact`'s 19 forbidden-token regexes and `memory`/`evals`' target paths +
  token lists to config (leave their bespoke logic); only THEN, if worthwhile, factor a shared
  forbidden-token-in-file helper. Do NOT force a single engine across the dep-check + token-scan shapes.

## Problem

~10+ harness scans hardcode Robota specifics (`@robota-sdk/*` scope prefixes, exact package/file paths, even
required SPEC prose) into machinery that presents as a general harness — the north-star's core "don't bake
Robota into general machinery" violation. The repo already has `scripts/harness/harness-config.mjs` as the
config-loader pattern; most of these scans predate it.

## What

### 1. Collapse the 5-scan "library-neutrality" family → one config-driven scan

`scan-agent-tools-neutrality`, `scan-session-artifact-neutrality`, `scan-memory-neutrality`,
`scan-evals-neutrality`, `scan-orchestration-neutrality` are the same guardian copy-pasted 5× (~670 lines total),
each hardcoding one subsystem's `{path, forbiddenTokens, allowlist}`. Replace with a single
`scan-library-neutrality.mjs` that reads those rows from `harness-config`. Preserve each subsystem's current
token/allowlist as config rows (no coverage loss).

### 2. Relocate the bespoke Robota-package layering scans out of the general suite

`check-agent-server-boundary` (433 lines, hardcodes app graph + required-SPEC prose regexes),
`check-command-layering` (CLI internals + literal slash-command name list), `check-sdk-public-surface`
(agent-framework barrels + forbidden owner packages), `check-background-workspace-conformance` (executor/
framework files + class names). Convert to config-driven repo-local layering rules (or one shared layering scan
sourcing package/edge lists from config); drop the required-SPEC-_prose_ regexes entirely (a scan should check
structure, not wording).

### 3. Config-ize the hardcoded `@robota-sdk/` scope prefix

In `check-test-module-mocks`, `check-workspace-refs`, `check-interface-imports`, `check-dep-kind`,
`check-capability-placement` (40 hardcoded patterns), and the `checkDagNodesLeaf` rule in
`check-dependency-direction` — source the scope prefix / package lists from `harness-config` so the otherwise
general check ports to any repo. Keep legitimate burn-down allowlists (e.g. MOCK-001) as data.

## Test Plan

- Each converted scan keeps its current pass/fail behavior on the current tree (snapshot before/after: the
  unified neutrality scan must flag exactly what the 5 separate scans flagged — add fixtures per subsystem).
- `run-all-scans` registry updated (5 entries → 1); `harness:scan` stays green; no orphaned scan files.
- `check-harness-config-paths` still passes (new config keys resolve).

## User Execution Test Scenarios

- Not applicable (harness scans; the scans' own fixtures + `harness:scan` are the maintained gate).
