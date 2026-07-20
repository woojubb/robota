---
title: 'SELFHOST-012: scheduled / cron tasks with pause/resume/edit'
status: done
completed: 2026-07-19
created: 2026-07-16
priority: low
urgency: later
area: packages/dag-scheduler, packages/agent-command, packages/agent-cli
depends_on: []
---

# Scheduled / cron tasks

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md).
Differentiator. Robota has background tasks + `dag-scheduler`, but no **user-facing** scheduled-task surface
(create/list/pause/resume/edit a cron task).

## What

A user-facing scheduled-task surface over `dag-scheduler`: create/list/pause/resume/edit recurring tasks, with a
command in `agent-command`/`agent-cli`. Reuse the existing scheduler; add the surface + lifecycle controls.

## Prior Art

Hermes scheduled cron tasks with pause/resume/edit (https://hermes-agent.nousresearch.com/docs/).

## Test Plan

Unit tests for the schedule lifecycle (create/pause/resume/edit) over dag-scheduler; a functional test that a
paused task does not fire and resumes; CLI behavior test. Architecture Review confirms reuse of dag-scheduler
(no new scheduler).
