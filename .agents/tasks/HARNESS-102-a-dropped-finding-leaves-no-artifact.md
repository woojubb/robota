---
title: 'HARNESS-102: nothing can observe a finding that was noticed and dropped — the find-to-issue skill instructs the behaviour and no mechanism can tell whether it was followed, because the failure state is an absence'
status: todo
created: 2026-08-16
priority: low
urgency: later
area: .agents/skills, scripts/harness
depends_on: []
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

## Test Plan

- Whichever direction is chosen carries its own prove-it-fails, or the item closes with the
  written finding that no mechanism is possible and why.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — process change with no runnable user-facing behaviour.
