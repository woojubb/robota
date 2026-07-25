---
title: 'INFRA-054: every required check on a promotion PR was vacuous, and the real one is optional'
status: todo
created: 2026-07-26
priority: high
urgency: soon
area: repo rulesets, .github/workflows
depends_on: []
---

# INFRA-054: `protect-main`'s required contexts do not verify a promotion

## Problem

Surfaced while implementing INFRA-051 and confirmed by its `proposal-reviewer` pass. On a PR whose
base is `main`, every one of `protect-main`'s inherited required status checks is a **no-op**:

| Required context | What it does on a `base_ref == 'main'` PR                                                          | Measured on #1427 |
| ---------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| `build`          | `echo "build is covered by release-grade verification"`, every later step `if: base_ref != 'main'` | 5s                |
| `quality`        | same shape                                                                                         | 5s                |
| `scans`          | same shape                                                                                         | 6s                |
| `security audit` | same shape                                                                                         | 3s                |
| `commitlint`     | whole job is `if: github.base_ref != 'main'`                                                       | skipping          |

The one job that actually verifies a promotion — `release-grade verification`, 7m31s, running
`pnpm harness:verify:release` — is **not a required status check**. Neither is `main-pr-source-guard`,
the recurrence guard for the #1216 incident. And **CodeQL failed on #1427 and the PR merged anyway**.

So the branch that ships to production was, until INFRA-051 added `promotion ancestry`, gated by five
checks that assert nothing and one that asserts everything but cannot block.

Each individual skip is defensible in isolation (`release-grade verification` genuinely subsumes
`build`/`quality`/`scans`). The defect is that the _required_ list was never moved to match, so
branch protection reports green from jobs that deliberately did no work.

Related: a skipped required check is accepted by branch protection. INFRA-050 documented that same
property being exploited accidentally, and it is the reason this is not merely cosmetic.

## Direction

1. Make **`release-grade verification`** a required status check on `protect-main`. One-line ruleset
   change; costs the first promotion PR ~8 minutes instead of merging on 6-second echoes.
2. Make **`main PR source guard`** required, so the #1216 recurrence guard can actually block.
3. Decide whether `build`/`quality`/`scans`/`security audit` should stay in the required list at all
   for `main`, given they are echoes there — either drop them or make them do the work.
4. Decide whether CodeQL should be required on `main` PRs (it already runs there and already failed
   without blocking).
5. **Narrow `protect-main.bypass_actors`.** It currently grants `RepositoryRole 5` `bypass_mode:
always`, so an admin can bypass every rule including INFRA-051's two gates. Decide whether the
   promotion path should retain it.

## Acceptance

- [ ] `protect-main`'s required contexts include at least one check that verifies the promotion's
      content, proven by a deliberately-broken promotion branch being blocked.
- [ ] The bypass-actor decision recorded explicitly (kept, narrowed, or removed) with its reason.

## References

- `.agents/spec-docs/done/INFRA-051-promotion-ancestry-invariant.md` § Measured facts
- `gh api repos/woojubb/robota/rulesets/18715845`
- `gh pr checks 1427`
