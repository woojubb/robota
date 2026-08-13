---
title: 'INFRA-089: staged and whole-repository lint auto-fix commands'
status: done
created: 2026-08-13
completed: 2026-08-14
priority: medium
urgency: now
area: package.json, .husky, scripts/harness, .agents/skills
depends_on: []
---

# INFRA-089 — staged and whole-repository lint auto-fix commands

**Spec:** [`.agents/spec-docs/done/INFRA-089-staged-auto-fix-before-commit.md`](../../spec-docs/done/INFRA-089-staged-auto-fix-before-commit.md)

## Objective

Expose the existing commit-scoped auto-fix path as `pnpm lint:fix:staged`, extend `pnpm lint:fix` to
perform an intentional whole-repository ESLint-then-Prettier sweep, and require final verification to
inspect the post-fix tree. Keep the pre-commit path staged-only and retain exactly one clone-wide lock.

## Plan

- [x] TC-01: add a failing fixture test for staged-only fixing, tool order, and unrelated-file preservation; implement `lint:fix:staged` and make it pass.
- [x] TC-02: add a failing command-contract test; extend `lint:fix` to canonical ESLint scope followed by repository-root Prettier and make it pass. Defer real-tree idempotence to the post-promotion normalization task.
- [x] TC-03: add a failing wiring test; delegate pre-commit to `lint:fix:staged` while preserving guards, memory options, and exactly one lock.
- [x] TC-04: prove the wiring guard fails on missing commands, missing lock/delegation, full-fix hook use, and reversed ESLint/Prettier order; restore GREEN.
- [x] TC-05: update the single workflow owner (`post-implementation-checklist`) to require stage → staged fix → verification → commit and document reviewed manual full sweeps; run harness scan.
- [x] TC-06: prove the attempted whole-tree run was reverted exactly to its pre-run dirty-path set, run staged fix and affected verification, and link the dependent post-promotion normalization task.

Lifecycle handoff: after the implementation checklist above is complete, GATE-VERIFY and
GATE-COMPLETE own the status transitions and atomic task/spec archival; they are gates over this task,
not implementation work that can truthfully be checked before those gates run.

## Test Plan

RED first: introduce a harness contract test that reads the real root script, hook, lint-staged config,
and workflow owner. Before implementation it must fail because `lint:fix:staged` is absent, `lint:fix`
does not invoke Prettier, the hook bypasses the root command, and the post-implementation sequence does
not mention post-fix verification. Include fixture mutations proving that missing single-lock ownership,
hook delegation to the broad command, and reversed ESLint/Prettier ordering are rejected.

GREEN: implement only the approved script and wiring changes, then run the focused harness test and the
existing cross-worktree stash/lock suite. Run `pnpm lint:fix:staged` only after explicitly staging the
intended paths. The owner-corrected order requires the real whole-tree execution and idempotence proof on a
fresh branch only after this functional branch reaches main; track that as a dependent normalization item.
Finish with `pnpm harness:test`, `pnpm harness:scan`, and mandatory `pnpm harness:verify-like-ci` against
the post-staged-fix tree.

## User Execution Test Scenarios

Not applicable. This is a developer/harness workflow and has no shipped user-facing runtime path. Its
observable contract is covered by command-spawn and repository-fixture tests plus the requested real-tree
execution evidence.

## Progress

### 2026-08-13

- GATE-WRITE passed after placement evidence was added.
- Owner selected the `lint:fix` namespace and approved the final reviewed design.
- Independent architecture placement review returned ENDORSE.
- Implementation commit `9cf8a12b9` is present on `develop` and `main`; the root scripts, single-lock hook
  delegation, completion workflow, and mutation fixtures are present in the current tree.
- The dependent full-sweep task
  [`INFRA-090`](INFRA-090-post-promotion-whole-repository-format-normalization.md) is completed:
  the repository-wide fixer ran to convergence, passed CI-equivalent verification, reached `main`, and its
  temporary branches were removed.
- Fresh completion audit: `staged-auto-fix.test.mjs` and `worktrees-share-the-stash.test.mjs` passed
  31/31 tests. The staged fixture invoked the actual root `pnpm lint:fix:staged` script and directly proved
  source and Markdown mutation, automatic re-staging, and byte-identical preservation of an unrelated
  unstaged Markdown file. A mutation also proves that moving `lint-staged` outside the lock is rejected.

## Decisions

- `lint:fix` is the occasional full sweep; `lint:fix:staged` is the routine/pre-commit path.
- The staged root command owns one repository lock. The hook delegates without wrapping a second lock.
- `post-implementation-checklist` is the single owner of the pre-commit completion order.
- Whole-tree normalization begins only after all earlier functional branches have reached main.

## Blockers

- None.

## Result

Implementation, post-promotion normalization, independent GATE-VERIFY, and GATE-COMPLETE are complete.
The task and spec were archived atomically after the completion verdict.
