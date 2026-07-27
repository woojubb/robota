---
title: 'INFRA-069: pre-push runs 0 of 81 scans for a source change, while `scans` is required'
status: todo
priority: high
urgency: soon
type: INFRA
area: scripts/harness, .husky
created: 2026-07-28
depends_on: [INFRA-066]
---

# INFRA-069 — the required `develop` gate has no local mirror

## Problem

`scans` is a **required** context on `protect-develop`. Measured: `harness:pre-push` never invokes
it — `grep -c "run-all-scans\|harness:scan" scripts/harness/pre-push.mjs` returns **0**. It runs
`harness:plan`, `harness:verify` and a CLI smoke, and that is all.

What the plan actually selects, measured through `createVerificationPlan`:

| Changed file                       | Repository checks selected                          |
| ---------------------------------- | --------------------------------------------------- |
| `packages/agent-core/src/index.ts` | **none**                                            |
| `package.json`                     | **none**                                            |
| `README.md`                        | `repository-review` — which has no executable check |
| `scripts/harness/**`               | 1 scan                                              |
| `.agents/rules/**`                 | 2 scans                                             |

So a package source change is pushed having run **zero** of the 81 scans that must pass on the PR.

The declared local mirror, `verify-like-ci`, is **invoked by nothing** — not `.husky/pre-push`, not
`pre-push.mjs`, not any workflow — and appears in 1 rule file and 0 skills, against `harness:scan`'s
11 rules and 13 skills. The thing people are told to run is not the thing that mirrors CI.

This is the same shape that cost two promotion round trips on `protect-main` (`INFRA-066`), sitting
unnoticed on `develop` the whole time.

## The cost is real but the fix has a price

Running 81 scans before every push is not obviously right — a slow pre-push gets bypassed with
`--no-verify`, and this repository already treats `--no-verify` as a total bypass with no CI
counterpart for formatting. **The decision this item needs is what the local gate should cost**, not
whether to run everything.

Options worth measuring rather than debating: the dist-independent subset only; scans selected by
changed paths the way `harness:verify` already selects scopes; or the full suite behind an
opt-out that is visible in the output.

## Done when

- A package source change runs a defined, non-empty set of the required scans before push, and the
  set is stated where a reader will find it.
- The measured wall-clock cost of that set is recorded, so the choice is defensible rather than
  assumed.
- `verify-like-ci` is either invoked by something or stops being described as the CI-equivalent
  entry point — a name with no caller is what made this invisible.
- Proven RED: a change that would fail a required scan is blocked locally before it reaches CI.
