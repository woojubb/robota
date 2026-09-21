---
status: approved
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
`active/` specs whose first PASS declares `single`, ten are `AGREEMENT` units whose checkpoint PR
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
basename)`: true for every path that is not (1) the unit's own Task/spec pair in any lifecycle
  folder, (2) a loop ledger (`.agents/loop-runs/*.jsonl`), (3) a lessons or work-run record under
  `.agents/evals/`, (4) a harness baseline (`scripts/harness/*baseline*.json`), (5) a repository
  memory file (`.agents/memory/**`, which memory-mirroring writes as a routine planning-adjacent
  side effect), or (6) another unit's pre-checkpoint planning record — a Task at the `.agents/tasks/`
  root or a spec under `draft/`, `backlog/`, or `todo/` (the vocabulary
  `isPreCheckpointPlanningPath` already owns), because filing a root item discovered while planning
  is a planning act. Items (1)–(4) are the inventory PR #2792 carried; (5) and (6) are the two
  planning-adjacent classes the proposal review found that inventory missing. Another unit's
  `active/` spec, archived records under `completed/` and `done/`, and every other path remain
  witnesses.
- `scripts/harness/scan-user-execution-plan-order.mjs` — `singleHistoryAnalysis` returns
  `checkpoint.delivery = { mode, witnessed }`. `mode` is read through `checkpointDelivery(contract,
spec)` from `checkpoint-evidence-source.mjs` over the spec at the checkpoint commit — the same
  reader the checkpoint validator binds the payload to — not through a second parser in the scan; a
  legacy v1 checkpoint has no delivery declaration and yields `mode: null` by that reader's own
  failure result, and a v2 checkpoint that validated but whose mode the reader cannot return is a
  finding, never `null`. `witnessed` folds `isDeliveryWitnessPath` over the entries after the
  checkpoint. One new range reader, `rangeAnalysis(root, base)` = `historyAnalysis` plus the
  delivery finding, is the single emit site consumed by `findHistoryFindings`,
  `readExaminedPlanOrderCount`, and the CLI's range branch; `findStagedFindings` keeps calling
  `historyAnalysis` and never sees the finding: a commit is not a range. The finding text is
  `single-delivery checkpoint \`<basename>\` reaches the end of the range with no delivery witness
  after <checkpoint sha>: push the implementation with the checkpoint, or declare sequenced delivery
  with continuation artifacts`, attached to the checkpoint commit, emitted when `mode === 'single'`,
`witnessed === false`, the form is `first`, and the unit is not an AGREEMENT pair at the checkpoint
commit — judged by one predicate, `isAgreementPairAt(root, commit, basename)`, extracted from the
test `integrationHistoryAnalysis`already performs (Task`children`non-empty and unique, spec
frontmatter`type: AGREEMENT`) so the scan keeps one definition of an AGREEMENT pair. The header
  comment's "stays sealed" residual note is rewritten to name the binding.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — the isolated suite gains the
  range, commit, closeout, and exemption cases (TC-01..TC-03).
- `.agents/rules/backlog-execution.md` § Pre-implementation planning checkpoint — one sentence
  stating the binding and its `Enforced by:` line (an L2 path; this unit is L2 for it).
- `.agents/tasks/PROC-2664-…imple.md` § Plan — five items mirroring TC-01..TC-05; `depends_on`
  cleared, because building the binding does not wait on `PROC-2680` (only `MANIFEST-2664`'s own
  closeout does).

No new scan, workflow, ruleset, hook, gate form, contract version, or `run-all-scans.mjs` change:
the `user-execution-plan-order` entry is already `always: true`, so CI's required `scans` job (the
`harness:scan --affected --context pr --base <base>` invocation) judges every pull request's range,
and a manual `pnpm harness:scan` judges it locally. The pre-push gate runs no range scan
(`pre-push-ci-mirror.mjs` executes no commands since LOCAL-2655; the push runs `harness:plan` and
the format check only), so the finding first fires in CI; whether the local pre-push should re-run
range scans is LOCAL-2655's decision and is not changed here.

### Alternatives Considered

1. Bind the declaration where the range is judged: the plan-order history scan emits a finding when a
   `single` first checkpoint reaches the end of the topic range with no delivery witness (this
   document).
   - Pro: the range is the only object that has the pull request's shape, and this scan is the one
     reader that already replays it; the judgement reaches CI's required `scans` check and, through
     checks-green, the merge gate, and any manual `pnpm harness:scan`; a commit-time judgement stays
     impossible, so the dedicated checkpoint commit keeps its planning-only form.
   - Con: the finding first fires in CI, after the checkpoint has reached the remote branch (the
     pre-push gate runs no range scan); a planning-only push of a `single` unit is refused outright,
     so a unit that wants a planning-only pull request must declare `sequenced` and name its
     artifacts — which is the declaration's meaning.
2. Refuse at the merge gate (`merge-gate.sh`) by reading the pull request's file list through `gh`.
   - Pro: the pull request is the literal object the declaration should match.
   - Con: a hook is an L2 policy file with no test harness of its own, it reads a live API the scan
     does not need, and it runs after CI has already spent a cycle on a pull request that cannot
     merge; the checkpoint would also reach the remote branch before refusal, as under 1.
3. Add a v2 `single` → `sequenced` correction form (a fifth checkpoint form) and leave the
   declaration unreconciled.
   - Pro: recovers a sealed unit through the existing correction and continuation machinery.
   - Con: `finding-depth-triager` named this the fourth repetition of the same move (HARNESS-131,
     PROC-029, PROC-031, issue #2774); it recovers the symptom without preventing it, and the one
     sealed instance no longer needs a form — its implementation landed in PR #2805 and its records
     close through the existing post-merge completion closeout once `PROC-2680` provides a receipt
     for a merge-commit landing.
4. Bind `single` to the unit's terminal state instead of a path witness: the range must also carry
   the archive to `done/` with a GATE-COMPLETE PASS.
   - Pro: a stronger witness with no path heuristic — the unit is complete or it is not.
   - Con: the repository deliberately admits archiving after landing (`postMergeCompletionPaths`,
     the post-merge completion closeout), so this would refuse an admitted flow and re-seal every
     unit that lands first and archives second.

### Decision

Choose alternative 1. The `single` declaration in a v2 first PASS is bound to the topic range that
carries the checkpoint: `singleHistoryAnalysis` returns `checkpoint.delivery = { mode, witnessed }`,
and the one range reader `rangeAnalysis` (hence `findHistoryFindings`, the CLI without `--staged`,
CI's `scans` job, and a manual `pnpm harness:scan`) emits one finding, attached to the checkpoint
commit, when the mode is `single`, no commit after the checkpoint changes a delivery-witness path,
the form is `first`, and the unit is not an AGREEMENT pair at the checkpoint commit (whose delivery
is its children's merges and final pull request, not a path its own checkpoint pull request can
carry; the AGREEMENT's checkpoint pull request into `develop` is judged by `singleHistoryAnalysis`,
so the exemption must live there and reuses the one AGREEMENT-pair predicate). A delivery witness is
any changed path outside the six-item negative list in Affected Scope — PR #2792's inventory plus
the two planning-adjacent classes the review added (repository memory; another unit's
pre-checkpoint planning record). The list is a deliberate asymmetry, stated rather than hidden: a
baseline row or a memory note is implementation-class for the prelude question (it may not precede
a checkpoint) and is not a witness for the delivery question (it does not prove one), because each
test must be conservative in the opposite direction. The witness is not the spec's
`## Affected Files` (an ungated section that `AGREEMENT` specs omit), not a lane floor (a
documentation-delivering L2 unit would sit at L0), and not the terminal state (alternative 4). The
negative list is a closed set this unit owns; a path class it misses is a finding against this
list, not a reason to widen it silently. `sequenced` first checkpoints, continuation and correction
forms, legacy v1 payloads, and L1 units are untouched: their doors already exist and are not this
finding's subject. The staged path is untouched: the checkpoint commit stays planning-only, and the
implementation commit that follows it is admitted exactly as today. The integration-agreement
composite analysis (`integrationHistoryAnalysis`) is out of scope and unchanged; a child branch
into an integration base is judged by that path and, per issue #2804, receives no CI today.

The sealed instance is recovered by no new form. `MANIFEST-2664`'s implementation is on `develop`
(`79698d78d`), so what remains is its record closeout: the post-merge completion closeout the scan
already admits (exact four-path archive at `status: done`, Evidence Log ending in a GATE-COMPLETE
PASS, Task `## Result` naming the delivering pull request, its landing OID, and an issue-comment
receipt). This unit proves that range stays admitted under the binding (TC-03); the receipt for a
merge-commit landing is `PROC-2680`'s deliverable, and `MANIFEST-2664` closes after it lands. This
unit's own delivery is one pull request carrying its checkpoint and its implementation, so it is the
first range the binding judges for real (TC-03).

Validated recommendation:

- Reachability: every pull request into `develop` runs
  `harness:scan --affected --context pr --base <base>`, whose `user-execution-plan-order` entry is
  `always: true`; the finding therefore reaches the required `scans` check and, through
  checks-green, the merge gate. Locally the same command is a manual `pnpm harness:scan`; the
  pre-push gate does not run it (LOCAL-2655).
- Capability preservation: the `single` and `sequenced` semantics, the three v2 forms, the v1
  contract, the staged checkpoint transition, the L0 ground, the documentation batch, the atomic
  AGREEMENT prelude, and the post-merge completion closeout are unchanged; the existing suite is the
  control.
- Adversarial pass: a planning-only push padded with a ledger append, a lessons file, a baseline
  row, a memory note, or a newly filed root item is still refused (those are on the negative list);
  a v2 checkpoint whose delivery mode the shared reader cannot return is a finding, not a silent
  `null`; a push that carries the implementation in a later commit of the same range is admitted; a
  `sequenced` planning-only pull request is admitted (its continuation door governs); an `AGREEMENT`
  prelude is admitted; the closeout range carries no first checkpoint and is admitted; a `--staged`
  run never emits the finding; the CLI exit map is unchanged (1 on any finding). Known edge, owned
  by the list: an L2 `single` unit whose entire delivery is edits to other units' root Tasks would
  be judged unwitnessed under item (6); no such unit reaches a first PASS today (a Task-only diff
  is L0 and has no spec), so the edge is recorded here rather than carved out.

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

Two declared, both fail-closed toward the binding, neither a silent path:

1. A spec whose frontmatter `type` (or whose Task's `children`) cannot be read at the checkpoint
   commit is judged as a non-AGREEMENT unit, so the binding applies; the exemption is granted only on
   a positive read. This is the conservative direction — an unreadable record cannot buy an
   exemption — and the one site is annotated
   `// allow-fallback: unreadable AGREEMENT identity applies the binding`.
2. A legacy v1 first PASS has no delivery declaration; `checkpointDelivery` returns its failure
   result and the scan records `mode: null`, under which the binding does not apply — the v1 doors
   (PROC-031) govern those units. A v2 first PASS that validated but whose mode the same reader
   cannot return is a finding (`single-delivery binding could not read the delivery mode of
\`<basename>\``), never `null`; the one site is annotated
`// allow-fallback: legacy v1 has no delivery declaration by contract`.

## Solution

1. `scripts/harness/plan-order-records.mjs`: export `isDeliveryWitnessPath(file, basename)` beside
   `isPreCheckpointPlanningPath`, with the six-item negative list stated in Affected Scope.
2. `scripts/harness/scan-user-execution-plan-order.mjs`: extract
   `isAgreementPairAt(root, commit, basename)` from `integrationHistoryAnalysis` and reuse it; in
   `singleHistoryAnalysis`, read the mode through `checkpointDelivery` over the spec at the
   checkpoint commit, fold `witnessed` over the entries after the checkpoint, and return
   `checkpoint.delivery`; add `rangeAnalysis(root, base)` as the single emit site and route
   `findHistoryFindings`, `readExaminedPlanOrderCount`, and the CLI's range branch through it;
   rewrite the header residual note.
3. `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`: the fixtures and cases of
   TC-01..TC-03, red before step 2 and green after it.
4. `.agents/rules/backlog-execution.md` § Pre-implementation planning checkpoint: the binding
   sentence and its `Enforced by:` line.
5. `.agents/tasks/PROC-2664-…imple.md` § Plan: five items mirroring TC-01..TC-05 and `depends_on`
   cleared (a planning edit, committed before the checkpoint).

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
      checkpoint is the range's last commit; the same single finding when it is followed only by a
      loop-ledger append, an `.agents/evals/lessons/auto-lessons.md` edit, and a
      `scripts/harness/reference-kind-baseline.json` row; the same single finding when it is followed
      only by `.agents/memory/MEMORY.md` and a newly filed `todo` Task of another unit; `[]` when one
      later commit changes `scripts/harness/example.mjs`; `[]` for a `sequenced` first checkpoint
      alone; `[]` for an `AGREEMENT`-typed spec's `single` checkpoint alone; an unchanged result for
      an L1 PLAN commit; an unchanged result for a legacy v1 first PASS whose spec today carries a
      Delivery mode line declaring `single` (the contract is selected by the entry's own marker, as
      the validator selects it, so the v1 entry reaches the reader's failure result and `mode: null`,
      not a binding); a finding naming the basename and containing `could not read the delivery mode`
      for a v2 checkpoint whose Delivery mode line was removed after the PASS; and
      `isDeliveryWitnessPath` returns `false` for the unit's Task and spec in every lifecycle folder,
      every `.agents/loop-runs/*.jsonl`, every path under `.agents/evals/lessons/` and
      `.agents/evals/work-runs/`, every `scripts/harness/` JSON file whose name contains `baseline`,
      every path under `.agents/memory/`, another unit's root Task, and another unit's `draft/`,
      `backlog/`, and `todo/` spec, and `true` for `scripts/harness/example.mjs`,
      `packages/x/src/y.ts`, another unit's `active/` spec, and another unit's `completed/` Task.
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

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes a repository-internal planning-checkpoint gate — two harness modules under
`scripts/harness/`, their isolated suite, and one rule sentence under `.agents/rules/`; every
affected path is under `scripts/harness/` or `.agents/`, and it exposes no Robota CLI, TUI, browser,
SDK, configuration, or installed-package surface an end user can execute. The finding it adds is the
terminal artifact, reached by CI's `scans` job and a manual `pnpm harness:scan`.

## Tasks

- [ ] `.agents/tasks/PROC-2664-add-a-recovery-door-for-a-v2-single-delivery-checkpoint-merged-without-its-imple.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-22

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: entry gate, no prior gate required; `status: draft` in frontmatter, file under `draft/`, `## Evidence Log` empty before this entry — input state matches.
- GATE-WRITE — Frontmatter (4 mechanical): `---` block, `status: draft`, `type: INFRA` (one of 11), `tags: [harness, process]` — all PASS per `gate.mjs judge --dry-run` (20 PASS / 0 FAIL / 7 PENDING-GUARDIAN), re-run at this HEAD.
- GATE-WRITE — Contains a concrete symptom: `## Problem` names three refusal sites and their literal finding strings — `gate-checkpoint-evidence.mjs:86` "prior v2 delivery does not bind the current Decision contract", `gate-implement-correction-validation.mjs:26` (legacy v1 only), `scan-user-execution-plan-order.mjs:3338` "staged implementation has no planning checkpoint ancestor" — each verified present in the cited file; the sealed instance is named by commit (`e7025ca96` = MANIFEST-2664 checkpoint, `f185015f7` = merge of PR #2792, `79698d78d` = merge of PR #2805), all resolvable in this tree, and `git diff --stat f185015f7^ f185015f7` shows exactly the pair + three `loop-runs` ledgers + one `reference-kind-baseline.json` row the Problem claims.
- GATE-WRITE — Contains a reproduction condition: two dated reproductions with their inputs and observed refusals (2026-09-21 from `f185015f7`, `--staged` with an implementation path; 2026-09-22 from `4543cf56d`, a `## Result` append to the `in-progress` Task), plus the general condition (a v2 `single` first checkpoint pushed and merged alone, then any later branch). The 21/10/1 measurement on `origin/develop@d5b4389f9` reproduced: 21 `active/` specs carry `"deliveryMode": "single"`, 10 of them `type: AGREEMENT`. Triager run `r20260921144518` exists in `.agents/loop-runs/backlog-execution-orchestrator.jsonl`.
- GATE-WRITE — Does not contain TBD/TODO: PASS (mechanical).
- GATE-WRITE — Prior Art Research present / substantiated-or-waived (3 mechanical): PASS — `Waived:` line with a reason (repository-internal checkpoint contract; closeout-receipt half owned by PROC-2680).
- GATE-WRITE — Research findings feed Alternatives/Decision: external findings N/A under the recorded waiver; the recommendation is evidence-based, not asserted — alternative 1 rests on the scan being the one reader that replays the range (`historyAnalysis`/`findHistoryFindings`/`readExaminedPlanOrderCount` at `scan-user-execution-plan-order.mjs:3001-3023`, verified) and on `run-all-scans.mjs:658-660` (`user-execution-plan-order`, `always: true`, verified); alternative 3's rejection cites the triager's "fourth repetition" finding; alternative 4's rejection cites `postMergeCompletionPaths` (line 1799, verified); the six-item negative list is derived from the measured PR #2792 inventory plus the two classes the proposal review added.
- GATE-WRITE — Architecture Review Checklist (3 mechanical: 4 items `[x]`, sibling scan with evidence, ≥2 alternatives with pro/con): PASS — 5/5 `[x]`, sibling scan lists the five v2-first-PASS readers inspected on 2026-09-22, 4 alternatives each with Pro and Con.
- GATE-WRITE — Decision references the trade-off: yes — it accepts alternative 1's own Con (the finding first fires in CI because `pre-push-ci-mirror.mjs` executes no commands since LOCAL-2655, verified at line 3; a planning-only `single` push is refused outright), states the negative-list asymmetry against `isPreCheckpointPlanningPath` as deliberate ("each test must be conservative in the opposite direction"), rejects alternative 4 for refusing the admitted post-merge closeout, and records a known edge (item 6, Task-only L2 delivery) rather than carving it out.
- GATE-WRITE — New-surface placement (conditional): N/A with reason — no new package, app, scan, workflow, hook, gate form, or contract version; the one new export `isDeliveryWitnessPath` sits in `plan-order-records.mjs`, which already owns `isPreCheckpointPlanningPath` (line 129, verified); `rangeAnalysis` and `isAgreementPairAt` are internal to the existing scan, the latter extracted from the AGREEMENT-pair test `integrationHistoryAnalysis` already performs (children list + `type: AGREEMENT`, lines ~2877-2884, verified). Checklist item 5 records the N/A explicitly.
- GATE-WRITE — Every item has a TC-N prefix: PASS (mechanical) — TC-01..TC-05.
- GATE-WRITE — At least 1 criterion per distinct feature/sub-item: Solution steps 1-2 (predicate; delivery reader via `checkpointDelivery`, `witnessed` fold, `rangeAnalysis` as single emit site, AGREEMENT exemption, mode-unreadable finding) → TC-01; staged path untouched + CLI exit map/stderr/`::examined::` → TC-02; post-merge closeout still admitted + self-application over this branch → TC-03; step 4 rule sentence + `Enforced by:` and the header residual-note rewrite → TC-04; suite/tier/import-safety/affected-scans gates → TC-05. Step 5 (Task § Plan mirror, `depends_on` cleared) is a planning-record edit judged by GATE-IMPLEMENT's Task criterion, not a deliverable feature; no feature is without a TC.
- GATE-WRITE — Each criterion uses Command or Observable form: TC-01/TC-02/TC-03 are `Observable:` with named function inputs and exact outputs (`[]`, exactly one finding with named `problem` substrings and `commit`, exit 0/1, one stderr line); TC-04/TC-05 are `Commands:` with `rg -c` counts and exit-0 invocations. TC-01's v1 expectation (`mode: null` even when the spec carries a `**Delivery mode:**` line) matches `checkpoint-evidence-source.mjs:201` (`!contract.decisionDelivery` → failure). Observation, not a failure: TC-01 and Affected Scope carry formatter-damaged inline code spans (e.g. `_baseline_.json`, `` `single``line ``) that read unambiguously but should be tidied before implementation.
- GATE-WRITE — No banned phrases: PASS (mechanical).
- GATE-WRITE — Test Plan (4 mechanical): present; 5 rows = 5 TC-N (count matches); every row has Test Type and Tool; 0 manual rows.
- GATE-WRITE — Structure (3 mechanical): `## Tasks` present with the paired Task path (file exists); `## Evidence Log` present and empty on this first run; no `## Status`/`## Classification` body sections.

**Judged at:** HEAD `63a1a5ba421e99b5354d39ee4fd3d8d9f417c100` · base `origin/develop@d5b4389f91e0be868e25c1d6cb00698316e062c1` · document `.agents/spec-docs/draft/PROC-2664-add-a-recovery-door-for-a-v2-single-delivery-checkpoint-merged-without-its-imple.md` blob `1123b92a2bf273467cb635da631724de762d2424` (tracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "PROC-2664 설계안을 승인합니다."
**Given:** 2026-09-22, this conversation
**Review fingerprint:** 4206a6ab42fe (review abf3d847, type/tags 75a55883)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (4206a6ab42fe) equals the document's current fingerprint
- GATE-APPROVAL — Ordering check (guardian): prior gate GATE-WRITE has a `✅ PASS | 2026-09-22` entry whose `**Status upgrade:** draft → review-ready` matches the document's current `status: review-ready` (the row's `recorded-pass` rule; it is also the only GATE-WRITE entry, so the last-entry rule would agree), and the file sits under `.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § Spec-Document Status and Lifecycle Folders maps to `review-ready`. No work this gate authorizes has already happened: `git diff --stat origin/develop...HEAD` lists only this spec, its paired Task, and two `.agents/loop-runs/*.jsonl` ledgers; `isDeliveryWitnessPath` occurs 0 times in `plan-order-records.mjs` and in `scan-user-execution-plan-order.mjs`; the worktree's only other modifications are the two auto-generated lessons files. `gate.mjs judge --gate GATE-APPROVAL --dry-run` re-run at this HEAD reproduces the mechanical set (6 PASS / 0 FAIL / 3 PENDING-GUARDIAN) and recomputes `**Review fingerprint:**` 4206a6ab42fe equal on the current text.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: the recorded instruction "PROC-2664 설계안을 승인합니다." names this document's ID (`PROC-2664` is carried by exactly one spec document under `.agents/spec-docs/` — `find .agents/spec-docs -name "PROC-2664*"` returns this file alone) and its object ("설계안", the design proposal) with an unconditional approval verb ("승인합니다") — the catalogue's "승인" form, not a clarifying-question answer, not silence, not a different item's approval. The orchestrator reports it as typed verbatim by the owner in this document's own conversation on 2026-09-22 (`**Given:** 2026-09-22, this conversation`), and it names no category of items, so DIRECT is the correct route. Relay check: the exact string occurs in exactly one place in the tree — the `**Instruction (verbatim):**` field `gate.mjs approve` wrote in this entry — so it is not reported by another session, agent, or document. Boundary recorded rather than overclaimed: the tree rules out the relay mode but cannot itself witness the utterance; that limit is inherent to Route DIRECT. `scan-standing-delegation-evidence` over the tree containing this entry: 408 approved documents examined, 0 findings, exit 0.
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry argues for: N/A — the entry records `**Approval route:** `DIRECT`` and names no class, so there is no class boundary to read the item against. Checked rather than assumed that no registered class would have applied: `backlog-execution.md` § Delegated Approval Classes holds two rows — `LANE-L0-L1` (this document declares `lane: L2` at frontmatter line 5) and `BACKLOG-ZERO-MIGRATION` (documentation-only terminalization of a fixed legacy population; this spec changes two `scripts/harness/*.mjs` modules and their suite).
- GATE-APPROVAL — Independent architecture validation (conditional): trigger not met, verified against the tree rather than the document's own claim — no new package, app, scan, workflow, hook, gate form, or contract version; the five `## Affected Files` all exist today; the one new export `isDeliveryWitnessPath` is placed in `scripts/harness/plan-order-records.mjs`, which already exports `isPreCheckpointPlanningPath` (the sibling vocabulary it reuses); `rangeAnalysis` and `isAgreementPairAt` are internal to the existing scan, the latter extracted from `integrationHistoryAnalysis` (present, 1 definition); the scan is already registered in `run-all-scans.mjs:658-660` with `always: true`, so no registry changes. Checklist item 5 records the N/A explicitly. Independent review nonetheless exists and is recorded, not self-claimed: the paired Task's `## Finding Evidence` records `proposal-reviewer` `REVIEW VERDICT: REVISE` at `6258dd693` (six findings, including the witness-list gaps, a second delivery-mode parser, two emit sites, and a third AGREEMENT predicate — i.e. where each piece lives) and `REVIEW VERDICT: ENDORSE` at `fdd13b3e0` after all six were applied, under orchestrator run `r20260921153105`, which exists in `.agents/loop-runs/backlog-execution-orchestrator.jsonl` with `ref` = this pair. Post-ENDORSE change inspected: `git diff -M fdd13b3e0 HEAD -- .agents/spec-docs` shows the `status` flip, one "Known edge" sentence appended to the Decision's adversarial pass (an edge recorded, not a placement change), a TC-01 rewording of the same cases, and the scenario section's `SCENARIO DRAFTED` form; `### Affected Scope` and `### Alternatives Considered` are byte-identical, so the endorsed placement is the placement approved.
- GATE-APPROVAL — Guardian tree binding: judged at HEAD `60743b06b578` · base `origin/develop@1c02d9777d54` · document blob `d930b8d4a720` (modified — HEAD blob `019b8db6d48f` plus the uncommitted `approve` entry above, hashed before these lines were appended).

**Judged by:** `backlog-gate-guard` — semantic set (ordering check, "Approval is a direct, unambiguous statement directed at this spec document", "The item is inside the class as the registry defines it", "Independent architecture validation (conditional)")
**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `60743b06b578` · base `origin/develop@1c02d9777d54` · document `.agents/spec-docs/backlog/PROC-2664-add-a-recovery-door-for-a-v2-single-delivery-checkpoint-merged-without-its-imple.md` blob `019b8db6d48f` (tracked)
