---
status: done
type: OBSERVABILITY
tags: [git-hooks, pull-request, metrics]
lane: L2
---

# OBSERVABILITY-002: measure work runs before pull-request creation

Paired with `.agents/tasks/completed/OBSERVABILITY-002-work-run-pre-pr-measurement.md`.

## Problem

The repository measures CI stages and pull-request creation-to-merge time, but it cannot explain the
larger interval before a pull request exists. A task can spend most of its elapsed time in planning,
implementation, verification, local review, pauses, or rework while leaving only commit timestamps.
That makes the reported throughput bottleneck unmeasurable and prevents evidence-based improvement.

The repository also has no durable correlation key between a work run, its commits, and the eventual
pull request. Any manually typed duration would be unverifiable, and treating an agent's claim time as
the user's request-arrival time would overstate what the repository can observe.

## Prior Art Research

- OpenTelemetry models a unit of work as a span with start/end timestamps, attributes, and timestamped
  events. Apply that shape locally: one durable event stream reconstructs the root interval, phase
  intervals, pauses, and readiness. Use repository-domain field names rather than inventing `otel.*`
  semantic conventions, and do not keep a multi-day in-memory span or introduce an observability
  backend for this repository-local workflow. Sources: https://opentelemetry.io/docs/specs/otel/trace/api/
  and https://opentelemetry.io/docs/specs/semconv/general/events/
- Git defines trailers as structured key-value metadata at the end of commit messages and provides
  `git interpret-trailers` to add and parse them. Use trailers only as stable correlation pointers;
  derive elapsed time from the receipt instead of writing a human-entered duration into every commit.
  Source: https://git-scm.com/docs/git-interpret-trailers
- GitHub pull-request records expose the server-owned `createdAt` timestamp. Draft PR creation counts
  as first-PR creation; `readyForReview` is a separate later boundary. Join `createdAt` to the receipt
  by branch/run identity and never substitute local `readyAt`. Sources:
  https://docs.github.com/en/graphql/reference/objects#pullrequest and
  https://docs.github.com/en/rest/using-the-rest-api/timezones-and-the-rest-api
- DORA change lead time starts at a code commit and ends in production. The proposed pre-PR metric has
  a different boundary, so report it as `claim-to-ready` and, only when GitHub data is available,
  `time-to-first-pr`; do not label either as DORA lead time or use it to rank individuals. Preserve
  raw receipt durations and calculate cohort percentiles rather than averaging percentiles. Sources:
  https://dora.dev/guides/dora-metrics/ and
  https://opentelemetry.io/docs/specs/otel/metrics/data-model/

## Architecture Review

### Affected Scope

- A pure repository-local work-run contract plus separate storage, Git-validation, CLI, and report
  adapters under `scripts/harness/`.
- Gitignored raw state under `.agents/evals/local-metrics/work-runs/` and one immutable tracked receipt
  per pushed run under `.agents/evals/work-runs/`, including durable exclusion receipts.
- Reachable `post-checkout` and `prepare-commit-msg` hooks, fresh-worktree bootstrap, pre-push validation,
  and an always-run branch scan so every topic branch has an early claim/exclusion path and local hooks
  and required CI consume one validator.
- Mandatory lifecycle wiring in `user-request-gate`, `backlog-execution-orchestrator`, and
  `post-implementation-checklist`, plus the concise `track-work-run` skill.
- Existing metric/eval/harness registries, one universal rule, root package scripts, and focused harness
  tests. No package, public API, or product runtime changes.

### Surface Placement

This is a repository-harness observability capability. `loop-run.mjs` is the event-ledger analog,
`verification-receipt.mjs` is the exact-Git-identity/receipt analog, and
`record-pr-lifecycle-measurement.mjs` is the downstream reporting analog. It is not a Robota product
CLI or package. A pure `work-run-contract.mjs` owns the closed event union, transition reducer, receipt
decoder, duration projections, cohort key, and validation errors. Storage, Git, GitHub, CLI, hook,
pre-push, CI, and report adapters consume narrow projections from that core and never invoke one
another as sibling products.

### Alternatives Considered

1. Infer the whole interval from commit and PR timestamps. **Pro:** no developer workflow change.
   **Con:** planning before the first commit, pauses, and phase/rework attribution remain invisible.
2. Put start/end timestamps directly in every commit message. **Pro:** all data is in Git history.
   **Con:** repeated mutable durations are noisy, manually forgeable, and cannot represent pause or
   phase events without trailer proliferation.
3. Append every event to one tracked JSONL ledger. **Pro:** one queryable source. **Con:** concurrent
   branches edit the same file and create avoidable merge conflicts.
4. Keep bounded raw events local, finalize one validated or exclusion receipt per run, and link commits
   and PR bodies with standard correlation markers. **Pro:** exact phase data, low merge-conflict risk,
   durable population accounting, and machine-checkable Git/PR identity. **Con:** it requires mandatory
   workflow wiring plus local, pre-push, CI, and reporting adapters. Recommended.

### Decision

Implement alternative 4 with the following exact contract.

1. The actual `post-checkout` hook opens an unbound run on creation/switch to a non-protected topic
   branch before its first commit. `user-request-gate` opens earlier, before its first recommendation
   round, when that workflow applies; post-checkout reuses the existing run. Documentation, settings,
   Git-only, and other non-package topic work therefore enter the same early claim path instead of being
   omitted by the implementation-request gate. `work.started` remains separate, and binding a Task or
   classified work kind is required before readiness. The run ID is cryptographically random. A receipt
   must prove `claimedAt` is no later than the first topic commit; a late-opened run is invalid.
2. The closed v1 event union is `work.claimed`, `work.bound`, `work.started`, `phase.started`,
   `phase.completed`, `work.paused`, `work.resumed`, `work.ready`, `work.reopened`, `work.abandoned`, and
   `work.excluded`. One active phase and one open pause are allowed. Unsupported schema versions and
   unknown event types fail validation. One canonical cohort key uses lane and work kind only.
3. Every transition is serialized by a bounded per-run lock rooted in the Git common directory. Events
   carry monotonic sequence and previous-event hash. State writes use temporary-file+rename. `ready` is
   an idempotent, retryable reconciliation: under the lock it appends/recognises the event, writes a
   deterministic receipt path atomically, and leaves ready correlation readable for the closure commit.
4. `ready` requires a clean tree and binds repository identity, branch, base commit, ready-head commit
   and tree, correlated commit OIDs/trailer digest, run ID, receipt generation, schema version, and owner
   fingerprint. Exactly one child closure commit may add only that receipt. Any amend, rebase, extra
   commit, or changed receipt invalidates readiness. Before first PR, `work.reopened` creates a
   superseding receipt **revision** over the same root interval; the final valid revision owns
   claim/start-to-first-PR metrics. After first PR, post-PR rework **generation** numbering begins at 1;
   every generation may itself have receipt revisions, prior receipts stay immutable, and the newest
   generation binds the pushed head without altering first-PR time.
5. Commit correlation uses only `Work-Run` and deterministic generation-specific `Work-Receipt`
   trailers. Exact existing
   pairs no-op; partial or conflicting pairs abort. `message`/`template` sources append for an active or
   ready run; `commit` (amend), `merge`, and `squash` preserve only an exact pair and otherwise abort.
   Fresh worktrees receive a tracked dispatcher/fallback and restoration coverage.
6. Work-run validation consumes the existing pre-resolved push/base/changed-path projection and an
   extracted shared planning-checkpoint predicate; it never re-derives branch or planning ownership.
   Pure planning ranges may carry an explicit exclusion receipt. A schema-valid `state-lost` receipt
   bound to exact surviving Git identity permits the push but is counted as `invalid`, never `excluded`.
   Mixed, malformed, identity-mismatched, empty-unknown, or classifier-failure states fail closed.
   Pre-push runs the validator after no-content/delete
   classification but before verification-receipt reuse; an always-run registered scan applies the same
   verdict to the actual PR base-to-head range in required CI.
7. A tracked `.agents/evals/work-runs/cutover-v1.json` is the versioned adoption marker; its adding
   commit is searched only in the resolved integration base ancestry; for the introduction PR, only in
   `base..head`. Missing or multiple marker additions fail distinctly, avoiding feature+squash ambiguity.
   Before the marker commit, `work-run cutover-plan --github` records the complete server-observed open-PR
   migration registry in the marker: repository, PR number, server `createdAt`, base OID, and original head
   OID. The introduction PR is the single special case whose base lacks and topic adds the marker.
   A registered old PR invokes the updated checkout's `work-run cutover-seal --target-worktree <path>
--pr <n>` before rebase; the command validates the still-reachable original objects against the marker
   entry and writes a durable `pre-cutover` receipt bound to that immutable registry record. After rebase
   or original-object expiry, CI validates the receipt against the marker entry and PR identity, not the
   lost objects or current fork point. Unregistered local-only old branches must be recreated from the
   cutover-containing base and cannot self-declare exclusion. A genuinely post-cutover branch may not
   claim it. Fixtures cover introduction, registered old PR before/after rebase and object expiry,
   unregistered old branch, and true post-cutover branch.
8. After the g0 closure is first pushed and before the PR exists, `harness:work-run:attest` creates an
   idempotent GitHub commit comment binding its run ID and closure OID to an unedited server timestamp.
   Exactly one valid, immutable opening comment may exist; duplicate matching comments fail closed.
   Attestation fails if any open, closed, or merged PR has already existed for the branch. PR validation
   fails closed unless the comment timestamp is strictly earlier than PR `createdAt`; the command itself
   confirms a later GitHub server timestamp tick before returning, so the PR may then be created. This
   prevents a PR opened at A from gaining a forged g0 at B. The PR body carries `Work-Run: <id>`. Reporting joins only
   a unique repository + PR number/body marker + PR head OID whose commit range contains the same run
   trailer. Zero/multiple/mismatched/query-failed results are distinct unavailable reasons; branch name
   is a lookup hint, never identity. GitHub `createdAt` remains the only first-PR timestamp.
9. Post-PR generation creation consumes one shared projection extracted from the existing
   `POST_FINDINGS_ACTION_REQUEST` owner. It requires the approved request identity and binds PR number,
   reviewed remote head, verdict/check/base evidence, action, named ground, evidence, scope, and approver;
   the existing pre-push guard and work-run validator consume the same projection, never parallel rules.
   A rebase generation binds every GraphQL `beforeCommit`/`afterCommit` edge to one retained proof;
   the suffix after the proven rebased head is limited to one tree-identical correlated bind commit
   plus its exact receipt-only closure, so a rebase approval cannot authorize additional file changes.
10. Reports state the observable denominator as validated receipts, with included, superseded, excluded,
    invalid, and unavailable counts/reasons. They compute wall, active, paused, phase, p50, and p90 values
    without averaging percentiles or ranking individuals. The final pre-PR receipt revision owns
    claim/start-to-first-PR; authorized post-PR generations own rework by ground and never move the
    original GitHub `createdAt` boundary.
    Local streams are limited to 10,000 events and 1 MiB. Nonterminal state is retained until explicit
    terminalization; only terminal raw state may compact after 30 days. `work.abandoned` writes a local
    terminal receipt included by local reports. If clone/worktree state is lost, `work-run recover
   --state-lost` writes a tracked invalid receipt bound to the surviving Git identity with timestamps
    explicitly unavailable; local and CI validators permit that exact receipt while reports count it as
    `invalid`, not `excluded`, avoiding deadlock without inventing a late claim. Server reports
    state that never-pushed/deleted local branches are outside their observable denominator. Receipt reads
    are bounded/streamed, and one batched
    GitHub query has a 15-second timeout. Oversize, timeout, and rate-limit outcomes are explicit.

### Architecture Review Checklist

- [x] Affected state, hook, report, skill/rule, and test paths are listed.
- [x] Sibling scan completed: `loop-run`, `verification-receipt`, PR-lifecycle, plan-order, changed-path,
      pre-push, Husky bootstrap, metric/eval registries, and mandatory workflow entrypoints were inspected;
      their existing facts remain owned there and are consumed through narrow projections.
- [x] Four alternatives include explicit pros and cons and one recommendation.
- [x] The design introduces no package, public API, or product-runtime surface.

## Fallback & Degradation Declaration

If lifecycle state, Git classification, receipt identity, or GitHub correlation cannot be read, fail
visibly or report the exact unavailable/excluded reason according to the boundary; never synthesize a
timestamp or choose one candidate. V1 has no silent emergency override. Every non-protected topic branch
is measured from post-checkout/user-request claim, carries a durable `work.excluded` receipt accepted by
the shared classifier, or carries the exact identity-bound `state-lost` invalid recovery receipt.
Protected-branch, no-content, and tree-equivalent
operations are outside the topic-range population; malformed or unreadable classification blocks.
Lost local state never becomes a synthetic measurement: nonterminal state has no age-based deletion, and
the only recovery is a durable `state-lost` invalid receipt with unavailable timestamps and exact surviving
Git identity. That receipt permits push while remaining in the invalid denominator. Abandonment is an
explicit terminal event visible to local reports.

## Solution

1. Add the pure contract and separately test/store/CLI/Git/report adapters with injected clock, Git,
   filesystem, lock, and GitHub boundaries.
2. Wire claim and phase events into mandatory orchestration entrypoints, add post-checkout coverage for
   all other topic work, then add idempotent trailer correlation and fresh-worktree hook bootstrap.
3. Reuse the existing push/base/change/checkpoint owners in pre-push and an always-run CI scan.
4. Add cutover handling and extract the post-findings authorization projection shared by the existing
   guard and post-PR generation validator.
5. Add exact receipt/PR identity, bounded reporting, the `track-work-run` skill, rule/registry wiring,
   command-level smoke coverage, and RED→GREEN enforcement proof.

## Affected Files

| File                                                                                                                                                                 | Change                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `scripts/harness/work-run-contract.mjs`                                                                                                                              | Pure event union, reducer, receipt decoder, projections                            |
| `scripts/harness/work-run-store.mjs`, `scripts/harness/work-run.mjs`                                                                                                 | Locked persistence and CLI shell                                                   |
| `scripts/harness/work-run-validation.mjs`, `scripts/harness/scan-work-run-measurement.mjs`                                                                           | Shared Git verdict and CI scan                                                     |
| `scripts/harness/work-run-attest-opening-head.mjs`, `scripts/harness/work-run-pr-evidence.mjs`                                                                       | Pre-PR server-timestamp seal and bounded PR-history proof                          |
| `.agents/evals/work-runs/cutover-v1.json`                                                                                                                            | Adoption boundary and immutable open-PR migration registry                         |
| `scripts/harness/work-run-report.mjs`                                                                                                                                | Bounded receipt aggregation, p50/p90, exact GitHub join                            |
| `scripts/harness/scan-user-execution-plan-order.mjs`                                                                                                                 | Export the canonical planning-range predicate                                      |
| `scripts/harness/pre-push.mjs`, `scripts/harness/run-all-scans.mjs`                                                                                                  | Reachable local/CI enforcement                                                     |
| `scripts/harness/post-findings-authorization.mjs`, `.claude/hooks/pre-push-check.sh`                                                                                 | Shared approved-action projection                                                  |
| `scripts/harness/restore-tracked-husky-hooks.mjs`, `.husky/post-checkout`, `.husky/prepare-commit-msg`, `.husky/_/*`                                                 | Early claim, trailers, and fresh-worktree bootstrap                                |
| `scripts/harness/__tests__/work-run*.test.mjs`, `scripts/harness/__tests__/pre-push-sequence.test.mjs`, `scripts/harness/__tests__/pre-push-open-pr-freeze.test.mjs` | Core, cutover, authorization parity, CLI, Git, concurrency, report, sequence tests |
| `.agents/skills/user-request-gate/SKILL.md`, `.agents/skills/backlog-execution-orchestrator/SKILL.md`                                                                | Mandatory claim/phase entry                                                        |
| `.agents/skills/post-implementation-checklist/SKILL.md`, `.agents/skills/track-work-run/SKILL.md`                                                                    | Ready/PR marker workflow                                                           |
| `.agents/evals/metrics.md`, `.agents/evals/README.md`, `.agents/evals/work-runs/README.md`                                                                           | Metric and schema SSOT                                                             |
| `.agents/rules/work-run-measurement.md`, `.agents/rules/index.md`, `.agents/skills/index.md`                                                                         | Universal invariant and routing                                                    |
| `scripts/harness/README.md`, `package.json`                                                                                                                          | Command registry and stable aliases                                                |

## Completion Criteria

- [x] TC-01: Post-checkout opens a collision-resistant unbound run for every non-protected topic branch,
      the mandatory request gate reuses/opens it earlier when applicable, and binding/exclusion covers
      documentation/settings/Git-only work before the first topic commit;
      the closed v1 reducer accepts legal claim/start/phase/pause/ready/reopen/exclude transitions and
      rejects late claims, unknown versions/events, concurrent lost updates, and invalid transitions.
- [x] TC-02: Locked, failure-injected `ready` reconciliation emits a revisioned receipt bound to exact
      repository/base/head/tree/commit/trailer identity, accepts only its receipt closure commit, and
      rejects ungrounded amend/rebase/additional-commit or corrupt/partial persistence states; finding,
      red-check, and rebase grounds create immutable linked post-PR generations through the shared
      maintainer-approved action projection, while pre-PR retries increment receipt revision only.
- [x] TC-03: Real temporary Git repositories prove tracked fresh-worktree `prepare-commit-msg` reachability,
      exact/idempotent trailers, conflict refusal, and the source-mode matrix for message/template/amend/
      merge/squash with visible exit status and stderr.
- [x] TC-04: Pre-push and the registered always-run scan consume the shared base/change/checkpoint
      projection, reject missing/stale/mixed/unreadable measurement, accept matching/exclusion receipts,
      permit exact identity-bound `state-lost` receipts while counting them invalid, cover implementation
      and non-implementation ranges, validate authorized post-PR generation grounds, apply the unique
      base-ancestry marker registry to introduction, registered old PR before/after rebase and object expiry,
      unregistered old branch, and post-cutover fixtures, and execute before
      reusable-verification returns in local and required-CI paths.
- [x] TC-05: Reporting states bounded included/superseded/excluded/invalid/unavailable populations and
      exact p50/p90 wall/active/paused/phase values; first-PR time appears only for a unique repository,
      pre-PR server-timestamped g0 seal, PR-body run marker, head-OID, and commit-trailer match using
      GitHub `createdAt`, while finding/
      red-check/rebase generations report separate post-PR rework, pre-PR revisions remain one root
      interval, and neither moves that boundary; nonterminal state survives age-based cleanup, abandonment
      is locally reportable, and state-loss recovery emits a tracked invalid receipt with unavailable
      timestamps and surviving Git identity rather than a fabricated claim.
- [x] TC-06: Metric/eval/harness registries, the universal rule, mandatory workflow skills, commands, and
      `track-work-run` skill expose one lifecycle/schema/denominator vocabulary with no duplicate owner.
- [x] TC-07: A command-level temporary-repository smoke drives claim→bind→start→phase→pause/resume→ready→
      closure commit→first PR→finding/red-check/rebase generation→validate→report, including a docs-only
      branch plus cutover-plan/seal and state-lost-permitted-invalid fixtures, while the pre-fix/missing-
      measurement fixture is RED and the final
      focused tests, skill validation, `pnpm harness:scan`, and CI-equivalent verification are GREEN.
- [x] TC-08: The repository-contract harness executes each test file once with bounded two-worker
      concurrency, and the measured slow hook/guard/cleanup fixtures reuse isolated seeds, batched shell
      probes, or in-process traversal without weakening fail-closed behavior or sharing mutable temp state.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                                                                   | Notes                                                  |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| TC-01 | Unit/concurrency       | `work-run-contract.test.mjs`, `work-run-store.test.mjs`, `work-run-hook.test.mjs`                                 | Applicability, reducer, hash/sequence, lock behavior   |
| TC-02 | Unit/integration       | `work-run-validation.test.mjs`, `verification-receipt.test.mjs`                                                   | Atomic retry/reconcile, identity, authorization parity |
| TC-03 | Integration            | `work-run-hook.test.mjs`, `hook-reading-matches-bash.test.mjs`                                                    | Hook reachability and refusal matrix                   |
| TC-04 | Regression             | `scan-work-run-measurement.test.mjs`, `pre-push-base-ref.test.mjs`, `pre-push-sequence.test.mjs`                  | Exact pushed subject; all early-return paths           |
| TC-05 | Unit/contract          | `work-run-report.test.mjs`, `work-run-pr-evidence.test.mjs`, `work-run-attest-opening-head.test.mjs`              | First-PR seal, percentile, rework, bounded failure     |
| TC-06 | Static                 | `scripts/harness/__tests__/scan-skill-registration.test.mjs`, `harness:scan:commands`, `harness:scan:consistency` | One owner and complete routing                         |
| TC-07 | E2E/suite              | `work-run-lifecycle.test.mjs`, `harness:scan`, `harness:verify-like-ci`                                           | Real entrypoints and full repository evidence          |
| TC-08 | Performance/regression | `harness-test-tiers.test.mjs`, `scan-user-execution-plan-order.test.mjs`, hook/guard/cleanup fixtures             | No duplicate tier; bounded two-worker semantics        |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: this changes internal repository workflow instrumentation and Git enforcement, not a Robota
CLI/TUI/browser/SDK product surface. The executable evidence is the harness CLI and Git-hook fixture,
which belong to the engineering test plan.

## Tasks

- [x] TC-01 — `.agents/tasks/completed/OBSERVABILITY-002-work-run-pre-pr-measurement.md`: implement universal topic claim and state transitions.
- [x] TC-02 — `.agents/tasks/completed/OBSERVABILITY-002-work-run-pre-pr-measurement.md`: finalize receipts and durations.
- [x] TC-03 — `.agents/tasks/completed/OBSERVABILITY-002-work-run-pre-pr-measurement.md`: correlate commits.
- [x] TC-04 — `.agents/tasks/completed/OBSERVABILITY-002-work-run-pre-pr-measurement.md`: enforce before push.
- [x] TC-05 — `.agents/tasks/completed/OBSERVABILITY-002-work-run-pre-pr-measurement.md`: aggregate first-PR and post-PR generation reports.
- [x] TC-06 — `.agents/tasks/completed/OBSERVABILITY-002-work-run-pre-pr-measurement.md`: wire rule, skill, and docs.
- [x] TC-07 — `.agents/tasks/completed/OBSERVABILITY-002-work-run-pre-pr-measurement.md`: prove and verify the system.
- [x] TC-08 — `.agents/tasks/completed/OBSERVABILITY-002-work-run-pre-pr-measurement.md`: remove measured harness bottlenecks without reducing coverage.

## Evidence Log

### [ARCHITECTURE-AUDIT-FANOUT] — COVERED | 2026-08-30

- Run `r20260830100729` converged in one round with every manifest cell covered.
- Structure placement evidence retained exactly:
  `AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=3 medium=2 low=0 coverage=7/7 uncovered=none`.
- Design: `coverage=6/6`; runtime: `coverage=5/5`; gate: `coverage=5/5`; no uncovered cells.
- The proposal was revised to absorb every structure, design, runtime, and gate finding before approval.

### [PROPOSAL-REVIEW] — REVISE | 2026-08-30

- `proposal-reviewer` found six in-scope gaps: mandatory start reachability, exact receipt identity,
  identity-safe PR join, local/CI enforcement reachability, fresh-worktree hook bootstrap, and metric/
  denominator SSOT.
- Placement verdict: repository-harness observability is the correct product family; split pure contract
  from adapters and reuse existing classification/receipt owners.
- `REVIEW VERDICT: REVISE`; all six findings were incorporated into the revised Decision, affected files,
  completion criteria, and test plan. A fresh independent review is required before approval.

### [GATE-WRITE] — ❌ FAIL | 2026-08-30

**Status remains:** draft
**Failed criteria:**

- **New-surface placement (conditional):** The draft introduces a new repository CLI/report interface
  plus a skill/rule workflow surface. The sibling scan names nearby mechanisms, but neither it nor the
  Decision identifies the closest analogous existing layer that this surface mirrors together with its
  product-family/taxonomy classification, and they do not explicitly show shared contract/core reuse
  rather than dependency on a sibling PRODUCT.
  **Required action:** Update the Architecture Review sibling scan and Decision to name the analogous
  layer and classification and to state the shared-core/contract reuse boundary before re-running this
  gate.

### [GATE-WRITE] — ✅ PASS | 2026-08-30

**Status upgrade:** draft → review-ready

- GATE-WRITE — Frontmatter block: begins with `---` and closes before the document title.
- GATE-WRITE — Frontmatter status: `status: draft` is present.
- GATE-WRITE — Frontmatter type: `type: OBSERVABILITY` is one of the 11 allowed values.
- GATE-WRITE — Frontmatter tags: `tags:` is present with three values.
- GATE-WRITE — Concrete symptom: repository throughput cannot account for the pre-PR interval or correlate a work run, commits, and its eventual pull request.
- GATE-WRITE — Reproduction condition: the gap occurs when repository work spans planning through readiness before a pull request exists.
- GATE-WRITE — Problem specificity: the five-sentence Problem section contains neither `TBD` nor `TODO` and names the unobservable behavior precisely.
- GATE-WRITE — Prior Art Research section: `## Prior Art Research` is present.
- GATE-WRITE — Research substantiation: the section cites OpenTelemetry specifications, Git documentation, GitHub API documentation, and DORA guidance.
- GATE-WRITE — Research waiver alternative: substantiated research is present, so no waiver is required.
- GATE-WRITE — Research-to-decision trace: span/events inform the event stream, Git trailers inform correlation pointers, GitHub `createdAt` defines first-PR time, and DORA guidance informs metric naming and aggregation.
- GATE-WRITE — Architecture checklist completion: all four checklist items are checked.
- GATE-WRITE — Sibling scan evidence: the checked item names `loop-run` and PR-lifecycle harness workers and explains the thin-adapter boundary.
- GATE-WRITE — Alternatives: four numbered alternatives each state an explicit pro and con.
- GATE-WRITE — Decision trade-off: selecting alternative 4 preserves exact phase evidence and machine-checkable correlation while accepting local-only abandoned runs and a GitHub join for actual PR creation.
- GATE-WRITE — New-surface placement: the draft classifies the capability as repository-harness observability, mirrors the `loop-run` and `record-pr-lifecycle-measurement` layer/product family, and centralizes reuse in the shared work-run contract rather than a sibling product.
- GATE-WRITE — Completion Criteria prefixes: all seven items use unique `TC-01` through `TC-07` prefixes.
- GATE-WRITE — Feature coverage: TC-01 through TC-07 respectively cover lifecycle transitions, receipts/durations, commit correlation, pre-push enforcement, reporting/GitHub joins, rule-skill-command-documentation wiring, and regression/full-suite proof.
- GATE-WRITE — Criterion observability: every TC states a command/result or externally checkable artifact, calculation, refusal, acceptance, consistency, or test outcome.
- GATE-WRITE — Banned criterion language: none uses “works correctly”, “no errors”, “implemented”, or “displays correctly”.
- GATE-WRITE — Test Plan section: `## Test Plan` is present.
- GATE-WRITE — Test Plan cardinality: seven rows match the seven Completion Criteria items.
- GATE-WRITE — Test Plan content: every row has a non-empty Test Type and Tool / Approach and none contains `TBD`.
- GATE-WRITE — Manual-test justification: no row uses a manual tool, so a manual-only Notes explanation is not applicable.
- GATE-WRITE — Tasks section: `## Tasks` is present and records one unchecked task placeholder for each TC against the paired Task document.
- GATE-WRITE — Evidence Log: `## Evidence Log` is present; its only prior entry is the earlier GATE-WRITE failure and no later-gate evidence exists.
- GATE-WRITE — Body structure: no `## Status` or `## Classification` body section is present.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "그래 그러면 측정 시스템을 구현해서 머지까지 하자"
**Given:** 2026-08-30, this conversation
**Review fingerprint:** 8558b9792562 (review 49b6442a, type/tags 033f072c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8558b9792562) equals the document's current fingerprint

### [GATE-APPROVAL] — 🔴 NON-COMPLIANCE | 2026-08-30

**Status remains:** review-ready
**Violation:** The spec introduces a new repository CLI/report and workflow surface, but its Evidence Log contains no independent `proposal-reviewer` verdict that endorsed the recommendation and explicitly covered placement, and no retained `architecture-audit-fanout` structure-channel result. The catalogue classifies approval of a new-surface spec without that recorded independent placement review as a process violation.
**Required action:** Obtain the independent `proposal-reviewer` placement verdict and `architecture-audit-fanout` structure-channel result, record both in this Evidence Log, then re-run GATE-APPROVAL.

### [PROPOSAL-REVIEW] — REVISE | 2026-08-30 (round 2)

- Placement is explicitly `ENDORSED`: closest analogs are `loop-run.mjs`,
  `verification-receipt.mjs`, and `record-pr-lifecycle-measurement.mjs`; product family is
  repository-harness observability; pure contract and adapters are correctly separated.
- The six prior findings are materially addressed. Two residual in-scope lifecycle findings remain:
  applicability outside `user-request-gate`, and authorized post-PR finding/red-check/rebase updates.
- `ACTIONABLE FINDINGS: 2`; `REVIEW VERDICT: REVISE`.
- The Decision and tests now add universal topic-branch post-checkout claim/exclusion coverage and
  immutable post-PR generation rollover with separate rework reporting. A fresh review remains required.

### [PROPOSAL-REVIEW] — REVISE | 2026-08-30 (round 3)

- Six of eight prior findings are closed and placement remains explicitly endorsed.
- `ACTIONABLE FINDINGS: 3`: define introduction/pre-existing branch cutover, reuse the exact
  post-findings authorization owner, and separate pre-PR receipt revisions from post-PR generations.
- `REVIEW VERDICT: REVISE`.
- The Decision, affected files, criteria, and tests now include `cutover-v1`, shared approved-action
  projection/parity, receipt revisions, and authorization-bound post-PR generations. Re-review required.

### [PROPOSAL-REVIEW] — REVISE | 2026-08-30 (round 4)

- Placement, shared authorization, and revision/generation separation are endorsed.
- Two in-scope findings remain: pre-cutover eligibility must survive rebase, and local-state loss must
  have an honest non-deadlocking recovery. `REVIEW VERDICT: REVISE`.
- The Decision now seals original base/head plus unique marker identity in exclusion receipts, retains
  nonterminal state, records local abandonment, and emits tracked `state-lost` invalid receipts without
  fabricated timestamps. The fallback heading was corrected to its required contract name.

### [PROPOSAL-REVIEW] — REVISE | 2026-08-30 (round 5)

- All prior architecture and lifecycle findings except two migration details are closed; placement is
  endorsed. `REVIEW VERDICT: REVISE`.
- Cutover now uses a base-ancestry marker with an immutable GitHub open-PR registry and executable
  pre-rebase sealing path, so validation survives object expiry without mutable fork-point inference.
- `state-lost` now has one explicit disposition: it permits push only when schema-valid and identity-bound,
  and remains counted as `invalid`, never `excluded`; criteria and smoke coverage carry the same rule.

### [PROPOSAL-REVIEW] — ENDORSE | 2026-08-30 (round 6)

- Independent `proposal-reviewer` verified every prior finding closed and found no actionable proposal
  defects. `REVIEW VERDICT: ENDORSE`.
- Placement explicitly endorsed: repository-harness observability; `loop-run`, verification-receipt, and
  PR-lifecycle analogs; pure contract consumed by storage/Git/GitHub/hook/CI/report adapters.
- Cutover discovery domain, complete open-PR registry/seal path, object-expiry behavior, state-lost
  disposition, exact Git/PR identity, shared post-findings authorization, and denominator ownership were
  all checked against their actual repository owners.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "그래 그러면 측정 시스템을 구현해서 머지까지 하자"
**Given:** 2026-08-30, this conversation
**Review fingerprint:** 3a9573547134 (review d9efae23, type/tags 033f072c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-30, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3a9573547134) equals the document's current fingerprint

### [GATE-APPROVAL] — ✅ PASS | 2026-08-30

**Guardian:** `backlog-gate-guard`
**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "그래 그러면 측정 시스템을 구현해서 머지까지 하자"
**Given:** 2026-08-30, this conversation
**Review fingerprint:** 3a9573547134 (review d9efae23, type/tags 033f072c)

- GATE-APPROVAL — ordering: PASS; prior `[GATE-WRITE] — ✅ PASS | 2026-08-30` exists, frontmatter is `status: review-ready`, and the document is in `.agents/spec-docs/backlog/`.
- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS; the DIRECT-route instruction is recorded verbatim with date and conversation identity.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS; “측정 시스템을 구현해서 머지까지 하자” authorizes implementation and merge of this measurement-system proposal, rather than relaying or approving another item.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A; route DIRECT names no delegated class.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A for Route CLASS; the DIRECT evidence nevertheless records the exact instruction, `2026-08-30`, and `this conversation`.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A; route DIRECT does not rely on class evidence.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A; route DIRECT does not claim delegated-class membership.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS; the gate dry-run recomputed fingerprint `3a9573547134`, equal to the latest recorded approval fingerprint.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS; this new repository CLI/report/workflow surface has independent `[PROPOSAL-REVIEW] — ENDORSE | 2026-08-30 (round 6)` evidence explicitly endorsing repository-harness observability placement and contract/adapter separation, plus retained structure-channel result `AUDIT-DIM-COMPLETE: dim=structure shard=1/1 blocker=0 high=3 medium=2 low=0 coverage=7/7 uncovered=none` from architecture fanout run `r20260830100729`.
- GATE-APPROVAL — pre-approval implementation prohibition: PASS; `origin/develop..HEAD` contains no commits and the worktree changes before this verdict are limited to the spec, paired Task, and gate/audit loop ledgers, with no affected implementation path edited.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-30; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (7)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 372 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md",
  "specPath": ".agents/spec-docs/todo/OBSERVABILITY-002-work-run-pre-pr-measurement.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/architecture-audit-fanout.jsonl",
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/OBSERVABILITY-002-work-run-pre-pr-measurement.md",
    ".agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [SCOPE-AMENDMENT] — TC-08 | 2026-08-31

- GATE-IMPLEMENT approved TC-01 through TC-07 before implementation began. During the measured run,
  the first full contract execution exposed a global serial-execution regression, a duplicate hermetic
  tier, and repeated process-heavy fixtures. TC-08 records the user-authorized request to remove that
  observed bottleneck without reducing coverage; it does not add a product or public-API surface.
- Independent before/after focused samples measured 136 tests in 96.72 seconds and 140 tests in 46.02
  seconds, a 52.4% wall-time reduction despite four additional tests. Tier inventory measurement also
  removed 73 duplicate hermetic test-file executions. The final repository-contract and CI-equivalent
  results will be recorded separately before TC-08 is closed.
- The first CI-equivalent run after oracle isolation passed 12 of 13 stages but spent 157.2 seconds in
  `affected-verify` before failing Linux-only project-mutation tests on macOS. Its plan had expanded a
  root manifest change containing only `harness:*` command registration to all 92 product scopes. The
  existing semantic root-manifest classifier now treats harness-only script changes as
  `developer-quality-only`, while mixed product `build`/`test`, dependency, and unknown changes remain
  workspace-wide. The same stage now selects 0/92 product scopes and passes in 1.0 second.

### [GATE-VERIFY] — ✅ PASS | 2026-08-31

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 8/8 tasks `[x]` in .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `volta run --node 22.14.0 --pnpm 8.15.4 pnpm harness:scan > /tmp/obs002-final-scan.log 2>&1` → exit 0; all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `volta run --node 22.14.0 --pnpm 8.15.4 pnpm harness:test > /tmp/obs002-final-harness-test.log 2>&1` → exit 0; all 2 supplied commands exit 0

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-31

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 10 of 4229 line(s))

```
· regression-red-proof (enforcing: accidental-green only) — NOT mirrored locally: the checker RUNS locally and is useful there, but it cannot reproduce this context's VERDICT. The opt-out is read from `PR_BODY` joined with the commit subjects, and off a pull request `PR_BODY` is empty — so an `allow-green-at-base: <reason>` declared in the body ALONE is invisible locally and the run reports `accidental-green` for a case CI legitimately excuses. A mirror that can disagree with the gate on the gate's own escape hatch is worse than no mirror: it would report a blocking verdict the required check does not hold.
! dependency audit — NOT mirrored locally: downloads the osv-scanner binary from GitHub and scans the lockfile against the OSV.dev database — it needs network access and an external toolchain, so a local run could not be made deterministic or offline.
    this diff makes it relevant (the diff touches `pnpm-lock.yaml` or any `package.json`). Run it yourself: osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml   (see ci.yml → dependency-audit for the pinned version)
· windows-shell — NOT mirrored locally: runs on `windows-latest` and exists precisely to exercise the win32 process-spawn path that no Linux or macOS host can execute. Mocked-platform unit tests are what it was added to stop being sufficient.
· workflow provenance — NOT mirrored locally: runs on `pull_request_target` and judges the pull request's CHANGED-FILE LIST against the workflows that provide a required context, reading both from the base. Off a real pull request there is no file list and no base to compare it to, so a local run would either invent one or report a pass over a control plane it never inspected — which is the vacuity INFRA-097 built this gate to close.
! review-gate — NOT mirrored locally: reads GitHub's code-scanning API for this PR's merge ref and compares it against the base branch. Both sides only exist once CodeQL has analysed a real pull request, so there is nothing a local run could read — a mirror would either invent the input or report a pass over an analysis that was never performed, which is the exact defect INFRA-048 built this gate to close.
    this diff makes it relevant (every pull request — the code-scanning half resolves to `PASS (not-applicable)` on a docs-only diff, but the PR-body half (RULE-016: first heading `## Background`, no agent-session link) judges every PR, so the check is never irrelevant). Run it yourself: the body half: gh pr view <n> --json body -q .body | node scripts/harness/check-pr-body.mjs. The code-scanning half has no local equivalent — push and read the check, or query it directly: gh api "repos/<owner>/<repo>/code-scanning/alerts?pr=<n>&state=open" --paginate  (note --paginate: a single page silently truncates, which is how a 40-high backlog once read as clean)
PASS — all 13 stage(s) passed; mirrors the required checks of `develop`.
verification receipt not written: working tree is not clean:  M .agents/loop-runs/post-implementation-checklist.jsonl,  M .agents/spec-docs/active/OBSERVABILITY-002-work-run-pre-pr-measurement.md,  M .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md
  (without a receipt the next `git push` re-runs this entire gate)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-31

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 10 of 4229 line(s))

```
· regression-red-proof (enforcing: accidental-green only) — NOT mirrored locally: the checker RUNS locally and is useful there, but it cannot reproduce this context's VERDICT. The opt-out is read from `PR_BODY` joined with the commit subjects, and off a pull request `PR_BODY` is empty — so an `allow-green-at-base: <reason>` declared in the body ALONE is invisible locally and the run reports `accidental-green` for a case CI legitimately excuses. A mirror that can disagree with the gate on the gate's own escape hatch is worse than no mirror: it would report a blocking verdict the required check does not hold.
! dependency audit — NOT mirrored locally: downloads the osv-scanner binary from GitHub and scans the lockfile against the OSV.dev database — it needs network access and an external toolchain, so a local run could not be made deterministic or offline.
    this diff makes it relevant (the diff touches `pnpm-lock.yaml` or any `package.json`). Run it yourself: osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml   (see ci.yml → dependency-audit for the pinned version)
· windows-shell — NOT mirrored locally: runs on `windows-latest` and exists precisely to exercise the win32 process-spawn path that no Linux or macOS host can execute. Mocked-platform unit tests are what it was added to stop being sufficient.
· workflow provenance — NOT mirrored locally: runs on `pull_request_target` and judges the pull request's CHANGED-FILE LIST against the workflows that provide a required context, reading both from the base. Off a real pull request there is no file list and no base to compare it to, so a local run would either invent one or report a pass over a control plane it never inspected — which is the vacuity INFRA-097 built this gate to close.
! review-gate — NOT mirrored locally: reads GitHub's code-scanning API for this PR's merge ref and compares it against the base branch. Both sides only exist once CodeQL has analysed a real pull request, so there is nothing a local run could read — a mirror would either invent the input or report a pass over an analysis that was never performed, which is the exact defect INFRA-048 built this gate to close.
    this diff makes it relevant (every pull request — the code-scanning half resolves to `PASS (not-applicable)` on a docs-only diff, but the PR-body half (RULE-016: first heading `## Background`, no agent-session link) judges every PR, so the check is never irrelevant). Run it yourself: the body half: gh pr view <n> --json body -q .body | node scripts/harness/check-pr-body.mjs. The code-scanning half has no local equivalent — push and read the check, or query it directly: gh api "repos/<owner>/<repo>/code-scanning/alerts?pr=<n>&state=open" --paginate  (note --paginate: a single page silently truncates, which is how a 40-high backlog once read as clean)
PASS — all 13 stage(s) passed; mirrors the required checks of `develop`.
verification receipt not written: working tree is not clean:  M .agents/loop-runs/post-implementation-checklist.jsonl,  M .agents/spec-docs/active/OBSERVABILITY-002-work-run-pre-pr-measurement.md,  M .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md
  (without a receipt the next `git push` re-runs this entire gate)
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-31

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 10 of 4229 line(s))

```
· regression-red-proof (enforcing: accidental-green only) — NOT mirrored locally: the checker RUNS locally and is useful there, but it cannot reproduce this context's VERDICT. The opt-out is read from `PR_BODY` joined with the commit subjects, and off a pull request `PR_BODY` is empty — so an `allow-green-at-base: <reason>` declared in the body ALONE is invisible locally and the run reports `accidental-green` for a case CI legitimately excuses. A mirror that can disagree with the gate on the gate's own escape hatch is worse than no mirror: it would report a blocking verdict the required check does not hold.
! dependency audit — NOT mirrored locally: downloads the osv-scanner binary from GitHub and scans the lockfile against the OSV.dev database — it needs network access and an external toolchain, so a local run could not be made deterministic or offline.
    this diff makes it relevant (the diff touches `pnpm-lock.yaml` or any `package.json`). Run it yourself: osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml   (see ci.yml → dependency-audit for the pinned version)
· windows-shell — NOT mirrored locally: runs on `windows-latest` and exists precisely to exercise the win32 process-spawn path that no Linux or macOS host can execute. Mocked-platform unit tests are what it was added to stop being sufficient.
· workflow provenance — NOT mirrored locally: runs on `pull_request_target` and judges the pull request's CHANGED-FILE LIST against the workflows that provide a required context, reading both from the base. Off a real pull request there is no file list and no base to compare it to, so a local run would either invent one or report a pass over a control plane it never inspected — which is the vacuity INFRA-097 built this gate to close.
! review-gate — NOT mirrored locally: reads GitHub's code-scanning API for this PR's merge ref and compares it against the base branch. Both sides only exist once CodeQL has analysed a real pull request, so there is nothing a local run could read — a mirror would either invent the input or report a pass over an analysis that was never performed, which is the exact defect INFRA-048 built this gate to close.
    this diff makes it relevant (every pull request — the code-scanning half resolves to `PASS (not-applicable)` on a docs-only diff, but the PR-body half (RULE-016: first heading `## Background`, no agent-session link) judges every PR, so the check is never irrelevant). Run it yourself: the body half: gh pr view <n> --json body -q .body | node scripts/harness/check-pr-body.mjs. The code-scanning half has no local equivalent — push and read the check, or query it directly: gh api "repos/<owner>/<repo>/code-scanning/alerts?pr=<n>&state=open" --paginate  (note --paginate: a single page silently truncates, which is how a 40-high backlog once read as clean)
PASS — all 13 stage(s) passed; mirrors the required checks of `develop`.
verification receipt not written: working tree is not clean:  M .agents/loop-runs/post-implementation-checklist.jsonl,  M .agents/spec-docs/active/OBSERVABILITY-002-work-run-pre-pr-measurement.md,  M .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md
  (without a receipt the next `git push` re-runs this entire gate)
```

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-31

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 10 of 4229 line(s))

```
· regression-red-proof (enforcing: accidental-green only) — NOT mirrored locally: the checker RUNS locally and is useful there, but it cannot reproduce this context's VERDICT. The opt-out is read from `PR_BODY` joined with the commit subjects, and off a pull request `PR_BODY` is empty — so an `allow-green-at-base: <reason>` declared in the body ALONE is invisible locally and the run reports `accidental-green` for a case CI legitimately excuses. A mirror that can disagree with the gate on the gate's own escape hatch is worse than no mirror: it would report a blocking verdict the required check does not hold.
! dependency audit — NOT mirrored locally: downloads the osv-scanner binary from GitHub and scans the lockfile against the OSV.dev database — it needs network access and an external toolchain, so a local run could not be made deterministic or offline.
    this diff makes it relevant (the diff touches `pnpm-lock.yaml` or any `package.json`). Run it yourself: osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml   (see ci.yml → dependency-audit for the pinned version)
· windows-shell — NOT mirrored locally: runs on `windows-latest` and exists precisely to exercise the win32 process-spawn path that no Linux or macOS host can execute. Mocked-platform unit tests are what it was added to stop being sufficient.
· workflow provenance — NOT mirrored locally: runs on `pull_request_target` and judges the pull request's CHANGED-FILE LIST against the workflows that provide a required context, reading both from the base. Off a real pull request there is no file list and no base to compare it to, so a local run would either invent one or report a pass over a control plane it never inspected — which is the vacuity INFRA-097 built this gate to close.
! review-gate — NOT mirrored locally: reads GitHub's code-scanning API for this PR's merge ref and compares it against the base branch. Both sides only exist once CodeQL has analysed a real pull request, so there is nothing a local run could read — a mirror would either invent the input or report a pass over an analysis that was never performed, which is the exact defect INFRA-048 built this gate to close.
    this diff makes it relevant (every pull request — the code-scanning half resolves to `PASS (not-applicable)` on a docs-only diff, but the PR-body half (RULE-016: first heading `## Background`, no agent-session link) judges every PR, so the check is never irrelevant). Run it yourself: the body half: gh pr view <n> --json body -q .body | node scripts/harness/check-pr-body.mjs. The code-scanning half has no local equivalent — push and read the check, or query it directly: gh api "repos/<owner>/<repo>/code-scanning/alerts?pr=<n>&state=open" --paginate  (note --paginate: a single page silently truncates, which is how a 40-high backlog once read as clean)
PASS — all 13 stage(s) passed; mirrors the required checks of `develop`.
verification receipt not written: working tree is not clean:  M .agents/loop-runs/post-implementation-checklist.jsonl,  M .agents/spec-docs/active/OBSERVABILITY-002-work-run-pre-pr-measurement.md,  M .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md
  (without a receipt the next `git push` re-runs this entire gate)
```

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-31

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 10 of 4229 line(s))

```
· regression-red-proof (enforcing: accidental-green only) — NOT mirrored locally: the checker RUNS locally and is useful there, but it cannot reproduce this context's VERDICT. The opt-out is read from `PR_BODY` joined with the commit subjects, and off a pull request `PR_BODY` is empty — so an `allow-green-at-base: <reason>` declared in the body ALONE is invisible locally and the run reports `accidental-green` for a case CI legitimately excuses. A mirror that can disagree with the gate on the gate's own escape hatch is worse than no mirror: it would report a blocking verdict the required check does not hold.
! dependency audit — NOT mirrored locally: downloads the osv-scanner binary from GitHub and scans the lockfile against the OSV.dev database — it needs network access and an external toolchain, so a local run could not be made deterministic or offline.
    this diff makes it relevant (the diff touches `pnpm-lock.yaml` or any `package.json`). Run it yourself: osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml   (see ci.yml → dependency-audit for the pinned version)
· windows-shell — NOT mirrored locally: runs on `windows-latest` and exists precisely to exercise the win32 process-spawn path that no Linux or macOS host can execute. Mocked-platform unit tests are what it was added to stop being sufficient.
· workflow provenance — NOT mirrored locally: runs on `pull_request_target` and judges the pull request's CHANGED-FILE LIST against the workflows that provide a required context, reading both from the base. Off a real pull request there is no file list and no base to compare it to, so a local run would either invent one or report a pass over a control plane it never inspected — which is the vacuity INFRA-097 built this gate to close.
! review-gate — NOT mirrored locally: reads GitHub's code-scanning API for this PR's merge ref and compares it against the base branch. Both sides only exist once CodeQL has analysed a real pull request, so there is nothing a local run could read — a mirror would either invent the input or report a pass over an analysis that was never performed, which is the exact defect INFRA-048 built this gate to close.
    this diff makes it relevant (every pull request — the code-scanning half resolves to `PASS (not-applicable)` on a docs-only diff, but the PR-body half (RULE-016: first heading `## Background`, no agent-session link) judges every PR, so the check is never irrelevant). Run it yourself: the body half: gh pr view <n> --json body -q .body | node scripts/harness/check-pr-body.mjs. The code-scanning half has no local equivalent — push and read the check, or query it directly: gh api "repos/<owner>/<repo>/code-scanning/alerts?pr=<n>&state=open" --paginate  (note --paginate: a single page silently truncates, which is how a 40-high backlog once read as clean)
PASS — all 13 stage(s) passed; mirrors the required checks of `develop`.
verification receipt not written: working tree is not clean:  M .agents/loop-runs/post-implementation-checklist.jsonl,  M .agents/spec-docs/active/OBSERVABILITY-002-work-run-pre-pr-measurement.md,  M .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md
  (without a receipt the next `git push` re-runs this entire gate)
```

### [GATE-COMPLETE: TC-08] — ✅ PASS | 2026-08-31

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 10 of 4229 line(s))

```
· regression-red-proof (enforcing: accidental-green only) — NOT mirrored locally: the checker RUNS locally and is useful there, but it cannot reproduce this context's VERDICT. The opt-out is read from `PR_BODY` joined with the commit subjects, and off a pull request `PR_BODY` is empty — so an `allow-green-at-base: <reason>` declared in the body ALONE is invisible locally and the run reports `accidental-green` for a case CI legitimately excuses. A mirror that can disagree with the gate on the gate's own escape hatch is worse than no mirror: it would report a blocking verdict the required check does not hold.
! dependency audit — NOT mirrored locally: downloads the osv-scanner binary from GitHub and scans the lockfile against the OSV.dev database — it needs network access and an external toolchain, so a local run could not be made deterministic or offline.
    this diff makes it relevant (the diff touches `pnpm-lock.yaml` or any `package.json`). Run it yourself: osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml   (see ci.yml → dependency-audit for the pinned version)
· windows-shell — NOT mirrored locally: runs on `windows-latest` and exists precisely to exercise the win32 process-spawn path that no Linux or macOS host can execute. Mocked-platform unit tests are what it was added to stop being sufficient.
· workflow provenance — NOT mirrored locally: runs on `pull_request_target` and judges the pull request's CHANGED-FILE LIST against the workflows that provide a required context, reading both from the base. Off a real pull request there is no file list and no base to compare it to, so a local run would either invent one or report a pass over a control plane it never inspected — which is the vacuity INFRA-097 built this gate to close.
! review-gate — NOT mirrored locally: reads GitHub's code-scanning API for this PR's merge ref and compares it against the base branch. Both sides only exist once CodeQL has analysed a real pull request, so there is nothing a local run could read — a mirror would either invent the input or report a pass over an analysis that was never performed, which is the exact defect INFRA-048 built this gate to close.
    this diff makes it relevant (every pull request — the code-scanning half resolves to `PASS (not-applicable)` on a docs-only diff, but the PR-body half (RULE-016: first heading `## Background`, no agent-session link) judges every PR, so the check is never irrelevant). Run it yourself: the body half: gh pr view <n> --json body -q .body | node scripts/harness/check-pr-body.mjs. The code-scanning half has no local equivalent — push and read the check, or query it directly: gh api "repos/<owner>/<repo>/code-scanning/alerts?pr=<n>&state=open" --paginate  (note --paginate: a single page silently truncates, which is how a 40-high backlog once read as clean)
PASS — all 13 stage(s) passed; mirrors the required checks of `develop`.
verification receipt not written: working tree is not clean:  M .agents/loop-runs/post-implementation-checklist.jsonl,  M .agents/spec-docs/active/OBSERVABILITY-002-work-run-pre-pr-measurement.md,  M .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md
  (without a receipt the next `git push` re-runs this entire gate)
```

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-08-31

**Command:** `pnpm harness:scan`
**Exit:** 0
**Output:** (last 10 of 166 line(s))

```
✓ docs-structure

⚑ 4 advisory finding(s) — NOT failures. The verdict below is unaffected.
⚑ action-references: RESOLVABILITY NOT VERIFIED on this run (not CI — run with --live to verify resolvability): 12 reference(s) were parsed but none was resolved. An action that does not exist passes this run.
⚑ spec-whitebox-leakage: packages/agent-framework/docs/SPEC.md: 2058/2862 lines (71.9%) outside the standard sections — consider extracting to docs/design/
⚑ spec-whitebox-leakage: packages/agent-session/docs/SPEC.md: 318/757 lines (42.0%) outside the standard sections — consider extracting to docs/design/
⚑ progress-report-quantification: progress-report quantification: 1 finding(s) acknowledged in scripts/harness/progress-report-acknowledgments.json — 1 real violation(s) recorded, not cleared by editing history.

149 scans passed, 1 skipped (99 declared what they examined)
scan receipt NOT written: working tree is not clean:  M .agents/loop-runs/post-implementation-checklist.jsonl,  M .agents/spec-docs/active/OBSERVABILITY-002-work-run-pre-pr-measurement.md,  M .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md,  M scripts/harness/check-plan.mjs,  M scripts/harness/file-size-baseline.json,  M scripts/harness/shared.mjs, ?? scripts/harness/__tests__/manifest-change-classification.test.mjs, ?? scripts/harness/__tests__/repository-check-classification.test.mjs, ?? scripts/harness/manifest-change-classification.mjs, ?? scripts/harness/repository-check-classification.mjs
```

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-08-31

**Command:** `pnpm harness:verify-like-ci`
**Exit:** 0
**Output:** (last 10 of 4229 line(s))

```
· regression-red-proof (enforcing: accidental-green only) — NOT mirrored locally: the checker RUNS locally and is useful there, but it cannot reproduce this context's VERDICT. The opt-out is read from `PR_BODY` joined with the commit subjects, and off a pull request `PR_BODY` is empty — so an `allow-green-at-base: <reason>` declared in the body ALONE is invisible locally and the run reports `accidental-green` for a case CI legitimately excuses. A mirror that can disagree with the gate on the gate's own escape hatch is worse than no mirror: it would report a blocking verdict the required check does not hold.
! dependency audit — NOT mirrored locally: downloads the osv-scanner binary from GitHub and scans the lockfile against the OSV.dev database — it needs network access and an external toolchain, so a local run could not be made deterministic or offline.
    this diff makes it relevant (the diff touches `pnpm-lock.yaml` or any `package.json`). Run it yourself: osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml   (see ci.yml → dependency-audit for the pinned version)
· windows-shell — NOT mirrored locally: runs on `windows-latest` and exists precisely to exercise the win32 process-spawn path that no Linux or macOS host can execute. Mocked-platform unit tests are what it was added to stop being sufficient.
· workflow provenance — NOT mirrored locally: runs on `pull_request_target` and judges the pull request's CHANGED-FILE LIST against the workflows that provide a required context, reading both from the base. Off a real pull request there is no file list and no base to compare it to, so a local run would either invent one or report a pass over a control plane it never inspected — which is the vacuity INFRA-097 built this gate to close.
! review-gate — NOT mirrored locally: reads GitHub's code-scanning API for this PR's merge ref and compares it against the base branch. Both sides only exist once CodeQL has analysed a real pull request, so there is nothing a local run could read — a mirror would either invent the input or report a pass over an analysis that was never performed, which is the exact defect INFRA-048 built this gate to close.
    this diff makes it relevant (every pull request — the code-scanning half resolves to `PASS (not-applicable)` on a docs-only diff, but the PR-body half (RULE-016: first heading `## Background`, no agent-session link) judges every PR, so the check is never irrelevant). Run it yourself: the body half: gh pr view <n> --json body -q .body | node scripts/harness/check-pr-body.mjs. The code-scanning half has no local equivalent — push and read the check, or query it directly: gh api "repos/<owner>/<repo>/code-scanning/alerts?pr=<n>&state=open" --paginate  (note --paginate: a single page silently truncates, which is how a 40-high backlog once read as clean)
PASS — all 13 stage(s) passed; mirrors the required checks of `develop`.
verification receipt not written: working tree is not clean:  M .agents/loop-runs/post-implementation-checklist.jsonl,  M .agents/spec-docs/active/OBSERVABILITY-002-work-run-pre-pr-measurement.md,  M .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md
  (without a receipt the next `git push` re-runs this entire gate)
```

### [GATE-COMPLETE] — ✅ PASS | 2026-08-31

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-31; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 8/8 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (8)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (8) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (8) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 8/8 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (8) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 8/8 tasks `[x]` in .agents/tasks/OBSERVABILITY-002-work-run-pre-pr-measurement.md
