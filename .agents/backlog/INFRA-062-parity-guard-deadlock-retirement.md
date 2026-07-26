---
id: INFRA-062
title: Two sound guards jointly made claude-code-review.yml unmodifiable — remove the condition, not the guard's teeth
status: in-progress
priority: high
type: INFRA
created: 2026-07-26
---

## Problem — a guard deadlock, measured

Two guards, each defensible alone, jointly forbade a legal change:

- **`scan-review-workflow-parity`** (INFRA-048) failed when `claude-code-review.yml` differed from
  the copy on the default branch. It exempted **only** a PR whose base _is_ `main`.
- **`scan-promotion-ancestry`** (INFRA-051, **required** on `protect-main`) rejects a `release/*`
  PR carrying work `develop` has not integrated — "a promotion must promote develop's tree
  UNCHANGED."

So an edit to that workflow could not reach `main` directly (ancestry refuses the shape), and
routing it through `develop` left the parity scan red — inside the **required** `scans` job — until
the promotion landed. There was no exemption for the PR that _introduces_ the change.

Worse, **the scan's test was stricter than the scan itself**: `holds on the real repository` in
`scan-review-workflow-parity.test.mjs` asserted the invariant unconditionally, while the CLI
honoured `isPromotionToDefault()`. `pnpm harness:test` runs in both `scans` and `quality`, so even
the exempt promotion PR failed. Measured on #1472: **1 failed / 1126 passed**, that assertion the
only failure, in both jobs. Every route was blocked; #1473 (the verified INFRA-053 fix) sat
unmergeable behind it.

## Decision — eliminate the condition the guard detects (option A, owner-approved 2026-07-26)

The parity scan existed solely to detect `anthropics/claude-code-action`'s silent skip: token-less,
the action mints a GitHub App token via an OIDC exchange that validates the invoking workflow
byte-for-byte against the default branch, and on divergence prints "Skipping action due to workflow
validation" and **exits 0** (INFRA-048's 100 green-and-empty runs). The action's own skip message
calls the divergence case expected — our scan treated the action's documented normal case as a
failure.

**Verified at source, against the installed version.** `anthropics/claude-code-action@v1`
dereferences (annotated tag `c96dd0a8`) to commit `be7b93b1907a4abad570368f3c74b6fe3807510b`, which
is exactly `v1.0.183`. In that tree:

- `action.yml` line 287 maps the input: `OVERRIDE_GITHUB_TOKEN: ${{ inputs.github_token }}`.
- `src/github/token.ts` — `setupGitHubToken()` returns the provided token **before** the OIDC
  exchange (`if (providedToken) { … return providedToken; }`).
- `WorkflowValidationSkipError` is thrown in exactly one place, inside `exchangeForAppToken()`
  (the server-side validation at `api.anthropic.com/api/github/github-app-token-exchange`), and
  handled in exactly one place, `src/entrypoints/run.ts` (sets
  `skipped_due_to_workflow_validation_mismatch` and returns — the exit-0). A repo-wide grep of
  `src/` and `base-action/src/` finds no other validation site.

Supplying `github_token` therefore makes the skip path **unreachable code**, not merely unlikely.
Remove the cause and the parity scan guards nothing — so it was retired: the scan, its test (whose
CLI/test exemption inconsistency dies with it), its `run-all-scans` registration, and its
`package.json` script.

## What shipped

1. **`claude-code-review.yml` supplies `github_token: ${{ secrets.GITHUB_TOKEN }}`** to the action,
   with a header documenting why the input is load-bearing.
2. **Permissions narrowed to exactly what the reviewer does**: `contents: read` (checkout, reading
   repo files for context) + `pull-requests: write` (inline review comments via the action's
   `github_inline_comment` MCP server, PR summary via `gh pr comment`; read of the diff is implied
   by write). `id-token: write` dropped — it existed only for the OIDC exchange that no longer
   runs. No `issues`, no `actions`, no write access to code. Note the exchange's DEFAULT app-token
   permissions were `contents: write, pull_requests: write, issues: write` (token.ts
   `DEFAULT_PERMISSIONS`), so this is a strict narrowing on every axis.
3. **`scan-review-workflow-parity` retired; `scan-review-token-supply` added**
   (`scripts/harness/scan-review-token-supply.mjs` + test, registered in `run-all-scans` and
   `package.json`): every workflow step invoking `anthropics/claude-code-action` must supply a
   non-empty `github_token` in its `with:` block. Dropping the input would silently restore the
   skip path with nothing left to detect it — this is the anti-rot floor, same shape as
   `scan-no-fallback`.
   - **RED** against the pre-change workflow (the repo's real file, no `github_token`): 1 finding —
     `.github/workflows/claude-code-review.yml:56 invokes anthropics/claude-code-action WITHOUT a
github_token input`.
   - **GREEN** after: `review-token-supply scan passed`.
4. **#1473's verified content landed here** (merged into this branch): the tool grant +
   shell-constraint prompt that took the reviewer from 17 denials/zero output to 0 denials, 11
   turns, 2 inline findings + summary on #1434. #1472 (the blocked `release/*` route, retitled DO
   NOT MERGE) is closed by this.

## Why the deadlock cannot recur here

The deadlock's precondition was a required check whose invariant ("byte-identical across
branches") could only be restored by a merge the invariant itself blocked. The replacement guard's
invariant ("this file supplies `github_token`") is **local to the PR's own tree** — any PR that
violates it can fix it in the same commit, and no cross-branch state is involved. A
guard-that-blocks-its-own-fix is the shape to reject in review; this item is the record of why.

## Merge sequence (no bypass needed)

CI executes the PR's own tree, so retiring the scan in the same commit that edits the workflow
dissolves the bootstrapping problem:

1. Merge this PR into `develop` — `scans`/`quality` run the PR's harness, in which the parity scan
   and its test no longer exist, and the new guard passes. Green with no bypass.
2. Promote `develop` → `main` normally (`scripts/harness/promote.mjs`). The promotion PR's tree is
   develop's tree unchanged, so `scan-promotion-ancestry` passes; the review runs on it too (the
   merge-ref copy carries `github_token`).

Between steps 1 and 2 the file differs across branches — and that is now harmless: `pull_request`
runs use the merge-ref's copy, which carries `github_token`, so the review runs everywhere in the
window. Nothing is red anywhere.

## The live run — the proof, and the guard's first real catch

PR #1478, run **30195313198**, 2026-07-26T08:49:22Z → 08:52:20Z (**2 m 58 s**). The workflow file on
that branch was deliberately divergent from `main`'s copy — exactly the condition that produced the
100 silent skips.

```
2026-07-26T08:49:30Z  Using provided GITHUB_TOKEN for authentication   <- the early return; no OIDC
                      "num_turns": 10,  "total_cost_usd": 0.7787
```

`grep -ci "workflow validation"` over the full 576-line run log: **0**. Every pre-fix run carried
those lines and finished in 13–21 s. The skip path is gone, demonstrated rather than argued.

It posted **one inline finding + a summary**, and the finding was real — against this very scan:

> `/^github_token:\s*\S/` treats a quoted-but-empty value (`github_token: ''`) as satisfying the
> guard, because the quote character matches `\S`.

Correct, and it defeats the scan's entire purpose: `action.yml` maps the input to
`OVERRIDE_GITHUB_TOKEN` and `setupGitHubToken()` gates on truthiness (`if (providedToken)`), so an
empty string falls through to the OIDC exchange and silently restores the skip. Fixed in
`hasNonEmptyTokenValue()` (strip one matching quote pair, require a non-empty remainder), proven
RED — 7 failing — against the pre-fix scan and GREEN after (15 tests).

**Then it caught a second one of the same class**, on the run after the fix (30196368343): YAML
resolves `github_token: # TODO fill in` to null, but capturing everything after the colon reads the
COMMENT as the value. `'' # left blank` too. Both would have passed the guard and handed the action
an empty token — the same silent skip, one syntax further out. Fixed by resolving the value the way
YAML does (a quoted scalar owns up to its closing quote; otherwise `#` after whitespace opens a
comment), proven RED — 4 failing — and GREEN after (21 tests).

**A guard whose own bypass passes is not a guard**, and it was the reviewer this work exists to
repair that caught both holes — unprompted, from the diff, on consecutive runs. That is the
flywheel closing on itself, and it is the strongest evidence in this item that the review is
genuinely running: a skipping reviewer finds nothing, twice.

## Acceptance

- [x] Live run on this item's own PR — a workflow file deliberately divergent from `main`'s copy —
      executes the review (zero `workflow validation` lines) and posts output. Run 30195313198.
- [x] `scan-review-token-supply` proven RED against the token-less file, GREEN after.
- [x] Source verification pinned to the version `@v1` resolves to (`v1.0.183` / `be7b93b1`).
- [x] `pnpm harness:scan`, `pnpm harness:test`, `pnpm harness:verify-like-ci`, YAML parse green.

## Renumbering note (PROC-002)

This item was authored as `INFRA-058` and renumbered to `INFRA-062` before merge: `INFRA-058`,
`059` and `060` were all claimed the same day by audits that merged first. That is PROC-002's
subject — a number claimed at authoring time in a branch-local file, against a namespace no branch
observes atomically. Renumbered by hand across the backlog file, its cross-references in INFRA-053,
the workflow header, and the scan's header comment and failure-message string.

It also inherits HARNESS-052's two anti-rot hardenings from the scan it replaces, which landed
upstream while this was in flight: `listGovernedWorkflows` throws rather than returning `[]` on an
absent `.github/workflows`, and an empty governed set is reported as a finding rather than a pass.
The `MANDATORY_TREE_GUARDS` classification in `scan-guard-scope-fail-closed.mjs` moved with it.

## References

- INFRA-048 (built the parity scan; the 100 silent skips), INFRA-051 (promotion ancestry),
  INFRA-053 (the turn-budget/denial fix this unblocks), PRs #1472, #1473
- `.github/workflows/claude-code-review.yml`, `scripts/harness/scan-review-token-supply.mjs`,
  `scripts/harness/__tests__/scan-review-token-supply.test.mjs`
