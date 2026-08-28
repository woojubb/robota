---
title: 'DOCS-030: terminalize backlog-zero migration batch 01'
issue: https://github.com/woojubb/robota/issues/2404
status: todo
created: 2026-08-29
priority: critical
urgency: now
area: legacy Task/spec lifecycle records and frozen-baseline path keys
depends_on: []
---

# DOCS-030: terminalize backlog-zero migration batch 01

## Objective

Return the first six units of the fixed backlog-zero population to canonical GitHub issues. Preserve
every historical gate verdict and make no
package source, API, policy, workflow, hook, product, or user-document change.

Source initiative: https://github.com/woojubb/robota/issues/2404.

Standing authorization: `BACKLOG-ZERO-MIGRATION`, registered 2026-08-28. This Task is one bounded
documentation-only batch derived from Git object `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

## Plan

- [ ] Commit the exact six-unit Migration Manifest before GATE-APPROVAL and revalidate every source
      blob plus live ownership/reservation immediately before remote mutation.
- [ ] Create and uniquely read back exact AGREEMENT-001 and AGREEMENT-002 convergence issues; append a
      complete handoff to both and to exact open issue #2139, issue #2047, issue #2138, and issue #2140.
- [ ] Terminalize all six unfinished Task/spec records as `skipped`/`rejected` with exact
      handoff-comment URLs, without rewriting delivery history.
- [ ] Rekey only the existing frozen-baseline entries named in the manifest; add no exemption.
- [ ] Run lifecycle, baseline, reference, standing-delegation, focused path, full harness scans, and
      `pnpm harness:verify-like-ci`.

## Recommendation Gate

Pending independent review of the committed manifest. The proposed disposition preserves GitHub Issues
as the durable queue, keeps delivered history, and changes no implementation or policy.

## Test Plan

- `node scripts/harness/check-task-archival.mjs`
- `node scripts/harness/scan-doc-folder-status-agreement.mjs`
- `node scripts/harness/scan-standing-delegation-evidence.mjs`
- `node scripts/harness/scan-reference-kind-qualified.mjs`
- `pnpm harness:scan`
- `pnpm harness:verify-like-ci`

## User Execution Test Scenarios

`SCENARIO DRAFTED: not-applicable | 0`

Not applicable. This batch changes only internal lifecycle records and frozen-baseline path keys; it
does not add or change a runnable product surface. Package/app source, API/contracts, policy,
workflows/hooks, product behavior, and user-authored documentation are excluded, so there is no
product surface against which a user-execution scenario could run.

## Result

Pending.
