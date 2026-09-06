---
title: 'HARNESS-102: nothing can observe a finding that was noticed and dropped — the find-to-issue skill instructs the behaviour and no mechanism can tell whether it was followed, because the failure state is an absence'
status: done
created: 2026-08-16
completed: 2026-09-06
priority: low
urgency: later
area: .agents/skills, scripts/harness
depends_on: []
no-issue: issue-registration policy alignment requested directly by the maintainer (stop auto-filing GitHub Issues from findings); no GitHub issue is the source record
---

# HARNESS-102: the unmechanized half of find→issue

Split out of HARNESS-100 so its `infeasible-now` terminal state has a tracked item other than itself.
`lesson-to-harness` step 8 permits infeasible-now **with a written obstacle plus a tracked item**;
HARNESS-100 named this Task's subject as the obstacle and pointed at itself, which is not a tracked
item. This is that item.

## Problem

`find-to-issue` instructs: when a defect is discovered mid-task, file a GitHub issue and keep going.
**Whether that happened is not observable from the tree.** A finding that was noticed and dropped
leaves no artifact — no file, no commit, no log line. There is nothing for a check to read, so the
failure state is an absence, and absence is the one thing a repository scan cannot see.

This is not "hard to check". It is a stated structural obstacle, which is why it is filed rather than
left as a silence.

## Directions worth testing before concluding it is impossible

None is obviously correct; each is a hypothesis:

- **Make the absence leave a trace.** If a session records what it noticed — even a one-line note —
  the absence becomes a presence and a check has a subject. The cost is a new artifact nobody may
  maintain, which is its own failure mode.
- **Sample rather than enforce.** A periodic read of recent sessions against the issues filed in the
  same window measures the rate without gating any single instance. Weaker than a gate, but a
  measured rate is not nothing, and it is honest about what it is.
- **Accept it and say so permanently.** If no mechanism can exist, the correct end state is a
  recorded, dated statement to that effect — so a later session does not spend the same effort
  rediscovering the obstacle. That is a legitimate outcome for this item, not a failure of it.

## Resolution (2026-09-06)

Direction 1 ("make the absence leave a trace"), driven by a maintainer-requested policy change that
widens this item's scope: `find-to-issue` no longer instructs filing a GitHub Issue at all — issue
count growth measured against `allocate-work-item-id.mjs` traced back to two paths that filed one
without being asked: `find-to-issue`'s own default action, and the allocator's silent
create-if-no-title-match fallback. Both are closed in this change:

1. `find-to-issue` now appends a five-field record to `.agents/learn.md` instead of filing an Issue —
   the absence HARNESS-102 names becomes a presence: a stable ID, a timestamp and evidence, on every
   mid-task finding, with no network call.
2. `allocate-work-item-id.mjs` / `work-item-issue-binding.mjs` no longer create a GitHub Issue when
   `--issue` is omitted and no exact title match exists; they refuse and name what to do instead
   (pass `--issue`, or record the finding in `.agents/learn.md`).

A GitHub Issue remains available for anyone to open by hand; what closes is the reflex of the harness
filing one automatically, which is the artifact-observability gap this item was filed to solve.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs` — the allocator
  refuses to create an Issue and requires `--issue` or an exact title match.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes internal harness/agent-workflow tooling (a Node CLI script and an agent
skill's instructions); it has no end-user runtime surface, CLI behavior, SDK contract, or
product-facing interaction to execute.
