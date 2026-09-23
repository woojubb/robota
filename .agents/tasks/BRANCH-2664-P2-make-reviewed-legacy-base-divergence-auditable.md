---
title: 'BRANCH-2664-P2: make reviewed legacy-base divergence auditable'
issue: https://github.com/woojubb/robota/issues/2664
status: in-progress
created: 2026-09-21
priority: high
urgency: now
area: repository integration-base migration policy and harness verification
depends_on: [MANIFEST-2664]
---

Spec: `.agents/spec-docs/active/BRANCH-2664-P2-make-reviewed-legacy-base-divergence-auditable.md`

# BRANCH-2664: P2 make reviewed legacy-base divergence auditable

## Issue #2826 coordination

This Task remains open, but its prospective verification consumes the current applicable-check
contract. Deleted plan-order and CI-mirror modules are historical references only. Any Darwin
migration check must be an affected child aggregated by `pr-validation`, not a fifth required
context; the stable required contexts remain `pr-validation`, `security`, `review-policy`, and
trusted `workflow provenance`.

## Objective

> Scope split 2026-09-21: the manifest verifier, record binding, runtime seam, static scan, and
> owner-document route moved to `MANIFEST-2664` (this Task's former TC-01/02/03/05/06). This Task
> keeps the remote publication and authority layer and its verification, and depends on that bundle.

Unblock AGREEMENT-2664's legacy integration-base migration without weakening replay review. Use the
landed generic verifier and one closed manifest to verify the measured replacement, preserve merge
cleanliness as first-class data, land the reconciled history on `develop`, and close issue #2664.

## Problem

The legacy remote base `4214cb540` conflicts when merged with `origin/develop@6cbd65a21`; on the clean
historical sync fixture, plan-order examines 60 topic commits and reports undeclared `PUSH-2664`, four
out-of-order children, and a `RULE-2326` checkpoint mix. Measured replacement v3 `720eb5e84` passes over
62 topic commits, but only one of eight child segments has complete ordered stable patch-ID equality.
Current policy therefore rejects both the invalid legacy history and the corrected history. V3 is
evidence only: the publishable replacement must be rebuilt from the develop commit that contains the
generic verifier.

## Source Constraints

Problem-side constraints this Task owns. Every design fact — command table, journal enum, lease protocol,
admission seam, credential handoff, CI registration — is owned by the SPEC's `## Architecture Review` >
`### Decision` and is referenced here, never restated, so the two documents cannot drift.

- Keep the archived legacy ref immutable and bind every operation to exact full commit IDs.
- Preserve strict equality where it exists; a manifest entry must not turn an equal replay into a waiver.
- Never infer remote replacement authority from local refs or mutable prose.
- Keep root `.eslintrc.json` unchanged as the lint-policy SSOT; the static scan applies it as-is.
- Do not mutate remote refs or rulesets while this design is unapproved; do not close issue #2664 here.
- Keep MAP-2664 parked until the integration base is mechanically admissible and remotely readable.
- Do not fall back to an owner PAT or unprotected ref when either declared App, external key custody, or
  ruleset prerequisite is unavailable; stop before Phase B mutation instead.
- Reuse existing owners rather than duplicating them: the landed PR-scoped completion selection
  (`481084a5b`, PR #2789), the shared strict-record parser/serializer/validator, `github-api.mjs`'s pure
  pagination helpers, and the bounded runtime seam — each extended only as the SPEC's Affected Scope
  states.
- Every contract the SPEC's Decision names (ruleset scope and window, App split and read identity, journal
  lifecycle and lease reclaim, admission classifier and bypass enumeration, one-shot credential handoff,
  remote projection matrix, Darwin required context and its landing sequence) is implemented exactly as
  written there; where this Task and the SPEC could be read differently, the SPEC governs.

## Plan

- [ ] TC-01 — Preserve clean/conflicted merge status and own-path attribution in the shared helper,
      with clean, manual-resolution, staged, and persisted-conflict-marker regressions.
- [ ] TC-02 — Run the landed migration verifier and affected harness contracts against the exact replacement/sync history.
- [ ] TC-03 — Re-key MANIFEST-2664's reference-kind baseline from `active/` to `done/` with value and
      baseline cardinality unchanged.
- [ ] TC-04 — Commit and verify the canonical AGREEMENT-2664 migration manifest against exact legacy and
      replacement OIDs.
- [ ] TC-05 — Preserve the archived legacy ref and publish the verified replacement only through exact
      expected-OID checks.
- [ ] TC-06 — Sync current `develop`, resolve the three measured conflicts without markers, and preserve
      the current behavior on overlapping paths.
- [ ] TC-07 — Reconcile and terminalize BRANCH-2664-P2, MERGE-2664, MAP-2664, and AGREEMENT-2664 with one
      delivered-or-terminal owner for every issue row.
- [ ] TC-08 — Confirm the final hosted state, independent verification, one completion-record audit,
      and issue #2664 in the CLOSED state.

## Superseded Plan (historical)

- [ ] TC-01 — Implement the pure manifest module: the SHA-1 canonical manifest, four dispositions,
      deterministic base64-path recursive `--no-renames` tuples, closed parsing, raw non-UTF-8/control-byte
      paths, and exact field diagnostics. Acceptance is SPEC TC-01.
- [ ] TC-02 — Reproduce the legacy findings with a hermetic minimal graph in the migration-verifier
      suite (the command half) and record bounded Phase-B evidence with fetch commands, OIDs, and output
      digests for the exact remote legacy/fresh-replacement graph (the observable half) without a
      live-network default test. Acceptance is SPEC TC-02.
- [ ] TC-03 — Cover equality and content/mode/type/rename/empty-patch cases plus every declared resource
      limit at boundary and boundary-plus-one, at the extended runtime seam (per-operation timeout,
      `maxBuffer`, reserved cleanup runtime) as well as at the manifest. Acceptance is SPEC TC-03.
- [ ] TC-04 — Land the protector-owned provision/read-back boundary with its own test file, exact
      protector/publisher App identities with a fresh JWT per request, the confined `gh` read identity,
      attestation sub-generations for every credentialed read, the two-section declaration (epoch plus
      cumulative `archives[]`) with the pinned HTTPS push URL, the pure admission classifier reached by
      both hook layers through `show-admission` with `pre-push.mjs` reading stdin once, the one-shot
      handshake-token socket credential helper proven against an authenticated smart-HTTP remote,
      window-scoped rulesets, exact absent-ref smart publication, and atomic GraphQL target-review apply.
      Acceptance is SPEC TC-04.
- [ ] TC-05 — Assign immutable ref/lease/ruleset ownership to `git-branch`, sequence/outcomes to
      `multi-backlog-initiative`, and make `backlog-execution` route without restating either contract;
      assert by headings and identifiers. Acceptance is SPEC TC-05.
- [ ] TC-06 — Bind the manifest to the independent review (exported shared parser, `MANIFEST-DIGEST`,
      unchanged trust policy, owner-attested independence with the `APPROVED-BY` agent check), the
      existing merge decision, the landed PR-scoped completion selection with the exact-ID identity check,
      the completion merge blob, both `gh` readers on the runtime `maxBuffer`, and fail-closed GitHub
      projections. Acceptance is SPEC TC-06.
- [ ] TC-07 — Implement the importable orchestrator, the journal (persistence, atomic lock claim,
      single-winner stale reclaim, `publication-bound@N`, attestation sub-generations, five re-emittable
      envelopes, closed lifecycle, staged reconciliation), handlers at process start with the reserved
      cleanup runtime, the disjoint remote projection matrix with stable `remote:complete`, and the
      handshake-driven real-process fixtures in the isolated tier under a dedicated `test/` sub-root with
      dead-owner sweeps. The acceptance list is SPEC TC-07 verbatim; this Task adds nothing to it.
- [ ] TC-08 — Keep root `.eslintrc.json` unchanged as the lint-policy SSOT and add an explicit
      `SCAN_COMMANDS` entry for `scan-integration-migration-static` (glob-derived governed set including the new
      scans, `advisory: false`, fail-closed on a missing ESLint binary, no inline override) that checks the
      complete governed file set via `--no-ignore --no-cache` when source or lint configuration is
      affected; register `migration-darwin-contract` as its own `ciOwned` required context through the
      control-plane landing route with the owner's live-ruleset step, the recorded `--live` reconciliation,
      the `scan-integration-migration-darwin-gate` scan, the twelve-context mirror-map test, and the
      declaration-derived benchmark pin; then run every focused suite and affected L2 scan with every
      command exiting zero. Acceptance is SPEC TC-08.

## Test Plan

Run the focused migration-verifier suite, affected harness contracts, reference-kind scan,
canonical migration verifier, exact remote-ref read-backs, Task/spec projection scans, required GitHub
checks, independent merge verification, and the closeout audit. TC-08 is complete only when issue #2664
reads `CLOSED`.

## Superseded Test Plan (historical)

Use temporary Git repositories to build all four dispositions plus content, mode, symlink/type,
add/delete, rename, empty-patch, malformed-canonicalization, omitted, extra, and tampered histories.
Exercise deterministic temporary Git graphs plus injected credential/clock/protector/Git/GraphQL
ports and a real temporary bare remote for exact absent-ref/target leases, pack and sync-object
publication, atomic multi-ref rejection/success, both App identities, secret redaction, child
argv/environment isolation, signal cleanup and token revocation, immutable archive
refusal, restart states, develop advance after sync,
lost responses, administrative drift, final sync, and mixed-state refusal. Add GitHub parser/API fixtures
for trusted association, exact comment identity, edits, duplicates, stale/dismissed substitutes,
authorization, API/auth failure, PR head, merge ancestry, and manifest blob/digest. Re-run generated
verification against the real #2664 legacy graph and a fresh post-Phase-A replacement.
Run production `MigrationStateStore`/`OperationLease` process races against a `test/` sub-root of the
canonical application-state root on `macos-latest` under `ROBOTA_MIGRATION_REQUIRE_DARWIN=1`, with sentinel
or IPC handshakes instead of wall-clock pauses and one spawned-CLI real-signal case; keep Linux coverage for
injected state transitions and unsupported-platform refusal. Exercise the pre-push admission seam through
the installed hook against the temporary bare remote while the parent holds the lease, and the socket
credential helper against a local authenticated smart-HTTP remote with a capturing hook subtree.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This is repository-internal Git history governance and publication verification. It adds no
Robota CLI, TUI, browser, public SDK, configuration, or installed-package behavior for an end user.

## Finding Evidence

- Closeout recommendation, 2026-09-22: replace the reusable publication-control-plane build with a
  bounded one-time owner-authorized migration. The reusable GitHub App/ruleset/journal/Darwin surfaces
  do not contribute to the required final state; the immutable archive, exact leases, canonical manifest,
  merge-status correction, current-develop sync, and remote read-back preserve the safety properties.
- Owner direction, 2026-09-22: "깃헙 이슈를 닫기 위한거라서 너는 그 목표대로 해야함". This makes
  #2664 closure the governing outcome and approves removing nonessential reusable automation from the
  closeout path under the previously granted standing approval for evidence-backed recommendations.

- Recommendation review: `REVIEW VERDICT: REVISE | 2026-09-21`. Three bounded review rounds reduced
  actionable findings from eight to five to one. The remaining finding is that the shared
  `DELIVERY_COMPLETION_RECORD` closeout audit checks global uniqueness on umbrella issue #2664 before
  honoring the supplied exact comment ID, so the proposed application reader would fail with
  `ambiguous-completion`. The recommended continuation is an owner-approved scope amendment that fixes
  exact-ID selection in the shared `post-findings-authorization.mjs` validator and tests, then reuses
  that validator from migration review; a private duplicate validator is rejected.
- Scope-amendment authorization: the user's standing instruction automatically approves a recommended
  continuation when its rationale is valid. The shared-selector route is narrower and safer than a
  private migration validator because it fixes the demonstrated #2664 ambiguity at its existing owner
  while preserving all current state checks; it is therefore approved for the resumed review run.
- Recommendation review: `REVIEW VERDICT: ENDORSE | 2026-09-21`. The resumed independent review
  confirmed that exact-ID-first selection in the shared closeout owner closes the final load-bearing
  finding without weakening pre-merge uniqueness or duplicating validation in migration code.
- Architecture fanout `r20260921044221`: converged with full structure coverage `7/7` and no structure
  findings. Design/runtime/gate channels identified deterministic-rename, ownership mapping, object-format,
  restart-state, archive atomicity, resource-bound, remote-authority, real-fixture, and static-analysis
  gaps; the revised recommendation incorporates each rather than treating structure-only success as a
  waiver.
- Post-fanout recommendation review: `REVIEW VERDICT: REVISE | 2026-09-21` with three in-scope findings.
  The prior `/installation` token check could not attest the issuing App, a develop advance after a
  successful sync was misclassified as indeterminate, and no-bypass archive wording ignored ruleset
  administration. The corrected design uses App JWT → exact repository installation → narrowed token
  attestation, adds retryable `sync-stale`, and treats ruleset administration as an explicit external
  non-interference prerequisite with fail-closed owner recovery.
- Recommendation review: `REVIEW VERDICT: ENDORSE | 2026-09-21`. The retained reviewer verified the
  three repair deltas and surrounding publication/evidence contracts: issuer identity precedes narrowed
  token creation, valid replacement-rooted stale sync chains are retryable, and archive protection is
  qualified to the active ruleset with explicit drift halt/re-attestation. Loop run
  `r20260921051109` converged with findings `[3, 0]`.
- Architecture fanout `r20260921051955`: all 23 cells were covered, exposing two design blockers and
  related material gaps. `updateRefs` cannot upload fresh Git objects, recursive tuple extraction required
  `diff-tree -r`, and exact bypass-actor visibility cannot share the least-privilege publisher identity.
  The integrated correction adds exact absent-ref-lease smart object publication, separated publisher/protector Apps
  with an owner-operated provisioner, injected remote ports, credential scrubbing/revocation and
  redaction tests, raw path-byte fixtures, owner-dispatched drift wiring, and a registered affected-harness
  static scan. Issue #2826 replaced discovery with explicit registry wiring, so implementation and
  the fresh fanout must validate the registry entry rather than a `scanDefinition` export.
- Post-fanout recommendation review: `REVIEW VERDICT: REVISE | 2026-09-21` with three in-scope findings.
  The revised transport now recognizes that each develop sync also creates a local-only object: GraphQL
  remains exclusive to atomic target/review application, while review creation and every sync use native
  Git smart pushes with explicit absent-ref or exact-old-tip leases and lost-response classification.
  `scan-harness-mjs-static.mjs` was originally reviewed against the then-current discovery contract;
  issue #2826 supersedes that wiring choice with an explicit runner registry entry.
- Recommendation review: `REVIEW VERDICT: ENDORSE | 2026-09-21`. The retained reviewer verified exact
  native Git lease syntax for review/sync object publication, GraphQL-only atomic target/review apply,
  capability-probe cleanup and SIGKILL residual-risk wording. Its discovery recommendation is
  superseded by issue #2826's explicit static-scan registry.
  Loop run `r20260921052726` converged with findings `[3, 0]`.
- Final architecture fanout `r20260921053723`: all 23 cells were covered; design was clean, while
  structure/runtime/gate retained five material contract gaps. The correction retains root
  `.eslintrc.json` as the unchanged lint-policy owner, makes the explicitly registered scan evaluate a complete governed set,
  captures every child argv/environment, installs bounded signal cleanup, and gives capability-probe
  create/delete lost responses unconditional state-based cleanup. A final delta fanout and fresh
  GATE-WRITE are required before approval.
- Final-delta recommendation review: `REVIEW VERDICT: REVISE | 2026-09-21` with two in-scope precision
  findings. No lint relaxation is needed: root `.eslintrc.json` remains unchanged and the scan applies it
  with `--no-ignore --no-cache` to the fixed governed set. Repeated catchable signals coalesce into the
  first bounded cleanup. Host loss/`SIGKILL` are cleanup-unattempted; revocation failure/deadline exhaustion
  are explicitly reported cleanup-incomplete expiry-backed states.
- Recommendation review: `REVIEW VERDICT: ENDORSE | 2026-09-21`. The retained reviewer confirmed the
  unchanged root lint policy, complete-set static scan, repeated-signal coalescing, and truthful separation
  of cleanup-unattempted from cleanup-incomplete expiry-backed credentials. Loop run
  `r20260921054322` converged with findings `[2, 1, 0]`.
- Architecture fanout `r20260921064420`: all 23 cells were covered and the fanout ledger correctly closed
  with uncovered-cell count `[0]`. Structure was clean. Design/runtime found one deduplicated
  persist-before-output crash window, a recovery-side response-loss state-machine gap, and conflicting
  missing-store routing; gate review found that the Darwin-only production store/lease had no reachable
  blocking macOS PR path. The current revision persists and re-emits exact secret-free envelopes, adds
  durable recovery action subtransactions with fresh authorization after uncertainty, assigns missing-store
  loss exclusively to reviewed epoch rotation, and routes a real macOS producer fail-closed through the
  required `quality` verdict. A fresh full fanout and proposal review are required on this exact revision.
- Architecture fanout `r20260921070109` (branch re-cut from `origin/develop@24a646101`): all 23 cells were
  covered and the ledger closed `converged` with uncovered-cell count `[0]`; raw signals were structure
  `high=1 medium=7`, design `high=3 medium=3`, runtime `medium=7`, gate `high=1 medium=6`. Verified by hand:
  `481084a5b` (PR #2789) had already bound completion selection to the audited pull request, so the
  earlier "global uniqueness before exact IDs" diagnosis above is history, not a premise. The revision
  window-scopes the rulesets so ordinary child-PR merges keep working, defines the journal-bound pre-push
  admission seam at both hook layers, replaces the stdin askpass with a one-shot socket credential helper,
  extends the bounded runtime seam with unchanged defaults, adds fatal-path cleanup and atomic lock
  metadata, makes `remote:complete` stable after one migration sync, registers `migration-darwin-contract`
  as its own required context with a required-capability entry and executed-test floor, enumerates the
  command table, makes genesis the fifth re-emittable envelope, names the `gh` read identity, splits the
  pure manifest module, exports the shared parser, and derives the static scan's governed set from a glob.
  A fresh full fanout and proposal review are required on this exact revision.
- Architecture fanout `r20260921072359`: all 23 cells were covered and the ledger closed `converged` with
  uncovered-cell count `[0]`; raw signals were structure `high=1 medium=7`, design `high=3 medium=11`,
  runtime `medium=10`, gate `high=1 medium=7`. Nothing from the previous run recurred; every material
  finding was a seam the previous revision introduced without closing. The revision adds the pure
  admission classifier reached by both hook layers (`show-admission`, lock-free snapshot read, pushed OID
  must equal `HEAD` on `integration/<agreement-id>`), `publication-bound@N`, attestation sub-generations
  for every credentialed read, `MANIFEST-DIGEST`, owner-attested independence, runtime `maxBuffer` in both
  `gh` readers, single-winner stale-lock reclaim, handlers at process start with a reserved cleanup
  runtime, handshake-token socket confinement with a pinned HTTPS push URL, the importable orchestrator,
  the two-section declaration, the disjoint remote projection matrix, the declaration-derived benchmark
  pin, and the owner's live-ruleset step. A fresh full fanout and proposal review are required on this
  exact revision.
- Architecture fanout `r20260921074652`: all 23 cells were covered and the ledger closed `converged` with
  uncovered-cell count `[0]`; raw signals were structure `high=2 medium=3`, design `medium=8`, runtime
  `high=2 medium=4`, gate `high=1 medium=5`. Nothing from the previous two runs recurred; one structure
  finding (a "phantom" hook-lock precedent) was refuted by hand — `scripts/harness/with-repo-lock.sh:44-52`
  is the run-unlocked fallback the SPEC meant, now named. The revision makes `publication-bound` the
  registered-before-dispatch state for smart pushes with the push group recorded, treats a foreign boot
  session as proven death and guards reclaim against the moved-live-lock race, derives the cleanup budget
  from the declaration and orders it revoke-first, drains stdout before any exit, adds `withdraw-proposal`
  and drift return routes, extends the shared projection with `author.id` and exports
  `canonicalizeStrictRecord`, makes the admission module the single owner of declaration loading,
  state-root derivation, and the snapshot codec, enumerates every bypassed hook block, excludes tests from
  the lint-governed set with the reason and baseline recorded, derives the Darwin producer's command from
  `DARWIN_REQUIRED_TEST_FILES`, writes the post-merge owner step and `--live` sequence into the landing
  route, re-freezes the concurrency-footprint baseline, and takes the benchmark-ceiling decision. This
  Task's Source Constraints were reduced to problem-side constraints with the SPEC as the sole design
  owner. A fresh full fanout and proposal review are required on this exact revision.
- Architecture fanout `r20260921080947` (commit `c748d5dea`): all 23 cells were covered and the ledger
  closed `converged` with uncovered-cell count `[0]`; raw signals were structure `medium=5`, design
  `high=2 medium=6`, runtime `high=1 medium=4`, gate `medium=6`. Nothing from the three earlier runs
  recurred. Not yet applied — recorded for the owner's decision: (1) make `pre-push.mjs` the single
  admission seam that dispatches an admitted update to a migration-only step pipeline and never enters
  `createPrePushRuntime`/`resolvePrePushBaseRef`/subject resolution (a pinned-URL push is refused by
  `pre-push-base-ref.mjs:260-267` today), with the shell layer receiving the verdict; (2) add
  `remote:review-pending` as the first admissible projection state and give `prepare-operation` an
  explicit operation kind; (3) replace rename-based stale-lock reclaim with an exclusive
  `lock.reclaim` intent plus unlink-and-link, and forbid a holder that fails re-verification from writing
  any journal transition; (4) skip clean-tree/lockfile/prerequisites/`runVerification` on the admitted
  route and run only the bounded plan-order scan; (5) drain stdout through the `write` callback, not
  `finished(process.stdout)`; (6) enforce the journal ceiling at generation admission only; (7) answer the
  credential `get` only after the post-spawn `publication-bound@N` fsync; (8) split a leaf
  `integration-migration-layout.mjs` and export the local-form integration-branch pattern from a leaf
  owner; (9) add a Module/Entry column to the command table; (10) delete `.eslintignore` from TC-08;
  (11) derive the Darwin producer as per-file `harness-test-tiers` invocations and assert
  `numPendingTests == 0 && numTodoTests == 0` per file; (12) place the socket under a short `0700`
  directory with a 104-byte path check; (13) add `classify-changed-paths.test.mjs` (a third
  eleven-context pin) to Affected Files; (14) take the benchmark measurement from the Phase-A PR's
  `pull_request` run and name the `jq` filter as the exclusion site; (15) make `author.id` optional in
  the shared projection with the numeric check only in the migration predicate; (16) export a
  discriminated strict-record parse result; (17) add a `classify-command` verb so the shell PreToolUse
  path never carries a namespace regex; plus the low findings. Measured lint baseline over the
  enumerated governed source set: `pnpm exec eslint --no-ignore --no-cache` → 1 error
  (`scan-user-execution-plan-order.mjs:1802`), 53 warnings (37 in the conditionally governed scanner).
- Loop status after four full fanouts this session: high counts 5, 5, 5, 3 and medium 23, 35, 20, 21;
  coverage converges, material findings do not. Halted for the owner's decision under the no-progress
  rule rather than iterated blindly.

- Legacy sync experiment: merging `origin/integration/agreement-2664@4214cb540` with
  `origin/develop@6cbd65a21` conflicts in `gate-checkpoint-evidence.test.mjs`. The clean historical sync
  fixture examined 60 topic commits and produced undeclared PUSH, four out-of-order, and one
  checkpoint-mix finding.
- Replacement evidence: local replacement v3 `720eb5e84` passed
  `node scripts/harness/scan-user-execution-plan-order.mjs` (history mode is the default without
  `--staged`) and examined 62 topic commits.
- Replay evidence: ordered stable patch-ID comparison passed completely for only 1/8 child segments;
  base-relative changed-path comparison also differed for the planning prelude and PUSH segment. One
  diagnostic ordered comparison measured 43 equal pairs, 17 unequal pairs, and two replacement-only
  commits; the generated canonical verifier will own final counts.
- Publication-boundary evidence (bypass enumeration): the admitted route must skip, in
  `.claude/hooks/pre-push-check.sh`, the review-record requirement, the lockfile-install and
  `harness:plan` work, the `gh pr list` read, the trusted-base ancestry check (`:796-799`), the sync-shape
  check on the trusted integration branch (`:807-828`), and the foreign-merge refusal on `integration/*`
  (`:840-856`), and in `pre-push-work-run.mjs` subject resolution; the plan-order scan with
  `--base <source-base-oid>` replaces them. Measured lint baseline of the governed source set under the
  unchanged root policy: one error (`scan-user-execution-plan-order.mjs:1802`, `no-param-reassign`) and 92
  warnings.
- Publication-boundary evidence: `.husky/pre-push` already forwards Git's ref-update stdin to
  `pre-push-runtime.mjs`, while current subject resolution refuses renamed/non-current ref updates;
  Phase A must add a narrowly classified integration-migration route before that ordinary resolution.
- Tooling dependency evidence: replacement history `720eb5e84`, not current `origin/develop`, contains
  the recorder-dependent recommendation contract and `scripts/harness/recommendation-review-record.mjs`.
  The current base's rule-compliant mechanism is the open `backlog-execution-orchestrator` loop ledger
  plus the dated `REVIEW VERDICT` recorded in this work item after convergence; absence of the
  replacement-only recorder is not treated as success.
- Capture: `.agents/learn.md` entry
  `LRN-agreement-migration-equivalence-cannot-correct-invalid-prelude` is preserved in the parked MAP
  work state.
