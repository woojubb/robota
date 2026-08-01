---
title: 'HARNESS-055: two actions are pinned to a BRANCH, not a tag — the ref resolves today and can point anywhere tomorrow'
status: todo
created: 2026-07-26
priority: low
urgency: later
area: .github/workflows, scripts/harness
depends_on: [INFRA-059]
---

# HARNESS-055 — a reference that resolves is not the same as a reference that is pinned

Measured 2026-07-26 while building INFRA-059's resolvability guard, by resolving every reference in
`.github/workflows` against the real remote:

| reference                             | resolves through |
| ------------------------------------- | ---------------- |
| `pnpm/action-setup@v2`                | `refs/heads/v2`  |
| `actions/dependency-review-action@v5` | `refs/heads/v5`  |
| the other 11 references               | `refs/tags/<v>`  |

A `refs/heads` ref is a **branch**. Whoever can push to that branch changes what runs in this
repository's CI, on every workflow that uses it, with no diff here and no review. That is the
supply-chain half of the same question INFRA-059 answered for existence: `@v2` resolving is not a
statement about what `@v2` will be.

This is deliberately NOT a finding in `scan-action-references.mjs`. It resolves, so it is verifiable,
and failing on it would have reddened two references that item was not authorised to bump — a guard
that fires on something the author cannot fix gets suppressed, which costs more than it catches. The
scan instead prints a per-run inventory line, so this item always has current data.

## The decision this item needs

Whether to SHA-pin third-party actions (`uses: owner/repo@<40-hex> # vX.Y.Z`) — the practice GitHub's
own hardening guide recommends — and if so, for which set: all third-party actions, everything
outside `actions/*` and `github/*`, or only the branch-resolved ones above.

The trade-off is real and should not be decided by whoever happens to touch the file next: SHA pins
freeze a known-good commit, but they also freeze security patches, and they need a bot (or a
recurring chore) to advance. Note that INFRA-059's scan **already implements** the check that makes
pins trustworthy — a pinned SHA whose `# vX.Y.Z` comment no longer matches where that tag points is
a finding — and that rule has zero live subjects today precisely because nothing is pinned.

Bumping `pnpm/action-setup@v2` is not free either: v3+ changes how the pnpm version is resolved
(`packageManager` in the root manifest), so a bump is a behaviour change, not a version string edit.

## Acceptance

- [ ] The pinning policy is decided and recorded (which actions, and how pins are advanced).
- [ ] If pinning is adopted: the references are converted, each pin carrying its `# vX.Y.Z` comment,
      and INFRA-059's tag-mismatch rule is shown firing on a deliberately wrong comment — it must not
      be believed while it has zero subjects.
- [ ] If pinning is NOT adopted: the reasoning is recorded here and the scan's inventory line is
      kept, so the exposure stays visible rather than being closed by silence.

## Test Plan

`node scripts/harness/scan-action-references.mjs --live` before and after any conversion: every
reference must still resolve, and the summary's branch-head count must drop to the intended number.
`pnpm harness:test` for the scan's own suite. If `pnpm/action-setup` is bumped, the `build` and
`quality` CI jobs are the behavioural proof, since every job installs through it.

## User Execution Test Scenarios

Not applicable: CI configuration and repository policy only — no user-facing surface, command or
runtime behaviour changes.
