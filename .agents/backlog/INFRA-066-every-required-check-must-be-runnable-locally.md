---
title: 'INFRA-066: every required status check must be runnable locally, or say why it is not'
status: todo
priority: high
urgency: soon
type: INFRA
area: scripts/harness, .github/workflows
created: 2026-07-27
depends_on: [INFRA-055, INFRA-056]
---

# INFRA-066 — the third invariant axis: local reachability

## Problem

Two invariants already govern required status checks, and neither asks whether you can run one
before you reach it:

| Invariant                               | Question it answers                                          |
| --------------------------------------- | ------------------------------------------------------------ |
| `ci-mirror-map` (INFRA-056)             | do local stages match **`protect-develop`'s** required jobs? |
| `scan-main-required-checks` (INFRA-055) | can a required check **fail**?                               |

Missing: **can it be run locally, before it blocks you?**

Measured 2026-07-27. `protect-main`'s `release-grade verification` runs on no other branch, so its
verdict was unknowable until a promotion PR was already open. Two consecutive promotions failed on
it — a timing-flaky test, then a fixture outside a newly contained root — each costing an
open-PR → CI → diagnose → fix → re-promote round trip. The command that reproduces it,
`pnpm harness:verify:release`, sat in `package.json` the whole time and is even named in
`verify-like-ci.mjs`'s own header. **Writing it down was not enough**, which is the point: the gap
was never information, it was the absence of a connection between the command and the act.

That one gate is now closed — `promote.mjs` runs it and discards the branch when it fails, with
`promotion-preflight-parity` pinning the connection so the two cannot drift. This item is the
GENERAL form, so the next unreachable check does not have to be discovered the same way.

## The subject

Twelve required contexts across two rulesets, read live 2026-07-27:

```
protect-develop   build, quality, scans, dependency audit, commitlint,
                  tui-e2e, examples-typecheck, windows-shell, review-gate
protect-main      promotion ancestry, main PR source guard, release-grade verification
```

Some are genuinely not locally runnable — `windows-shell` needs a Windows runner, `review-gate` and
`main PR source guard` read GitHub state that does not exist offline. **That is a legitimate
answer, and it must be recorded as one** rather than left as an omission indistinguishable from an
oversight. Which is exactly the distinction the whole `vacuous-green` family of items is about.

## Proposed direction

One declaration, each required context mapped to either:

- the local entry point that reproduces it, pinned to what the job actually runs — not to a literal
  copied from it, the way `promotion-preflight-parity` reads the job's own block; or
- an explicit `not-locally-runnable` with the reason (platform, GitHub state, cost).

With anti-rot in both directions: a context that disappears from a ruleset fails its stale entry, and
a context added to a ruleset with no entry fails for being undeclared. Without the second half this
is a list that silently stops covering the thing it names.

**Do not verify these by reading.** Each mapping claim should be established by running the local
entry point and confirming it exercises what the job exercises — the failure mode this item exists
to prevent is precisely a named equivalence that was never executed.

## Done when

- Every required context of both rulesets is declared, mapped or excused with a reason.
- A context added to a ruleset without a declaration fails, proven RED.
- A declaration whose context no longer exists fails, proven RED.
- Each mapped entry point is confirmed by execution, not by reading the workflow.
