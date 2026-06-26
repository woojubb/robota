---
title: 'HARNESS-017: Enforce conventional commits mechanically (commitlint + commit-msg hook + CI)'
status: todo
created: 2026-06-27
priority: high
urgency: now
area: root (husky, package.json, ci)
depends_on: []
---

# Enforce conventional commits mechanically

## What

`git-branch.md` mandates conventional commits, but there is **no mechanical enforcement**:
`.husky/` has only `pre-commit` and `pre-push` (no `commit-msg`), and `package.json` has no
`commitlint`. A non-conforming commit message passes silently.

Add:

1. `@commitlint/cli` + `@commitlint/config-conventional` as devDeps, with a
   `commitlint.config.*` (extend `config-conventional`; allow the repo's scope set).
2. `.husky/commit-msg` running `commitlint --edit "$1"` so local commits are validated.
3. A CI step (PR-level) that lints the PR's commit range, so the gate holds even if a
   contributor skips local hooks.

## Why

A documented commit convention that nothing checks drifts. The repo already enforces other
git policy mechanically (`branch-guard.sh` for protected branches, `pre-push.mjs`
worktree/CI gates) — commit-message format is the remaining prose-only git rule. Mechanizing
it keeps the changelog/release tooling (`.changeset/`) inputs consistent.

## Done When

- A malformed commit message (e.g. `wip stuff`) is rejected by the local `commit-msg` hook.
- The CI PR step fails on a non-conventional commit in the PR range.
- `pnpm install --frozen-lockfile` passes (lockfile updated for the new devDeps only).
- The conventional config matches the scopes the repo actually uses (no false rejects on
  existing valid styles).

## Test Plan

- Attempt `git commit -m "wip"` → hook rejects; `git commit -m "chore: x"` → passes.
- Push a branch with a bad commit message → CI commit-lint step fails.
- Run `commitlint` over the last N commits on `develop` → they pass (config not stricter than
  current practice).

## User Execution Test Scenarios

1. Make a commit with a non-conventional message → it is blocked locally with a clear reason;
   a conventional message succeeds. Evidence: _to fill._
