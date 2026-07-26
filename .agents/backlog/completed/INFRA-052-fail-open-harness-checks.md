---
title: 'INFRA-052: harness checks that report success for work they did not do'
status: done
created: 2026-07-26
completed: 2026-07-26
priority: high
urgency: soon
area: scripts/harness
depends_on: [INFRA-050]
---

# INFRA-052: two harness checks failed open, and three terminal signals were unregistered

Both fail-opens were recorded as deliberate residuals by INFRA-050 ("Residuals (not fixed here,
deliberately)"). They share the INFRA-048 root cause: **a check that reports success when it did
not run**.

## Problem

**B — `check-document-authority.mjs` failed open.** When no base ref resolved (or the diff against
it failed) it printed `SKIPPED … Not a pass` and exited **0**. It runs inside `pnpm harness:scan`,
which is a **required** CI gate, and `run-all-scans` reads exit codes — so the gate recorded a pass
for a gate that had stopped enforcing. INFRA-050 measured exactly that on the former depth-50
`scans` checkout. It also carried its own `git fetch --depth=50` fallback: a depth fetch GRAFTS the
repository, so the rescue path was itself the thing that broke base resolution.

**C — `shared.mjs`'s `detectChangedFiles` returned `[]`** when the base ref could not be resolved.
An empty list is indistinguishable from "this branch changed nothing", and all four callers
(`plan-change`, `verify-change`, `record-change`, `review-change`) read it that way. Checked every
caller before changing the contract; none of them wants "could not compute" and "nothing changed"
to be the same value.

**D — three agent terminal signals were unregistered.** `CI TRIAGE`, `GATE VERDICT` and
`SCENARIO DRAFTED` are the terminal output lines of `ci-failure-triager`, `backlog-gate-guard` and
`user-execution-scenario-author`. Two HARNESS-049 increments shipped those agents but could not add
the tokens to `CLOSED_SIGNAL_VOCAB` because `scripts/**` was outside their file ownership, so each
agent had to omit its `signal:` frontmatter field and the orchestration map recorded a signal
nothing could mechanically check.

## What changed

1. `check-document-authority.mjs` exits **1** when the base ref cannot be resolved or the diff
   fails. The `--depth=50` fallback fetch is removed — every job that runs this scan now checks out
   at `fetch-depth: 0` (INFRA-050), so `origin/<base>` is already present and complete.
2. `detectChangedFiles` **throws** when the working tree is clean and no base ref resolves. An
   empty list is still returned for the legitimate case: base resolved, diff ran, no files differ.
3. `CI TRIAGE`, `GATE VERDICT`, `SCENARIO DRAFTED` registered in `CLOSED_SIGNAL_VOCAB`.

## Red / green evidence

Each fixture deliberately carries a REAL finding, so the red proves "a violating tree reported
success", not merely "a code path was taken".

**B — base ref unresolvable (no `origin`, no `develop`), branch adds a real violating architecture
doc:**

```
BEFORE  document authority scan SKIPPED: no base ref could be resolved … Not a pass …   EXIT=0
AFTER   document authority scan FAILED:  no base ref could be resolved …                EXIT=1
```

Same for an explicitly named but unreachable base ref (`--base-ref no-such-ref`): `EXIT=0` → `1`.

Normal runs unchanged: resolvable base + violating branch → `EXIT=1` (finding printed) before and
after; resolvable base + clean branch → `EXIT=0` before and after.

**C — clean tree, no resolvable base, branch carries a real source change inside a workspace package:**

```
BEFORE  harness:plan   -> "Changed files: 0"                                        EXIT=0
        harness:verify -> "No package or app scope detected from changed files."    EXIT=0
AFTER   both -> Error: Unable to resolve a base ref to diff against … Refusing to
        report "no changed files" from a base that could not be resolved            EXIT=1
```

Normal runs unchanged: resolvable base + real change → `Changed files: 1 / packages/widget`;
genuinely empty diff → `Changed files: 0`, exit 0 (still an empty list, not an error); dirty
working tree → `Changed files: 1` with no base ref needed; explicit `--base-ref base` → works.

**Reverse-apply (accidental-green floor).** With the pre-fix source restored and the new tests kept:

```
check-document-authority.test.mjs   2 failed | 12 passed  ->  14 passed
detect-changed-files.test.mjs       2 failed |  4 passed  ->   6 passed
check-agent-def-convention.test.mjs 3 failed | 17 passed  ->  20 passed
```

## Test Plan

- `scripts/harness/__tests__/check-document-authority.test.mjs` — fail-closed on an unresolvable
  base and on an unreachable named base, plus an assertion that resolution performs no fetch (the
  removed fallback was itself the graft).
- `scripts/harness/__tests__/detect-changed-files.test.mjs` (new, 6 tests) — the two fail-closed
  directions through the real `plan-change` / `verify-change` entrypoints, and four no-regression
  cases. Subprocess-based because `detectChangedFiles` binds `WORKSPACE_ROOT` to `process.cwd()`.
- `scripts/harness/__tests__/check-agent-def-convention.test.mjs` — each registered token asserted
  BOTH ways (registered, and its emitting agent still emits it) so the entry cannot rot into dead
  vocabulary.
- `pnpm harness:test`, `pnpm harness:scan` (including INFRA-050's `ci-base-history`), and
  `pnpm harness:verify-like-ci` — green.

## User Execution Test Scenarios

Not applicable: this changes harness gate behaviour only, with no user-facing command or UI
surface. The equivalent agent-run evidence is the before/after transcripts above, produced by
running the real scripts against purpose-built git fixtures.

## Residuals

- The three agents still declare no `signal:` frontmatter field. Registering the vocabulary is the
  half that lives in `scripts/**`; adding the field lives in `.claude/agents/**`, which was outside
  this change's file ownership. Now unblocked — nothing else stands in the way.
- Roughly twenty scans return `[]` when their governed directory is absent (`if (!existsSync(dir))
return []`), which reads as "clean". For optional directories that is correct; for
  `scan-ci-base-history.mjs`'s `.github/workflows` it would mean guarding nothing while reporting a
  pass. Not exercised today (the directory exists), so it is recorded rather than fixed.
