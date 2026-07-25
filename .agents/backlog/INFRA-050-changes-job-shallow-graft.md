---
title: 'INFRA-050: the changes job uses a three-dot diff over a grafted history — can mis-skip code checks'
status: todo
created: 2026-07-26
priority: high
urgency: soon
area: .github/workflows/ci.yml
depends_on: [INFRA-049]
---

# INFRA-050: a shallow graft can make a code PR look docs-only

## Problem

Found while fixing INFRA-049 (#1420). That fix established the mechanism: the workflow checks out with
`fetch-depth: 0` and then runs `git fetch origin <base> --depth=50`, and **a `--depth` fetch grafts the
repository** — it truncates ancestry that was already complete. Measured on #1415: the same command over
the same branch saw **109 commits locally vs 97 (a different set) in CI**.

The commitlint job was fixed. **The `changes` job still carries the same pattern**, and it feeds

```
git diff origin/<base>...HEAD
```

A **three-dot** diff is computed against the _merge base_. On a grafted history the merge base can be
wrong or unreachable, so the diff can be wrong — and `changes` is what decides whether the code-side
jobs run at all.

The failure direction that matters: a **code** PR mis-classified as **docs-only** silently skips
`build` / `quality` / `tui-e2e` / `examples-typecheck` / `windows-shell`, all of which are required
checks. They would report `skipping` — which branch protection accepts — so the PR merges having never
been built or tested. That is a gate bypass, not a flake, and it fails **silently**.

INFRA-049 recorded this as out of its stated scope (soft failure, non-blocking there); it is filed here
rather than lost.

## What

Remove the graft: drop the `--depth=50` base fetch (checkout already fetches `+refs/heads/*` at full
depth — verified in #1415's checkout log), or replace the three-dot diff with an explicitly computed
merge-base that does not depend on a truncated history. Audit every other job that diffs or walks
history against the base for the same pattern while there.

## Test Plan

Red-first, and the red must demonstrate the **bypass**, not just a wrong file list: construct a PR whose
history triggers the graft and whose diff contains a source change, and show `changes` reports
`code=false` under today's config (so the required code jobs skip) and `code=true` after the fix. Then
confirm a genuinely docs-only PR still reports `code=false` — the fix must not make every PR run
everything. Consider whether this belongs in `harness:verify-like-ci`'s CI-mirror so the divergence
cannot re-open.
