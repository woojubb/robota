# Git & Branch Rules

Mandatory rules for git operations and branch policy.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Git Worktree — ABSOLUTELY PROHIBITED

**`git worktree` is banned. Zero exceptions.**

- Never create, use, or reference a git worktree for any task.
- Never propose worktrees as a solution to any problem.
- Do all work directly on a normal feature branch in the main clone.
- If the Claude Code `Agent` tool or any subagent requests a worktree, refuse. This includes
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

### `--delete-branch` is Prohibited in `gh pr merge`

**Never pass `--delete-branch` to `gh pr merge`. Zero exceptions.**

```bash
# WRONG — deletes the branch automatically:
gh pr merge 670 --squash --delete-branch

# CORRECT — merge only, no auto-deletion:
gh pr merge 670 --squash --auto
```

Branches must only be deleted by explicit user request. Use `git branch -D <name>` (local) or
`gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<name>` (remote) when the user says to delete a branch.

**Why:** `--delete-branch` on a `develop → main` PR deleted the `develop` integration branch,
breaking the entire branch structure and requiring manual restoration. Auto-deletion is safe only
for short-lived feature branches, not for long-lived integration branches — and there is no way to
distinguish them automatically.

### Branch Policy

- `main` is the production branch. Direct commits, pushes, and merges to `main` are prohibited.
- `develop` is the integration branch. All feature work branches from `develop`. Direct commits to
  `develop` are also prohibited — branch first, then PR. (Both `main` and `develop` are protected;
  enforced by `.husky/pre-commit` and the `branch-guard` skill/hook.)
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

### Delete Merged Branches (mandatory)

After a PR merges, delete its now-merged feature branch so only `develop` and `main` remain as standing
branches. **Never** use `gh pr merge --delete-branch` (see the ban above) — delete explicitly, only
after confirming the branch is merged:

- **Local:** `git branch -d <branch>` (the `-d` form refuses an unmerged branch — a built-in guard).
- **Remote:** confirm merged, then `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`.
- **Verify before remote deletion:** `git merge-base --is-ancestor origin/<branch> origin/main` (or
  `origin/develop` for non-release merges) must succeed.

**Never delete `develop` or `main`.**

**Why:** stale merged branches accumulate on the remote and obscure the active set; cleaning each cycle
keeps `develop`/`main` the only standing branches. The safe per-branch delete (never the merge-time
`--delete-branch`) avoids the incident that deleted the `develop` integration branch.

### Post-Merge Branch Cycle (mandatory)

After a branch is merged, follow this exact cycle to start the next feature branch from a correct base:

1. **Discard transient churn first.** Auto-generated churn (e.g. regenerated `.agents/evals/lessons/*`)
   blocks `git checkout develop` and, if forced or ignored, causes the new branch to fork off the wrong
   base. **Discard it with a scoped `git checkout --`, not a bare stash:**
   ```bash
   git checkout -- .agents/evals/lessons
   git checkout develop
   git pull
   git checkout -b <type>/<topic>
   ```
   `pnpm harness:pre-push` already tolerates this specific churn (it does not block a push when the only
   dirty files are the auto-generated evals lessons), so no stash is needed for the push itself.
2. **Pull develop** so the new branch is based on the freshly-pulled integration head.
3. **Create the feature branch** from the updated `develop`.
4. **Verify the base.** Confirm the new branch forked from the freshly-pulled `develop`, not a previous
   feature branch:
   ```bash
   git merge-base --is-ancestor origin/develop HEAD && echo "base OK"
   ```

**Why:** Branching for a new item once cut from the wrong base because uncommitted evals churn blocked
`git checkout develop`, so the new branch silently forked off the previous feature branch.

**Stash hygiene.** Never reach for a bare `git stash` / blind `git stash pop` to deal with known
auto-generated churn. Stashes accumulate across sessions (a stack dozens deep was observed), so
`git stash pop` routinely restores the WRONG entry. For known auto-generated churn, discard with
`git checkout -- <path>`. If you must preserve real local edits, use a scoped `git stash push -- <path>`
and pop by explicit ref (`git stash pop stash@{N}`), never the bare top of the stack.

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

### Pre-Merge Code-Review Gate (mandatory, zero exceptions)

**Every PR the agent opens must pass a `/code-review` before it is merged. Merging a PR that has not
been code-reviewed and had all findings resolved is prohibited.**

Sequence for every PR (no merge — admin or otherwise — may happen before step 4 completes):

1. **Open the PR** and wait for its checks (CI) to be green.
2. **Run the `/code-review` skill** scoped to the PR's diff (the branch vs. its base).
3. **Resolve every finding.** A finding is "resolved" when one of these is true, recorded in a PR
   comment (or the PR description):
   - it is **fixed** with a follow-up commit on the same branch (then re-run the relevant
     tests/typecheck/`harness:scan` so the fix is verified), **or**
   - it is **refuted** with an explicit, written reason why it is not a real problem (a false positive
     or out-of-scope), **or**
   - it is **deferred** by filing a backlog item and linking it, only when the finding is real but
     genuinely out of the PR's scope (must be justified, not a convenience).
     No CONFIRMED/PLAUSIBLE finding may be left silently unaddressed.
4. **Only after all findings are resolved** may the PR be merged.

**Scope:** required for any PR that changes code (`.ts`/`.tsx`/`.js`/`.mjs`/`.cjs`). A
documentation/spec/backlog-only PR (markdown/JSON config only, no code diff) is exempt — running
`/code-review` on it yields no code findings — but a PR that mixes code and docs is in scope.

**Why:** code review is the last gate before code reaches `develop`/`main`. Resolving findings
pre-merge keeps defects out of the integration branch instead of chasing them afterward. This applies
to the agent's own admin merges to `develop` exactly as to `main`.

### Deployment

- **Cloudflare Pages** (blog, docs) deploys automatically when `main` is updated.
- Manual docs deployment uses `pnpm docs:deploy`, which uploads `apps/docs/.vitepress/dist` to Cloudflare Pages with Wrangler.
- Changes on release branches are NOT deployed until merged to `main`.
- When deployment is needed, create a PR from the release branch to `main` and ask the user to merge it.
