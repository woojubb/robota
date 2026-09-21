---
title: 'HARNESS-2796: The three package-rename drift guards each delegate "does this name resolve" to the others, so their union covers nothing — a rename''s stale commands survive all three'
issue: https://github.com/woojubb/robota/issues/2796
status: todo
created: 2026-09-21
area: scripts/harness
priority: medium
urgency: soon
scripts/harness
depends_on: []
---

# HARNESS-2796: The three package-rename drift guards each delegate "does this name resolve" to the others, so their union covers nothing — a rename's stale commands survive all three

## Objective

Three scans exist for "does this package name resolve" and each delegates the question to another,
so their union covers nothing: `scan-filter-script-resolves` skips unresolvable filter tokens by
documented design, `check-workspace-refs` reads only manifests and helper scripts, and
`check-ghost-package-refs` strips inline code spans — where every `--filter` command lives. Two
corpus gaps compound it: `diagrams/*.mmd` is read by no scan, and `.changeset/` is blanket-exempted
as history although `pre.json` and a pending fragment's package header are live.

Fourth instance of this class; the first three are cited in the guards' own headers.

## Plan

- [ ] Give the question one owner reading one corpus, including commands inside code spans and non-`.md` live artifacts
- [ ] Apply the historical-record exemption per file kind rather than per directory, so `.changeset/pre.json` and pending fragment headers are checked
- [ ] Have the other two guards cite the owner instead of deferring to it
- [ ] Verify against the MCP-001 rename: every stale reference it left must be caught

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Pending design. This Task records a cause found during the MCP-001 review and filed under finding-depth.md; its user-execution disposition is decided when the change is planned, not when the cause is recorded.
