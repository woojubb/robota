---
title: 'DX-001: PR batching policy — bundle coherent work into appropriately-sized PRs (fewer CI waits)'
status: in-progress
created: 2026-07-16
priority: high
urgency: now
area: .agents/rules/git-branch.md, .agents/rules/backlog-execution.md
depends_on: []
---

# PR batching policy

## Problem

Splitting work into many tiny PRs (one per small doc/spec change) makes the agent wait for a full CI run on
each — the wait repeats far more than the work warrants. Small, closely-related changes that will merge together
anyway do not need a PR each. The existing **One-Backlog-per-PR / PR Unit Rule** (`git-branch.md`,
`backlog-execution.md`) targets **not mixing UNRELATED backlogs** — it does NOT require splitting a single
coherent work-unit into many PRs. That distinction was being over-applied.

## What (the policy)

Bundle multiple commits into one PR by BOTH criteria:

1. **Coherent work-unit** — the commits belong to the same feature/epic/batch/theme (e.g. all spec revisions in
   one design-gate pass; all backlog items in one roadmap authoring pass; a rule + its enforcement + its wiring).
   Do NOT bundle genuinely unrelated backlogs (that still violates the PR Unit Rule).
2. **Soft size ceiling** — split when a bundle would exceed roughly **~600 changed lines or ~15 files**, or when a
   part is independently revertible and valuable. Otherwise keep it in one PR.

Within a PR, use **one commit per logical step** (conventional-commit each), so history stays readable while CI
runs once for the bundle. Prefer a small number of medium PRs over many tiny ones.

**Reconcile with the PR Unit Rule:** unrelated backlogs → separate PRs (unchanged). Related steps of one
work-unit → one multi-commit PR (this policy). Implementation PRs that change runtime behavior still carry their
User Execution Test Scenarios; bundling does not waive any gate.

## Test Plan

- Update `git-branch.md` (and cross-ref `backlog-execution.md`) with the batching policy + the coherent-unit /
  size-ceiling criteria, reconciled against the PR Unit Rule.
- No mechanical scan required (a soft process guideline); a checklist line in `post-implementation-checklist` /
  the relevant skill suffices. If a mechanical nudge is wanted later, a PR-size advisory could be added, but it
  must not hard-block (some coherent units legitimately exceed the ceiling).
