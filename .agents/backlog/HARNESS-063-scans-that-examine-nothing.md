---
title: 'HARNESS-063: three scans whose subject is empty, and one that cannot fail in CI'
status: todo
priority: medium
urgency: soon
type: HARNESS
area: scripts/harness
created: 2026-08-01
depends_on: []
issue: https://github.com/woojubb/robota/issues/1554
---

# HARNESS-063 — a pass over an empty corpus reads exactly like a clean sweep

## Problem

`requireGovernedTree` (HARNESS-052) fences the case where a scan's tree is ABSENT. It does not fence
the case where the tree exists and is empty, or where the live half of a corpus is empty while a
frozen archive supplies the count. Measured 2026-08-01:

| Scan                                  | What it examines                        | Measured                                                                                                                                                     |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `check-task-archival`                 | `.agents/tasks/` excluding `completed/` | **0 of 423** files — the directory holds one README and an archive                                                                                           |
| `scan-test-plan`                      | four trees                              | live pipeline stages contribute **0**; all 26 documents checked come from `docs/superpowers/`, which a sibling scan excludes as "dated historical artifacts" |
| `check-design-doc-completeness`       | `packages/*/docs/design/**`             | **0** — it reports this via the advisory channel, honestly                                                                                                   |
| `scan-progress-report-quantification` | the agent host's transcripts            | in CI there is no such directory: explicit SKIP, **exit 0**. It cannot fail in the required `scans` job, and is the 3rd slowest scan at 1281 ms              |

None of these is dishonest code. Together they are four green lines in an 83-scan summary that report
nothing verified, and the summary is what a reader takes as the state of the tree.

## Direction

Not deletion — every one of them fails correctly on a new malformed document. What is missing is that
**a pass says how much it examined**, which is `HARNESS-057`'s subject; this item is the measured
list that makes it concrete. Plus two specific decisions:

- `.agents/tasks/` is either revived with a stated purpose or retired together with its scan — and
  that decision belongs with PROC-006, which is already reconciling the tracking trees.
- `scan-progress-report-quantification` is an agent-host check registered in a repo-wide gate. It
  belongs on CI's `--skip` list beside `dist`, so the summary stops implying it verified something.

## Done when

- Each scan above reports its examined count, and a zero is visibly a zero in the summary.
- The two decisions are taken rather than inherited.
