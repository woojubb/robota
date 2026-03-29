# Git & Branch Rules

Mandatory rules for git operations, branch policy, and worktree isolation.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

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
- See [`branch-guard`](../skills/branch-guard/SKILL.md) skill for detailed procedures including worktree isolation and deployment.

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
- Changes on release branches are NOT deployed until merged to `main`.
- When deployment is needed, create a PR from the release branch to `main` and ask the user to merge it.

### Worktree Isolation

- When performing a large, independent task that requires a different branch context, commit and push current work first, then switch branches. Return to the original branch when done.
- For tasks that must not affect the current working tree, use `git worktree` or a separate clone in a temporary location.
- Always clean up worktrees and temporary clones after the task is complete.
