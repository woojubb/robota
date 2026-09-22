# A Claude desktop worktree session starts off-policy, and what brings it back

> Historical evidence only. Issue #2826 removed the loop ledger and this startup sequence is not
> operative guidance. Current worktree and branch policy lives in `.agents/rules/git-branch.md` and
> `.agents/memory/current-execution-permissions.md`.

In-repo mirror (memory-mirroring rule) of a host-memory note written 2026-09-21 while landing
CHECKS-2664 (PR #2811). Owner permission is owned by
[current-execution-permissions.md](current-execution-permissions.md): **agent-created worktrees are
prohibited**. The Claude desktop app's "Code" tab may itself open a session inside
`.claude/worktrees/<name>/` — that placement is the host's, not the agent's, and this note records how
such a session reaches a rule-conformant state without creating any further worktree.

- **The branch is main-based.** The app's `claude/<name>` branch is cut from `main`, tens of commits
  behind `origin/develop`, so rules and harness code read there can be stale (§ Lanes in
  `spec-workflow.md` did not exist on that base). Re-cut before reading rules in depth:
  `git fetch origin develop && git checkout -b <type>/<slug> origin/develop`.
- **`branch-guard` refuses the re-cut** while other sessions' unmerged local branches exist; they are
  not this session's to delete. The declared hatch is `BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1` (inline or
  env), after reading the list and confirming none is yours.
- **No `node_modules`.** The first `git commit` fails inside lint-staged. `pnpm install
--frozen-lockfile` once, before the first commit (git-branch.md already says a fresh worktree owes it).
- **A ledger line already appended** (`loop-run.mjs open` before the re-cut) blocks the checkout; discard
  it, re-cut, re-append — and open orchestrator runs with `--ref <Task path>` or they cannot be closed.
- **PR body edits re-dispatch CI**: `gh pr edit --body` fires `pull_request: edited`, the concurrency
  group cancels the in-flight `ci.yml` run and starts another. Write the body once, before the first
  push; the control-plane statement (git-branch.md § Landing a control-plane change, step 1) belongs
  in that first version when the diff touches `.github/workflows/`.
- **The app cannot bind the PR** when `origin` is an SSH alias (`github.com-<user>:…`); watch checks
  with `gh pr checks` under a `Monitor`. Delete a merged remote branch with the rule's own command
  (`gh api -X DELETE repos/<o>/<r>/git/refs/heads/<branch>`, git-branch.md § Delete Merged Branches):
  on 2026-09-21 `git push origin --delete <branch>` from a freshly cut, unpushed branch was refused by
  `pre-push-check` ("no local review recorded for docs/checks-2664-closeout at 1c02d9777") and the
  post-verdict action-request guard, so the API form is the one that does not depend on the current
  branch's review state.
