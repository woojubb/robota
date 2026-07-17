---
name: daily-report
description: Generate the committed daily work report (OBSERVABILITY-001) — one markdown summary per UTC day that had work. Use when a UTC hour boundary passes during active work, or to catch up missing reports.
---

# Daily Work Report

## Rule Anchor

- Backlog: [OBSERVABILITY-001](../../backlog/completed/OBSERVABILITY-001-daily-work-report-harness.md)

## Use This Skill When

- A **UTC hour boundary** passes while working (the natural background trigger — see below).
- Manually, to catch up any missing daily reports.

Output: `.agents/daily-reports/YYYY-MM-DD.md` — one **committed** report per UTC day that had work
(git commits). No-work days produce no report. The harness catches up **day-by-day** from the last
report; you never lump multiple days into one report.

## Steps

1. **Plan.** Run the harness to list the UTC work days still needing a report (catch-up range,
   no-work days already skipped), with each day's gathered facts:

   ```bash
   node scripts/harness/daily-report.mjs --plan
   ```

   If `workDays` is empty → **stop** (no work, or all reported). Do not create an empty report.

2. **Write each report (day by day, oldest first).** For each work day, generate the factual report,
   then author its `## Summary`:

   ```bash
   node scripts/harness/daily-report.mjs --date <YYYY-MM-DD>
   ```

   This fills the commits / merged PRs / files·specs·tasks sections. Then **edit only the `## Summary`
   section** of `.agents/daily-reports/<YYYY-MM-DD>.md`: replace the `_(pending agent summary)_`
   placeholder with a **1–3 sentence prose summary** of what that UTC day accomplished, grounded in the
   report's own commits/PRs (not recollection). Keep the factual sections as generated.

3. **Commit.** Commit the report(s) on a branch and open a PR per the repo's git rules
   (`git-branch.md`): `docs(daily-report): <YYYY-MM-DD> work report`. One commit may cover several
   catch-up days.

## Background Trigger — runs in PARALLEL; never blocks the main task

Report generation MUST run as a **background agent, in parallel with the main task** — the main agent
does NOT stop its current work to write a report. Concretely: the main agent **dispatches this skill's
Steps to a background subagent** (`Agent` with `run_in_background: true`) and immediately continues its
own work; when the background subagent completes, the main agent is notified and gives the owner a
**brief one-paragraph briefing** on the report, then resumes. (Owner workflow, 2026-07-18.)

Entry points:

- **Self-scheduled (the intended default):** near a UTC hour boundary during active work, the main agent
  schedules/kicks off the background report subagent (e.g. via a scheduled wake / cron whose action is
  "dispatch the daily-report subagent"), then keeps working. Act only if the **Plan** step shows a work
  day needs a report.
- **Manual / on-demand:** the owner invokes `/daily-report` (or runs the harness) any time to catch up.

The trigger is idempotent: the harness writes a report only for a UTC day that is (a) a work day and
(b) after the last existing report — so re-firing on the same day is a no-op (use `--force` only to
regenerate an existing day's factual sections). Because it runs in the background, a report never
interrupts or slows the main work; the only foreground moment is the short completion briefing.

## Boundaries

- This skill only **orchestrates**: the harness (`scripts/harness/daily-report.mjs`) owns work-day
  detection, catch-up range, data gathering, and template rendering; this skill adds the prose Summary
  and commits. Do not reimplement the harness logic here.
- Reports are a durable record under `.agents/daily-reports/` — NOT the gitignored `.agents/reports/`.
