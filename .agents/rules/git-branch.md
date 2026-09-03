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

- A commit message MUST NOT carry an agent-session link — a `Claude-Session:` trailer or a
  `claude.ai/code/session…` URL. A commit names its work item and issue; the session that wrote it is
  a private link with no place in a shared, permanent record. `Co-Authored-By` is attribution and
  stays. The PR body's contract, including the same prohibition for bodies, is owned by
  [backlog-execution.md](backlog-execution.md) § PR Unit Rule.
  Enforced by: `no-session-link` (commitlint)

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

Changing a hook — any file under `.husky/` (the git-level hooks) or `.claude/hooks/` (the PreToolUse
gates, the guard itself included) — through `Write`/`Edit`/`MultiEdit` requires `HOOK_EDIT_ACK=1`.
That is not an escape from a check — it IS the check: a hook may be changed, it may not be changed
in passing. A content test ("is the new body empty?") is wrong in both directions — it refuses an
ordinary partial deletion and passes a body of `exit 0` — which is why the check demands the
acknowledgement instead of judging the edit.

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
- **Read check-run state per LATEST run per check `name`, never per row.** The check-runs endpoint
  returns every run ever created for the commit, so a re-triggered workflow leaves superseded rows
  behind as `completed`/`cancelled` — rows that say "concluded" about a check that never ran on the
  tree (issue #2237, measured on PR #2235). `latestCheckRunsByName` in
  `scripts/harness/github-api.mjs` is the one place that dedupe lives; every gate or script reading
  check state goes through it. And `cancelled` is **evidence in neither direction** — not a failure,
  not a pass, but the absence of a result: wait for or trigger a real run (`checkRunEvidence`).

**Why:** a merge that lands past a red required gate ships the failure to the integration branch, and
nothing after the merge announces it — only an independent landing check sees it.

### Delete Merged Branches (mandatory)

After a PR merges, its now-merged feature branch must not be left standing: only `develop` and `main` are
standing branches. **Mandatory here means "do not leave it undone", not "delete unconditionally"** — the
judgement conditions above govern, and when one of them holds the branch stays and the reason is recorded.
**Never** use `gh pr merge --delete-branch` (see the ban above) — delete explicitly, only after confirming
the branch is merged:

- **Verify first, and verify the MERGE COMMIT — never the branch.** This repository squash-merges: a
  squash merge writes a NEW commit on the target, so a merged branch's own commits are ancestors of
  nothing there. Ancestry of the branch therefore answers a question nobody asked. Ask instead whether
  the branch's pull request LANDED on the target:

  ```bash
  MC=$(gh pr list --state merged --head "<branch>" --json mergeCommit --jq '.[0].mergeCommit.oid')
  [ -n "$MC" ] && git merge-base --is-ancestor "$MC" origin/main   # or origin/develop
  ```

  **Both halves are required.** A merged pull request must exist for the branch, AND its merge commit
  must be an ancestor of the target you name. A branch can carry a merged pull request whose base was
  another feature branch, leaving its work on neither standing branch — so "it was merged" alone does
  not authorize deletion. **If either half fails, do not delete it; surface it.**

- **Name the target deliberately.** `main` trails `develop` between promotions, so a branch merged to
  `develop` is legitimately absent from `main`. Check against the branch it was merged INTO.
- **Local:** `git branch -D <branch>`, after the same verification. `-d` is not a usable guard here: it
  applies the same ancestry test and so refuses every squash-merged branch. The verification above is
  the guard; `-D` without it is not.
- **Remote:** `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`.

**Never delete `develop` or `main`.**

**Why:** stale merged branches obscure the active set; the confirmed per-branch delete (never merge-time `--delete-branch`) is the form that cannot take an integration branch or an unmerged PR with it.

**Why the merge commit and not the branch.** Ancestry of the branch encodes the merge METHOD — it is
true only where merges leave the branch's own commits on the target. Encoding a contingent fact about
tooling as if it were a property of merged branches makes the rule unsatisfiable the moment the method
changes, and this failure is silent: a check that refuses a correct action produces no contradiction,
only a growing pile of undeletable branches that nothing prompts anyone to look at. The measured
before-and-after is recorded in
[PROC-012](../tasks/completed/PROC-012-verify-a-merged-branch-by-its-pull-request-merge-commit-not-by-branch-ancestry.md).

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

### One issue, one PR, one session (mandatory)

**A GitHub issue and a pull request each have exactly ONE owning session while work on it is open.**
No second session edits that branch, pushes to that PR, or starts work on that issue.

This is not the One-Branch-At-A-Time rule above. That bounds how many branches a CLONE holds; this
bounds how many SESSIONS touch one unit of work, and neither implies the other.

**The orchestrator keeps the assignment list and reads it before assigning.** Ownership is not
derivable from the issue tracker: an open issue and an unowned issue look identical there. Re-deriving
"what is unassigned" from a list of what is open is how one item gets handed out twice.

- An assignment without a named owner is not an assignment.
- A session that finds work already owned reports it to the owner and does not act.
- Releasing ownership is explicit and one-directional.

**Why it is quiet:** the collision is not in the file system, so nothing local refuses it. Two sessions
can hold disjoint branches, pass every hook, and discover at rebase time that they solved the same
problem twice — or that one silently reverted the other's reasoning while resolving a clean merge.

Enforced by: nothing — ownership exists only in the orchestrator's assignment list. A clone can see
which branches exist and which issues are open; it cannot see who was TOLD to do what, and the two
sessions in a collision each look correct locally. The only thing that has caught it is a session
asking before acting.

Case: [PROC-013](https://github.com/woojubb/robota/issues/2283).

### `ACTIONABLE FINDINGS: 0` ends the loop — it does not start a merge

<!-- enforcement declaration -->

Enforced mechanically for pushes by `.claude/hooks/pre-push-check.sh`; merge/rebase actions must use the same published request as an operator gate.

**Any published findings verdict obliges exactly one thing: STOP EDITING.** This includes both
`ACTIONABLE FINDINGS: 0` and a non-zero count. It is not a signal to merge, not a deadline, and not a
reason to hurry.

Before every next action (edit/push, rebase, or merge), the owning session must read the latest verdict
and publish a head- and verdict-bound `POST_FINDINGS_ACTION_REQUEST` comment on the PR. A maintainer
must approve it. The comment
must contain exactly these auditable fields:

```
POST_FINDINGS_ACTION_REQUEST
HEAD: <exact current PR head SHA>
VERDICT: <latest ACTIONABLE FINDINGS count>
ACTION: push | rebase | merge
GROUND: finding | red-check | rebase
EVIDENCE: <link or command output another person can inspect>
SCOPE: <the files/operation the request permits>
APPROVED: yes
APPROVED-BY: @<maintainer>
```

The next-action guard checks the marker, latest verdict count, exact head, action, explicit ground,
evidence, scope, and approval. A local review record, private judgement, advice attached to a passing
verdict, or an override token is not approval. After an approved action, a new head or verdict requires
a new decision comment.

**A push into an open pull request requires a NAMED GROUND, and there are exactly three.** This is not
a caution and not a preference. Work with no ground does not get done more carefully — **it does not
get started.**

1. **A finding published on that pull request.** Published means posted where the next reader sees it:
   a reviewer verdict, or a review you posted yourself through the writer. A finding held in one
   session is not a ground — see below.
2. **A required check that is red.** The check names what is wrong; fixing it is the resolution.
3. **The base moved and the branch must be rebased.** That is not an edit and does not restart the
   loop.

**Nothing else is a ground.** Not an improvement you noticed. Not your own prose re-read and found
imprecise. Not advice a reviewer attached to a passing verdict. Not a thing that is _true_ and _better_
and _would have been caught eventually_. Every one of those is real work and every one belongs in the
next pull request.

**Before pushing, name which of the three it is.** If you cannot name it in one sentence pointing at
something another person can open — a comment, a check, a commit range — **there is no ground and the
push does not happen.** "It was wrong and I fixed it" is not a ground; it is a description of the work,
and every unjustified round in the measured case could have said it.

**The burden runs the other way from intuition.** A defect you can see is not permission to touch a
frozen diff; it is a reason to write it down somewhere it will survive. The pull request under review
is the one place it must not go.

**Advice arriving alongside any count is not a finding.** A reviewer may add SHOULD or CONSIDER
notes on a diff it has just passed. Those are input for a FUTURE pull request. Acting on them
re-opens the diff, producing a new head, a new round, and new advice on the new code — a loop with no
terminal condition, because each fix creates the surface the next round reads.

**Merging is a separate judgement, made once, without urgency.**

- **Green checks are not authorization.** A person or orchestrator decides; a state does not.
- **Do not race the base.** Aiming at speed is what puts a merge in a race with base moves,
  concurrent merges and stale verdicts. If the base moves, rebase and re-verify — that is not an edit
  and does not restart the finding loop.
- **Round count is not the condition.** A loop is not wrong because it is long; it is wrong when it
  is editing a pull request that reported clean.

**An override supplied every time is not an override.** The hatch exists for a push whose reason the
hook cannot see. Reaching for it repeatedly is the signal that the reason has stopped being examined,
and nothing counts repeated use.

**A verdict nobody published is not a verdict — and driving your own work with one is a private gate.**

The measured case is the pull request cited below, and what the repository can show about it is this:

```
$ gh pr view 2323 --json comments,reviews
9 verdicts from github-actions   — every one ACTIONABLE FINDINGS: 0
0 reviews
0 review threads                 — nothing was ever published to answer
```

**Nine rounds, nine clean verdicts, and nothing on the pull request to have been responding to.**
That is checkable by anyone; the rest of this paragraph is not, and the difference is marked below.

The owning session reported dispatching its own reviewer each round and never dispatching
`pr-review-writer` — 32 reviewer dispatches, 0 writer dispatches, and 0 runs of `gh pr view`.
**Those three figures come from that session's account of its own behaviour and from nowhere else.**
`git grep` finds them in no file, and `.agents/loop-runs/pr-finding-resolution-loop.jsonl` — the
ledger that exists precisely to record finding-resolution rounds — holds ten rows, **none of them
this pull request.** A session's report of what it did is evidence and is worth stating; it is not a
command output, and this block previously presented it as one under the word _Measured_.

So: it dispatched its own reviewer each round, consumed the findings privately, pushed a fix, and
dispatched again. **The merge gate's input was zero from round one.** The first clean verdict landed at
`2026-08-24T21:10Z` and the merge at `2026-08-25T11:55Z` — **14h 44m**, of which 10h was an
owner-ordered write halt, leaving roughly **4h 40m** the loop itself spent. And across that whole
span, after the first commit, **not one non-comment TypeScript line changed**:

```
$ git diff <first-commit> <pr-head> -- '*.ts' | grep '^[+-]' | grep -v '^[+-] *//'
(no output)
```

Only SPEC prose, comments and changeset text moved — on a change the repository had already passed.

Case: [PR #2323](https://github.com/woojubb/robota/pull/2323).

**So the rule is not "the reviewer keeps suggesting things" and not "stop when the gate says zero".**

- **If you dispatch a reviewer, publish its verdict.** `pr-review-writer` exists for this. An
  unpublished verdict is the input to no gate, visible to nobody, and answerable by nobody — and a
  session that fixes against it has built a gate only it can see, then reports being held by it.
- **Publishing converts a finding from fuel into a record.** Published, it can be answered, deferred,
  filed as its own issue, or refuted by someone else. Unpublished, the only thing that can be done
  with it is the next commit.
- **Read the gate's input before concluding you are blocked by it.** `gh pr view <n>` is the value the
  merge gate reads. A session that has never run it does not know whether it is blocked.

**And publishing is what supplies the exit.** The session's own account of why recognising the pattern
did not stop it: _"there was no place to say this finding is real and not for this pull request."_
There is such a place, and it is the pull request — but only for a finding that was posted to it. A
finding that exists only in one session has nowhere to be deferred to, so the only move available is
to fix it now.

**The reverse failure is real too and the rule must not create it.** Of the local findings here, the
first round's two MUSTs were genuine — one was a SPEC asserting _"executor injection has no public
entry point at all"_ where at least seven public paths existed, a false universal in a
security-adjacent document. **A rule reading only "the gate says zero, so stop" ships those.** That is
the argument for publishing rather than for discarding: the repository's light-pass reviewer and a
dispatched deep reviewer answer different questions, and the gap between them belongs on the pull
request where both are visible, not inside whichever session happened to look.

**The ordering is already written down and nothing checks it.** `pr-finding-resolution-loop` step 5
reads _"Dispatch `pr-review-writer` (posts the review to the PR), **then** `pr-review-fixer`"_ — publish
first, fix second. Measured: **nothing enforces that ordering.** `scripts/harness/__tests__/`
mentions the writer — in a doc comment and in an exemption set — and neither reference checks that a
dispatch happened, so a session can run reviewer → fixer → push, thirty-two times, and no mechanism
notices the middle step was skipped.

**This paragraph first said "no file references it at all", which was false**, and the correction is
worth keeping rather than quietly applying: _referenced by nothing_ and _enforced by nothing_ are
different claims, and the first was the stronger one to make and the cheaper one to falsify — eleven
words of `grep`. A rule about not overclaiming, overclaiming in its own evidence line.

**And the surrounding mechanism does better than this paragraph did.** `scan-review-findings.mjs`
scopes itself in its own header — it checks contract PRESENCE, not that any mechanism ran — and
`orchestration-map.md` records it as a **partial** floor rather than counting it as a satisfied one.
A check that declares what it does not cover, and a map that refuses to count it as coverage, is the
opposite of the failure this section describes.

**The rule was not missing; its enforcement was.** What
catches the loop today is the frozen-diff refusal below, which refuses the second push once the pull
request's own verdict reads zero — verified against this case's branch.

**The test for an edit remains: did anyone ask for it?** A finding you published and someone can read
counts as asked. A finding only you have seen does not — and neither does your own prose, re-read.

**If no more issues can be found, there is nothing left to fix.**

Enforced by: `pre-push-check` for the half a machine can decide — it refuses a push into an open pull
request whose latest reviewer verdict reports `ACTIONABLE FINDINGS: 0`, because there is then nothing
for that push to resolve. **That refusal was unreachable when this rule was first written**, and the
way it was unreachable is worth keeping: the check sat inside the branch that runs only when no local
review is recorded, so a session that recorded one — which this file REQUIRES before a first push —
skipped the branch entirely and never reached the check. A guard bypassed by obeying the rule beside
it is not a guard. It is now evaluated on every push, before the override short-circuit, and it has
its own hatch: `PRE_PUSH_ALLOW_FROZEN_DIFF=1` inline. `PRE_PUSH_ALLOW_UNREVIEWED=1` does **not**
excuse it — that one asserts the diff is unreviewed, which is a different claim about a different
rule, and one switch disarming two unrelated gates is how both stop being asked.

**It reads two of the three grounds and says which.** A published finding is the verdict count; a red
required check it now reads too, because for a while it did not — and a push resolving a failing check
was refused as work on a pull request the same hook called merge-ready while `merge-gate.sh` would
have blocked the merge on `mergeStateStatus`. **A rebase it cannot see**, so that is the ground the
hatch is for, and the refusal says so rather than offering a remedy the author is already following.
An unreadable answer to either question leaves the refusal standing: unknown is not zero, in both
directions. The rest is not mechanizable here: whether to merge, and when, is a
judgement about a state the repository can observe but not evaluate, and a check that merged on green
would be the automation this section exists to refuse.

Case: [PROC-013](https://github.com/woojubb/robota/issues/2283).

### Work that reaches `develop` is resolved — and the closure is performed, not inferred

**When a pull request lands on `develop`, the session that owns it closes the issue that work resolves,
by hand, as a step of the post-merge sequence.** `develop` is where resolution happens. Promotion to
`main` is a release action; it is not what makes an issue done, and an issue must not wait on it.

**Do not delegate the closure to the host's closing keywords.** They fire only on a pull request whose
base is the **default branch** — which no feature pull request here has — so a keyword on a `develop`
pull request closes nothing and reads, to its author and to every later reader, as though it had.
`scripts/harness/promotion-closes.mjs` owns that fact; this section exists because relying on it is what
left delivered work sitting in the open queue. Write the keyword if you like — it costs nothing and it
documents intent — but it is not the act, and a pull request body is not a closure.

**Close what was delivered, and say what was not.** This is the reason the step is a judgement rather
than a setting. A keyword closes an issue whole, so a pull request delivering part of one either closes
undelivered acceptance criteria along with the delivered ones, or carries no keyword and closes nothing.
An issue with acceptance criteria is closed only after the criteria are compared item by item; where some
remain, the issue stays open and the comment records which, so that "addressed" and "satisfied" do not
collapse into one state.

**The closing comment names the delivering commit on `develop`.** An issue closed without that is closed
on someone's memory — the next reader cannot tell which change is supposed to have resolved it, and
cannot check.

Enforced by: nothing — whether a merged change satisfies an issue is not decidable from the tree. When
this was measured, 57 open issues were named by a merged `develop` pull request and almost every one of
those mentions was
`filed as`, `parent tracker`, or `Filed from this` — a merged pull request naming an issue is usually
**registering** work, not delivering it. A machine that closed on mention would close the backlog the
repository had just written down. What a machine can do is make the gap visible, never decide it. So the
step is carried by [`post-merge-cycle`](../skills/post-merge-cycle/SKILL.md), which must report the
closure — or the reason there was none — as part of its outcome contract, where an omission is a missing
field rather than a silence.

Case: [PROC-015](https://github.com/woojubb/robota/issues/2289).

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
and carries a review naming the exact current `headRefOid` and a base that is either the base branch's
live tip — read with `git ls-remote`, because GitHub's `baseRefOid` lags the branch by minutes (issue
#2309) — or moved over no file the PR touches (a clean merge is required either way — PROC-016), and refuses outright <!-- allow-citation: the item that changed the gate -->
when the reviewer's own `ACTIONABLE FINDINGS: <n>` says findings remain. Timestamp recency is not
review identity: a base can change while the child head does not. The hook fails closed on missing,
malformed, duplicate, stale, or unreadable markers. Deliberate exception: `MERGE_GATE_ACK=1` **inline
in the same command**, which prints that the gate did not verify — an override is a visible choice,
not a silent one.

## Which Form An Override Takes

Every guard here declares an escape hatch, and **the form is not interchangeable**. There are two,
they have different lifetimes, and using the wrong one fails silently — the command runs, the guard
refuses anyway, and the reader concludes the guard is broken.

**Inline** — `VAR=1 <command>`, in the same statement. The hook reads the command STRING, so the
assignment must prefix the guarded command. It excuses only the statement it prefixes: `VAR=1 date;
git push` does not disarm the push. This is the safer form, and most hatches use it.

**Environment** — `export VAR=1`. The hook reads `${VAR}` from its own environment. A PreToolUse hook
runs as a separate process and never sees an inline assignment on the agent's command, so only an
exported variable reaches it. It then stays armed for every later command until unset, which is the
opposite lifetime from inline and the reason this form is worth naming rather than assuming.

| variable                                                                                          | hook                          | form        |
| ------------------------------------------------------------------------------------------------- | ----------------------------- | ----------- |
| `MERGE_GATE_ACK`                                                                                  | `merge-gate.sh`               | inline      |
| `PRE_PUSH_ALLOW_UNREVIEWED`                                                                       | `pre-push-check.sh`           | inline      |
| `PRE_PUSH_ALLOW_FROZEN_DIFF`                                                                      | `pre-push-check.sh`           | inline      |
| `WORKTREE_CWD_GUARD_ALLOW_MAIN`                                                                   | `worktree-cwd-guard.sh`       | inline      |
| `BRANCH_GUARD_ALLOW_DELETE`, `_BASE`, `_BRANCH_COPY`, `_OPEN_BRANCHES`, `_BADNAME`, `_MAIN_MERGE` | `branch-guard.sh`             | either      |
| `BULK_EDIT_ACK`                                                                                   | `bulk-edit-guard.sh`          | either      |
| `FOREGROUND_WAIT_ACK`                                                                             | `no-foreground-wait.sh`       | either      |
| `HOOK_EDIT_ACK` — any file under `.husky/` or `.claude/hooks/`                                    | `check-forbidden-patterns.sh` | environment |
| `LOCKFILE_CHURN_ACK`                                                                              | `pre-push-check.sh`           | environment |

`BRANCH_GUARD_ALLOW_BADNAME` exempts a branch name from the naming convention, and
`BRANCH_GUARD_ALLOW_MAIN_MERGE` a push or merge into `main` for a release the user approved. Both
were accepted by the hook and named in no rule until this section; an undeclared bypass is worse than
a declared one, because the reader who needs it cannot find it and the reader auditing the guard does
not know it is there.

This table is NOT the authority on what works — the hook source is. It is the declaration the scan
compares against that source, in both directions.

Enforced by: `hook-override-declarations` (`scripts/harness/scan-hook-override-declarations.mjs`),
which DERIVES the accepted forms from each hook's own code rather than from a list. A hand-kept list
of accepted forms would be one more copy of exactly the thing that drifted — the declaration existed
in up to five places and nothing compared any of them to the code.

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
