---
title: 'INFRA-055: every required check on a promotion PR was vacuous, and the real one is optional'
status: done
created: 2026-07-26
completed: 2026-07-26
priority: high
urgency: soon
area: repo rulesets, .github/workflows
depends_on: []
---

# INFRA-055: `protect-main`'s required contexts do not verify a promotion

## Problem

Surfaced while implementing INFRA-051 and confirmed by its `proposal-reviewer` pass. On a PR whose
base is `main`, every one of `protect-main`'s inherited required status checks is a **no-op**:

| Required context | What it does on a `base_ref == 'main'` PR                                                          | Measured on #1427 |
| ---------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| `build`          | `echo "build is covered by release-grade verification"`, every later step `if: base_ref != 'main'` | 5s                |
| `quality`        | same shape                                                                                         | 5s                |
| `scans`          | same shape                                                                                         | 6s                |
| `security audit` | same shape                                                                                         | 3s                |
| `commitlint`     | whole job is `if: github.base_ref != 'main'`                                                       | skipping          |

The one job that actually verifies a promotion — `release-grade verification`, 7m31s, running
`pnpm harness:verify:release` — is **not a required status check**. Neither is `main-pr-source-guard`,
the recurrence guard for the #1216 incident. And **CodeQL failed on #1427 and the PR merged anyway**.

So the branch that ships to production was, until INFRA-051 added `promotion ancestry`, gated by five
checks that assert nothing and one that asserts everything but cannot block.

Each individual skip is defensible in isolation (`release-grade verification` genuinely subsumes
`build`/`quality`/`scans`). The defect is that the _required_ list was never moved to match, so
branch protection reports green from jobs that deliberately did no work.

Related: a skipped required check is accepted by branch protection. INFRA-050 documented that same
property being exploited accidentally, and it is the reason this is not merely cosmetic.

## Direction

1. Make **`release-grade verification`** a required status check on `protect-main`. One-line ruleset
   change; costs the first promotion PR ~8 minutes instead of merging on 6-second echoes.
2. Make **`main PR source guard`** required, so the #1216 recurrence guard can actually block.
3. Decide whether `build`/`quality`/`scans`/`security audit` should stay in the required list at all
   for `main`, given they are echoes there — either drop them or make them do the work.
4. Decide whether CodeQL should be required on `main` PRs (it already runs there and already failed
   without blocking).
5. **Narrow `protect-main.bypass_actors`.** It currently grants `RepositoryRole 5` `bypass_mode:
always`, so an admin can bypass every rule including INFRA-051's two gates. Decide whether the
   promotion path should retain it.

## Acceptance

- [x] `protect-main`'s required contexts include at least one check that verifies the promotion's
      content, proven by a deliberately-broken promotion branch being blocked. — PR #1446,
      `mergeStateStatus: BLOCKED`, `release-grade verification` red on a content scan while the five
      formerly-required contexts all reported `skipping`. See _Proof_ cell 2.
- [x] The bypass-actor decision recorded explicitly (kept, narrowed, or removed) with its reason. —
      NOT applied; recommendation recorded for the owner below.

---

## Outcome

Items 1–4 are closed. Item 5 is **not applied** — narrowing admin bypass is the repository owner's
call and a wrong move can lock them out during an incident. The recommendation is recorded below.

Reviewed by `proposal-reviewer` in two passes before anything was applied to the live ruleset. Both
returned **REVISE** and both caught real defects — the first a base-retarget bypass that defeats the
entire scheme including INFRA-051's already-live gate, the second a blacklist-of-one-spelling hole in
this item's own rot guard. Both are recorded below.

### What `protect-main` now requires

| Context                      | Added / removed | Why                                                                                                                                                    |
| ---------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `promotion ancestry`         | kept            | INFRA-051 A1/A2/A3.                                                                                                                                    |
| `main PR source guard`       | **added**       | The #1216 recurrence guard can now block. Also hardened to reject fork heads.                                                                          |
| `release-grade verification` | **added**       | The only required context that executes the repository's code on a promotion.                                                                          |
| `build`                      | **removed**     | 5s echo on a `main` PR. Subsumed by `release-grade verification`; still required on `protect-develop`.                                                 |
| `quality`                    | **removed**     | 5s echo. As above.                                                                                                                                     |
| `scans`                      | **removed**     | 6s echo. As above.                                                                                                                                     |
| `security audit`             | **removed**     | 3s echo. `release-grade verification`'s osv-scanner step is unconditional, where this job's is gated on a manifest diff — the replacement is stronger. |
| `commitlint`                 | **removed**     | Skipped wholesale on `main` by design. A promotion's merge-commit subject is GitHub-generated and every promoted commit was linted on its own PR.      |

Set in the same call: `strict_required_status_checks_policy: true`, so a promotion's green run must
have been produced against the current `main` rather than a stale one — A1 is computed against
`origin/main` at run time, so a stale run can assert ancestry against a `main` that has since moved.
`non_fast_forward`, `allowed_merge_methods: ["merge"]` and `bypass_actors` were carried through
unchanged, and `protect-develop` (a separate ruleset, 18715844) was not touched — verified after
applying.

Live state after the change:

```
$ gh api repos/woojubb/robota/rules/branches/main --jq '.[] | select(.type=="required_status_checks") | .parameters'
{"do_not_enforce_on_create":false,
 "required_status_checks":[{"context":"promotion ancestry"},
                           {"context":"main PR source guard"},
                           {"context":"release-grade verification"}],
 "strict_required_status_checks_policy":true}
```

### Unconditional-execution evidence for each added context

The bar (learned from the #1436 `review-gate` rollback the day before): a required check that can
ever fail to REPORT blocks every PR forever. Both additions were checked against it before applying.

**`release-grade verification`** — `.github/workflows/ci.yml`:

- `on: pull_request: branches: [main, develop]` with **no `paths`/`paths-ignore`**, so every PR to
  `main` triggers the workflow regardless of what it changed.
- job `release-grade-verify`: `name: release-grade verification`, `if: github.base_ref == 'main'`,
  **no `needs:`**, no matrix, no `continue-on-error`, and **every step unconditional**.
- Therefore no PR shape changes whether it reports: a docs-only promotion, an enormous promotion, a
  merge-commit head (which INFRA-051 made mandatory for `main`) and a tree identical to `develop` all
  execute the same steps. Measured on #1427: pass, 7m31s.
- Infrastructure failure (install, artifact download, osv-scanner fetch) turns it RED and blocks the
  promotion until re-run. Accepted: what disqualifies a required check is being unable to report, not
  being able to fail, and a red run here is always satisfiable by re-running it.

**`main PR source guard`** — same workflow, job `main-pr-source-guard`:

- `if: github.base_ref == 'main'`, no `needs:`, one `run:` step with no checkout, no network and no
  install.
- Its verdict is a pure function of the PR's own head (`head.repo.full_name` and `head_ref`), so it
  cannot fail for a reason unrelated to the change, and a red verdict is always satisfiable by the
  author. Measured on #1427: pass, 4s.

### The defect the review surfaced: the base-retarget bypass

`ci.yml` declared `on: pull_request:` with no `types:`, so it used GitHub's default activity set
`[opened, synchronize, reopened]`. **Retargeting a PR's base branch fires `edited`**, which is not in
that set — so no workflow re-dispatches and the PR keeps the conclusions it earned against its old
base. Measured on throwaway PR #1442 (head sha `e4806e4f`):

1. Feature branch `chore/infra-055-retarget-probe` → `develop`. Green; `main PR source guard`,
   `promotion ancestry` and `release-grade verification` all `skipping`.
2. `gh pr edit 1442 --base main`. `gh api actions/runs?head_sha=e4806e4f` returned the **same four run
   ids** before and after — nothing re-dispatched.
3. `gh pr view 1442` → **`mergeStateStatus: CLEAN, mergeable: MERGEABLE`**, with all three main-only
   contexts `SKIPPED` — and a skipped required check is accepted by branch protection.

A feature branch was one click from landing on `main`, past every gate INFRA-051 and INFRA-055 exist
to enforce. The PR was closed and the branch deleted immediately.

Fixed by adding `edited` to `ci.yml`'s `pull_request` types. The reviewer's proposed refinement —
skipping the jobs when the edit was not a base change, to avoid re-running CI on a title edit — was
**rejected**: a skipped job publishes a `skipped` check run that supersedes the previous `success`
for the same head sha, so editing a PR's title would erase its verification and leave it mergeable on
skipped required checks. Re-running is the only conclusion-preserving option, and its cost (one CI
run per title/body edit) is the price of that property. The reviewer conceded this ruling in full on
its second pass.

Two consequences of `edited` that were closed in the same change:

- **A per-PR `concurrency` group** (`ci-${{ github.event.pull_request.number }}`,
  `cancel-in-progress: true`). `ci.yml` had none while `codeql.yml` and `review-gate.yml` both do,
  and `edited` makes two runs per head sha routine — two check runs per context means a flake in
  either decides the merge verdict. Fails closed: a cancelled run reports `cancelled`, not `success`.
- **The same supersede property has one benign instance here**: a develop→main retarget re-dispatches
  the workflow and the four develop-side jobs publish `skipped` over the `success` they earned
  against `develop` (visible on #1447, where each of those contexts shows both conclusions). That is
  harmless _only_ because they are no longer required on `main`. `scan-main-required-checks.mjs` is
  what refuses the combination that would make it harmful, and the reasoning is recorded in ci.yml
  next to the trigger so nobody "restores" the old required list later.

A second, unrelated defect was found in the same job while making it required: `main-pr-source-guard`
interpolated `${{ github.head_ref }}` directly into its `run:` script. A `${{ }}` expression is
substituted before the shell parses, and a git ref may contain backticks, `$`, `;`, `&` and `|` — on
a public repo with forking enabled that is remote code execution on the runner, openable by anyone.
Now passed through `env:`. Making the job required is what obliged the fix.

### Decisions on items 3 and 4

**Item 3 — dropped, and the vacuous shape deleted rather than merely de-listed.**
`build`/`quality`/`scans`/`security-audit` now carry a job-level `if: github.base_ref != 'main'`; the
four "Skip duplicate …" echo steps and ~30 step-level `if: github.base_ref != 'main'` conditions are
gone. The echo shape existed for exactly one reason — the jobs were required on `main`, so they had
to resolve rather than linger pending — and that reason disappears with the de-listing.

The argument for dropping rather than making them work is subsumption, and the review found the
subsumption claim was **false as written**: `pnpm test` is `pnpm run -r --if-present test`, which
excludes the workspace root, so `harness:test` (the harness scans' own suite, HARNESS-021) was not in
the release gate; and `agent-cli`'s bintests live under a separate `test:bin` config, so the
RUNTIME-001 built-binary e2e was not either. Rather than weaken the claim, the gate was fixed:

```
harness:verify:release = pnpm build:deps && pnpm harness:scan && pnpm harness:test && pnpm test
                      && pnpm --filter @robota-sdk/agent-cli test:bin && pnpm typecheck && pnpm lint
```

With those two additions the subsumption is true rather than asserted: `release-grade verification`
runs the full build, the full scan suite, the scans' own tests, the package tests, the binary e2e,
typecheck and lint, plus an **unconditional** osv-scanner — where the four dropped jobs are
affected-scope-selective via `--base-ref` and gate their vulnerability scan on a manifest diff.

**Item 4 — CodeQL is NOT required on `main`.** Two independent disqualifications:

- `codeql.yml` carries `paths-ignore` for markdown/docs. A promotion whose entire `develop` delta is
  markdown is routine in this repo, and then the workflow never triggers, so neither
  `Analyze (javascript-typescript)` nor the code-scanning `CodeQL` check ever reports. A required
  context that cannot report leaves the promotion permanently pending, unblockable except by an admin
  bypass — precisely the #1436 `review-gate` rollback shape.
- The red context on #1427 was `CodeQL` (5s, `check-runs/89702695263`), the code-scanning **results**
  check, not the analysis job (`Analyze (javascript-typescript)` passed, 4m10s). It is diff-scoped —
  but a promotion's diff is the entire `develop`→`main` delta, and GitHub's own summary on #1427 says
  `Alerts not introduced by this pull request might have been detected because the code changes were
too large`. Its verdict therefore scales with promotion size rather than with anything the promotion
  decides.

This is not an analysis gap: CodeQL already runs on push to `main`/`develop` and on every code PR to
`develop`, so promoted code was analysed on its own PR. #1427 is a visibility/discipline gap.

An alternative — a step inside `release-grade-verify` querying the code-scanning API for open
`high_or_higher` alerts — was considered and **dropped**: it duplicates `check-review-gate.mjs`
(the duplicated-verdict shape INFRA-048 removed by extracting `classify-changed-paths.mjs`), it
couples a time-varying alert set into the job that verifies content, and it would require adding a
workflow-level `security-events: read` permission that every job in `ci.yml` would inherit, including
ones that execute PR-authored code.

**Recorded follow-up:** converge on `review-gate` as the alert gate on `protect-main`. It already
runs on `branches: [main, develop]`, fails closed with an explicit `UNAVAILABLE` sentinel, solves the
docs-only never-reports hole by construction using the same `classify-changed-paths.mjs` that gates
ci.yml's matrix, and blocks only on findings the PR introduces. It must **not** be made required on a
fresh single-PR sample — that is exactly what was rolled back in #1436. Require it only after it has
been observed reporting a real conclusion on both a code promotion and a docs-only promotion.

### The rot guard

The required list and the workflow are two artifacts nobody diffs against each other, which is how
this drift survived. `.github/required-status-checks.json` is now the **source** of what
`protect-main` must require, and `scripts/harness/scan-main-required-checks.mjs` (registered in
`pnpm harness:scan`) asserts offline that every context it names can actually fail on a `main` PR:

| Assertion | What it prevents                                                                                                      |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| R1        | The context resolves to exactly one job that publishes that display name — a context nothing publishes never reports. |
| R2        | The workflow triggers on `pull_request` for `main` with no `paths`/`paths-ignore` — the #1436 never-reports shape.    |
| R3        | The job's `if:` is absent or **exactly** `github.base_ref == 'main'`; no step is gated on `base_ref`.                 |
| R4        | At least one unconditional step, so the job cannot become an all-conditional shell.                                   |
| R5        | No `continue-on-error` on the job or any step — the one **fail-open** rot: command fails, check reports success.      |
| R6        | No `needs:` on a job that is itself main-excluded — GitHub then skips the required job, and skipped is accepted.      |
| R7        | The `pull_request` trigger declares `types:` including `edited`; an **absent** `types:` is the failing case.          |

A missing or empty declaration is a hard failure, not a pass. The scan is hermetic (checked-in files
only), so it always reaches a verdict, never prints SKIP, and no GitHub API outage can redden the
release gate that runs it. An opt-in `--live` half reconciles the declaration against the live
ruleset; `.github/workflows/ruleset-drift.yml` runs it daily and on demand, deliberately outside the
merge path so drift costs a red cron rather than a blocked promotion.

**R3 is a whitelist because the first draft's blacklist was green on the defect it existed to
prevent.** The reviewer ran the draft against fixtures and found three passes: `base_ref != "main"`
in double quotes (the #1427 vacuous shape, one quote character away from the spelling it caught),
`base_ref == 'develop'` (the #1436 permanent-pending shape), and a `types:` list without `edited`
(so deleting the fix above would have kept `harness:scan` green while the #1442 bypass returned).
Inverting to a whitelist makes any unanticipated spelling fail closed; R7 was added for the third.

21 unit tests assert the scan is RED on each shape it targets, not merely green on the current tree,
including each of those three fixtures. Writing them found a real parser bug of the same family: the
block-list branch reader matched every `- x` in the trigger body, so a `paths-ignore:` list parsed as
branch names and a path-filtered workflow would have looked like it covered `main` — masking the
exact R2 finding the scan exists to raise. Both block-list readers are now anchored to their own key,
with a test for the scoping class itself.

### Proof

Three real PRs against the live ruleset, all closed unmerged. Together they measure the defect, the
fix, and the bypass — none of it is argued from reasoning.

**Cell 1 — the defect, re-measured today. PR #1448, plain `develop → main`.** Its head is `develop`,
so the workflow came from develop's still-unfixed `ci.yml` — i.e. exactly the #1427 shape:

| Context          | Result       |
| ---------------- | ------------ |
| `build`          | pass, **5s** |
| `quality`        | pass, **5s** |
| `scans`          | pass, **5s** |
| `security audit` | pass, **5s** |
| `commitlint`     | `skipping`   |

Under the old required list — those five contexts — this PR was green on every required check.
Under the new one: `mergeStateStatus: BEHIND`, with `promotion ancestry` and `release-grade
verification` red.

**Cell 2 — a deliberately-broken promotion is BLOCKED. PR #1446,
`release/infra-055-blocked-promotion-proof` → `main`.** The branch is a correctly-shaped promotion
(`git merge --no-ff origin/main`, so A1 holds) carrying one deliberate content defect: the INFRA-050
depth-limited `git fetch` reintroduced into `ci.yml`, which `scan-ci-base-history` catches inside
`harness:scan` and therefore inside `pnpm harness:verify:release`.

```
$ gh pr view 1446 --json mergeStateStatus
mergeStateStatus = BLOCKED

main PR source guard          pass  3s
promotion ancestry            fail  12s
release-grade verification    fail  2m51s
build / quality / scans / security audit / commitlint    skipping
```

The failure inside `release-grade verification` is a CONTENT failure, from its own job log:

```
----- ci-base-history (FAILED) -----
ci-base-history scan failed (INFRA-050):
✗ ci-base-history
2 of 66 scans failed
```

**This is the attribution, and it is measured rather than argued.** On this PR the five formerly-
required contexts all reported `skipping`, and branch protection accepts a skipped required check —
so under the old required list every required check was satisfied and this broken promotion would
have merged. It is `BLOCKED` only because the required list now names a check that reads the
promotion's content.

One honest caveat: `release-grade verification` runs `harness:scan`, which itself contains the
`promotion-ancestry` scan, so the two required gates are not fully independent — a promotion that
fails A1/A2/A3 also fails the content gate transitively. The reviewer asked for a cell isolating
(ancestry-green, content-red); that cell is **structurally void**, because A3 requires the head's
tree to equal `develop`'s, so no content defect can exist on the head without also reddening
ancestry. What the required list buys that ancestry cannot is the converse case: a promotion that
faithfully promotes a **broken `develop`** — where A1/A2/A3 all hold and only `release-grade
verification` can object. The `promotion-ancestry` job installs nothing and executes no repository
code; it reads `merge-base`, `rev-list` and `diff` only.

**Cell 3 — the base-retarget bypass is closed. PR #1447,
`chore/infra-055-retarget-probe-2` → `develop`, then retargeted to `main`.** Head branch carries the
fixed `ci.yml`, so the `edited` trigger applies.

|                                               | #1442 (before the fix)              | #1447 (after)                           |
| --------------------------------------------- | ----------------------------------- | --------------------------------------- |
| Workflow runs for the head sha after retarget | **unchanged** (same 4 ids)          | **new CI run `30172547631` dispatched** |
| `main PR source guard`                        | `SKIPPED`                           | **`FAILURE`**                           |
| `promotion ancestry`                          | `SKIPPED`                           | **`FAILURE`**                           |
| `release-grade verification`                  | `SKIPPED`                           | **`FAILURE`**                           |
| `mergeStateStatus`                            | **`CLEAN`, `mergeable: MERGEABLE`** | **`BEHIND`**                            |

The same two-click action that put a feature branch one click from `main` now re-dispatches CI and
produces three red required checks.

### Follow-ups recorded, not done here

- **Open code-scanning alerts on `develop` are far worse than documented.**
  `code-scanning/alerts?state=open&ref=refs/heads/develop` → **171 open, of which 40 at
  `security_severity_level: high`**, 15 medium, and 1 at `rule.severity: error`. `review-gate.yml`'s
  header still claims "this repo's ~100 open alerts are all severity `note`", which is stale. #1427
  merged past a red `CodeQL` reporting 15 high-severity items. This needs its own item; it was not
  filed here because `.agents/tasks/**` beyond this file was outside the authorised paths for this
  change.
- **`hotfix/*` → `main` is a documented path that cannot pass the required gate.** `git-branch.md`
  and `main-pr-source-guard` both admit it, but INFRA-051's A3 requires the head's tree to equal
  `merge-base(origin/develop, head)`'s tree, which a hotfix by definition violates. Either the rule
  should say hotfixes route through `develop`, or A3 needs a hotfix path.
- **Require `review-gate` on `protect-main`** once the two-shape observation window above is met.
- **`git-branch.md` needs one line: a promotion PR is never updated with GitHub's "Update branch"
  button — re-run `promote.mjs`.** `strict_required_status_checks_policy: true` means a promotion PR
  goes `BEHIND` if `main` moves while it is open, and the button offers rebase, which would destroy
  A1/A2/A3. It fails closed (the ancestry gate reddens rather than the promotion landing wrong), so
  this is a usability fix, not a safety hole. Not written here because `.agents/rules/**` was outside
  the authorised paths for this change.
- **Dispatch `ruleset-drift.yml` once by `workflow_dispatch` after this merges.** Its `GITHUB_TOKEN`
  read of `repos/{owner}/{repo}/rules/branches/main` is unverified in the Actions environment (it
  works from a local `gh`), and a permanently-red non-gating cron is the alarm everyone learns to
  ignore. `workflow_dispatch` only becomes available once the file is on the default branch.
- **`harness:verify:release` now pulls `test:bin` into the sole required content gate on `main`.**
  That is a deliberate trade — the RUNTIME-001 binary e2e spawns a built binary, so it is more
  environment-sensitive than a unit test, and a flake there now reddens a promotion. Accepted because
  it is satisfiable by re-run and because the alternative was leaving the subsumption claim false. It
  runs on every develop code PR today and has been stable; if it proves flaky on the release path,
  the fix is to stabilise it, not to drop it back out of the gate.

## `bypass_actors` — recommendation to the owner (NOT applied)

Current: `bypass_actors: [{ actor_type: RepositoryRole, actor_id: 5 (admin), bypass_mode: always }]`,
and `current_user_can_bypass: "always"` for the account that performs promotions.

**Recommendation: remove the entry entirely.** Reasons, strongest first:

1. It makes every gate in this change advisory for the one account that actually performs promotions.
   The required list was just made substantive; a standing `always` bypass returns it to opt-in.
2. It also makes `non_fast_forward` bypassable. Rewriting `main` would make INFRA-051's
   `ADOPTION_BASELINE` (`a1a6bb830`) unreachable, and that gate fails hard when the baseline cannot be
   resolved — so a bypassed force-push would red-block every subsequent promotion repo-wide.
3. **Break-glass does not require a standing bypass.** An admin can always set the ruleset's
   `enforcement` to `disabled`/`evaluate`, or edit the rule, and recover from any emergency. The
   difference is that doing so is a deliberate, timestamped, auditable event, whereas a standing
   bypass is invisible at merge time — nothing records that a gate was skipped.

If a standing hatch is wanted anyway, `bypass_mode: pull_request` is strictly better than `always`:
it still permits an emergency merge but not a direct push to `main`.

**This is deliberately left for the owner to decide.** Getting it wrong locks the owner out of their
own repository during an incident, which is not a call an agent should make.

## References

- `.agents/spec-docs/done/INFRA-051-promotion-ancestry-invariant.md` § Measured facts
- `gh api repos/woojubb/robota/rulesets/18715845`
- `gh pr checks 1427`, `gh api repos/woojubb/robota/check-runs/89702695263`
- Retarget measurement: PR #1442 (closed unmerged)
- `.github/required-status-checks.json`, `scripts/harness/scan-main-required-checks.mjs`
