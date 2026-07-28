---
title: 'INFRA-068: the worktree guard is off in every real session, and ten green tests say otherwise'
status: todo
priority: high
urgency: now
type: INFRA
area: .claude/hooks
created: 2026-07-28
depends_on: []
---

# INFRA-068 — a guard that fails open on a variable nothing sets

## Problem

`worktree-cwd-guard.sh` exists to stop a worktree agent operating on the main clone. It fails open
unless `ROBOTA_AGENT_WORKTREE` is set.

Measured: a repository-wide grep finds that variable in **exactly one place — its own test file**.
Nothing in `.claude/settings.json`, no agent launcher, no skill, no workflow sets it. It was
confirmed unset inside an `Agent`-tool worktree subagent during this audit: precisely the condition
the guard exists for.

**Its ten tests pass.** They set the variable themselves, so they measure the logic and never the
wiring. Green tests over a guard that is off in every real session — the same shape as a check
satisfied by a mention rather than a wiring, one layer up: satisfied by a fixture rather than a
deployment.

A sibling instance in the same layer: `check-forbidden-patterns.sh` excludes every worktree session,
because its scope filter prefixes on `CLAUDE_PROJECT_DIR` (the main clone) while the file being
edited sits under `.claude/worktrees/`. Identical content and path gave exit 2 with
project-dir=worktree and exit 0 with project-dir=main-clone. `self-check.mjs` cannot see it because
its fixture always places the file under `projectDir`.

## Why this matters more than it looks

Parallel worktree agents are how most work in this repository now happens. Two of the guards meant
to keep them inside their own tree are off exactly there. Both were invisible because each test
supplies the condition the deployment does not.

## Proposed direction

Two halves, and the second is the one that generalises:

1. Set the marker where worktrees are created, so the guard is live in the sessions it governs — or,
   if the marker is the wrong mechanism, derive the condition from the path the hook can already
   see, and delete the variable rather than leave a dead switch.
2. **A test may not supply the condition that makes the guard active.** A guard's test suite should
   include one case that runs it exactly as a real session would, with only the environment a real
   session has. That is what neither of these guards had.

## Done when

- The worktree guard is proven active in a real worktree session with no test-supplied environment.
- `check-forbidden-patterns.sh` fires on a forbidden edit inside a worktree, proven RED there and
  GREEN on a permitted edit.
- Each has one case that sets nothing the deployment does not set, so a guard cannot again be green
  in tests and off in life.
