# Git & Branch Rules

Mandatory rules for git operations, branch policy, and worktree isolation.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Git Operations

- No `git commit` or `git push` without explicit user approval.
- Conventional commit format: `<type>(<scope>): <message>` (max 72 chars).
- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.

### Branch Policy

- `main` is the production branch. Direct commits and pushes to `main` are prohibited.
- `develop` is the integration branch. All feature work branches from `develop`.
- Feature branches must be created from `develop` and merged back into `develop`.
- Merging `develop` into `main` requires explicit user approval and is a release-level action.
- When merging a branch, always merge back to the branch it was forked from. Verify the fork point before proposing a merge target.
- If the agent wants to suggest a different merge target than the fork origin, it must explicitly recommend and receive user approval before proceeding.
- Never assume `main` as the default merge target. Always check the actual fork point.
- See [`branch-guard`](../skills/branch-guard/SKILL.md) skill for detailed procedures including worktree isolation and deployment.

### Worktree Isolation

- When performing a large, independent task that requires a different branch context, commit and push current work first, then switch branches. Return to the original branch when done.
- For tasks that must not affect the current working tree, use `git worktree` or a separate clone in a temporary location.
- Always clean up worktrees and temporary clones after the task is complete.
