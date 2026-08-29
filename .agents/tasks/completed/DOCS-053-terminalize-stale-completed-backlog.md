---
title: 'DOCS-053: terminalize stale completed backlog records'
status: done
created: 2026-08-29
priority: high
urgency: now
area: .agents/tasks, .agents/spec-docs
depends_on: []
completed: 2026-08-29
no-issue: document batch authorized by DOCS-029; records existing issue and PR ownership
---

# DOCS-053: terminalize stale completed backlog records

## Objective

Remove actionable copies whose implementation is already merged or whose canonical ownership is an
open GitHub issue.

## Plan

- [x] TC-01: archive TOOL-006 with merged PR evidence and HARNESS-130 with issue #2410 handoff.

## User Execution Test Scenarios

Reason: not applicable because this task only archives backlog documents and records existing delivery or
issue ownership; it changes no user-facing execution surface.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Recorded reason: not applicable because this document-only batch changes no user-facing execution surface.

## Test Plan

Inspect PR #2040 and issue #2410; run repository scans and CI-like document verification. The diff must
contain no package, app, API, policy, CI, or runtime files.

## Tasks

- [x] TC-01: archive TOOL-006 and HARNESS-130 with exact evidence.

### Completion evidence

TOOL-006 was delivered by merged PR #2040 (`a432cd380`); HARNESS-130 is handed off to canonical open
issue #2410. No source, API, policy, CI, or runtime paths changed.

### Completion evidence

TOOL-006 was delivered by merged PR #2040 (`a432cd380`); HARNESS-130 is handed off to canonical open
issue #2410. No source, API, policy, CI, or runtime paths changed.
