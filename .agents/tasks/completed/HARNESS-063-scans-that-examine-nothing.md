---
title: 'HARNESS-063: three scans whose subject is empty, and one that cannot fail in CI'
status: done
completed: 2026-08-01
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

## Half one — the examined count (#1561)

Landed. Verified on this tree, `pnpm harness:scan`, all 84 scans passing:

```
⚑ design-doc: design-doc completeness examined 0 documents in 76 package design director(y/ies) …
⚑ progress-report-quantification: progress-report quantification examined 0 transcript(s) — no session transcript for this workspace at … ; the agent-narrative channel does not exist on this host (e.g. CI or a fresh checkout), so nothing was judged.
⚑ task-archival: task-archival examined 0 active task files — the active half of .agents/tasks/ is empty (422 archived under completed/), so this pass verified no document.
⚑ test-plans: test-plan examined 0 live planning documents — the 26 document(s) checked all come from docs/superpowers/plans, docs/superpowers/specs …
```

All four zeros are visible, each with its reason.

## Decision 1 (2026-08-01) — `.agents/tasks/` is REVIVED, not retired

Measured on this tree:

| Fact                               | Number                                                  |
| ---------------------------------- | ------------------------------------------------------- |
| live documents in `.agents/tasks/` | **0** (one `README.md`, no task file)                   |
| archived under `completed/`        | **422**                                                 |
| last live task file added          | `CMD-004-phase2.md`, 2026-07-25 — archived the same day |
| harness consumers reading the tree | **5** scans/scripts + one hook + one skill              |

The five: `check-task-archival.mjs`, `check-plan.mjs`, `daily-report.mjs`, `scan-test-plan.mjs`,
`scan-guard-scope-fail-closed.mjs`. Plus `.claude/hooks/task-tracking.sh` and the `task-tracking`
skill.

**Revive.** PROC-006 has already decided that a unit of work is named a **Task** and that this tree
becomes its one home — it names this item as the pending verdict and treats "revive" as the premise
of its own plan. Retiring the tree and its scan here would delete the destination that decision
depends on and force PROC-006 to re-create it, so retire is not the cheaper option, it is the more
expensive one.

**How it survives PROC-006's rename.** Nothing here moves a document, renames a tree or touches the
scan's subject — that is PROC-006's work, and this decision is the answer it was waiting on rather
than a pre-emption of it. What lands is the stated purpose, written into `.agents/tasks/README.md`:
the tree holds the live record of a unit of work, and it is empty of live documents by circumstance
rather than by policy until PROC-006 performs the move. If PROC-006 later lands a different
conclusion, the README is one paragraph to rewrite, not a tree to reconstruct.

`check-task-archival` keeps running. An empty active half is not a failure — an author with no open
work is correct work — and the advisory that names the zero is what stops the pass reading as a
sweep.

## Decision 2 (2026-08-01) — `scan-progress-report-quantification` stays OFF the CI `--skip` list

The item proposed adding it beside `dist`, on two grounds. Both were measured, and both fail:

| Ground                                      | Measured                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "3rd slowest scan at 1281 ms"               | that is the DEVELOPER-HOST cost, on the host where it has transcripts and therefore verifies something. With no transcript directory — the CI condition — it costs **27–31 ms**. |
| "the summary implies it verified something" | closed by HARNESS-057/#1561: it prints its examined count and an advisory naming the zero AND the reason.                                                                        |

And keeping it has a positive value the skip would throw away, for that ~30 ms: CI EXECUTES the
module, so a crash, a broken import or a bad config key fails the required `scans` job. On the
`--skip` list it would never run there, and `run-all-scans` would print `skipped: … (--skip)` — a
line that drops the reason the scan itself reports today.

The two scans that ARE skipped are skipped for a different reason, stated in `ci.yml`: `dist` and
`build-contracts` cannot run on a fresh checkout at all. This one can, and does.

**Leave as is.** The decision is anchored by
`scripts/harness/__tests__/scan-progress-report-quantification-ci-placement.test.mjs`, red-proved by
adding the skip to `ci.yml` and watching the assertion fail — the first version of that assertion was
itself vacuous (`pnpm harness:scan:build-contracts` contains the substring `pnpm harness:scan` and
comes earlier in the file), which is why the matcher is anchored on a word boundary.

## What this item does NOT close

`scan-test-plan` and `check-design-doc-completeness` still examine zero live documents. Both report it
honestly, and neither was given a decision here because neither was asked for one — the item's two
decisions were the tasks tree and the CI skip list. Whether a scan whose live corpus is empty should
FAIL rather than report is HARNESS-057's question, not this one's.
