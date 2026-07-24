---
title: 'HARNESS-043: fence destructive git when a worktree cwd silently falls back to the main checkout'
status: todo
created: 2026-07-25
priority: medium
urgency: soon
area: .claude/hooks, scripts/harness
depends_on: []
---

# HARNESS-043: worktree-cwd fallback guard

## Problem

Observed incident (TYPE-003, 2026-07-25, disclosed in PR #1361): a subagent's assigned worktree was
externally cleaned mid-session; the shell cwd silently fell back to the MAIN checkout, where the
agent's `git reset --hard origin/develop` ran against the main clone's develop. It happened to be a
pure fast-forward (verified, nothing lost), but the same mechanics with a stale ref would have
destroyed local state. Same failure family as the HARNESS-041 incident (reviewer `git reset --hard`
destroyed an untracked spec-doc): agents running destructive git outside their intended tree.

## What

Mechanical fence, not prose: a PreToolUse hook (or extension of branch-guard.sh) that blocks
`git reset --hard | clean -f | checkout -- . | push --force*` when BOTH (a) the command's effective
repo (`git -C` target > cwd) resolves to the MAIN checkout (not a `.claude/worktrees/*` path), and
(b) the session/agent context indicates a worktree assignment (env marker set at worktree spawn —
add one if none exists). Inline override token (same convention as branch-guard's) for deliberate
main-checkout operations. Red-first hook tests per the hook-test precedent.

## Test Plan

Hook fixture tests: destructive command in fallback-cwd context → BLOCKED with actionable message;
same command inside the assigned worktree → allowed; override token → allowed; non-destructive git
unaffected. `pnpm harness:test` green.
