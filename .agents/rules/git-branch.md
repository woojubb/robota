# Git & Branch Rules

Mandatory rules for git operations and branch policy.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Git Worktree — ABSOLUTELY PROHIBITED

**`git worktree` is banned. Zero exceptions.**

- Never create, use, or reference a git worktree for any task.
- Never propose worktrees as a solution to any problem.
- Do all work directly on a normal feature branch in the main clone.
- If the Claude Code `Agent` tool or any sub-agent requests a worktree, refuse. This includes
  the `isolation: "worktree"` parameter on the `Agent` tool — never pass it.
- If a leftover worktree is found (`git worktree list` shows more than the main clone), remove it
  immediately: `git worktree remove -f -f <path>`.

**Automated enforcement:** `scripts/harness/pre-push.mjs` calls `assertNoActiveWorktrees()` at
startup. Any push with an active non-main worktree is blocked with exit code 1.

**Why:** Worktrees share the same `packages/` paths but have separate working trees. This has
caused: (1) edits leaking from the worktree onto `develop`'s working tree, breaking typecheck;
(2) pre-push hooks running in the wrong directory context; (3) symlink issues requiring manual
workaround every session; (4) locked worktrees left behind after Claude Code agent sessions.
The isolation they provide is not worth these failure modes.

### Clean Working Tree Before Every Commit and Push

**Before creating a commit, verify the working tree is fully accounted for:**

```bash
git status --short
```

- Every modified file must be either staged for the commit or explicitly discarded.
- Every new file must be either staged, added to `.gitignore`, or explicitly discarded.
- A commit that leaves behind modified or untracked files that belong to the same change is
  incomplete. Do not create the commit until all related files are staged.

**Before pushing, the working tree must be clean** (no modified, staged, or untracked files that
belong to the branch). `scripts/harness/pre-push.mjs` calls `assertCleanWorkingTree()` — any push
with uncommitted modifications or staged changes is blocked with exit code 1.

**Why:** Selective commits that leave related files behind create invisible half-states: the code is
pushed but dependent files (SPEC.md, README, tests, backlog) are not, causing future sessions to
start from an inconsistent baseline.

### Git Operations

- No `git commit` or `git push` without explicit user approval.
- Conventional commit format: `<type>(<scope>): <message>` (max 72 chars).
- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.

### Branch Policy

- `main` is the production branch. Direct commits, pushes, and merges to `main` are prohibited.
- `develop` is the integration branch. All feature work branches from `develop`.
- Feature branches must be created from `develop` and merged back into `develop`.
- Merging `develop` into `main` requires explicit user approval and is a release-level action.
- When merging a branch, always merge back to the branch it was forked from. Verify the fork point before proposing a merge target.
- If the agent wants to suggest a different merge target than the fork origin, it must explicitly recommend and receive user approval before proceeding.
- Never assume `main` as the default merge target. Always check the actual fork point.
- See [`branch-guard`](../skills/branch-guard/SKILL.md) skill for detailed procedures including protected branch checks and deployment.

### One-Branch-At-A-Time Rule (mandatory, zero exceptions)

**Before creating any new branch, check for unmerged branches:**

```bash
git branch --merged develop   # branches already merged into develop
git branch --no-merged develop # branches NOT yet merged into develop
```

- If any feature branch is open (not merged into its fork origin), **stop**.
- **Do not create a new branch.**
- Ask the user explicitly: "Branch `<name>` is still open and not merged. Should I merge it first, or abandon it?"
- Wait for the user's answer before proceeding.

This rule applies even when:

- Switching back to `develop` to start new work
- The existing branch "looks complete"
- The new task seems unrelated to the open branch

**Why:** Creating a second branch while one is still open causes silent divergence. By the time the second branch is rebased, the first branch's content is already in develop (via a separate merge), producing mass conflicts with no clear resolution path. This has caused repeated incidents.

**The only exception:** The user explicitly says "create a new branch anyway" or "abandon the old branch."

### Feature Branch Workflow (mandatory)

**Never commit directly to `main` or release branches.** Always create a feature branch for work.

**When current branch is `main`:**

1. Create a feature branch from `main` (e.g., `feat/topic`, `fix/topic`, `chore/topic`).
2. Do all work on the feature branch.
3. Push the feature branch and create a PR targeting `main`.
4. The user merges the PR manually. The agent cannot merge to `main`.

**When current branch is a release branch (e.g., `release/v3.0.0`):**

1. Create a feature branch from the release branch (e.g., `feat/topic`).
2. Do all work on the feature branch.
3. When work is complete, propose to the user how to integrate:
   - **Option A: Direct merge** — agent merges the feature branch into the release branch (for small, low-risk changes).
   - **Option B: PR** — agent creates a PR targeting the release branch (for larger or higher-risk changes).
4. The user decides which option to use. The agent must not merge without proposing first.

**Branch naming:** `<type>/<topic>` (e.g., `feat/blog-i18n`, `fix/header-switcher`, `chore/cleanup-tasks`).

### Deployment

- **Cloudflare Pages** (blog, docs) deploys automatically when `main` is updated.
- Manual docs deployment uses `pnpm docs:deploy`, which uploads `apps/docs/.vitepress/dist` to Cloudflare Pages with Wrangler.
- Changes on release branches are NOT deployed until merged to `main`.
- When deployment is needed, create a PR from the release branch to `main` and ask the user to merge it.
