---
title: 'HARNESS-093: package scenario:record scripts reference a deleted owner-record CLI'
status: done
created: 2026-08-15
completed: 2026-08-15
priority: high
urgency: now
area: scripts/harness, example-owning packages
depends_on: []
---

# HARNESS-093: restore the package-owned scenario record entrypoint

## Problem

Example-owning packages still declare `scenario:record` commands that invoke
`scripts/harness/record-owner-scenario.mjs`, but that entrypoint was deleted while its shared payload,
normalization, command-execution, and validation implementation remained in `scenario-records.mjs`.
Consequently a package cannot create or refresh the canonical record that `harness:verify
--include-scenarios` requires. This directly blocks ARCH-014's executed-scenario gate.

## Direction

Restore only the thin package-facing CLI. It must parse `--scope`, `--output`, and the command after
`--`, delegate execution and record construction to the existing `scenario-records.mjs` SSOT, fail
closed when the command exits non-zero, and overwrite the requested canonical record atomically from
the caller's perspective. Do not duplicate normalization, hashing, or validation rules.

## Test Plan

- Run the existing `agent-core` and `agent-session` package `scenario:record` commands to prove their
  declared entrypoint resolves and produces valid records.
- Run `pnpm harness:self-check` and the consistency scan that validates example-owner scripts and
  artifacts.
- Exercise the restored CLI through ARCH-014's new package-owned record command, then run the matching
  scenario verification and scoped harness verification.

## User Execution Test Scenarios

Not applicable — this is a governance/harness entrypoint restoration and delivers no user-facing
product behavior. Its evidence is the package-owned record/verify commands and harness checks above.

## Progress

### 2026-08-15

- Confirmed the entrypoint was deleted while two existing package scripts still reference it.
- Confirmed all substantive record behavior remains owned by `scenario-records.mjs`.
- Restored an import-safe delegating CLI and added success, failure, and import-inertness coverage.
- Verified both pre-existing package owner commands and the new ARCH-014 owner command can record.
- `harness:self-check`, consistency, and the focused 23-test harness suite passed.

## Decisions

- Restore the previous thin delegating CLI rather than creating a second scenario-record implementation.

## Blockers

- None.

## Result

Package-owned scenario recording works again through one shared normalization/hash implementation.
The CLI fails closed on owner-command failure and performs no work when imported.
