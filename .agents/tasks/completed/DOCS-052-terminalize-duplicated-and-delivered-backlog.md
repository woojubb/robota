---
title: 'DOCS-052: terminalize duplicated and delivered backlog records'
status: done
created: 2026-08-29
priority: high
urgency: now
area: .agents/tasks, .agents/spec-docs
depends_on: []
no-issue: document batch authorized by DOCS-029; records existing issue and PR ownership
completed: 2026-08-29
---

# DOCS-052: terminalize duplicated and delivered backlog records

## Objective

Remove stale actionable copies for TOOL-007 and MEM-001, which duplicate canonical GitHub issues, and
HARNESS-123, which was already delivered by a merged pull request.

## Plan

- [x] TC-01: archive the three records with exact issue or merge evidence.

## User Execution Test Scenarios

Reason: not applicable because this task only archives backlog documents and records existing delivery or
issue ownership; it changes no user-facing execution surface.
**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Recorded reason: not applicable because this document-only batch changes no user-facing execution surface.

## Test Plan

Inspect issues #1999 and #2055, PR #2363, and archived metadata; run repository scans and CI-like
document verification. The diff must contain no package, app, API, policy, CI, or runtime files.

## Tasks

- [x] TC-01: archive TOOL-007, MEM-001, and HARNESS-123 with evidence.
