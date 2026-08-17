# Git & Branch Rules

Mandatory rules for git operations and branch policy.
Parent: [AGENTS.md](../../AGENTS.md) | Index: [rules/index.md](index.md)

### Git Worktree — allowed for parallel agents, with guardrails

**`git worktree` is ALLOWED.** Its purpose here is to run **multiple subagents in parallel** for speed: each
agent works in its own isolated worktree, so their file edits never collide and the One-Branch-At-A-Time
serialization does not throttle independent work. Prefer the Claude Code `Agent` tool's `isolation: "worktree"`
parameter — it creates the worktree in an isolated path and auto-removes it when unchanged.

**Guardrails (each closes a real failure mode of shared working trees):**

- **One working tree per session.** Never edit or commit the MAIN clone's working tree from inside a worktree
  session, and never touch a worktree from the main-clone session. Operate in exactly one working tree at a time
  (this is the #1 rule — edits leaking between trees is the breakage the others exist to prevent).
- **Isolated location only.** Create worktrees in the `Agent` tool's managed path or a directory OUTSIDE the
  repo — never nest one inside the repo's own tracked `packages/`/`apps/` tree.
- **Each worktree gets its own branch** cut from a freshly-fetched `origin/develop`; all the branch rules in this
  file still apply within it.
- **Clean up when done:** `git worktree remove <path>` then `git worktree prune`. `Agent`-tool worktrees
  auto-clean; manual ones are your responsibility.

**Automated safeguard (non-blocking):** `scripts/harness/pre-push.mjs` runs `pruneAndWarnStaleWorktrees()` — it
prunes administrative junk and WARNS about locked/stale leftover worktrees, but no longer blocks the push.

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

**Before merging — and before reporting a branch green — run `pnpm harness:verify-like-ci`** — the
single entry that reproduces the required status checks of `protect-develop`, the ruleset a feature
branch's PR must satisfy (`scripts/harness/verify-like-ci.mjs`). A bare `run-all-scans` is not that
gate, and neither is any narrower command. Which local gate runs at PUSH time — the fast scoped
`pnpm harness:pre-push` by default, the full entry point opt-in — is owned by
[verification.md](verification.md) § Pre-Push Local Verification Requirement, not here.
For an integration-child PR, that entry point binds PR-base discovery to the actual single pushed ref, HEAD
object, and matching `origin` destination; it never infers a narrow base from the checkout while another
remote or ref, or multiple refs, are being pushed.

- It runs the monorepo **build** and the affected packages' **test** suites, gated on exactly the
  conditions CI gates its own jobs on. Do not re-add a separate "plus build and tests" instruction
  anywhere: the entry point owns that, and a second list is how the two drift — an entry point named
  as the CI mirror while running less makes "I ran the CI-equivalent check" a much weaker claim than
  it reads as.
- It does NOT run two required contexts and says so in its own summary: `dependency audit` (needs
  network and an external binary) and `windows-shell` (needs a Windows runner). Nothing local covers
  those.
- The stage list cannot drift from CI: `scripts/harness/ci-mirror-map.mjs` pins every required
  context, step for step, to `.github/workflows/ci.yml` and `.github/required-status-checks.json`,
  and `pnpm harness:test` fails when they diverge.
- **`--only` is not the gate.** A partial run prints `PARTIAL — this is NOT a CI-equivalent result`.
  Never report a partial run as green.
- Cost is reported from the current plan, per stage and in total. Run it in the foreground and wait;
  do not rely on a fixed historical duration, because selected scopes and retained E2E capabilities
  determine the actual time.

**A PR into `main` is a different gate.** `protect-main` requires `promotion ancestry`, `main PR
source guard` and `release-grade verification`; the entry point that reproduces the last of those is
`pnpm harness:verify:release`. Protected CI is the sole automatic owner of that content-verification
entry point: `promote.mjs` performs the local structural and ancestry checks but does not run the
release suite a second time. The root command remains available as an explicit local diagnostic.

**Why:** selective commits leave invisible half-states — code pushed while dependent files (SPEC.md, README, tests, backlog) are not.

### Git Operations

- Conventional commit format: `<type>(<scope>): <message>`, subject **max 100 characters** — the
  value `commitlint` actually enforces (`config-conventional`'s `header-max-length`), verified by
  running it. This line used to say 72, which nothing enforced.

  The 72 was amended to match the configuration rather than the reverse,
  because the measurement went against tightening: of the last 100 subjects, **43 fall between 73 and
  100 characters**, and GitHub appends the ` (#NNNN)` pull-request suffix — **8 characters the author
  never typed** — on every squash merge. A 72-character ceiling would reject nearly half of this
  repository's normal practice, partly for text the author cannot control.

- Valid types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.

### Commit Cadence

Commit at appropriate logical boundaries **as work progresses** — one commit per logical step (e.g.
contract/types → adapter/mechanism → wiring/assembly → tests → docs/evidence), each left green
(build/typecheck), then open one coherent PR. **Never batch a whole slice into a single
end-of-work commit, and never defer committing until the context is nearly exhausted** — committed
progress is safe across a compaction, whereas a large uncommitted working tree is not, and deferring
reads as stalling. Avoid the opposite failure too: do not fragment into many trivial commits. The
context window filling is **not** a reason to stop implementing or to switch to planning-only; keep
implementing and keep committing. (Owner directive.)

**Committing needs no separate approval; PUBLISHING does.** This section used to sit six lines below
"No `git commit` or `git push` without explicit user approval", and the two could not both hold in an
autonomous run: one required asking before every commit, the other forbade deferring them. The
ask-first line was deleted rather than qualified — `agent-conduct.md`
already outranked it, which had made it a dead letter that still read as absolute, and the observed
failure was the cadence side: commits deferred to the context limit.

What remains gated is the **outward-facing** step, and it is gated by mechanism rather than by prose:
a push runs `.claude/hooks/pre-push-check.sh`, a merge runs `.claude/hooks/merge-gate.sh`, and a
merge into `main` is the user's alone (Feature Branch Workflow below). Working on a feature branch is
reversible; those three are not.

### Disabling the Gate is Prohibited

**Never disable a hook instead of satisfying it. Zero exceptions.** Enforced by `branch-guard.sh`.
The banned set is every documented kill switch, not one flag:

| Route                                                                       | Published by |
| --------------------------------------------------------------------------- | ------------ |
| `--no-verify`, `git commit -n`                                              | git          |
| `HUSKY=0`                                                                   | husky        |
| `git -c core.hooksPath=…`, `git config core.hooksPath …`                    | git          |
| removing, emptying, or dropping the execute bit on anything under `.husky/` | —            |
| opening a hook in an editor, or writing one from `node`/`python3`           | —            |

Banning a single route closes the instance and leaves the class — every route the ban does not name
walks straight through it, silently. The table is maintained as the class, and a newly published
kill switch joins it rather than earning its own rule.

Reading, listing and editing a hook are untouched; only destroying one is refused. Emptying a hook
through `Write`/`Edit`/`MultiEdit` is refused separately, in `check-forbidden-patterns.sh` — a body
left with nothing to run is a removal wearing an edit's clothes.

Changing a hook through `Write`/`Edit`/`MultiEdit` requires `HOOK_EDIT_ACK=1`. That is not an escape
from a check — it IS the check: a hook may be changed, it may not be changed in passing. A content
test ("is the new body empty?") is wrong in both directions — it refuses an ordinary partial
deletion and passes a body of `exit 0` — which is why the check demands the acknowledgement instead
of judging the edit.

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

**Measured: four parallel agents bypassed this way in a single day.** The cause was real — the gate
could not go green in a worktree — and fixing it was necessary. It was not sufficient: being told
not to bypass works until it doesn't, and being told is not a mechanism.

There is deliberately no override token. An override for an override is the next bypass. **If a check
is wrong, unrunnable, or fires on correct work, the check is what changes** — a gate that trains
people to route around it has already failed.

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
up is its own defect; they accumulate in the hundreds. **Use the safe `-d` form, never `-D`** —
`-d` refuses a branch git cannot see as merged, which is a free second opinion on exactly the case below
where the merge did not take every commit. `-D` is reserved for an **explicitly approved abandon** of a
branch that was never merged, and is never part of routine post-merge cleanup.

Judgement is required precisely because deletion is not always right the moment a PR merges. Do **not**
delete when any of these hold:

- the branch carries commits that are **not** in the merge (e.g. a review fix pushed after auto-merge
  fired), or a follow-up PR is planned from the same branch;
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

**Why:** the automatic form fires before any of the judgement conditions can be read — it can take an integration branch, and after a _failed_ merge it closes the unmerged PR it was cleaning up after. The merged-PR half alone is not enough: a branch name reused across several PRs carries their merges, so a count of merged PRs reads greater than zero while the CURRENT PR is still open — and the deletion proceeds and closes it. Deletion is safe only after the merge is confirmed, never for integration branches. Note the two hazards differ in cost: a deleted `develop` is **recoverable** (re-cut it from `main`), whereas a branch deleted while its PR is unmerged **orphans work**. That asymmetry is why the ban targets the blind, automatic form — not deletion itself, which the agent should do routinely once a merge is confirmed.

### Branch Policy

- `main` is the production branch. Direct commits, pushes, and merges to `main` are prohibited.
  **A PR to `main` may ONLY come from `develop` (or a `release/*` / `hotfix/*` promotion branch) — never a
  feature branch** (a feature branch PR'd straight to `main` sweeps the whole `develop` delta and diverges
  the branches). MECHANICALLY enforced by the `main-pr-source-guard` CI job
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
  **Enforced at creation** by `branch-guard`, over every spelling that CREATES a branch —
  `git checkout -b`, `git switch -c`, and `git branch <name> [<start-point>]`. All three spellings,
  because a rule that names only some of them is true on paper and reachable around in practice —
  `git branch x main && git checkout x` reaches neither the base check nor the name check when only
  the first two are covered. Listing, deleting and renaming (`git branch`, `-a`, `-r`, `-v`, `--list`, `-d`/`-D`,
  `-m`/`-M`) are not creations and pass silently. The copy forms — `git branch -c`/`-C`/`--copy`/
  `--force-copy` — DO create a branch and are **refused**, not judged: their arguments run the other
  way round (`-c <old> <new>` names the new branch SECOND), so reading a name and a base out of the
  usual positions would answer confidently backwards. Create the prescribed way instead, or take the
  deliberate exception `BRANCH_GUARD_ALLOW_BRANCH_COPY=1` inline. A creation whose base is not
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

### Promotion — `develop` → `main` (mandatory)

**A promotion must CARRY `main`'s ancestry. Squashing a sync merge is prohibited in both directions.**

A squash copies content across but records **no ancestry link**. After a squashed sync merge (a single
parent), `git merge-base --is-ancestor origin/main origin/develop` still fails, so the next promotion
re-computes against the **old merge base** and re-conflicts on exactly the files the back-merge just
reconciled. The cost is not the conflict — it is that a human re-derives the resolution every cycle,
and **both wholesale directions are wrong**: toward `main` reverts develop's dependency patch bumps;
toward `develop` un-archives backlog items and drops changesets.

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

**Why:** a second open branch silently diverges — by rebase time the first branch's content is already in develop, producing mass conflicts.

**Exceptions:**

1. The user explicitly says "create a new branch anyway" or "abandon the old branch."
2. **Worktree-parallel subagents** (§ Git Worktree above): each isolated worktree carries its OWN concurrent
   feature branch — that is the point of the parallelism, and the divergence risk the rule guards against does
   not apply because each branch edits a **disjoint file set** (the orchestrator MUST partition file ownership
   before spawning) and the PRs are merged **sequentially** after CI. Create such a branch with the inline
   override the `branch-guard` hook honors: `BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1 git checkout -b <type>/<slug>`.
   In the main clone (outside a parallel wave) the rule stands as written. Procedure:
   [`worktree-parallel-orchestration`](../skills/worktree-parallel-orchestration/SKILL.md).

### PR Batching — appropriately-sized PRs

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
from the target's remote head, or while a required CI gate was still red. Verification comes **first**
in the post-merge sequence, before any branch deletion.

- The read-only `merge-verifier` agent (`.claude/agents/merge-verifier.md`, signal `MERGE VERIFIED`) owns
  the checks and is the mechanism for this. **Dispatch it after a merge rather than eyeballing it** — its
  verdict is what "verified" means here.
- **Verify each hop of a multi-hop flow** (e.g. feature→develop→main): the landing check runs after every
  hop, not only the last.
- A required gate counts as green only if it actually passed: explicitly check `quality`/build, and
  **never treat "pending" or "not-required-skipped" as pass**.

**Why:** a merge that lands past a red required gate ships the failure to the integration branch, and
nothing after the merge announces it — only an independent landing check sees it.

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

**Why:** stale merged branches obscure the active set; the confirmed per-branch delete (never merge-time `--delete-branch`) is the form that cannot take an integration branch or an unmerged PR with it.

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

### An open PR's diff is frozen except to resolve a finding

**Open a PR only when the unit of work is complete.** An open PR is a merge invitation: it may be
merged the moment its review reports clean. A PR opened on a half-finished unit invites a merge of
half the work.

**Once it is open, the only permitted reason to push a new commit is to RESOLVE A REPORTED FINDING**
(the "fixed" branch above). Not the next part of the same task, and not an improvement the reviewer
did not ask for. A reviewer who reported clean reviewed a diff that no longer exists, and the merge
decision was made on the PR as it read.

The merge gate refuses a merge whose review names a stale head — but that ordering is not guaranteed.
A merge that lands before the push sees nothing to refuse, and the unpushed work is simply absent
from it.

If more work belongs to the same task, **finish it before opening the PR**, or open a second PR after
the first lands. If a finding's fix requires work beyond the finding, say so on the thread and let the
reviewer re-scope; do not widen the diff and leave them to discover it.

Enforced by: `.claude/hooks/pre-push-check.sh`. Its open-PR exemption rests on the premise that a
push into an open PR resolves what the review reported; when the PR's latest review reports
`ACTIONABLE FINDINGS: 0` there is nothing to resolve, so the push is new work and the hook refuses.
An unreadable count is not zero — the exemption stands, because a refusal on a failed measurement
blocks correct work on no evidence. Deliberate exception: `PRE_PUSH_ALLOW_UNREVIEWED=1` inline.

**Enforced** by `.claude/hooks/merge-gate.sh`, which refuses `gh pr merge` unless the PR is `CLEAN`
and carries a review naming the exact current `baseRefOid` and `headRefOid`, and refuses outright
when the reviewer's own `ACTIONABLE FINDINGS: <n>` says findings remain. Timestamp recency is not
review identity: a base can change while the child head does not. The hook fails closed on missing,
malformed, duplicate, stale, or unreadable markers. Deliberate exception: `MERGE_GATE_ACK=1` **inline
in the same command**, which prints that the gate did not verify — an override is a visible choice,
not a silent one.

The hook deliberately does NOT judge whether a prose finding was addressed; that is the reviewer's
call, and a hook guessing at it would be a check measuring the wrong thing. It establishes only that
CI is green and that a current review exists to be read.

The hook exists because the prose alone does not hold the gate: with the rule and the orchestration
in place but nothing refusing the command, a merge can still happen past unread findings — and every
one costs a follow-up pull request to fix what the unread review had already found.

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
