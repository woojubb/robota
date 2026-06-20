# HARNESS-016: 완료 태스크 아카이브 강제 (task-archival scan) — Task Breakdown

- **Status**: completed
- **Created**: 2026-06-20
- **Scope**: scripts/harness, .claude/hooks, .agents/skills/task-tracking, .agents/rules

## Problem

Completed `.agents/tasks/*.md` breakdowns kept piling up in the active directory instead of being
moved to `completed/`. Root cause: the only "done" detector — both task-tracking hooks — grepped a
`- **Status**:` field that the task-breakdown format (a `Spec:` pointer + `## Plan` checkboxes) never
carries, so every file reported `status: unknown`. The Stop hook only echoed an advisory reminder and
exited 0; no scan failed. Meanwhile the active/completed split is load-bearing: `scan-test-plan.mjs`
reads `.agents/tasks/*.md` (excluding completed/), so a done-but-active file feeds a stale plan
forever. Conclusion: the rule has value, but enforcement and detection were broken — fix the
mechanism, do not drop the rule.

## Plan

- [x] TC-01: all-checked breakdown whose `Spec:` is in `spec-docs/done/` → archivable
- [x] TC-02: any unchecked box → not archivable
- [x] TC-03: all-checked but spec in todo/active → not archivable (conservative, no false positive)
- [x] TC-04: explicit `Status: completed` → archivable even without checkboxes
- [x] TC-05: `Status: in-progress` → not archivable
- [x] TC-06: `<!-- archival-exempt: <reason> -->` → reported as exemption, not finding
- [x] TC-07: no checkboxes and no status → ignored
- [x] `scripts/harness/check-task-archival.mjs` scan (exported `classifyTaskFile`/`findTaskArchivalFindings`)
- [x] Unit test `scripts/harness/__tests__/check-task-archival.test.mjs`
- [x] Wire `task-archival` into `run-all-scans.mjs` + `harness:scan:task-archival` npm script
- [x] Rewrite both task-tracking hooks to use the same done-signal (report `DONE, needs archival`)
- [x] task-tracking SKILL: explicit, enforced "Archival Timing" section + two-format note
- [x] common-mistakes.md row #62 (lesson)
- [x] Archive the 13 pre-existing done files (CTX-001, HIST-001, PRESET-006..017) via `git mv`

## Test Plan

`scripts/harness/__tests__/check-task-archival.test.mjs` covers TC-01..TC-07 against the exported
`classifyTaskFile`. Scan behavior verified by running `node scripts/harness/check-task-archival.mjs`:
it reported all 13 done-but-active files (exit 1) before archival and `passed` (exit 0) after. Hooks
verified by direct `bash` execution — both now label the same 13 as `DONE` instead of `unknown`.

## Result

"Done" is now machine-detectable from a signal the artifact actually carries, archival is enforced by
a `harness:scan` member (not advisory echo), the hooks and the scan share one definition of done, and
the existing 13-file backlog of unarchived tasks was cleared. The escape hatch
(`<!-- archival-exempt: <reason> -->`) covers complete-but-intentionally-active files. No follow-up.
