# Git & Branch Rules

Mandatory rules for git operations and branch policy.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Git Worktree — allowed for parallel agents, with guardrails

**`git worktree` is ALLOWED.** Its purpose here is to run **multiple subagents in parallel** for speed: each
agent works in its own isolated worktree, so their file edits never collide and the One-Branch-At-A-Time
serialization does not throttle independent work. Prefer the Claude Code `Agent` tool's `isolation: "worktree"`
parameter — it creates the worktree in an isolated path and auto-removes it when unchanged.

**Guardrails (these prevent the folder-confusion failures that originally motivated a ban):**

- **One working tree per session.** Never edit or commit the MAIN clone's working tree from inside a worktree
  session, and never touch a worktree from the main-clone session. Operate in exactly one working tree at a time
  (this is the #1 rule — the historical breakage was edits leaking between trees).
- **Isolated location only.** Create worktrees in the `Agent` tool's managed path or a directory OUTSIDE the
  repo — never nest one inside the repo's own tracked `packages/`/`apps/` tree.
- **Each worktree gets its own branch** cut from a freshly-fetched `origin/develop`; all the branch rules in this
  file still apply within it.
- **Clean up when done:** `git worktree remove <path>` then `git worktree prune`. `Agent`-tool worktrees
  auto-clean; manual ones are your responsibility.

**Automated safeguard (non-blocking):** `scripts/harness/pre-push.mjs` runs `pruneAndWarnStaleWorktrees()` — it
prunes administrative junk and WARNS about locked/stale leftover worktrees, but no longer blocks the push.

**History:** worktrees were previously banned after (1) edits leaked between working trees, (2) a pre-push hook
ran in the wrong directory, (3) symlink issues, and (4) locked worktrees were left behind. The guardrails above
(one-working-tree-at-a-time, isolated location, cleanup + the prune-and-warn hook) address those modes; the
parallel-agent speedup is worth it.

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

**Before pushing or merging, run `pnpm harness:verify-like-ci`** — the single entry that reproduces
the required status checks of `protect-develop`, the ruleset a feature branch's PR must satisfy
(`scripts/harness/verify-like-ci.mjs`). A bare `run-all-scans` is not that gate (HARNESS-045), and
neither is any narrower command.

- It runs the monorepo **build** and the affected packages' **test** suites, gated on exactly the
  conditions CI gates its own jobs on. Until INFRA-056 it ran neither, while being named here as the
  CI mirror — so "I ran the CI-equivalent check" was a much weaker claim than it read as. Do not
  re-add a separate "plus build and tests" instruction anywhere: the entry point owns that, and a
  second list is how the two drift.
- It does NOT run two required contexts and says so in its own summary: `dependency audit` (needs
  network and an external binary) and `windows-shell` (needs a Windows runner). Nothing local covers
  those.
- The stage list cannot drift from CI: `scripts/harness/ci-mirror-map.mjs` pins every required
  context, step for step, to `.github/workflows/ci.yml` and `.github/required-status-checks.json`,
  and `pnpm harness:test` fails when they diverge.
- **`--only` is not the gate.** A partial run prints `PARTIAL — this is NOT a CI-equivalent result`.
  Never report a partial run as green.
- Cost: a markdown-only branch is ~20s; any other branch runs the build and the e2e suites and takes
  roughly 3.5-5 minutes. Run it in the foreground and wait.

**A PR into `main` is a different gate.** `protect-main` requires `promotion ancestry`, `main PR
source guard` and `release-grade verification`; the entry point that reproduces the last of those is
`pnpm harness:verify:release`.

**Why:** selective commits leave invisible half-states — code pushed while dependent files (SPEC.md, README, tests, backlog) are not.

### Git Operations

- No `git commit` or `git push` without explicit user approval.
- Conventional commit format: `<type>(<scope>): <message>` (max 72 chars).
- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.

### Commit Cadence

Commit at appropriate logical boundaries **as work progresses** — one commit per logical step (e.g.
contract/types → adapter/mechanism → wiring/assembly → tests → docs/evidence), each left green
(build/typecheck), then open one coherent PR (DX-001). **Never batch a whole slice into a single
end-of-work commit, and never defer committing until the context is nearly exhausted** — committed
progress is safe across a compaction, whereas a large uncommitted working tree is not, and deferring
reads as stalling. Avoid the opposite failure too: do not fragment into many trivial commits. The
context window filling is **not** a reason to stop implementing or to switch to planning-only; keep
implementing and keep committing. (Owner feedback, 2026-07-17, validated on SELFHOST-003 P1.)

### Disabling the Gate is Prohibited

**Never disable a hook instead of satisfying it. Zero exceptions.** Enforced by `branch-guard.sh`
(INFRA-083). The banned set is every documented kill switch, not one flag:

| Route                                                                       | Published by |
| --------------------------------------------------------------------------- | ------------ |
| `--no-verify`, `git commit -n`                                              | git          |
| `HUSKY=0`                                                                   | husky        |
| `git -c core.hooksPath=…`, `git config core.hooksPath …`                    | git          |
| removing, emptying, or dropping the execute bit on anything under `.husky/` | —            |
| opening a hook in an editor, or writing one from `node`/`python3`           | —            |

The first version of this rule banned `--no-verify` alone. Measuring it immediately found **six other
routes walking straight through** — closing the instance and leaving the class, which is the mistake
this rule exists to stop repeating.

Reading, listing and editing a hook are untouched; only destroying one is refused. Emptying a hook
through `Write`/`Edit`/`MultiEdit` is refused separately, in `check-forbidden-patterns.sh` — a body
left with nothing to run is a removal wearing an edit's clothes.

Changing a hook through `Write`/`Edit`/`MultiEdit` requires `HOOK_EDIT_ACK=1`. That is not an escape
from a check — it IS the check: a hook may be changed, it may not be changed in passing. The first
version asked whether the new content was empty and was wrong in both directions, refusing an
ordinary partial deletion while passing `exit 0`.

**One stated limit:** an in-place shell editor can still empty a hook (`sed -i 's/.*//'`). Telling
that apart from an ordinary substitution means evaluating the editor's program, and being wrong
either way costs more than the gap — too strict refuses everyday edits, too loose buys the next
spelling. The path an agent actually takes is the tool layer, and that one is closed.

It has to be enforced at the PreToolUse layer: `--no-verify` disables the git-level hook, so the
pre-push hook cannot catch its own bypass — by the time it would run it has already been skipped.
The PreToolUse layer runs on the tool call, which the flag cannot reach.

```bash
# WRONG — steps around the gate:
git push --no-verify
git commit -n -m "..."

# CORRECT — if the gate is wrong or unrunnable, change the gate:
pnpm install --frozen-lockfile && pnpm build   # a fresh worktree owes this once
```

**Measured 2026-08-01: four parallel agents bypassed this way in a single day.** The cause was real —
the gate could not go green in a worktree (HARNESS-058) — and fixing it was necessary. It was not
sufficient. The agents were then _told_ not to bypass, which worked, and being told is not a
mechanism: the identical shape had already been written down about a bare `git stash pop` since
LESSON-005 and an agent did it anyway ten weeks later.

There is deliberately no override token. An override for an override is the next bypass. **If a check
is wrong, unrunnable, or fires on correct work, the check is what changes** — that is the whole of
HARNESS-058, and a gate that trains people to route around it has already failed.

`git push -n` is **not** covered, because for `push` that flag is `--dry-run`, not `--no-verify`. The
same short flag means different things in the two subcommands; a rehearsal is not a bypass.

### `--delete-branch` is Prohibited in `gh pr merge`

**Never pass `--delete-branch` to `gh pr merge`. Zero exceptions.**

```bash
# WRONG — deletes the branch automatically:
gh pr merge 670 --squash --delete-branch

# CORRECT — merge only, no auto-deletion:
gh pr merge 670 --squash --auto
```

**Deleting a merged branch is the agent's own call — no user request needed.** Once a branch's PR is
confirmed `MERGED` and nothing further is pending on it, clean it up: `git branch -d <name>` (local) or
`gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<name>` (remote). Leaving merged branches to pile
up is its own defect; 105 of them had accumulated by 2026-07-25. **Use the safe `-d` form, never `-D`** —
`-d` refuses a branch git cannot see as merged, which is a free second opinion on exactly the case below
where the merge did not take every commit. `-D` is reserved for an **explicitly approved abandon** of a
branch that was never merged, and is never part of routine post-merge cleanup.

Judgement is required precisely because deletion is not always right the moment a PR merges. Do **not**
delete when any of these hold:

- the branch carries commits that are **not** in the merge (e.g. a review fix pushed after auto-merge
  fired — see the #1409/#1410 sequence), or a follow-up PR is planned from the same branch;
- an agent still has it checked out in a worktree, or its worktree is `locked`;
- it is an integration branch (`develop`, `main`) or a `release/*` / `hotfix/*` branch still in flight.

Repository-level _automatic_ deletion on merge (`delete_branch_on_merge`) is deliberately **off**: it
fires before any of the above can be considered. Keeping deletion agent-driven preserves that judgement
while the guardrails below keep it safe.

**Confirm the merge landed BEFORE deleting the remote branch. Zero exceptions.** A remote branch deleted
while its PR is still open CLOSES/orphans that PR. So a remote-branch deletion is allowed only once
`gh pr view <n> --json state` reports `MERGED` **and** no PR is open on the branch right now
(`gh pr list --head <branch> --state open` is empty). Those are two questions, not one: a merged PR in
the branch's history is not evidence that nothing is open on it — a reused branch name accumulates
merged PRs from earlier rounds, and the open one hides behind that count. Never run `gh pr merge` and
the deletion in one blind sequence — the merge can fail (e.g. `mergeStateStatus: DIRTY`) while the
deletion still fires. **Enforced** by `.claude/hooks/branch-guard.sh`, which blocks
`gh api -X DELETE .../git/refs/heads/<name>`, `git push <remote> --delete <name>`, and
`git push <remote> :<name>` unless both hold, and fails closed when either query cannot answer.
Override for an intentional abandon: `BRANCH_GUARD_ALLOW_DELETE=1` **inline in the same command**
(`BRANCH_GUARD_ALLOW_DELETE=1 git push origin --delete <name>`) — the guard reads the command string,
so an `export` in an earlier statement does not reach it.

**Why:** `--delete-branch` once deleted the `develop` integration branch, and a blind delete after a _failed_ merge once closed an unmerged PR (cherry-pick recovery). The merged-PR half alone was not enough: `fix/d4-scope-calculator` carried two merged PRs from earlier reuses of the name, so the count read `2` and the deletion proceeded while #1483 was open and `DIRTY` — GitHub closed it. Deletion is safe only after the merge is confirmed, never for integration branches. Note the two hazards differ in cost: a deleted `develop` is **recoverable** (re-cut it from `main`), whereas a branch deleted while its PR is unmerged **orphans work**. That asymmetry is why the ban targets the blind, automatic form — not deletion itself, which the agent should do routinely once a merge is confirmed.

### Branch Policy

- `main` is the production branch. Direct commits, pushes, and merges to `main` are prohibited.
  **A PR to `main` may ONLY come from `develop` (or a `release/*` / `hotfix/*` promotion branch) — never a
  feature branch** (a feature branch PR'd straight to `main` sweeps the whole `develop` delta and diverges
  the branches — the #1216 incident). MECHANICALLY enforced by the `main-pr-source-guard` CI job
  (`.github/workflows/ci.yml`). The flow is fixed: **feature→develop→main**.
- `develop` is the integration branch. All feature work branches from `develop`. Direct commits to
  `develop` are also prohibited — branch first, then PR. (Both `main` and `develop` are protected;
  enforced by `.husky/pre-commit` and the `branch-guard` skill/hook.)
- Feature branches must be created from `develop` and merged back into `develop`. **Create them from the
  freshly-fetched `origin/develop` head — never from `main`, and never from another local feature branch.**
  Explicitly: `git fetch origin && git checkout -b <type>/<slug> origin/develop`. Rationale, one line each:
  branching off a squash-merged local branch re-introduces its pre-squash commits (pushes fine, merges DIRTY);
  a branch cut from `main` after a promotion drags `Merge pull request …` commits into the PR range and fails
  `commitlint`. A clean feature/docs branch has **zero merge commits** in its `origin/develop..HEAD` range.
  **Enforced at creation** by `branch-guard` (INFRA-067): a `checkout -b` / `switch -c` whose base is not
  `origin/develop` is refused, naming the base it found and the base it wanted. The start point is read from the
  command when one is given, and is the current HEAD when it is not — which is how the promotion-ancestry break
  happened, with nobody naming `main` and everyone simply standing on a promotion branch. `hotfix/*` and
  `release/*` are outside this requirement, since the rule lets them PR to `main` and prescribes no base for
  them. Deliberate exception: `BRANCH_GUARD_ALLOW_BASE=1` inline.
  **Enforced at push** by `.claude/hooks/pre-push-check.sh` (blocks a push when
  `git log --merges origin/develop..HEAD` is non-empty on a non-integration branch); `branch-guard` also flags
  local unmerged branches. Recover with `git reset --hard origin/develop && git cherry-pick <your-commit(s)>`.
- Merging `develop` into `main` requires explicit user approval and is a release-level action. **Build the
  promotion branch with `node scripts/harness/promote.mjs` — never by hand** (§ Promotion below).
- When merging a branch, always merge back to the branch it was forked from. Verify the fork point before proposing a merge target.
- If the agent wants to suggest a different merge target than the fork origin, it must explicitly recommend and receive user approval before proceeding.
- Never assume `main` as the default merge target. Always check the actual fork point.
- The mechanical floor for the protected-branch checks is `.claude/hooks/branch-guard.sh` plus
  `.husky/pre-commit`; the [`branch-guard`](../skills/branch-guard/SKILL.md) skill documents those two
  layers and their overrides. It owns no policy — this section does.

### Promotion — `develop` → `main` (mandatory, INFRA-051)

**A promotion must CARRY `main`'s ancestry. Squashing a sync merge is prohibited in both directions.**

A squash copies content across but records **no ancestry link**. After `main -> develop` squash-merged as
`bc0ee64ff` (single parent), `git merge-base --is-ancestor origin/main origin/develop` still failed, so the
next promotion re-computed against the **old merge base** and re-conflicted on the same five `package.json`
files plus `pnpm-lock.yaml` the back-merge had just reconciled (#1415 → #1413, 2026-07-26). The cost is not
the conflict — it is that a human re-derives the resolution every cycle, and **both wholesale directions are
wrong**: toward `main` reverts develop's dependency patch bumps; toward `develop` un-archives backlog items
and drops changesets.

**Build the promotion branch with the tool, not by hand:**

```bash
node scripts/harness/promote.mjs          # --dry-run to check without creating the branch
```

It performs exactly this, and stops if either step is not clean:

```bash
git checkout -B release/promote-develop-to-main origin/develop
git merge --no-ff origin/main             # records main's ancestry INTO the promotion
```

In the steady state that merge is **clean by construction and asks nothing of a human**:
`merge-base(develop, main)` is the develop commit the last promotion promoted, and `main`'s tree equals that
commit's tree, so `main`'s side of the three-way merge is empty. If it is **not** clean, `main` holds content
`develop` never integrated (a `hotfix/*`, a direct push, a conflict-resolving merge) — back-merge `main` into
`develop` on its own PR, **merged as a merge commit**, then re-run. Never resolve that inside the promotion.

**Never update a promotion PR with GitHub's "Update branch" button.** Both of its modes destroy what
the promotion asserts: the merge form adds a `main` merge commit the tool did not place, and the rebase
form rewrites the promotion's history so `main`'s ancestry is no longer carried. Either way the
`promotion ancestry` gate goes red — fail-closed, so nothing unsafe merges, but the branch is then
unrecoverable by button. Re-run `promote.mjs` instead; it rebuilds the branch from current refs.

**Merge the promotion PR with `gh pr merge <n> --merge`. Never `--squash`.**

**Enforcement — two mechanical layers, both pre-merge:**

| Layer            | Mechanism                                                                                                                   | What it blocks                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge **method** | `protect-main` ruleset, `pull_request` rule with `allowed_merge_methods: ["merge"]`                                         | GitHub refuses to squash- or rebase-merge any PR into `main`. `protect-develop` is untouched, so feature PRs still squash.                                       |
| Merge **input**  | `promotion ancestry` CI job (required status check on `protect-main`) running `scripts/harness/scan-promotion-ancestry.mjs` | A promotion whose head does not contain `origin/main` (**A1**), carries non-merge commits `develop` has never seen (**A2**), or changes develop's tree (**A3**). |

Both are gates, not detectors: they block before the merge, not after. A **plain `develop → main` PR
generally cannot satisfy A1** once `main` carries a promotion merge commit — `release/promote-develop-to-main`
is the normal route, which is why `main-pr-source-guard` admits it.

### One-Branch-At-A-Time Rule (mandatory in the MAIN clone)

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

**Why:** a second open branch silently diverges — by rebase time the first branch's content is already in develop, producing mass conflicts (repeated incidents).

**Exceptions:**

1. The user explicitly says "create a new branch anyway" or "abandon the old branch."
2. **Worktree-parallel subagents** (§ Git Worktree above): each isolated worktree carries its OWN concurrent
   feature branch — that is the point of the parallelism, and the divergence risk the rule guards against does
   not apply because each branch edits a **disjoint file set** (the orchestrator MUST partition file ownership
   before spawning) and the PRs are merged **sequentially** after CI. Create such a branch with the inline
   override the `branch-guard` hook honors: `BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1 git checkout -b <type>/<slug>`.
   In the main clone (outside a parallel wave) the rule stands as written. Procedure:
   [`worktree-parallel-orchestration`](../skills/worktree-parallel-orchestration/SKILL.md).

### PR Batching — appropriately-sized PRs (DX-001)

Do NOT split a single coherent work-unit into many tiny PRs — each one waits on a full CI run, and that overhead
repeats far more than the work warrants. Bundle multiple commits into one PR by BOTH criteria:

1. **Coherent work-unit** — the commits belong to the same feature/epic/batch/theme (e.g. all spec revisions in
   one design-gate pass; all backlog items in one authoring pass; a rule + its enforcement + its wiring).
2. **Soft size ceiling** — split when a bundle would exceed roughly **~600 changed lines or ~15 files**, or when a
   part is independently revertible and valuable. Otherwise keep it in one PR.

Use **one conventional commit per logical step** within the PR, so history stays readable while CI runs once for
the bundle. Prefer a few medium PRs over many tiny ones.

This does NOT relax the **One-Branch-At-A-Time / PR Unit Rule** above: genuinely UNRELATED backlogs still go in
separate PRs. Related steps of ONE work-unit go in one multi-commit PR. Bundling never waives a gate (an
implementation PR still carries its User Execution Test Scenarios).

### Merge Landing Verification (mandatory)

A merge is not "done" the moment `gh pr merge` returns. **Independently verify the merge actually landed
before treating the work as complete** — the merge command can report success while the change is absent
from the target's remote head, or while a required CI gate was still red (a red-`quality` PR has merged
before). Verification comes **first** in the post-merge sequence, before any branch deletion.

- The read-only `merge-verifier` agent (`.claude/agents/merge-verifier.md`, signal `MERGE VERIFIED`) owns
  the checks and is the mechanism for this. **Dispatch it after a merge rather than eyeballing it** — its
  verdict is what "verified" means here.
- **Verify each hop of a multi-hop flow** (e.g. feature→develop→main): the landing check runs after every
  hop, not only the last.
- A required gate counts as green only if it actually passed: explicitly check `quality`/build, and
  **never treat "pending" or "not-required-skipped" as pass**.

**Why:** a PR once merged despite a red quality gate and shipped a broken build to `main` (DATA-005).

### Delete Merged Branches (mandatory)

After a PR merges, its now-merged feature branch must not be left standing: only `develop` and `main` are
standing branches. **Mandatory here means "do not leave it undone", not "delete unconditionally"** — the
judgement conditions above govern, and when one of them holds the branch stays and the reason is recorded.
**Never** use `gh pr merge --delete-branch` (see the ban above) — delete explicitly, only after confirming
the branch is merged:

- **Local:** `git branch -d <branch>` (the `-d` form refuses an unmerged branch — a built-in guard).
- **Remote:** confirm merged, then `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`.
- **Verify before remote deletion:** `git merge-base --is-ancestor origin/<branch> origin/main` (or
  `origin/develop` for non-release merges) must succeed. If it does not, the branch carries commits the
  target does not have — do not delete it; surface it.

**Never delete `develop` or `main`.**

**Why:** stale merged branches obscure the active set; the safe per-branch delete (never merge-time `--delete-branch`) avoids the incident that deleted `develop`.

### Post-Merge Branch Cycle (mandatory)

After a branch is merged, the next feature branch must start from a correct base. The invariants:

- **Discard transient churn before switching branches — with a scoped `git checkout --`, never a bare
  stash.** Auto-generated churn (e.g. regenerated `.agents/evals/lessons/*`) blocks `git checkout develop`
  and, if forced or ignored, causes the new branch to fork off the wrong base. So the discard
  (`git checkout -- .agents/evals/lessons`) precedes `git checkout develop`. `pnpm harness:pre-push`
  already tolerates this specific churn (it does not block a push when the only dirty files are the
  auto-generated evals lessons), so no stash is needed for the push itself.
- **Never commit these files.** They are regenerated in place; staging them (typically via a broad
  `git add .agents`) sweeps machine-churn into a feature/spec commit. **Stage explicit paths, not a broad
  directory add.** **Enforced** by `.husky/pre-commit`, which blocks a commit that stages
  `.agents/evals/lessons/*` (override only for a sanctioned harness update: `ALLOW_LESSONS_COMMIT=1`).
- **The new branch's base is the freshly-pulled integration head — and that must be verified, not
  assumed:** `git merge-base --is-ancestor origin/develop HEAD` must succeed.

**Ordering and per-failure routing for the whole post-merge sequence** — verify the landing, then delete the
branch, then re-base — are owned by [`post-merge-cycle`](../skills/post-merge-cycle/SKILL.md).

**Why:** uncommitted evals churn once blocked `git checkout develop`, so a new branch silently forked off the previous feature branch.

**Stash hygiene.** Never use a bare `git stash` / blind `git stash pop` for known auto-generated churn —
stashes accumulate across sessions and `pop` restores the wrong entry. Discard churn with
`git checkout -- <path>`; to preserve real local edits use a scoped `git stash push -- <path>` and pop by
explicit ref (`git stash pop stash@{N}`), never the bare top of the stack.

### Feature Branch Workflow (mandatory)

**Never commit directly to `main` or release branches.** Always create a feature branch for work.

**Branch naming:** `<type>/<topic>` (e.g., `feat/blog-i18n`, `fix/header-switcher`, `chore/cleanup-tasks`).

**When current branch is `main`:** cut the feature branch from the freshly-fetched `origin/develop` and
target `develop` — **not** `main`. A feature branch may never PR `main` (Branch Policy above; enforced by
the `main-pr-source-guard` CI job). Work reaches `main` only through the `develop`→`main` promotion, and
**the user merges that PR manually — the agent cannot merge to `main`.**

**When current branch is a release branch (e.g., `release/v3.0.0`):**

1. Create a feature branch from the release branch (e.g., `feat/topic`).
2. Do all work on the feature branch.
3. When work is complete, propose to the user how to integrate:
   - **Option A: Direct merge** — agent merges the feature branch into the release branch (for small, low-risk changes).
   - **Option B: PR** — agent creates a PR targeting the release branch (for larger or higher-risk changes).
4. The user decides which option to use. The agent must not merge without proposing first. If the user
   picks neither, or the chosen integration conflicts, **stop and surface it** — never substitute the
   other option, and never merge to resolve the ambiguity.

### Pre-Merge Code-Review Gate (mandatory, zero exceptions)

**Every PR the agent opens must pass a `/code-review` before it is merged. Merging a PR that has not
been code-reviewed and had all findings resolved is prohibited.** No merge — admin or otherwise — may
happen before this gate completes.

**Gate preconditions.** The gate runs on a PR whose **required checks are green** — a red required check
is a build/test failure, not a review finding — and the review is **scoped to the PR's diff (the branch
versus its base)**, not to one file and not to the whole tree.

**What "resolved" means.** A finding is "resolved" when one of these is true, recorded in a PR
comment (or the PR description):

- it is **fixed** with a follow-up commit on the same branch (then re-run the relevant
  tests/typecheck/`harness:scan` so the fix is verified), **or**
- it is **refuted** with an explicit, written reason why it is not a real problem (a false positive
  or out-of-scope), **or**
- it is **deferred** by filing a backlog item and linking it, only when the finding is real but
  genuinely out of the PR's scope (must be justified, not a convenience).

No CONFIRMED/PLAUSIBLE finding may be left silently unaddressed. **Only after all findings are resolved**
may the PR be merged.

**Enforced** by `.claude/hooks/merge-gate.sh`, which refuses `gh pr merge` unless the PR is `CLEAN`
and carries a review newer than its head commit, and refuses outright when the reviewer's own
`ACTIONABLE FINDINGS: <n>` says findings remain. It fails closed: an unreadable state is a refusal,
never a pass. Deliberate exception: `MERGE_GATE_ACK=1` **inline in the same command**, which prints
that the gate did not verify — an override is a visible choice, not a silent one.

The hook deliberately does NOT judge whether a prose finding was addressed; that is the reviewer's
call, and a hook guessing at it would be a check measuring the wrong thing. It establishes only that
CI is green and that a current review exists to be read.

This exists because the sentence above was not enough on its own: on 2026-07-28, with this rule, the
orchestration skill and its three agents all in place, two PRs were merged past unread findings in a
single session — #1503, whose MUST needed #1507, and #1510, whose High needed #1517.

The loop that drives a PR to that state is owned by
[`pr-finding-resolution-loop`](../skills/pr-finding-resolution-loop/SKILL.md) (review → record → fix, to
convergence) and [`automated-review-convergence`](../skills/automated-review-convergence/SKILL.md) (the
automated-feedback rounds). Both consume the taxonomy above rather than defining one.

**Scope:** required for any PR that changes code (`.ts`/`.tsx`/`.js`/`.mjs`/`.cjs`). A
documentation/spec/backlog-only PR (markdown/JSON config only, no code diff) is exempt — running
`/code-review` on it yields no code findings — but a PR that mixes code and docs is in scope.

**Why:** code review is the last gate before code reaches `develop`/`main`. Resolving findings
pre-merge keeps defects out of the integration branch instead of chasing them afterward. This applies
to the agent's own admin merges to `develop` exactly as to `main`.

### Deployment

What this rule owns is the **branch** side of deployment. The topology — which app deploys to which
platform, on which trigger, by which script — is owned by
[`.agents/specs/architecture-map/apps-and-deployment.md`](../specs/architecture-map/apps-and-deployment.md).

- Changes on release branches are NOT deployed until merged to `main`.
- When deployment is needed, create a PR from the release branch to `main` and ask the user to merge it.
