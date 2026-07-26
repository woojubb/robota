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

## Resolution (2026-07-26) — measured, in PRs #1472 → `main` and #1473 → `develop`

### The denial count, at every step

The metric is the denial count, not the turn cap. Each row is one agent run of the real
configuration against a real PR, with the action's own `github_inline_comment` MCP server attached
and its own post-session buffer flush.

| Configuration                        | PR                | Turns | **Denials** | Posted                 |
| ------------------------------------ | ----------------- | ----- | ----------- | ---------------------- |
| as shipped (no `allowed_tools`)      | #1470             | 26 ✗  | **17**      | nothing                |
| tool grant only                      | #1472 (150 files) | 26 ✗  | **13**      | nothing                |
| tool grant + shell constraint stated | #1472 (150 files) | 20 ✓  | **1**       | summary                |
| tool grant + shell constraint stated | **#1434**         | 11 ✓  | **0**       | **2 inline + summary** |

Row 1 is CI run `30189528981`. Rows 2–4 are local reproductions of the same SDK invocation the
action performs in agent mode.

### What was granted, and why that is the minimum

```
--allowedTools "Bash(gh pr diff:*),Bash(gh pr view:*),Bash(gh pr comment:*),mcp__github_inline_comment__create_inline_comment,Read,Grep,Glob"
--disallowedTools "Write,Edit,NotebookEdit,WebFetch,WebSearch"
```

Reading `anthropics/claude-code-action@v1.0.183` shows the failure was worse than a budget problem.
A `prompt:` input selects **agent mode**, and in agent mode the prompt is passed verbatim with **no
PR context injected**, while a GitHub MCP server is installed **only if one of its tools is named in
`--allowedTools`** (`src/mcp/install-mcp-server.ts`). With no `--allowedTools` at all the reviewer
was asked to read a diff it could not fetch and to post comments through a server that was never
started. The run log's `No buffered inline comments` is that, recorded.

Two rounds of measurement were needed. The tool grant alone only moved 17 → 13, because every
remaining denial was shell plumbing — `gh pr diff N > file`, `… | awk …`, `git fetch` — which a
`Bash(gh pr diff:*)` prefix rule does not cover. Broadening the grant would have traded away the
point of a read-only reviewer; stating the constraint in the prompt cost nothing and took it to 1,
then 0.

### The turn budget: **left at 25**

It never needed raising. Once the denials were gone the same 150-file PR completed in 20 turns and
#1434 in 11. The cap's real meaning is a bound on the number of **findings** — `create_inline_comment`
posts one comment per call, so one finding costs one turn.

### The scoping question: **answered — bound the output, not the budget**

The prompt now caps inline comments at 10 in severity order, pushes the remainder into the summary,
and tells the reviewer to post the summary first once fewer than ~5 turns remain. It also stops
re-reading the whole rule set every run: it consults `AGENTS.md` / `.agents/rules/` only when the
diff suggests a violation. Diff-size-aware scoping, without a budget that grows with every large PR.

### Proof

Live run against **#1434** itself — 0 denials, 11 turns, completed — posting
[two inline findings](https://github.com/woojubb/robota/pull/1434#discussion_r3652038352) and a
summary. The first finding is the `review-gate` auto-merge disarm running without `contents: write`
and swallowing the failure behind `|| echo "auto-merge was not armed"` — the defect this repository
later filed and fixed separately as **INFRA-057** (#1467). The reviewer found it unprompted, from
the diff.

### The window: sequenced, and the sequence is now in the workflow file

Acceptance criterion 3 is met by a header block in `claude-code-review.yml` (not only here) stating
the byte-parity rule, the required-check window, the three-step sequence, and the fact that a change
to that file cannot be proven by its own PR.

The window itself is **not** closed, and one option for closing it is worth recording. The parity
validation happens inside `setupGitHubToken()` → `exchangeForAppToken()` (`src/github/token.ts`),
which is skipped entirely when a `github_token` input is supplied. Passing
`github_token: ${{ secrets.GITHUB_TOKEN }}` would therefore stop the action from ever silently
skipping — but `scan-review-workflow-parity` would still fail on divergence, so it only closes the
window if the scan is retired or rewritten alongside it. That is a change to `scripts/**` and a
security-posture decision, so it is recorded rather than taken.

### Blocker found while executing the sequence

`scripts/harness/__tests__/scan-review-workflow-parity.test.mjs:130` asserts the invariant
unconditionally:

```js
it('holds on the real repository', () => {
  const { findings } = findReviewWorkflowParityFindings(REPO_ROOT);
  expect(findings).toEqual([]);
});
```

The scan **CLI** honours `isPromotionToDefault()` and correctly reports the rule as not applicable
on a PR based on `main`; its **test does not**, and `pnpm harness:test` runs unconditionally inside
the required `scans` job (and again in `quality`).

So the one PR the guard deliberately exempts — the promotion that restores parity — is blocked by
the guard's own test. Measured on #1472: `scans` and `quality` both red, **1 failed / 1126 passed**,
the single failure being that assertion, while `pnpm harness:scan` itself passed. As it stands
`claude-code-review.yml` cannot be modified by anyone while keeping CI green.

**This must be fixed before #1472 can merge.** The fix belongs in that test — honour the same
exemption the CLI implements, or scope the invariant to non-promotion refs — and lands as its own
PR to `develop` (it touches no workflow, so it carries no parity cost).

## References

- INFRA-048 (`review-gate`, the parity scan, and the measurement that `Claude review` never ran)
- INFRA-057 (the `review-gate` disarm-permission bug the live review rediscovered on #1434)
- `.github/workflows/claude-code-review.yml`, `scripts/harness/scan-review-workflow-parity.mjs`
