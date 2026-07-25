---
title: 'INFRA-055: every required check on a promotion PR was vacuous, and the real one is optional'
status: todo
created: 2026-07-26
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
      content, proven by a deliberately-broken promotion branch being blocked.
- [x] The bypass-actor decision recorded explicitly (kept, narrowed, or removed) with its reason.

---

## Outcome

Items 1–4 are closed. Item 5 is **not applied** — narrowing admin bypass is the repository owner's
call and a wrong move can lock them out during an incident. The recommendation is recorded below.

Reviewed by `proposal-reviewer` before anything was applied to the live ruleset. The first pass came
back **REVISE** with five MUST-fixes, one of which (a base-retarget bypass that defeats the entire
scheme, including INFRA-051's already-live gate) turned out to be real and live; the second pass
came back **ENDORSE**. Both are summarised under _Review_.

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

Also set `strict_required_status_checks_policy: true`, so the promotion's green run must have been
produced against the current `main` rather than a stale one.

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
run per title/body edit) is the price of that property.

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
| R3        | No `github.base_ref` condition at job or step level — the #1427 echo shape verbatim.                                  |
| R4        | At least one unconditional step, so the job cannot become an all-conditional shell.                                   |
| R5        | No `continue-on-error` on the job or any step — the one **fail-open** rot: command fails, check reports success.      |
| R6        | No `needs:` on a job that is itself main-excluded — GitHub then skips the required job, and skipped is accepted.      |

A missing or empty declaration is a hard failure, not a pass. The scan is hermetic (checked-in files
only), so it always reaches a verdict, never prints SKIP, and no GitHub API outage can redden the
release gate that runs it. An opt-in `--live` half reconciles the declaration against the live
ruleset; `.github/workflows/ruleset-drift.yml` runs it daily and on demand, deliberately outside the
merge path so drift costs a red cron rather than a blocked promotion.

15 unit tests assert the scan is RED on each shape it targets, not merely green on the current tree.
Writing them found a real parser bug — the block-list branch reader matched every `- x` in the
trigger body, so a `paths-ignore:` list parsed as branch names and a path-filtered workflow would have
looked like it covered `main`, masking the exact R2 finding the scan exists to raise.

### Proof: a deliberately-broken promotion is BLOCKED

See _Proof_ below (filled in from the live runs).

### Follow-ups recorded, not done here

- **Open code-scanning alerts on `develop` are far worse than documented.**
  `code-scanning/alerts?state=open&ref=refs/heads/develop` → **171 open, of which 40 at
  `security_severity_level: high`**, 15 medium, and 1 at `rule.severity: error`. `review-gate.yml`'s
  header still claims "this repo's ~100 open alerts are all severity `note`", which is stale. #1427
  merged past a red `CodeQL` reporting 15 high-severity items. This needs its own item; it was not
  filed here because `.agents/backlog/**` beyond this file was outside the authorised paths for this
  change.
- **`hotfix/*` → `main` is a documented path that cannot pass the required gate.** `git-branch.md`
  and `main-pr-source-guard` both admit it, but INFRA-051's A3 requires the head's tree to equal
  `merge-base(origin/develop, head)`'s tree, which a hotfix by definition violates. Either the rule
  should say hotfixes route through `develop`, or A3 needs a hotfix path.
- **Require `review-gate` on `protect-main`** once the two-shape observation window above is met.

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
