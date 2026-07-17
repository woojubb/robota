---
title: 'OBSERVABILITY-001: daily work-report harness (template-based, UTC-daily, background-triggered)'
status: todo
created: 2026-07-18
priority: medium
urgency: later
area: .agents, scripts/harness, .claude
depends_on: []
---

# Daily work-report harness

## Problem

There is no automatic summary of what was done each day. The owner wants a per-day `.md` report of that
day's work, generated on a template, so the daily activity is captured without manual effort. This
supports the self-improving-harness north-star (a durable, reviewable trace of what the harness did).

## Owner requirements (verbatim intent, 2026-07-18)

- **One report per work day, keyed to UTC.** The report summarizes the work done on that UTC day.
- **Template-based.** There is a basic report template; each daily report is filled out to that template.
- **Purpose:** summarize, day by day, what work was done.
- **Delivered as a skill or a background agent** that triggers **naturally while the owner is working** —
  when the time comes (a UTC hour boundary / 정각), it fires as a **background agent** and writes the report.
- **No report on no-work days.** Days with no work produce no report.
- **Catch-up, day by day.** When a report is needed again after the last one, generate reports for each
  intervening **work** day **in order**, one per day (do not lump multiple days into one report).

## Open design questions (resolve at spec/GATE-WRITE time)

- **"Work day" detection signal.** Proposed default: a UTC day is a work day iff it has git commits (by the
  configured author) and/or recorded session activity that day. Pick the authoritative signal.
- **Report location + naming.** Proposed default: `.agents/reports/daily/YYYY-MM-DD.md` (UTC date). Confirm.
- **Template contents.** Design the template (candidate sections: date/UTC-window, summary, PRs merged,
  specs/tasks advanced, notable decisions, follow-ups filed, verification run). The template is the SSOT.
- **Trigger mechanism.** How the background agent fires at a UTC hour boundary during active work —
  a scheduled wakeup / cron entry, a session hook, or a `/`-invocable skill the owner (or a scheduler)
  runs. Must degrade gracefully when no session is active.
- **Idempotency + catch-up bookkeeping.** Track the last-reported UTC date so a re-run backfills each
  missing **work** day exactly once, in chronological order, skipping no-work days. Re-running for an
  already-reported day must not duplicate or clobber.
- **Data source for the summary.** Git log for the UTC day + merged PRs + spec/task state changes; keep it
  agent-generated from durable artifacts, not free-form recollection.

## Scope

Build the harness (template + work-day detection + report generation + background trigger + catch-up
bookkeeping). **Create this backlog now; implement it only after the current in-flight work is done**
(owner instruction 2026-07-18). Follow the spec-gate pipeline (GATE-WRITE → APPROVAL → IMPLEMENT → …) when
implementation begins.
