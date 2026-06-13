# Tasks — HARNESS-015: Orphan-export baseline burn-down to zero

Spec: `.agents/spec-docs/active/HARNESS-015-orphan-baseline-burndown.md`
Test Plan SSOT: the spec's TC table.

- [x] T1 (TC-01): per-entry triage table (disposition: delete / allowlist+reason /
      wire-to-surface) for all 153 baseline entries, committed with the batches.
- [x] T2 (TC-02): `scripts/harness/orphan-export-baseline.json` deleted and the
      baseline-loading branch removed from the scan (runs unconditionally).
- [x] T3 (TC-03): `pnpm harness:scan:orphan-exports` exits 0 on the final tree.
- [x] T4 (TC-04): every allowlist entry added by this work carries a non-empty reason
      string.
- [x] T5 (TC-05): every package touched by deletions/wiring passes its build + typecheck +
      tests in this branch.
- [x] T6 (TC-06): SPEC Public API Surface tables of touched packages contain no row
      referencing a deleted symbol.
- [x] T7: wrap-up — full harness scan green; PR to develop (squash); backlog moved to
      completed/ (User Execution N/A — internal dead-code cleanup per the backlog).

## Test Plan

Authoritative TC table: `.agents/spec-docs/active/HARNESS-015-orphan-baseline-burndown.md`
(## Test Plan). Summary: TC-01/06 manual review artifacts; TC-02/03 file-absence +
scan run; TC-04 allowlist content check; TC-05 per-package verification commands.
