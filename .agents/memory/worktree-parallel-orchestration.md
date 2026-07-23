# Worktree-parallel subagent orchestration — proven pattern + incident lessons

## STATUS: OPERATIONAL (2026-07-24, waves 1–3: PRs #1288–#1296)

In-repo mirror (memory-mirroring rule). Owner enabled worktrees (#1285) explicitly to parallelize subagents.

**The pattern that works (6 agent-PRs, zero merge conflicts):**

1. **Partition file ownership BEFORE spawning** — each agent gets an explicit owned-file list + a FORBIDDEN
   list naming sibling-owned files; anything else it needs goes in the PR body, not an edit. Disjoint file
   sets ⇒ sequential squash-merges need no rebases.
2. Spawn with `Agent isolation: "worktree"`; each agent: `pnpm install` → rename/create its own branch
   (`BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1` inline override, honored since #1287) → verify (scans/tests) →
   push → `gh pr create` — **never merges**. The orchestrator merges sequentially after CI.
3. Worktree-env test artifacts are EXPECTED: `dist`/`build-contracts` scans fail in a fresh worktree (no
   build) — cross-check in the main clone or `pnpm build` before judging; don't chase them as regressions.
4. Agents stall when they wait on their own background tasks (session stops kill them silently) — instruct
   FOREGROUND verification, and resume a stalled agent with a nudge message; a killed session's worktree +
   branch survive, so work is harvestable (inspect `git -C <worktree> status/log`, finish + ship yourself).

**Incident lessons (all mechanically fixed):**

- **GIT_DIR leak (#1293):** a git hook exports `GIT_DIR`/`GIT_INDEX_FILE`, redirecting EVERY child git call
  to the real repo regardless of cwd — fixture `git init/commit/checkout` inside hook-spawned test suites
  mutated the live checkout (rogue commits + `core.bare=true` pollution that corrupted `git status`
  everywhere). Fix: `envWithoutGitVars()` in `scripts/harness/shared.mjs` — ALL harness children spawn with
  `GIT_*` stripped. Symptom signature: "not a git repository"/"must be run in a work tree" errors in the
  MAIN clone ⇒ check `git config core.bare` first.
- **Hook worktree-blindness (#1294):** PreToolUse guards judged `CLAUDE_PROJECT_DIR` (main clone) instead of
  the command's real context ⇒ false blocks for every worktree agent AND `git -C <path> commit` slipped past
  the action regexes unguarded. Fix: effective-dir resolution (`git -C` > hook `cwd` > project dir) + GITPFX
  regexes that see through env prefixes/global flags.
- Inline `BRANCH_GUARD_ALLOW_*=1` overrides only work because the hook greps the COMMAND STRING (#1287) — a
  `VAR=1` prefix is invisible to the hook's own environment.
