---
title: 'HARNESS-082: job-level workflow permissions are invisible to the permissions scan'
status: todo
created: 2026-08-09
priority: high
urgency: next
area: scripts/harness
depends_on: []
issue: https://github.com/woojubb/robota/issues/1675
---

# HARNESS-082: job-level workflow permissions are invisible to the permissions scan

## Problem

`scripts/harness/scan-workflow-permissions.mjs` parses only the WORKFLOW-level `permissions:`
block. A job-level block — the form GitHub itself recommends for scoping a single job's grant —
is invisible to `parsePermissions`, so any write permission granted at job level is excused only
in prose (a comment in the scan's registry entry) and checked by nothing.

The category is growing: `review-gate.yml`'s `disarm-auto-merge` job was the first job-level
write grant carried on a comment, and `codeql.yml`'s `recover-review-gate` job
(`actions: write`, #1669) is the second. Each addition widens the unchecked surface silently —
the exact "excused-but-unchecked" drift the scan exists to prevent.

## Evidence

Measured 2026-08-09, during #1669 review:

- `codeql.yml` had to be REMOVED from the scan's checked list entirely, because the scan cannot
  see that the workflow-level grant stayed read-only while one job adds `actions: write` — the
  parser reads only the top-level block and would have judged the whole file by it.
- `review-gate.yml` precedent: `disarm-auto-merge`'s `pull-requests: write` is documented in a
  comment, verified by nobody.
- The #1669 review round named the pattern: "the second job-level `write` grant now excused only
  in prose and invisible to this scan … worth a filed backlog item."

## Direction

Extend `parsePermissions` to walk `jobs.<id>.permissions` blocks and judge each job's effective
grant (job block overrides workflow block; absence inherits). Then:

- restore `codeql.yml` to the checked list, with the recovery job's `actions: write` carried as
  a structured allowlist entry (file + job + permission + reason), not a prose comment;
- convert `review-gate.yml`'s `disarm-auto-merge` excuse to the same structured entry;
- fail on any job-level write grant not in the allowlist, so the category stops growing
  silently.

## Acceptance

- [ ] `parsePermissions` resolves the EFFECTIVE permissions per job (job-level override,
      workflow-level inheritance).
- [ ] Job-level write grants require a structured allowlist entry; a reason-less entry fails
      (anti-rot, same shape as scan-no-fallback).
- [ ] `codeql.yml` and `review-gate.yml` are both back under the scan with their two job-level
      grants allowlisted.
- [ ] Red-proof: a fixture (or temporary mutation) with an unlisted job-level `write` makes the
      scan fail before the fix to the allowlist, pass after.
