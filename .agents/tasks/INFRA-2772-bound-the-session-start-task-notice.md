---
title: 'INFRA-2772: Bound the SessionStart Task notice to what is actually in progress'
issue: https://github.com/woojubb/robota/issues/2772
status: in-progress
created: 2026-09-20
priority: medium
urgency: soon
area: .claude/hooks, scripts/harness
depends_on: []
---

# INFRA-2772: Bound the SessionStart Task notice to what is actually in progress

Spec: `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md`.

## Objective

`task-tracking.sh start` injects every open Task (166 files, 14,855 bytes, ~6 s of per-file `node`
spawns) into the agent's context on every session start and compaction, and calls all of them
"in progress" when 122 are `todo`. Make the notice list only `in-progress`/`blocked` Tasks, bounded
at 20 with the bound announced, count the rest, and classify the directory in one process.

## Plan

- [ ] `scripts/harness/task-lifecycle.mjs`: add `classify-dir <dir>` (one line per file:
      `name\tstate\tstatus`), `classify <file>` unchanged
- [ ] `.claude/hooks/task-tracking.sh`: one `classify-dir` call; `start` prints counts, the bounded
      `in-progress`/`blocked` list with the "showing the first 20 of M" line, the `todo` count line,
      and the unchanged DONE/INVALID lines; `stop` keeps its output
- [ ] `scripts/harness/__tests__/task-notice-is-bounded.test.mjs`: todo-not-listed, 21→20 + bound line,
      DONE still flagged, `classify-dir` shape
- [ ] `.agents/skills/task-tracking/SKILL.md`: one line on what the notice lists
- [ ] TC-01 — `pnpm exec vitest run scripts/harness/__tests__/task-notice-is-bounded.test.mjs` green,
      and red with the hook change reverted
- [ ] TC-02 — `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` exits 0
- [ ] TC-03 — `pnpm exec vitest run scripts/harness/__tests__/remaining-hooks-run.test.mjs scripts/harness/__tests__/open-issues-are-shown.test.mjs` exits 0
- [ ] TC-04 — `bash .claude/hooks/task-tracking.sh start | wc -c` under 3,000 bytes with one
      `showing the first 20 of` line

## Test Plan

Owned by the spec's `## Test Plan` table (TC-01 to TC-04): a new vitest suite
`scripts/harness/__tests__/task-notice-is-bounded.test.mjs` is the red-proof (todo counted not listed,
21 in-progress → 20 entries plus the bound line, DONE still flagged, `classify-dir` line shape); the
two existing hook suites pin capability preservation; the affected scan set is the regression run;
and the byte count of the hook's own output on this tree is the measurement the issue was filed on.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The change is to a repository-internal Claude Code SessionStart hook whose only output
is the context notice the agent reads; no end user of the Robota product (CLI, SDK, TUI, MCP server)
can observe it through any runnable product surface. Verification is the engineering test plan
(TC-01 to TC-04) in the spec document.
