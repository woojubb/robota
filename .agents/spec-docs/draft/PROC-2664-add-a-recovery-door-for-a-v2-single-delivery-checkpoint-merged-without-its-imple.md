---
status: draft
type: INFRA
tags: [harness, process]
lane: L2
---

# PROC-2664: Bind a single-delivery checkpoint to the pull request that carries it

Paired with `.agents/tasks/PROC-2664-add-a-recovery-door-for-a-v2-single-delivery-checkpoint-merged-without-its-imple.md`. Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

A v2 `gateImplementFirst` checkpoint records `"deliveryMode": "single"` from the spec's
`**Delivery mode:**` line at judgement time, and every consumer thereafter treats that word as a
fact: the continuation writer refuses a later branch (`gate-checkpoint-evidence.mjs`, "prior v2
delivery does not bind the current Decision"), the correction form admits only a legacy v1 first
PASS (`gate-implement-correction-validation.mjs`, PROC-031), and the staged scan refuses any
implementation path on a branch whose range holds no checkpoint
(`scan-user-execution-plan-order.mjs`, `staged implementation has no planning checkpoint
ancestor`). No step compares the declaration with the pull request that actually carries the
checkpoint. `MANIFEST-2664`'s checkpoint (`e7025ca96`) was pushed and merged alone in PR #2792 at
`f185015f7` — every gate, the push hook, and the merge gate passed — and the unit was sealed:
reproduced 2026-09-21 on a branch cut from `f185015f7` (`--staged` with an implementation path
refused) and again on 2026-09-22 from `4543cf56d` (a `## Result` append to the `in-progress` Task
refused with the same finding). The recovery taken, `VERIFIER-2664` (PR #2805), is the second
identity PROC-031 rejected for the v1 case. Measured on `origin/develop@d5b4389f9`: of the 21
`active/` specs whose first PASS declares `single`, nine are `AGREEMENT` units whose checkpoint PR
carries planning by design, and `MANIFEST-2664` is the one non-AGREEMENT unit whose landing on
`develop` (first-parent diff of `f185015f7`) changed no path outside its pair, three ledgers, and a
baseline row. `finding-depth-triager` judged the item's own statement the root (run
`r20260921144518`): the declaration is a prediction consumed as an immutable fact, and every prior
answer — HARNESS-131's continuation form, PROC-029's declaration, PROC-031's correction form, the
residual recorded on issue #2774 — added an evidence form instead of a binding.

## Prior Art Research

Waived: this is a repository-internal planning-checkpoint contract; the binding reuses the plan-order
scan's existing topic-range replay and lane-floor readers and has no external product analogue to
cite. The closeout-receipt half of the original finding is owned by `PROC-2680` and is not designed
here.

## Architecture Review

### Affected Scope

- `scripts/harness/plan-order-records.mjs` — one exported predicate, `isDeliveryWitnessPath(file,
basename)`: true for every path that is not the unit's own Task/spec pair in any lifecycle folder,
  not a loop ledger (`.agents/loop-runs/*.jsonl`), not a lessons or work-run record under
  `.agents/evals/`, and not a harness baseline (`scripts/harness/*baseline*.json`). The negative
  list is the exact inventory a planning-only pull request has been observed to carry (PR #2792:
  the pair, three ledgers, `reference-kind-baseline.json`).
- `scripts/harness/scan-user-execution-plan-order.mjs` — `singleHistoryAnalysis` reads the first
  PASS's v2 payload once more (it already parses it for the form) and returns
  `checkpoint.delivery = { mode, witnessed }`, where `witnessed` is whether any commit after the
  checkpoint in the range changes a delivery-witness path; `findHistoryFindings` and the CLI's range
  mode emit the finding `single-delivery checkpoint \`<basename>\` reaches the end of the range with
  no delivery witness after <checkpoint sha>: push the implementation with the checkpoint, or declare
  sequenced delivery with continuation artifacts`when`mode === 'single'`, `witnessed === false`,
the checkpoint form is `first`, and the spec's frontmatter `type`at the checkpoint commit is not`AGREEMENT`. `findStagedFindings`calls`historyAnalysis` directly and never sees the finding: a
  commit is not a range. The header comment's "stays sealed" residual note is rewritten to name the
  binding.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — the isolated suite gains the
  range, commit, closeout, and exemption cases (TC-01..TC-03).
- `.agents/rules/backlog-execution.md` § Pre-implementation planning checkpoint — one sentence
  stating the binding and its `Enforced by:` line (an L2 path; this unit is L2 for it).
- `.agents/tasks/PROC-2664-…imple.md` § Plan — five items mirroring TC-01..TC-05.

No new scan, workflow, ruleset, hook, gate form, contract version, or `run-all-scans.mjs` change:
the `user-execution-plan-order` entry is already `always: true`, so CI's required `scans` job (the
`harness:scan --affected --context pr --base <base>` invocation) judges every pull request's range,
and `pnpm harness:scan` judges it locally. The pre-push gate's scan-suite stage mirrors the same
command when selected; no pre-push change is made.

### Alternatives Considered

1. Bind the declaration where the range is judged: the plan-order history scan emits a finding when a
   `single` first checkpoint reaches the end of the topic range with no delivery witness (this
   document).
   - Pro: one implementation reaches push (`pnpm harness:scan`, pre-push scan-suite), CI (`scans`
     required check), and merge (checks green) without touching a hook or workflow; the range is the
     only place the pull request's shape is knowable, and the scan already replays it; a commit-time
     judgement stays impossible, so the dedicated checkpoint commit keeps its planning-only form.
   - Con: the finding surfaces in CI rather than at `git push` for a session whose pre-push planning
     mode skips the scan-suite stage; a planning-only push of a `single` unit is refused outright, so
     a unit that wants a planning-only pull request must declare `sequenced` and name its artifacts
     — which is the declaration's meaning.
2. Refuse at the merge gate (`merge-gate.sh`) by reading the pull request's file list through `gh`.
   - Pro: the pull request is the literal object the declaration should match.
   - Con: a hook is an L2 policy file with no test harness of its own, it reads a live API the scan
     does not need, and it runs after CI has already spent a cycle on a pull request that cannot
     merge; the checkpoint would also reach the remote branch before refusal.
3. Add a v2 `single` → `sequenced` correction form (a fifth checkpoint form) and leave the
   declaration unreconciled.
   - Pro: recovers a sealed unit through the existing correction and continuation machinery.
   - Con: `finding-depth-triager` named this the fourth repetition of the same move (HARNESS-131,
     PROC-029, PROC-031, issue #2774); it recovers the symptom without preventing it, and the one
     sealed instance no longer needs a form — its implementation landed in PR #2805 and its records
     close through the existing post-merge completion closeout once `PROC-2680` provides a receipt
     for a merge-commit landing.

### Decision

Choose alternative 1. The `single` declaration in a v2 first PASS is bound to the topic range that
carries the checkpoint: `singleHistoryAnalysis` returns `checkpoint.delivery = { mode, witnessed }`,
and the range-mode readers (`findHistoryFindings`, the CLI without `--staged`, hence CI's `scans`
job and `pnpm harness:scan`) emit one finding, attached to the checkpoint commit, when the mode is
`single`, no commit after the checkpoint changes a delivery-witness path, the form is `first`, and
the unit is not an `AGREEMENT` (whose delivery is its children's merges and final pull request, not
a path its own checkpoint pull request can carry). A delivery witness is any changed path outside
the unit's own pair, loop ledgers, `.agents/evals/` lessons and work-run records, and harness
baselines — the exact inventory PR #2792 carried and nothing narrower, so the binding is decided by
paths the scan already classifies, not by the spec's `## Affected Files` (an ungated section that
`AGREEMENT` specs omit) and not by lane floors (a documentation-delivering L2 unit would sit at L0).
`sequenced` first checkpoints, continuation and correction forms, legacy v1 payloads, and L1 units
are untouched: their doors already exist and are not this finding's subject. The staged path is
untouched: the checkpoint commit stays planning-only, and the implementation commit that follows it
is admitted exactly as today. The integration-agreement composite analysis
(`integrationHistoryAnalysis`) is out of scope and unchanged; a child branch into an integration base
is judged by that path and, per issue #2804, receives no CI today.

The sealed instance is recovered by no new form. `MANIFEST-2664`'s implementation is on `develop`
(`79698d78d`), so what remains is its record closeout: the post-merge completion closeout the scan
already admits (exact four-path archive at `status: done`, Evidence Log ending in a GATE-COMPLETE
PASS, Task `## Result` naming the delivering pull request, its landing OID, and an issue-comment
receipt). This unit proves that range stays admitted under the binding (TC-03); the receipt for a
merge-commit landing is `PROC-2680`'s deliverable, and `MANIFEST-2664` closes after it lands. This
unit's own delivery is one pull request carrying its checkpoint and its implementation, so it is
the first range the binding judges for real (TC-03).

Validated recommendation:

- Reachability: every pull request into `develop` runs `harness:scan --affected --context pr --base
  <base>`, whose `user-execution-plan-order` entry is `always: true`; the finding therefore reaches
  the required `scans` check and, through checks-green, the merge gate. Locally the same command is
  `pnpm harness:scan`.
- Capability preservation: the `single` and `sequenced` semantics, the three v2 forms, the v1
  contract, the staged checkpoint transition, the L0 ground, the documentation batch, the atomic
  AGREEMENT prelude, and the post-merge completion closeout are unchanged; the existing suite is the
  control.
- Adversarial pass: a planning-only push padded with a ledger append, a lessons file, or a baseline
  row is still refused (those are on the negative list); a push that carries the implementation in a
  later commit of the same range is admitted; a `sequenced` planning-only pull request is admitted
  (its continuation door governs); an `AGREEMENT` prelude is admitted; the closeout range carries no
  first checkpoint and is admitted; a `--staged` run never emits the finding; the CLI exit map is
  unchanged (1 on any finding).

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — two harness modules, their isolated suite, one rule
      section, the paired Task; no package.
- [x] Sibling scan 완료 — every reader of the v2 first PASS was inspected on 2026-09-22:
      `gate-checkpoint-evidence.mjs` (continuation writer), `gate-correction-checkpoint-evidence.mjs`
      and `gate-implement-correction-validation.mjs` (correction), `checkpoint-evidence-contract*.mjs`
      (shapes), `scan-user-execution-plan-order.mjs` (history and staged consumers); only the history
      consumer sees a range, so only it changes.
- [x] 대안 최소 2개 검토 완료 — range scan, merge-gate hook, fifth form.
- [x] 결정 근거 문서화 완료 — the range is the only object the declaration can be compared with;
      the scan already replays it.
- [x] New-surface placement: N/A — no new file, command, scan, or export beyond one predicate in the
      module that already owns planning-path classification.

## Fallback & Degradation Declaration

None. A first PASS whose payload cannot be parsed is already a finding of the existing checkpoint
validation and reaches no delivery judgement; a spec whose frontmatter `type` cannot be read at the
checkpoint commit is judged as a non-`AGREEMENT` unit (the binding applies), never silently exempted.

## Solution

1. `scripts/harness/plan-order-records.mjs`: export `isDeliveryWitnessPath(file, basename)` beside
   `isPreCheckpointPlanningPath`, with the four-item negative list stated in Affected Scope.
2. `scripts/harness/scan-user-execution-plan-order.mjs`: in `singleHistoryAnalysis`, parse the first
   PASS's v2 payload for `deliveryMode` (legacy v1 or unparsable → `mode: null`), read the spec's
   frontmatter `type` at the checkpoint commit, fold `witnessed` over the entries after the
   checkpoint, and return `checkpoint.delivery`; in `findHistoryFindings` and the range branch of
   `scanUserExecutionPlanOrder`, append the finding under the four conditions; rewrite the header
   residual note.
3. `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`: the fixtures and cases of
   TC-01..TC-03, red before step 2 and green after it.
4. `.agents/rules/backlog-execution.md` § Pre-implementation planning checkpoint: the binding
   sentence and its `Enforced by:` line.
5. `.agents/tasks/PROC-2664-…imple.md` § Plan: five items mirroring TC-01..TC-05 (a planning edit,
   committed before the checkpoint).

## Affected Files

- `scripts/harness/plan-order-records.mjs`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `.agents/rules/backlog-execution.md`
- `.agents/tasks/PROC-2664-add-a-recovery-door-for-a-v2-single-delivery-checkpoint-merged-without-its-imple.md`

## Completion Criteria

- [ ] TC-01: Observable: in the isolated `scan-user-execution-plan-order.test.mjs`, over a fixture
      whose topic range holds a v2 `single` first checkpoint for a non-`AGREEMENT` L2 unit,
      `findHistoryFindings(root, base)` returns exactly one finding whose `problem` names the unit's
      basename and contains `no delivery witness` and whose `commit` is the checkpoint SHA when the
      checkpoint is the range's last commit, and the same single finding when it is followed only by
      a loop-ledger append, an `.agents/evals/lessons/auto-lessons.md` edit, and a
      `scripts/harness/reference-kind-baseline.json` row; it returns `[]` when one later commit
      changes `scripts/harness/example.mjs`, `[]` for a `sequenced` first checkpoint alone, `[]` for
      an `AGREEMENT`-typed spec's `single` checkpoint alone, and an unchanged result for an L1 PLAN
      commit and for a legacy v1 first PASS; and `isDeliveryWitnessPath` returns `false` for the
      unit's Task and spec in every lifecycle folder, every `.agents/loop-runs/*.jsonl`,
      `.agents/evals/lessons/**`, `.agents/evals/work-runs/**`, and `scripts/harness/*baseline*.json`,
      and `true` for `scripts/harness/example.mjs`, `packages/x/src/y.ts`, and another unit's Task.
- [ ] TC-02: Observable: over the TC-01 fixture with the checkpoint at HEAD, `findStagedFindings`
      returns `[]` with `scripts/harness/example.mjs` staged and `[]` with only a loop-ledger append
      staged (the binding judges a range, never a commit); the CLI spawned as a child with `cwd` =
      the fixture root and `--base <base>` exits 1 with exactly one stderr line containing
      `no delivery witness` and the checkpoint's nine-character prefix, and `::examined::` on stdout;
      spawned with `--staged` over the same repository it exits 0.
- [ ] TC-03: Observable: over a fixture whose base carries an `in-progress` pair with a `single`
      first checkpoint and whose branch carries only the exact four-path post-merge completion
      closeout (both records at `status: done`, Evidence Log ending in `[GATE-COMPLETE] — ✅ PASS`,
      Task `## Result` naming a pull request, a landed OID whose subject carries `(#N)`, and an
      issue-comment receipt), `findHistoryFindings(root, base)` returns `[]`; and on this repository
      `node scripts/harness/scan-user-execution-plan-order.mjs --base origin/develop` over the
      branch that carries this unit's checkpoint and implementation exits 0 with
      `::examined::` on stdout.
- [ ] TC-04: Commands: `rg -c 'A `single` declaration is bound to the topic range that carries its
    checkpoint' .agents/rules/backlog-execution.md` → `1`; `rg -c 'user-execution-plan-order'
    .agents/rules/backlog-execution.md` reports at least one match inside the § Pre-implementation
      planning checkpoint `Enforced by:` line (asserted by the isolated suite's owner-text case over
      the section body); `rg -c 'stays sealed' scripts/harness/scan-user-execution-plan-order.mjs` →
      `0` and `rg -c 'delivery witness' scripts/harness/scan-user-execution-plan-order.mjs` ≥ `1`;
      and the archived Task's `## Result` names how `MANIFEST-2664` completes — through the
      post-merge completion closeout after `PROC-2680`'s receipt — with the `Contained —
    PROC-2664.` notes in `VERIFIER-2664` described as historical, not edited.
- [ ] TC-05: Commands: `pnpm harness:test:hermetic`, `node scripts/harness/harness-test-tiers.mjs
    --tier contracts --affected --base-ref origin/develop --head-ref HEAD` (the isolated plan-order
      suite runs one file per invocation in this tier), `node
    scripts/harness/scan-harness-script-import-safety.mjs`, and `node
    scripts/harness/run-all-scans.mjs --affected --context pr --base origin/develop --skip dist
    --skip build-contracts` exit 0. No ESLint or dead-export gate covers `scripts/harness/*.mjs`;
      none is claimed.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                    | Notes                                                                 |
| ----- | ----------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| TC-01 | adversarial | Isolated plan-order suite; `make-temp.mjs` repositories            | Range refusal, padded planning-only range, witness, three exemptions  |
| TC-02 | regression  | Same suite: `findStagedFindings` + CLI child (`spawnSync`)         | A commit is never judged; CLI exit map and stderr line                |
| TC-03 | contract    | Same suite: closeout fixture; the scan over this unit's own branch | The recovery door stays open; self-application of the binding         |
| TC-04 | contract    | `rg` command-form checks; owner-text case in the isolated suite    | Rule sentence, `Enforced by:`, header note, archived Task `## Result` |
| TC-05 | suite       | Hermetic tier, contract tier runner, import safety, affected scans | Every path the CI `scans` job actually runs must exit 0               |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-05).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/PROC-2664-add-a-recovery-door-for-a-v2-single-delivery-checkpoint-merged-without-its-imple.md` — todo

## Evidence Log
