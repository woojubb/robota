---
title: 'HARNESS-058: verify-like-ci cannot go green on a docs branch in a worktree, so it gets skipped'
status: todo
priority: medium
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-28
depends_on: [INFRA-069]
---

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
