---
status: review-ready
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

| Unit    | Original path(s) and blob OID(s)                                                                                                       | Current ownership and evidence                                                                                                                                                                                                                                                                                                                                                | Criterion-level disposition                                                                                                                                                                                                                                      |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI-062 | `.agents/tasks/CLI-062-cjk-cursor-positioning-disabled.md` @ `53654cb4767e4f516f0722ca6f1a3c797f619373`                                | PR #1353 merge `65ad4372` delivered real-cursor positioning and PR #1435 merge `95cf8e15` automated the terminal matrix; both are base ancestors. Four focused files and 67 tests pass. Exact continuation issue marker planned: `backlog-zero:CLI-062:2c875dd3`.                                                                                                             | Only Terminal.app and iTerm2 observations with macOS Korean IME remain, including the I5 default decision. Task `skipped`, returned to the exact handoff comment after readback.                                                                                 |
| CLI-078 | `.agents/tasks/CLI-078-eval-command-outside-product-profile.md` @ `aa6c3650ca35cfea3a9adaf9b0e4e24393bbe99a`                           | Current eval still constructs a default provider independently; runner collaborators are constructed before assembly and passed around its result. Issues #2044 and closed issue #2048 do not own this full seam. Exact issue marker planned: `backlog-zero:CLI-078:2c875dd3`.                                                                                                | Decide folded output versus documented shell exception; align identity/construction order, seam claims, tests, and scenario. Task `skipped`, returned to the exact new issue handoff comment.                                                                    |
| CLI-079 | `.agents/tasks/CLI-079-default-cli-composes-mode-command-spec-says-it-does-not.md` @ `528259610284a1acf65b2bb18419890f44da5a82`        | Default modules still compose user-invocable `/mode`, while the agent-cli SPEC says the default CLI does not; no exact issue or competing owner exists. Exact issue marker planned: `backlog-zero:CLI-079:2c875dd3`.                                                                                                                                                          | Make the product decision, align code/SPEC/architecture map, pin composition, and verify the shipped CLI. Task `skipped`, returned to the exact new issue handoff comment.                                                                                       |
| CLI-080 | `.agents/tasks/CLI-080-composition-root-executor-exemption-wider-than-documented-rule.md` @ `098ac802d55d0fc3a1e80c23ad69d1c28ef3312c` | The rule names one composition-root exemption; maps call the file a CLI host adapter, while the guard separately labels its free-text exemption “composition root — concrete worktree adapter wiring” without mechanically defining category membership. Closed issue #2048 and open issue #2319 are not owners. Exact issue marker planned: `backlog-zero:CLI-080:2c875dd3`. | Resolve the normative/category/mechanical-definition gap by a named verifiable host-adapter category or contract relocation. Task `skipped`, returned to the exact new issue handoff comment.                                                                    |
| CLI-081 | `.agents/tasks/CLI-081-flags-reach-the-model-as-appended-prompt-instructions.md` @ `acd63bec8fa2c6ce93a2b70fcda78c1006cd9be7`          | Exact OPEN/unassigned issue #2056. Prompt prose now reaches all three shells and is partly documented, but structured-option routing and scan coverage remain open.                                                                                                                                                                                                           | Preserve the issue's current broader scope: route the structured option across surfaces, define unsupported-provider behavior, remove prose, widen scan coverage, and verify a real scenario. Task `skipped`, returned to the exact issue #2056 handoff comment. |

Live ownership check: PR #2439 is merged, its append-only ledger rows are present in the current base,
and the open PR set is empty. No matching implementation branch, extra worktree, assignee, session, or
loop reservation exists. This branch is the sole migration owner and owns no implementation. Any
governed blob or unit ownership change excludes that unit and requires a fresh manifest approval.

Control issue marker planned: `backlog-zero:DOCS-032:2c875dd3`. It will own this batch PR only. Parent
issue #2404 remains open for later batches and the preventive durable-queue mechanism.

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

- [ ] TC-01: the committed manifest contains exactly five units, nine final tracked paths, all five
      governed blobs, current ownership, one disposition per unit, and zero baseline changes.
- [ ] TC-02: four unique continuation issues, the exact existing issue #2056, five canonical handoff
      comments, and the DOCS-032 control issue are read back; every unfinished skipped Task cites its
      exact canonical comment URL.
- [ ] TC-03: all five Tasks become skipped without deleting or rewriting historical evidence; the
      excluded CLI-034 Task and both factual carriers remain byte-unchanged.
- [ ] TC-04: the exact final changed-path set contains only the five Task moves, paired DOCS-032
      Task/spec, and two append-only loop ledgers; no baseline, carrier, or package path changes.
- [ ] TC-05: focused lifecycle/path/reference/delegation checks, `pnpm harness:scan`, and
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

- [ ] `.agents/tasks/DOCS-032-terminalize-backlog-zero-migration-batch-03.md`

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
