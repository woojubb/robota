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

- `codeql.yml` STAYS in the scan's checked list, but only its workflow-level grant
  (`security-events`) is what the scan actually judges — the recovery job's `actions: write`
  is structurally invisible to `parsePermissions`, and the PR could record that fact only as a
  comment beside the entry, not as anything the scan enforces.
- `review-gate.yml` precedent: `disarm-auto-merge`'s `pull-requests: write` is documented in a
  comment, verified by nobody.
- The #1669 review round named the pattern: "the second job-level `write` grant now excused only
  in prose and invisible to this scan … worth a filed backlog item."

## Direction

Extend `parsePermissions` to walk `jobs.<id>.permissions` blocks and judge each job's effective
grant (job block overrides workflow block; absence inherits). Then:

- carry the recovery job's `actions: write` as a structured allowlist entry
  (file + job + permission + reason) in `codeql.yml`'s existing entry, replacing the prose
  comment;
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
