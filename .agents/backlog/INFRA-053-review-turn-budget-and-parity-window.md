---
id: INFRA-053
title: Raise the review turn budget, and close the parity window that makes workflow edits risky
status: todo
priority: high
type: INFRA
created: 2026-07-26
---

## Problem

Two coupled defects, both surfaced by INFRA-048's parity fix.

### 1. The review exhausts its turn budget on essentially every PR

`claude-code-review.yml` runs the action with `--max-turns 25`. Now that the review actually executes
(it was silently skipping every run — see INFRA-048), the budget is the binding constraint on large
changes. Measured 2026-07-26:

| PR    | Size                          | Result                                           |
| ----- | ----------------------------- | ------------------------------------------------ |
| #1434 | large, multi-area             | `error_max_turns` at 25 — **no comments posted** |
| #1435 | moderate                      | completed in 1m40s                               |
| #1436 | **one backlog file, no code** | `error_max_turns` at 25 — **no comments posted** |

**It is not a function of PR size.** A single-file, code-free backlog PR exhausted the same budget,
so the review currently produces nothing on _most_ PRs, not only large ones. The check went from
green-and-empty to red-and-honest, which is a real improvement — the failure is at least visible now
— but review coverage is still effectively zero. That is why this is `high` rather than `medium`.

It is not blocking, though: `Claude review` is advisory, and the required `review-gate` reads
code-scanning output rather than this review, so the merge gate itself is unaffected.

### 1b. The budget is not the root cause — **17 of the 25 turns are permission denials**

Corrected 2026-07-26 after reading a full run log (`30189528981`) rather than the summary line:

```
"subtype": "error_max_turns",
"permission_denials_count": 17
##[error]Execution failed: Reached maximum number of turns (25)
ANTHROPIC_API_KEY:
```

Three findings, and two of them invalidate earlier diagnoses in this repo:

1. **Authentication is fine.** A sub-agent reported the failure as an unset `ANTHROPIC_API_KEY`
   secret. It is not: the trailing `ANTHROPIC_API_KEY:` is an env echo printed _after_ the failure,
   the run authenticates through `CLAUDE_CODE_OAUTH_TOKEN` (which exists), and the review demonstrably
   runs for ~2 minutes before exhausting its turns. Nothing is missing from the repository secrets.
2. **Most of the budget is spent being refused.** 17 denials out of a 25-turn cap. Raising
   `--max-turns` alone would buy proportionally more denials — the number to fix first is 17, not 25.
   The workflow declares **no `allowed_tools`**, so the reviewer runs on the action's default set
   while the prompt instructs it to read `AGENTS.md`, `.agents/rules/*`, `CLAUDE.md` and
   `CONTRIBUTING.md`.
3. **`fetch-depth: 1` cannot produce a diff.** The checkout fetches a single commit, so there is no
   base ref against which `git diff` could resolve — yet the prompt's entire task is "review this
   PR's diff" and it explicitly tells the reviewer not to explore the tree. Whatever the reviewer is
   reading, it is not reaching the diff the way a local reviewer would.

So the honest ordering is: **grant the tools the prompt requires, give the checkout enough history to
diff, and only then decide whether 25 turns is the constraint.** Measure the denial count after each
change; a budget raised over an unfixed denial loop is the "more of a thing that does not work"
shape.

### 2. Editing that workflow at all is a two-step with a blocking window

`anthropics/claude-code-action` compares its invoking workflow byte-for-byte against the **default
branch** (`main`) and silently skips when they differ. `scan-review-workflow-parity` now makes that
divergence fail loudly instead — inside `scans`, which is a **required** check.

The consequence: any edit to that file is red on one branch or the other until both carry it.

- Edit on `develop` first → `scans` is red on **every open PR to develop** until promotion.
- Edit on `main` first → same, in the window before the back-merge.

The scan exempts PRs whose base **is** `main` (`isPromotionToDefault`), so a `release/*` → `main` PR
passes. That gives a workable sequence, but not a window-free one.

## Direction

**The turn budget.** Raise it and justify the number from measurement, not taste — re-run the review
on a PR of #1434's size at the candidate value and confirm it completes. Consider also whether the
review should be scoped (per-area, or diff-size-aware) rather than given an ever-larger budget: a
budget that must grow with every large PR is not a fix, and an unbounded review is its own cost.

**The window.** Sequence, and preferably remove the need for one:

1. Cut `release/*` from `develop`, make the edit, PR → `main` (parity-exempt), merge.
2. Immediately back-merge `main` → `develop` so parity is restored.

Run this **only on an empty queue** — no open PRs to `develop`, no implementation agents running —
because the window blocks a required check for everyone. That is the same serial-only constraint
PERF-004 carries, and for the same reason.

Better than sequencing it carefully: make the window impossible. Options worth weighing — have the
scan compare against the branch the PR will merge into rather than the default branch; or accept the
divergence for the duration of a PR that demonstrably restores it. Either way the constraint is the
action's own behaviour, so any fix must keep the action from silently skipping.

## Acceptance

- [ ] Review completes with findings posted on a PR the size of #1434, proven by a live run.
- [ ] The turn budget's value is justified by a measurement, and the scoping question is answered
      either way.
- [ ] Either the parity window is closed, or the sequencing is written down where the next person
      editing that workflow will actually see it (the workflow file itself, not only here).

## References

- INFRA-048 (`review-gate`, the parity scan, and the measurement that `Claude review` never ran)
- `.github/workflows/claude-code-review.yml`, `scripts/harness/scan-review-workflow-parity.mjs`
