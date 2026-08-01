---
title: 'HARNESS-043: fence destructive git when a subagent cwd silently falls back to the MAIN checkout'
status: done
created: 2026-07-25
completed: 2026-07-25
priority: high
urgency: soon
area: .claude/hooks, scripts/harness
depends_on: []
---

# Mechanical fence — block destructive git when a worktree cwd falls back to MAIN

## Problem

The TYPE-003 incident: a subagent was assigned an isolated worktree, that worktree was externally
cleaned/removed mid-session, the process cwd silently dropped back to the MAIN clone, and
`git reset --hard` then ran against MAIN — destroying uncommitted main-checkout state.

`branch-guard.sh` and `pre-push-check.sh` already resolve the worktree-aware effective repo
(`git -C <path>` > hook-input `cwd` > `CLAUDE_PROJECT_DIR`), but neither guards the destructive
working-tree commands (`reset --hard`, `clean -f`, `checkout -- .`, `push --force`) against the
specific "assigned a worktree but resolved to MAIN" fallback.

## What (the mechanical check)

A PreToolUse Bash hook (`.claude/hooks/worktree-cwd-guard.sh`, sibling to branch-guard — matching the
one-hook-per-concern convention) that BLOCKS `git reset --hard | git clean -f[dx] | git checkout -- . |
git push --force*` when BOTH:

- **(a) MAIN-checkout** — the command's effective repo toplevel is NOT under `.claude/worktrees/`; AND
- **(b) worktree-assignment marker** — the `ROBOTA_AGENT_WORKTREE` env var is set.

**Marker mechanism.** `ROBOTA_AGENT_WORKTREE` is the assignment marker. The worktree launcher (Claude
Code `Agent` tool `isolation: "worktree"`) SHOULD export `ROBOTA_AGENT_WORKTREE=<assigned worktree
path>` when spawning a worktree subagent, so the guard can distinguish an assigned-worktree session
(whose cwd must never resolve to MAIN for a destructive op) from an ordinary main-clone session. Until
the launcher exports it, the guard is inert for those sessions — which is the intended fail-safe.

**Fail-safe.** The guard blocks ONLY when it can POSITIVELY confirm BOTH conditions. No marker →
ordinary main-clone work → never blocked. Effective repo under `.claude/worktrees/` → the assigned
worktree → never blocked. Effective repo unresolvable → never blocked. Inline override
`WORKTREE_CWD_GUARD_ALLOW_MAIN=1 <cmd>` (same convention as branch-guard's inline overrides) permits a
deliberate main-checkout destructive op.

## Test Plan

Red/green fixtures in `scripts/harness/__tests__/worktree-cwd-guard.test.mjs` (spawns the bash hook
with a synthesized PreToolUse payload, real temp git repos for the MAIN vs worktree paths):

- destructive cmd in fallback-cwd (cwd=MAIN) + marker set → BLOCKED (exit 2) — `reset --hard`,
  `clean -fdx`, `checkout -- .`, `push --force`;
- same destructive cmd inside the assigned worktree → allowed;
- inline override token → allowed;
- non-destructive git (`git status`) in fallback context → unaffected;
- normal main-repo destructive work with NO marker → unaffected (the fail-safe);
- effective dir not a git repo → unaffected (the fail-safe);
- non-Bash tool call → ignored.

## Outcome

DONE. Implemented as a new sibling PreToolUse hook `.claude/hooks/worktree-cwd-guard.sh`, registered
in `.claude/settings.json` after branch-guard/pre-push-check. TDD red-before-green: the 4 BLOCK cases
failed (exit 0) against a no-op stub, then passed after implementing the two-condition + fail-safe
logic. Full suite: 10/10 green in `worktree-cwd-guard.test.mjs`; `pnpm harness:test` green;
`node scripts/harness/run-all-scans.mjs` green (60 scans). Reused branch-guard's effective-dir
resolution, GITPFX prefix tolerance, heredoc/comment stripping, and inline-override convention.

## User Execution Test Scenarios

- Not applicable (harness/hook check; the hook's own red/green fixtures are the maintained gate).
- Evidence: the fixture suite above, run by the agent (RED against the stub, GREEN after the fix).
