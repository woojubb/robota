# Tasks — HARNESS-002: Done-backlog evidence regression scan

Spec: `.agents/spec-docs/active/HARNESS-002-done-evidence-scan.md`
Test Plan SSOT: the spec's TC table.

- [x] T1 (TC-01): `scripts/harness/check-done-evidence.mjs` — extract repo-file paths
      (`packages/|apps/|scripts/` + extension) from `.agents/backlog/completed/*.md`;
      existing referenced path → scan passes (fixture test).
- [x] T2 (TC-02): missing referenced path → scan fails naming the backlog file AND the
      missing path (fixture test).
- [x] T3 (TC-03): prose-only file (no repo paths) → skipped, scan passes (fixture test).
- [x] T4 (TC-04): `<!-- evidence-superseded: <reason> -->` annotation exempts a missing
      path; exemption count reported (fixture test).
- [x] T5 (TC-05): `harness:scan:done-evidence` pnpm script runs standalone; registered in
      `run-all-scans.mjs` (aggregate reports 23 scans).
- [x] T6 (TC-06): initial live triage — scan green on the current `completed/` set (stale
      references restored or annotated with replacement evidence).
- [x] T7 (TC-07): `.agents/rules/backlog-execution.md` documents the durable-artifact
      evidence rule referencing this scan.
- [x] T8: wrap-up — harness tests green; PR to develop (squash); backlog moved to
      completed/ (User Execution N/A — harness/internal tooling).

## Test Plan

Authoritative TC table: `.agents/spec-docs/active/HARNESS-002-done-evidence-scan.md`
(## Test Plan). Summary: TC-01..TC-04 via check-done-evidence.test.mjs fixtures; TC-05
via pnpm script + aggregate output; TC-06 via live run; TC-07 rule-doc diff review at
GATE-COMPLETE.
