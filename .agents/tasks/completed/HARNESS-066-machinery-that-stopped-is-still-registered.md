---
title: 'HARNESS-066: machinery that stopped producing is still registered, and nothing distinguishes "retired" from "stalled"'
status: done
completed: 2026-08-03
created: 2026-08-02
priority: medium
urgency: next
area: .agents, scripts/harness
depends_on: []
---

# HARNESS-066: stopped is not the same as retired, and the tree cannot tell them apart

## Problem

Two `.agents/` asset trees stopped producing output while their scripts remain on disk and
registered. Nothing records whether each was retired deliberately or simply stalled — so the next
reader cannot tell a decision from a lapse, and neither can a scan.

## Evidence

From an external read-only investigation (2026-08-02); the dates and file listings were re-verified
here.

| Asset                    | Last output           | Repo activity           | State                                           |
| ------------------------ | --------------------- | ----------------------- | ----------------------------------------------- |
| `.agents/daily-reports/` | **2026-07-19**        | active through 08-02    | ran 3 days, stopped 14 days ago                 |
| `.agents/release-runs/`  | `3.0.0-beta.79.md`    | ~~moved to changesets~~ | ~~residue of a retired workflow~~ — WRONG, LIVE |
| `.agents/local-reviews/` | 32 files (gitignored) | —                       | see below                                       |

**The release-runs row is struck through because it is false, and the correction is left visible
rather than edited away.** `3.0.0-beta.79` is the CURRENT `agent-cli` version and there are 16
artefacts, not one — the last release produced its run file, so nothing lapsed. `.agents/rules/publish.md`
requires a version-specific file here; `scripts/publish/publish-packages.sh` runs
`pnpm harness:release:check -- --publish` on every publish; `check-release-governance.mjs`
(registered in `run-all-scans.mjs`) enforces the machinery and reads that directory's README. The
investigation asserted "moved to changesets" from a report rather than from the tree — the exact
failure this Task is about, committed by the Task itself.

<!-- evidence-superseded: daily-report.mjs was deleted by this Task's own resolution — retiring the directory while leaving the generator and its registered skill in place was the contradiction review caught. release-run.mjs remains, because that asset turned out to be live. -->

Both scripts were present when this was filed: `scripts/harness/daily-report.mjs`,
`scripts/harness/release-run.mjs`.

**A natural experiment already ran here.** `daily-reports`' README says the script fills the facts
and an **agent writes the `## Summary` prose** and commits it. A clock-driven cadence plus a prose
step has no recovery pressure once it lapses. The **event-driven** `.agents/archive/audits/` tree, by
contrast, has output dated 2026-08-02. Same repo, same authors, two cadences, opposite lifespans —
which is a stronger argument than any preference about how to schedule reports.

**`local-reviews/` is a measured defect, not a guess.** `.github/workflows/review-gate.yml` records
what happened: _"the merging clone held a record for a DIFFERENT branch and would have answered one
PR's merge with another PR's disposition."_ The directory is gitignored and keyed on local
branch/HEAD, so it is invisible to the clone that merges. The blocking decision was correctly moved
to a PR label — but 32 files and the directory remain, with nothing saying it has been demoted to a
local note cache. The next reader can still mistake it for gate evidence.

## Why this is foundational (or not)

**LOCAL.** Each is independently resolvable and none blocks other work. It is filed because the
common shape — _a mechanism whose output stopped while its registration did not_ — is the same one
that produces vacuous checks (HARNESS-064): something that looks live and is not.

## Direction

`.agents/archive/README.md` already states the retention policy — it archives _kinds_ of artefact,
not finished work — so the decision is which of these are kinds worth keeping. For each of the three,
choose one and write it down where the tree shows it:

- **Retire**: move to `archive/`, delete the script, say why in the README.
- **Resume**: fix the reason it stalled. For `daily-reports` that means the prose step, since the
  evidence above says clock-driven-plus-prose is what failed.
- **Demote**: keep it, and record in its README that it is not what a reader would assume — this is
  the honest answer for `local-reviews`, which is a useful local cache and not gate evidence.

Do NOT resolve this by deleting the directories quietly. The distinction between retired and stalled
is the artefact this Task is about; deleting both erases it.

## Test Plan

- No behavioural regression to red-prove — this is a governance/asset decision, and saying so is
  more honest than inventing an assertion.
- If the outcome is a scan (e.g. "a registered generator whose output is older than N days must
  declare itself retired"), that scan needs the usual red-first: a stalled generator must FAIL it,
  proven before the scan is trusted.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Does not apply.** No user-facing surface.

## Implementation

Three assets, three decisions, each written where the tree shows it — which is the artefact this task
is about. Nothing was deleted quietly: the distinction between retired and stalled is what would have
been erased.

**`daily-reports/` — RETIRED.** Last output `2026-07-19.md` against a repository active through 08-02.
Retired rather than resumed, on the natural experiment already in the tree rather than on preference:
this generator is CLOCK-driven and needs an agent to write prose before the artefact is worth
anything, and it lapsed after three days; `.agents/archive/audits/` is EVENT-driven and has output
dated 2026-08-02. Same repository, same authors, two cadences, opposite lifespans. A clock-plus-prose
cadence has no recovery pressure — nothing goes wrong when it stops, which is why it stopped without
anyone noticing. The existing reports stay as a record of the days they cover.

Retired means the REGISTRATION is gone, not just the output. The first attempt left the script and
the `daily-report` skill in place "runnable by hand" — while that skill was still listed in
`.agents/skills/index.md` and still said generation "**MUST** run as a background worker",
"self-scheduled … near a UTC hour boundary during active work". A RETIRED directory that a registered
skill orders an agent to write to on a cadence is a live contradiction: this Task's own defect,
re-created by its own fix, and caught by review. The skill, its index row,
`scripts/harness/daily-report.mjs` and that script's test are deleted; git history keeps them.

**`release-runs/` — LIVE, and the Task's premise was wrong.** See the struck-through Evidence row.
A RETIRED label was written here before the tree was checked and is now reverted; the directory's
README carries the correction so the question is not re-opened by the next reader.

**`local-reviews/` — DEMOTED**, and this one needed more than a sentence. The directory is gitignored,
so a README explaining the demotion would have been invisible to the next reader — the exact failure
the demotion is about. `.gitignore` now excludes the directory's CONTENTS rather than the directory,
because git cannot re-include a file whose parent directory is excluded: the first attempt at the
negation silently kept ignoring the README, and `git check-ignore` said so. Records stay ignored; the
explanation is tracked.

No behavioural regression to red-prove, and the task says so itself. Inventing an assertion here would
pin nothing.
