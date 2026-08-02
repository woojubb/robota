---
title: 'HARNESS-066: machinery that stopped producing is still registered, and nothing distinguishes "retired" from "stalled"'
status: todo
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

| Asset                    | Last output           | Repo activity        | State                           |
| ------------------------ | --------------------- | -------------------- | ------------------------------- |
| `.agents/daily-reports/` | **2026-07-19**        | active through 08-02 | ran 3 days, stopped 14 days ago |
| `.agents/release-runs/`  | `3.0.0-beta.79.md`    | moved to changesets  | residue of a retired workflow   |
| `.agents/local-reviews/` | 32 files (gitignored) | —                    | see below                       |

Both scripts are still present: `scripts/harness/daily-report.mjs`, `scripts/harness/release-run.mjs`.

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
