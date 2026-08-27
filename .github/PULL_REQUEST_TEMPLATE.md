<!--
Keep the title in Conventional Commits form (e.g. `feat: ...`, `fix: ...`) — commitlint checks it.
The body's shape is owned by .agents/rules/backlog-execution.md § PR Unit Rule: the seven sections
below, in this order, opening with Background. The review-gate check refuses a body whose first
heading is not `## Background` or that carries an agent-session link. Fill in each section and
delete these comments.
-->

## Background

<!-- What is broken or missing, who is affected, and why it matters — for a reader who was not there. -->

## Purpose

<!-- What this PR sets out to make true. -->

## What changes

<!-- The files and behaviour that change, in plain terms. -->

## Why this way

<!-- The accepted recommendation, the alternatives considered, the REVIEW VERDICT and depth verdict where the work went through the backlog pipeline. -->

## How it was verified

<!-- Commands run and what you observed. For a bug/regression fix, confirm the new test FAILS without the fix (prove it red against the pre-fix state). The user-execution scenario result, or the not-applicable reason.
- [ ] `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm test` pass for the affected packages
- [ ] `pnpm harness:scan` passes (repo gates)
- [ ] Tests added/updated for the change (a bug fix's regression test is proven red-before-green)
- [ ] Docs updated where relevant (package `docs/SPEC.md`, README, `content/`)
- [ ] Targets `develop` (feature → develop → main; only `develop`/`release/*`/`hotfix/*` may target `main`) -->

## Not in this PR

<!-- Residual risks, and the filed items that own what this PR deliberately leaves out. -->

Closes #
