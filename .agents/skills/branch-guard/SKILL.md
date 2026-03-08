---
name: branch-guard
description: Guard against committing directly to protected branches (main, master, develop). Use before every git commit to ensure work happens on a feature branch.
---

# Branch Guard

## Rule Anchor
- `AGENTS.md` > "Git Operations"

## Use This Skill When
- About to run `git commit` on any branch.
- The current branch is `main`, `master`, or `develop`.

## Preconditions
- The agent has changes ready to commit.
- The agent has confirmed user approval for the commit.

## Execution Steps

1. **Check current branch**:
   ```bash
   git branch --show-current
   ```

2. **If on a protected branch** (`main`, `master`, or `develop`):

   **First commit in a task:**
   - Do NOT commit directly.
   - Ask the user whether to create a new branch before committing.
   - Suggest a branch name based on the change type and scope:
     - `feat/<scope>-<short-description>`
     - `fix/<scope>-<short-description>`
     - `refactor/<scope>-<short-description>`
     - `docs/<scope>-<short-description>`
     - `chore/<short-description>`
   - Example: `docs/spec-expansion`, `feat/agents-caching`, `chore/harness-cleanup`
   - Wait for user confirmation of the branch name before proceeding.
   - Create and switch to the new branch:
     ```bash
     git checkout -b <approved-branch-name>
     ```

   **Subsequent commits within the same task:**
   - If a feature branch was already created for the current task, continue committing on that branch without asking again.
   - Mid-task commits (e.g., checkpointing progress in a multi-step plan) do not require a new branch — they are part of the same logical work.

3. **If NOT on a protected branch**: proceed with the commit normally.

## Protected Branches
- `main`
- `master`
- `develop`

4. **When merging a branch** (PR or local merge):

   **Determine merge target:**
   - Check the fork point of the current branch:
     ```bash
     git log --oneline --first-parent develop..HEAD
     git log --oneline --first-parent main..HEAD
     ```
   - The merge target must be the branch it was forked from.
   - If the branch was forked from `develop`, merge back into `develop`.
   - If the branch was forked from `main`, merge back into `main` (rare, requires justification).

   **Never assume `main` as the default target.** The default is always the fork origin.

   **If the agent wants a different merge target:**
   - Explicitly state the recommendation and reasoning.
   - Wait for user approval before proceeding.

   **Merging `develop` into `main`:**
   - This is a release-level action. Always ask for explicit user approval.
   - Never do this as part of a regular feature workflow.

## Stop Conditions
- User declines branch creation — do not commit on the protected branch.
- Branch name conflicts with an existing branch — ask for an alternative name.
- Merge target differs from fork origin — ask user before proceeding.

## Checklist
- [ ] Current branch checked before every commit
- [ ] Protected branch detected and user notified
- [ ] Branch name suggested with conventional prefix
- [ ] User approved the branch name
- [ ] New branch created before committing
- [ ] Merge target matches fork origin
- [ ] Release merge (develop → main) explicitly approved by user

## Anti-Patterns
- Committing directly to `main`, `master`, or `develop` without asking.
- Creating a branch without user approval of the name.
- Using generic branch names like `temp` or `wip` without a descriptive suffix.
- Creating a new branch for every intermediate commit within a single task.
- Merging into `main` when the branch was forked from `develop`.
- Assuming `main` as the default merge/PR target.
