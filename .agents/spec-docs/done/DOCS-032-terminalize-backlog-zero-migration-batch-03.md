---
status: done
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-032: Terminalize backlog-zero migration batch 03

## Problem

At fixed population object `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`, five valid CLI backlog
records remain nonterminal on the integration branch. CLI-062 is delivered except for two
macOS/Korean-IME observations, and CLI-078, CLI-079, CLI-080, and CLI-081 remain valid product or
architecture work. CLI-081 already has an exact open GitHub owner; the other four units do not.

The current `origin/develop` base is `87579e423a9971c3de7cfb8ea2e2b59a9293f261`. All five Task blobs
are byte-identical between the fixed population and this base. PR #2439 has merged its unrelated
CORE-049 package work and append-only ledger rows; the open PR set is empty and it owned none of these
five units. No matching implementation branch, worktree, assignee, or loop reservation exists.
Leaving the Tasks open keeps the repository as a second durable queue after their exact GitHub owners
exist.

## Prior Art Research

Waived: RULE-017 and the registered `BACKLOG-ZERO-MIGRATION` class already selected the finite
manifest, exact readback, append-only handoff, and history-preserving terminalization mechanism. This
batch applies that mechanism to fixed repository records and makes no package, product, or policy
decision.

## Architecture Review

### Affected Scope

- Five Task lifecycle paths for CLI-062, CLI-078, CLI-079, CLI-080, and CLI-081.
- The paired DOCS-032 Task/spec and the two required loop ledgers.
- Append-only GitHub issue creation/comments and exact readback only.

CLI-034 is deliberately excluded: its obsolete-premise terminalization is neither complete delivery
nor an unfinished issue handoff and therefore needs a separately approved batch. Its Task, historical
done spec, HARNESS-096 carrier, and reference-kind baseline key remain byte-unchanged here. The
CLI-062 evaluation scenario also remains unchanged because evaluation evidence is outside this
class's named Task/spec/ledger/baseline set. No package/app source, public API/contract, package
documentation, product/user documentation, policy/gate rule, skill/workflow/hook, topology, baseline,
carrier, or product-direction change is in scope.

### Alternatives Considered

1. Leave the five Tasks open. Pro: no lifecycle edits. Con: preserves a second durable queue for work
   that can be owned exactly in GitHub.
2. Delete or bulk-mark all five done. Pro: smallest queue count. Con: destroys history and falsely
   claims delivery of macOS validation and four unresolved product/architecture decisions.
3. Revalidate each unit, create or reuse exact GitHub owners, append canonical handoffs, and
   terminalize the local Tasks as skipped. Pro: one durable queue with criterion-level evidence. Con:
   requires exact remote readback and preserves related carriers outside the class unchanged.

### Decision

Choose alternative 3. CLI-062, CLI-078, CLI-079, and CLI-080 receive exact new issues; CLI-081 returns
to its existing exact issue. Each Task cites one canonical handoff comment. CLI-034 and both factual
carriers remain for separately authorized ownership convergence.

This accepts exact remote readback and unchanged related carriers in exchange for canonical ownership
within the delegated class. It rejects destructive deletion, false completion, and a self-widened
approval boundary.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — five lifecycle documents and ledgers only
- [x] Sibling scan 완료 — all five units, fixed/current blobs, issues, PRs, branches, worktrees,
      reservations, delivery ancestry, and current implementation evidence checked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `87579e423a9971c3de7cfb8ea2e2b59a9293f261`.

Limits: 5 units; 9 final tracked paths. The `/tmp` survey is discovery-only. Every governed source blob
below is identical at the population object, base, and this branch. There are zero baseline rekeys and
zero baseline additions.

| Unit    | Original path(s) and blob OID(s)                                                                                                       | Current ownership and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Criterion-level disposition                                                                                                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI-062 | `.agents/tasks/CLI-062-cjk-cursor-positioning-disabled.md` @ `53654cb4767e4f516f0722ca6f1a3c797f619373`                                | Exact OPEN/unassigned issue #2442 with marker `backlog-zero:CLI-062:2c875dd3`. PR #1353 merge `65ad4372` delivered real-cursor positioning and PR #1435 merge `95cf8e15` automated the terminal matrix; both are base ancestors. Four focused files and 67 tests pass. Canonical handoff: https://github.com/woojubb/robota/issues/2442#issuecomment-5455751558.                                                                                                                          | Only Terminal.app and iTerm2 observations with macOS Korean IME remain, including the I5 default decision. Task `skipped`, returned to the cited handoff comment.                                                                                    |
| CLI-078 | `.agents/tasks/CLI-078-eval-command-outside-product-profile.md` @ `aa6c3650ca35cfea3a9adaf9b0e4e24393bbe99a`                           | Exact OPEN/unassigned issue #2443 with marker `backlog-zero:CLI-078:2c875dd3`. Current eval still constructs a default provider independently; runner collaborators are constructed before assembly and passed around its result. Issues #2044 and closed issue #2048 do not own this full seam. Canonical handoff: https://github.com/woojubb/robota/issues/2443#issuecomment-5455751753.                                                                                                | Decide folded output versus documented shell exception; align identity/construction order, seam claims, tests, and scenario. Task `skipped`, returned to the cited handoff comment.                                                                  |
| CLI-079 | `.agents/tasks/CLI-079-default-cli-composes-mode-command-spec-says-it-does-not.md` @ `528259610284a1acf65b2bb18419890f44da5a82`        | Exact OPEN/unassigned issue #2444 with marker `backlog-zero:CLI-079:2c875dd3`. Default modules still compose user-invocable `/mode`, while the agent-cli SPEC says the default CLI does not. Canonical handoff: https://github.com/woojubb/robota/issues/2444#issuecomment-5455751920.                                                                                                                                                                                                    | Make the product decision, align code/SPEC/architecture map, pin composition, and verify the shipped CLI. Task `skipped`, returned to the cited handoff comment.                                                                                     |
| CLI-080 | `.agents/tasks/CLI-080-composition-root-executor-exemption-wider-than-documented-rule.md` @ `098ac802d55d0fc3a1e80c23ad69d1c28ef3312c` | Exact OPEN/unassigned issue #2445 with marker `backlog-zero:CLI-080:2c875dd3`. The rule names one composition-root exemption; maps call the file a CLI host adapter, while the guard separately labels its free-text exemption “composition root — concrete worktree adapter wiring” without mechanically defining category membership. Closed issue #2048 and open issue #2319 are not owners. Canonical handoff: https://github.com/woojubb/robota/issues/2445#issuecomment-5455752113. | Resolve the normative/category/mechanical-definition gap by a named verifiable host-adapter category or contract relocation. Task `skipped`, returned to the cited handoff comment.                                                                  |
| CLI-081 | `.agents/tasks/CLI-081-flags-reach-the-model-as-appended-prompt-instructions.md` @ `acd63bec8fa2c6ce93a2b70fcda78c1006cd9be7`          | Exact OPEN/unassigned issue #2056. Prompt prose now reaches all three shells and is partly documented, but structured-option routing and scan coverage remain open. Canonical handoff: https://github.com/woojubb/robota/issues/2056#issuecomment-5455752323.                                                                                                                                                                                                                             | Preserve the issue's current broader scope: route the structured option across surfaces, define unsupported-provider behavior, remove prose, widen scan coverage, and verify a real scenario. Task `skipped`, returned to the cited handoff comment. |

Live ownership check: PR #2439 is merged, its append-only ledger rows are present in the current base,
and the open PR set is empty. No matching implementation branch, extra worktree, assignee, session, or
loop reservation exists. This branch is the sole migration owner and owns no implementation. Any
governed blob or unit ownership change excludes that unit and requires a fresh manifest approval.

Control issue #2441 is OPEN/unassigned and uniquely carries marker
`backlog-zero:DOCS-032:2c875dd3`; it owns this batch PR only. Parent issue #2404 remains open for later
batches and the preventive durable-queue mechanism.

### Baseline disposition

None of the five governed Tasks has an existing baseline path key. No baseline file changes.

## Solution

1. Commit this exact five-unit manifest, create and read back four continuation issues plus the
   DOCS-032 control issue, then append and read back five canonical unfinished-work handoff comments.
2. Record class approval only after exact issue/comment URLs, unchanged source ownership, the
   9-path ceiling, and zero baseline changes are independently proven.
3. Create the paired DOCS-032 planning checkpoint, then terminalize all five Tasks as skipped without
   deleting or rewriting historical evidence.
4. Run the declared verification against the final tree before completing DOCS-032.

## Affected Files

- `.agents/loop-runs/backlog-execution-orchestrator.jsonl`
- `.agents/loop-runs/user-execution-scenario.jsonl`
- `.agents/spec-docs/done/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`
- `.agents/tasks/completed/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`
- `.agents/tasks/completed/CLI-062-cjk-cursor-positioning-disabled.md`
- `.agents/tasks/completed/CLI-078-eval-command-outside-product-profile.md`
- `.agents/tasks/completed/CLI-079-default-cli-composes-mode-command-spec-says-it-does-not.md`
- `.agents/tasks/completed/CLI-080-composition-root-executor-exemption-wider-than-documented-rule.md`
- `.agents/tasks/completed/CLI-081-flags-reach-the-model-as-appended-prompt-instructions.md`

## Completion Criteria

- [x] TC-01: the committed manifest contains exactly five units, nine final tracked paths, all five
      governed blobs, current ownership, one disposition per unit, and zero baseline changes.
- [x] TC-02: four unique continuation issues, the exact existing issue #2056, five canonical handoff
      comments, and the DOCS-032 control issue are read back; every unfinished skipped Task cites its
      exact canonical comment URL.
- [x] TC-03: all five Tasks become skipped without deleting or rewriting historical evidence; the
      excluded CLI-034 Task and both factual carriers remain byte-unchanged.
- [x] TC-04: the exact final changed-path set contains only the five Task moves, paired DOCS-032
      Task/spec, and two append-only loop ledgers; no baseline, carrier, or package path changes.
- [x] TC-05: focused lifecycle/path/reference/delegation checks, `pnpm harness:scan`, and
      `pnpm harness:verify-like-ci` exit 0 on the final branch.

## Test Plan

| TC-ID | Test Type             | Tool / Approach                                                         | Notes                                                                                  |
| ----- | --------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| TC-01 | Agreement / manifest  | Git object/blob comparison, exact path set, unit/path count             | Test skipped: evidence audit observes five units, nine paths, and five governed blobs. |
| TC-02 | Agreement / remote    | Exact title/marker search and `gh api` issue/comment readback           | Test skipped: remote state is append-only control-plane evidence.                      |
| TC-03 | Agreement / lifecycle | Task archival and folder/status scanners plus preserved-blob comparison | Test skipped: existing scanners and blob comparison prove history preservation.        |
| TC-04 | Agreement / scope     | Exact changed-path inventory and excluded-path blob comparison          | Test skipped: exact diff and Git blobs prove the class boundary.                       |
| TC-05 | Agreement / CI        | Focused scanners, full harness scan, CI mirror                          | Test skipped: no new behavior; existing full gates verify atomic final placement.      |

## Tasks

- [x] `.agents/tasks/completed/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`

## User Execution Test Scenarios

Not applicable. This batch changes internal lifecycle evidence and remote queue ownership only. It
adds no runnable user-facing behavior.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — Mechanical criteria: 20/20 PASS; frontmatter, research waiver, architecture
  checklist, alternatives, five numbered criteria, matching Test Plan, Tasks placeholder, and the
  initially empty Evidence Log satisfy the L2 document contract.
- GATE-WRITE — Contains a concrete symptom: six fixed nonterminal CLI records preserve a duplicate
  durable queue, including one obsolete premise and five remotely trackable remainders.
- GATE-WRITE — Contains a reproduction condition: the fixed population and base OIDs, governed blob
  OIDs, open PR ownership, and absence of a competing branch, worktree, assignee, or reservation pin
  the condition to an inspectable tree state.
- GATE-WRITE — Research feeds Alternatives and Decision: the waived RULE-017 and registered-class
  mechanism directly supplies the finite manifest, exact readback, canonical handoff, and
  history-preserving terminalization selected by alternative 3.
- GATE-WRITE — Decision references the driving trade-off: exact remote readback and three narrow
  convergence edits are accepted in exchange for canonical ownership and preserved history, while
  deletion and false completion are rejected.
- GATE-WRITE — New-surface placement: N/A because the batch adds or reclassifies no package, app,
  presentation, interface, API, policy, workflow, topology, or product surface.
- GATE-WRITE — Criterion coverage: TC-01 through TC-05 independently cover the manifest, remote
  ownership, lifecycle terminalization, carrier/baseline convergence, and final verification.
- GATE-WRITE — Observable criterion form: every criterion names measurable counts, issue/comment
  readbacks, Task statuses and preservation conditions, exact carrier/key outcomes, or command exits.
- Mechanical judge: 20 PASS, 0 FAIL, 7 semantic criteria referred to the guardian.
- Guardian: all 7 semantic criteria PASS; `ACTIONABLE FINDINGS: 0`.

### [GUARDIAN RE-REVIEW: GATE-WRITE SCOPE CORRECTION] — ✅ PASS | 2026-08-29

**Status remains:** review-ready

- GATE-WRITE scope-correction re-review — Contains a concrete symptom: five fixed, valid CLI
  records remain nonterminal after their exact GitHub ownership can be established, preserving a
  duplicate durable queue.
- GATE-WRITE scope-correction re-review — Contains a reproduction condition: the fixed population
  and base OIDs, five unchanged Task blobs, open-PR ownership, and absence of a competing branch,
  worktree, assignee, or reservation identify the inspectable state.
- GATE-WRITE scope-correction re-review — Research feeds Alternatives and Decision: the waived
  RULE-017 and registered-class mechanism supplies the finite manifest, exact readback, canonical
  handoff, and history-preserving terminalization selected by alternative 3.
- GATE-WRITE scope-correction re-review — Decision references the driving trade-off: exact remote
  readback and unchanged related carriers are accepted for canonical ownership within the delegated
  class, while deletion, false completion, and a self-widened boundary are rejected.
- GATE-WRITE scope-correction re-review — New-surface placement: N/A because the narrowed batch adds
  or reclassifies no package, app, presentation, interface, API, policy, workflow, topology,
  baseline, carrier, or product surface.
- GATE-WRITE scope-correction re-review — Criterion coverage: TC-01 through TC-05 separately cover
  the five-unit manifest, remote ownership, lifecycle terminalization plus preserved exclusions,
  exact nine-path class boundary, and final verification.
- GATE-WRITE scope-correction re-review — Observable criterion form: all five criteria name exact
  counts, issue/comment readbacks, Task and blob preservation outcomes, a changed-path inventory, or
  command exits.
- Scope-correction guardian: all 7 semantic criteria PASS; `ACTIONABLE FINDINGS: 0`.

### [REMOTE-GROUNDING] — ✅ PASS | 2026-08-29

- Scope manifest commit: `b1c33a0f58`; exact remote-grounded manifest commit:
  `db5fcd8365209e667e849e20a852551144d240a4`.
- Control issue #2441 and continuation issues #2442, #2443, #2444, and #2445 are OPEN,
  unassigned, and uniquely match their committed `backlog-zero:*:2c875dd3` markers.
- Existing issue #2056 remains OPEN and unassigned; parent issue #2404 remains OPEN.
- The five canonical handoff comments were read back at the exact URLs in the manifest. Each contains
  the decision, current evidence, remaining criteria, dependencies and resumption instructions,
  original Task path/blob provenance, fixed population object, and migration owner issue #2441.
- All five source Task blobs remain identical at the population object, current `origin/develop`
  `87579e423a9971c3de7cfb8ea2e2b59a9293f261`, and committed HEAD. The open PR set, competing branch,
  extra worktree, and loop reservation sets are empty.
- Independent exact readback: `ACTIONABLE FINDINGS: 0`.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `CLASS`
**Class:** `BACKLOG-ZERO-MIGRATION`
**Instruction (verbatim):** "DOCS-029 승인함. BACKLOG-ZERO-MIGRATION 클래스를 등록하고, 2026-08-28 기준 기존 backlog를 GitHub issue로 이관하거나 이미 전달된 기록을 종결하는 문서 전용 배치를 자동 승인하도록 위임함. 패키지 소스/API/정책 변경은 제외."
**Given:** 2026-08-28, this conversation
**Evidence condition met:** Committed five-unit/nine-path manifest b1c33a0f58; exact remote-grounded manifest db5fcd8365 and evidence commit 65380e38c2; issues #2441-#2445 and #2056 OPEN/unassigned; five exact handoffs; five unchanged Task blobs; zero baseline, carrier, package, API, policy, workflow, topology, or product/user-document changes; independent ACTIONABLE FINDINGS: 0.
**Review fingerprint:** 9ffc24a011c0 (review ec0cf59b, type/tags a0d6c0d0)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (Committed five-unit/nine-path manifest b1c33a0f58; exact rem)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (9ffc24a011c0) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A;
  route `CLASS` is the selected exclusive route, so the Route DIRECT semantic criterion does not
  apply.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS; the manifest owns
  five fixed-population Task handoffs and nine final lifecycle/ledger paths, stays below the six-unit
  and fifteen-path limits, and changes no package/app source, API/contract, policy/gate document,
  skill/workflow/hook/topology, baseline, carrier, or product/user documentation.
- GATE-APPROVAL — Independent architecture validation: N/A; the narrowed batch adds or reclassifies
  no package, app, presentation/interface surface, layer, or product-family boundary.
- Guardian: all 3 pending semantic criteria resolved (1 PASS, 2 N/A); `ACTIONABLE FINDINGS: 0`.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 434 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/
- Planning checkpoint binding: `.agents/tasks/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`;
  `.agents/spec-docs/active/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`;
  `SCENARIO DRAFTED: not-applicable | 0`; whole-worktree inventory limited to the exact Task/spec pair
  and loop ledger.

### [GATE-VERIFY] — ✅ PASS | 2026-08-29

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29; status `in-progress`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 5/5 tasks `[x]` in .agents/tasks/DOCS-032-terminalize-backlog-zero-migration-batch-03.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `pnpm --filter @robota-sdk/agent-transport-tui build` → exit 0 (ℹ [ESM] dist/node/index.d.ts 21.91 kB │ gzip: 6.81 kB ⏎ ℹ [ESM] 4 files, total: 508.18 kB ⏎ ✔ Build complete in 945ms); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm --filter @robota-sdk/agent-transport-tui test -- src/__tests__/terminal-capabilities.test.ts src/flows/__tests__/real-cursor-flow.test.ts src/__tests__/cjk-fallback-render.test.tsx src/__tests__/real-cursor-positioning.test.tsx` → exit 0 ( ⏎ 2:50:02 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead. ⏎ [?25h); all 2 supplied commands exit 0

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-29

**Test skipped:** Agreement evidence: independent audit observed five units, nine projected final paths, five unchanged source blobs, and zero baseline changes.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-29

**Test skipped:** Remote control-plane evidence: issues #2441-#2445 and #2056 plus all five canonical comments were read back OPEN, unassigned, unique, and exact.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-29

**Test skipped:** Lifecycle evidence: all five Tasks differ only in permitted terminal frontmatter; excluded CLI-034 and carriers remain byte-unchanged.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-29

**Test skipped:** Scope evidence: exact final projection is five Task paths, paired DOCS-032 Task/spec, and two ledgers; no baseline, carrier, or package path.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-29

**Test skipped:** No product behavior changed. Focused pre-completion checks passed; pnpm harness:scan and pnpm harness:verify-like-ci are reserved for and must pass against the atomic final Task/spec placement.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-29

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-08-29; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (5)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 5/5 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (5) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 5/5 tasks `[x]` in .agents/tasks/DOCS-032-terminalize-backlog-zero-migration-batch-03.md

### [FINAL-PLACEMENT-VERIFY] — ✅ PASS | 2026-08-29

- `pnpm harness:scan` passed the atomic final placement: 145 scans passed and 3 declared scans
  skipped.
- `pnpm harness:verify-like-ci` passed all 13 locally reproducible CI stages against the final
  worktree: 185 contract-test files and 4,220 tests passed; formatting, commit-message checks,
  dist-free and built-tree scans, affected verification, lint (`0` errors; the existing warning
  ceiling), and workspace typechecking all passed.
- The first CI-equivalent attempt reached the workspace typecheck with declarations left stale by
  the newly merged base change in PR #2439. `pnpm build` regenerated the workspace declarations and
  passed; `pnpm -w typecheck` then passed, and the clean rerun of `pnpm harness:verify-like-ci`
  passed all 13 stages in 3m 23.4s. No package or application source was changed to obtain the pass.
- The affected product-behaviour evidence remains the focused TUI build plus the four named
  CLI-062 test files (67 tests), all passing. The other four units are exact issue handoffs and do
  not change runtime behaviour.
