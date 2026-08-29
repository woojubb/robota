---
title: 'HARNESS-058: verify-like-ci cannot go green on a docs branch in a worktree, so it gets skipped'
issue: https://github.com/woojubb/robota/issues/1571
status: done
completed: 2026-08-29
priority: medium
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-28
depends_on: [INFRA-069]
---

## Resolution

The fresh-worktree prerequisite contract and stage ordering were implemented and merged in PR #1577
(`03e582ab…`). Issue #1571 records the returned verification evidence. This stale Task is therefore
terminalized by the DOCS-041 backlog migration without changing source in this batch.

# HARNESS-058 — the mandated gate is unrunnable where the work happens

## Problem

`verify-like-ci` is named as the CI-equivalent verification entry point. Measured during an audit
that dogfooded it on a markdown-only branch: it went **red on `typecheck`**, then green on a re-run
of the identical commit once `dist/` existed.

The cause is stage order — `ci-mirror-map.mjs` declares `typecheck` before `build` — combined with
the environment parallel agents actually run in. A fresh worktree has no `dist/`, so cross-package
typecheck resolves to missing declaration files and fails on a branch that changed no code.

**A gate that cannot go green on a correct branch is a standing incentive to skip it**, and skipping
it is exactly what cost two promotion round trips. The same environment produced repeated
false alarms this session: `doc-examples` and `dist` failing in worktrees purely for missing
`node_modules`/`dist`, each needing a human to decide it was not a real failure.

## Why this is not just a stage-order bug

Three separate agents hit the same wall this session and each resolved it differently — one ran
`pnpm install && pnpm build` first, one reported the failures as environment artefacts, one nearly
recorded them as real. The verification story for a fresh worktree is undefined, so every agent
invents one. That is the defect; the stage order is only its most visible instance.

## The fresh-worktree contract

This is the answer that used to live in whoever last worked it out. The **executable** copy is
`scripts/harness/tree-prerequisites.mjs` — it is what every entry point prints when the contract is
unmet, so the contract cannot drift away from what the gate enforces. This section is its prose
statement.

### What a fresh worktree owes, before any verification

| #   | Prerequisite   | Command                          | Who needs it                                          |
| --- | -------------- | -------------------------------- | ----------------------------------------------------- |
| 1   | `install`      | `pnpm install --frozen-lockfile` | every gate — they all shell out to workspace binaries |
| 2   | `build-output` | `pnpm build`                     | every stage declaring `needsBuildOutput: true`        |

Both must be run **inside the worktree itself**. Measured cost of step 1 on a warm pnpm store: 2.9s
in the freshly-created worktree this contract was proven in. Step 2 does not have to be run by hand
before `verify-like-ci`: its own `build` stage produces the build output, which is why that entry
point demands only the install.

### Why "the parent clone has them" is not an answer

A `git worktree` shares the object database, not the install. A pnpm workspace places a
`node_modules` in **every package**, so there is nothing for a worktree to borrow.

The two worktree layouts fail in **opposite directions**, which is why neither one ever taught
anybody the contract:

| Layout                                                  | Symptom without an install                          | Why it misleads                                                                                          |
| ------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Sibling** (outside the repo, e.g. `/tmp/wt`)          | nothing starts: `Could not resolve 'vitest/config'` | looks catastrophic, so it gets diagnosed as a broken worktree rather than a missing step                 |
| **Nested** (inside the repo, e.g. `.claude/worktrees/`) | gets much further, then `sh: 1: tsgo: not found`    | Node's resolver walks **UP** into the parent clone's `node_modules`, so imports work and binaries do not |

The nested case is the dangerous one: it produces a _partial_ success whose failures land deep in a
stage and read as defects in the change under test.

### The distinction that must appear in the output

**Failed because the code is wrong** vs **failed because this tree was never prepared.** The second
is not a verdict on the change. Every entry point now refuses to produce one it cannot support, and
says which prerequisite is missing and the command that satisfies it. It is a **failure**, never a
skip — the gate still blocks.

### Where it is enforced

| Entry point                                      | Requires                   | Behaviour when unmet                                                      |
| ------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------- |
| `pnpm harness:pre-push`, **when it will verify** | `install` + `build-output` | blocks the push with the naming message, before any check runs            |
| `pnpm harness:verify-like-ci`                    | `install`                  | refuses to run any stage; `build-output` is left to its own `build` stage |
| any `verify-like-ci` build-output stage          | `build-output`             | that stage FAILS naming the prerequisite, instead of a downstream error   |

**A prerequisite is owed only by work that is going to happen.** The pre-push gate skips verification
entirely for a **delete-only push** and for a **re-push with no content delta from its base** — neither
reads `node_modules` or `dist` — so the tree assertion sits behind that decision, not in front of it.
Demanding `pnpm install && pnpm build` to delete a remote branch from a fresh worktree is the same
class of defect as the one this item opened with: a gate refusing work it has no reason to judge.
`runPrePushGate` in `pre-push.mjs` states the step order once, and
`__tests__/pre-push-sequence.test.mjs` pins the SEQUENCE — asserting only "a delete-only push is
allowed" would pass again if the assertion moved back, because a prepared tree passes either way.

`verify-change.mjs` (`pnpm harness:verify`) deliberately does **not** assert the contract itself: its
root is `process.cwd()` and it is legitimately run against synthetic workspace fixtures with no
install. It is reached as a gate only through the two entry points above, which own a real
repository root.

`ci-mirror-map.mjs` carries a `needsBuildOutput` declaration per stage, and
`__tests__/ci-mirror-map.test.mjs` pins the declaration to the order: a stage that reads build
output may not be listed before `build`, and a stage that declares nothing fails the test rather
than silently sorting as "needs nothing".

### When the build itself fails

Build output being absent has two different causes, and they need two different messages:

| Cause          | When                                                         | What the message says                                                                       |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `unprepared`   | no `build` stage will run in this run, and nothing is built  | name the prerequisite, and the command: `pnpm build`                                        |
| `build-failed` | `build` ran in this run and FAILED, so dist is still missing | point at the build failure already reported; **do not** tell the reader to run `pnpm build` |

The distinction exists because "a build was ATTEMPTED" is not "build output exists". The state is
carried through the stage loop (`initialBuildState` / `advanceBuildState` in `verify-like-ci.mjs`)
and dist is **re-read from disk** after `build` runs, never assumed from the fact that it was
scheduled. Measured on a fresh worktree with a real build regression, before this was fixed:
`examples-typecheck` emitted `TS2307: Cannot find module '@robota-sdk/agent-framework'` and a
spurious "install @types/node" hint, and `binary-e2e` spent 20s waiting for a serve host that was
never built — the exact noise this item exists to remove, in the scenario the feature is for.

The tradeoff, stated plainly: after a failed build, `typecheck` no longer prints its own diagnostic
for the regression. Nothing is lost that the `build` failure did not already report, and the stage
runs normally once the build is fixed — this is the same ordering CI enforces with `needs: build`.
What it buys is that the other four consumers stop reporting the unbuilt tree as a defect, and stop
spending minutes doing it: `binary-e2e` alone burned 20.47s waiting for a serve host that was never
built.

**Is `scan-suite`'s own dist re-check now redundant?** In this code path, yes: the loop-level gate
runs first and blocks `scan-suite` before `runScanSuite` reads dist, so its inline check can now only
fire if dist disappears between the two reads. It is deliberately kept — it guards a _different_
hazard (the dist-dependent scans silently no-op and LOOK like a pass, which is a fail-open, not a
misattribution) and it is the only check protecting `runScanSuite` if that function is ever called
from somewhere other than this loop. Removing it is a separate change, not this one.

## Proposed direction

- Order stages so a prerequisite runs before what needs it, or make the dependent stage state its
  prerequisite and fail with that reason rather than a type error.
- Decide what a fresh worktree owes before verification, and put it in one place agents can follow —
  right now the answer lives in whoever last worked it out.
- The distinction that matters in the output: **failed because the code is wrong** vs **failed
  because this tree was never built**. The second is not a verdict on the change, and today it is
  reported as if it were.

## Done when

- `verify-like-ci` passes on a docs-only branch in a freshly-created worktree, proven by running it
  there.
- A genuine failure still fails, proven RED, so the fix is not "stop checking".
- An unbuilt tree produces a message naming the missing prerequisite, not a downstream type error.
