---
status: approved
type: AGREEMENT
tags: [infra]
lane: L2
---

# AGREEMENT-2698: Coordinate the diagnostic-first harness migration

Paired with `.agents/tasks/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md`.
Arising from [issue #2698](https://github.com/woojubb/robota/issues/2698).

## Problem

The repository harness currently turns a broad set of process conventions into action vetoes.
`run-all-scans.mjs` registers 161 scans: only three are advisory on PRs, while every registered scan
can fail an integration run. `.claude/settings.json` also registers eight PreToolUse hooks, and seven
of their policy scripts contain exit-1/2 refusal paths for actions such as branch creation, edits,
pushes, waits, and merges. The result is a large, prescriptive control plane that can stop ordinary
work even after it has told the model what the concern is.

The current behaviour is reproducible from a clean `origin/develop` checkout: run
`pnpm harness:scan -- --skip dist --skip build-contracts` and inspect the scan registry or a policy
hook. The baseline run on 2026-09-11 completed 154 checks, skipped 5, and printed 5 advisory findings;
the overwhelming majority of the same policy checks remain hard failures in their normal context.

The owner direction is explicit: problems must be clearly communicated so a model can recognise them,
but the harness must not force detailed workflow behaviour or silently pass a known problem.

## Prior Art Research

- GitHub Actions supports intentional non-blocking jobs/steps through `continue-on-error`, while
  annotations and job summaries make a passing workflow still display a reviewable warning. Its
  annotation limit is bounded, so a complete report must remain available when the concise annotation
  set is truncated. [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idcontinue-on-error), [workflow commands](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-a-warning-message), and [Checks API limits](https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#create-a-check-run) document those separate concerns.
- ESLint similarly separates detection from enforcement: rules configured as warnings remain visible
  while its default process result stays successful, and a caller can opt into a warning threshold with
  `--max-warnings`. [Rule configuration](https://eslint.org/docs/latest/use/configure/rules) and
  [the CLI threshold](https://eslint.org/docs/latest/use/command-line-interface#--max-warnings)
  demonstrate that severity and blocking policy should not be fused inside each detector.

The common pattern is to separate detection, durable rendering, and the decision to block. Robota will
make repository-process policy non-blocking by default, but will emit an explicit `unavailable` result
when a detector cannot run so that a tool failure is never misrepresented as no finding.

## Architecture Review

### Affected Scope

The complete current veto inventory is grouped by owner so the migration can remove each path rather
than merely changing its message:

| Owner                                                                                                          | Current veto path                                                                                                                                                         | Migration destination                                                                                              |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `.claude/settings.json` and `.claude/hooks/`                                                                   | PreToolUse registration for `branch-guard`, `pre-push-check`, `worktree-cwd-guard`, `merge-gate`, `bulk-edit-guard`, `check-forbidden-patterns`, and `no-foreground-wait` | Shared diagnostic reporter; no refusal exit or blocking hook registration                                          |
| `.husky/`                                                                                                      | commit, pre-commit, pre-push, and prepare-commit workflow enforcement                                                                                                     | Retain only ordinary Git integrity checks; publish process diagnostics instead of refusing                         |
| `scripts/harness/gate*.mjs`, `scan-lane-declaration.mjs`, `loop-run.mjs`, `task-complete.mjs`, and their tests | lane, approval, task, receipt, and completion gates                                                                                                                       | Optional planning guidance plus reportable diagnostics; delete gate-only machinery with no diagnostic value        |
| `scripts/harness/run-all-scans.mjs`, `scripts/harness/scan-*.mjs`, baselines, and registry tests               | 161-check suite whose findings can fail the caller                                                                                                                        | Compact diagnostic-family registry with structured findings, examined subjects, and unavailable states             |
| `.github/workflows/ci.yml`, `scans-full.yml`, `review-gate.yml`, `.github/required-status-checks.json`         | CI/required-status conditions that promote harness policy to merge blockers                                                                                               | Report artifact and annotations; retain product-quality jobs separately                                            |
| `.github/workflows/workflow-provenance-gate.yml` and `scripts/harness/scan-workflow-provenance.mjs`            | required workflow-provenance process veto                                                                                                                                 | Explicit diagnostic disposition and removal from required-status wiring, or retirement with an auditable rationale |
| `.agents/rules/`, `.agents/skills/`, `AGENTS.md`                                                               | prose that makes policy workflow mandatory, prohibited, or fail-closed                                                                                                    | Concise recommended workflow that links to diagnostics rather than commanding a process                            |

`scripts/harness/run-all-scans.mjs`, its direct tests, and the hook scripts are the first concrete
implementation surface. Package source code and public APIs are not changed by the parent decision.

### Independent Architecture Validation

An independent four-dimension audit completed on 2026-09-11 under
`architecture-audit-fanout` run `r20260910175415`. All planned coverage cells were returned: structure
42/42, design 36/36, runtime 75/75, and gate 8/8 after one targeted live-ruleset retry. The audit
identified no new product-surface placement issue, but it found the design omissions addressed below:
the contract must have a versioned schema and owned module boundary; diagnostic results must survive
receipt reuse; hook-only observations need an event adapter; every scan/hook/Husky exit requires an
explicit migration row; CI must separate review/security quality from PR-body/process policy; and the
final audit must inspect the effective live rulesets rather than only checked-in declarations.

The retry also measured an existing external-state discrepancy: GitHub's effective `develop` branch
rules list was empty despite the repository declaration naming 11 required contexts, while `main` had
the declared five contexts. This is a migration input, not an inferred success: the final context
matrix must state and verify the chosen live state for each protected branch.

### New Diagnostic-Core Placement

`diagnostic-core.mjs` is a **private development-tooling shared core**, classified alongside the
existing reusable `scripts/harness/shared.mjs` and verification-receipt modules—not as a workspace
package, application, public interface, or product-family surface. `shared.mjs` is the closest
structural analogue: it is a harness-local module used by independent scripts without creating a
package-level dependency. The new core deliberately narrows that established shape: it is I/O-free
and carries only result types, validation, and stable-ID derivation; `diagnostic-renderer.mjs` is its
harness-local presentation adapter; runner, receipt, hook, and CI adapters call inward to those two
modules. No module in this boundary imports `run-all-scans.mjs`, starts registry discovery, or depends
on a product package.

This placement rejects two alternatives: putting the contract in `run-all-scans.mjs` would repeat the
current reverse dependency and registry side effect, while creating a new `packages/*` library would
incorrectly elevate repository-only process diagnostics into a Robota product API. The independent
architecture audit cited above is supplemented before approval with a focused structure verdict that
checks this analogue, classification, and inward-only dependency direction. Its verdict is recorded
in the Evidence Log; implementation may not promote the core into a package without a new owner
placement decision.

### Alternatives Considered

1. **Keep all vetoes but remove only dead or duplicate checks.** Pro: smallest behavioural risk and
   aligns with the prior HARNESS-DIET cleanup. Con: it retains the precise failure mode the owner now
   rejects: a model is forced through local ceremony instead of being informed of the issue.
2. **Make every check advisory without a common result/report contract.** Pro: quick to implement.
   Con: detector crashes, skipped work, and hidden output become indistinguishable from a clean result;
   it violates the requirement that predefined problems not pass silently.
3. **Separate diagnostic result/reporting from enforcement, make repository-process policy advisory
   by default, and remove policy-only detectors that cannot produce actionable guidance (chosen).**
   Pro: it satisfies both owner requirements—no workflow veto and no silent finding—while reducing
   the mechanism count. Con: merge throughput can increase while process debt accumulates, so reports
   must include severity, trend/count information, and a clear remediation route.

### Decision

Choose alternative 3. A single diagnostic result contract is delivered first, then each current veto
is either migrated to that contract or deleted after its report is shown to be redundant. A diagnostic
run returns an explicit clean/finding/unavailable report rather than encoding policy disagreement in
the process exit code. CI publishes a concise summary and complete artifact; a bounded annotation set
links directly to affected locations and reports any truncation.

The new dependency-free `diagnostic-core` layer owns a versioned discriminated result schema, result
validation, stable detector/finding IDs, structured locations, severity, examined-subject provenance,
and state-specific failure evidence. Detectors and hook adapters depend inward on this layer only;
the scan runner, receipt cache, and CI renderer consume it. Existing marker/import consumers migrate
off `run-all-scans.mjs` so a producer never initializes registry discovery or process I/O merely to
report a finding.

A checked-in migration manifest is the authoritative denominator. It contains one row for all 161
current scan registrations, every PreToolUse registration (including both `bulk-edit-guard` matchers),
every exit-bearing Husky rule, and every required-status context. Each row has an owner, subject,
classification (`process-diagnostic`, `product-quality`, `security-quality`, or `retired`), disposition,
report ID, and rationale. Registry discovery, hook inventory tests, CI wiring, and final audit consume
that manifest rather than self-deriving coverage from the shrinking implementation.

Policy findings and detector unavailability are non-blocking by default, but not silent. The runner
converts detector rejection, timeout, output truncation, and ordinary dependency failure into a
structured `unavailable` outcome, continues gathering sibling outcomes, and renders one final report.
If report serialization or durable publication itself fails, the direct caller receives an explicit
`diagnostic-publication-unavailable` notice with the failed target; it never receives a clean claim.
That notice is also non-vetoing under this initiative, consistent with the owner direction, and is
rendered directly when no durable artifact can be written.

Receipt reuse may cache only a wholly clean covered result, or must persist a versioned immutable
diagnostic report and re-render all finding/unavailable records on a hit. Hook adapters use a
correlated invocation ID, atomic event sink, one-event-per-detector semantics, and explicit duplicate
handling so a boundary-only finding has a visible/durable path even when no later scan runs.

CI uses an exact branch × context × disposition matrix. `review-gate` is split so its independent
security-quality verdict remains distinct from PR-body/review-process diagnostics; `workflow provenance`
is explicitly migrated or retired. The final step reconciles the matrix against live effective GitHub
rulesets, including the measured `develop` drift, and reports any mismatch as a diagnostic rather than
assuming the checked-in declaration is applied.

This deliberately does not change compilation, typecheck, lint, product tests, or dependency-security
quality checks. Those remain conventional product validity signals, not instructions for an agent's
workflow. The boundary is reviewed again when CI wiring is changed so no product-quality job is silently
demoted as collateral damage.

**Delivery mode:** `sequenced`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — the inventory table names every current veto owner and the first implementation surface.
- [x] Sibling scan 완료 — the existing advisory channel in `run-all-scans.mjs`, GitHub Actions summaries, and ESLint warning mode were inspected as comparable reporting shapes.
- [x] 대안 최소 2개 검토 완료 — three alternatives with concrete benefits and costs are recorded above.
- [x] 결정 근거 문서화 완료 — the Decision separates detection, rendering, and blocking and names the preserved product-quality boundary.

## Fallback & Degradation Declaration

The migration introduces no silent fallback. A detector that cannot inspect its subject emits an
`unavailable` diagnostic containing its identity, the failed dependency or command, and the next
action. A report publication failure emits `diagnostic-publication-unavailable` directly to the caller
instead of pretending the durable report exists. Per-detector output and runtime are bounded; timeout,
over-output, cancellation, and annotation limits all create explicit visible outcomes. The renderer may
limit location annotations for platform limits, but it must report the limit and preserve the full
findings in the durable report whenever publication is available.

## Solution

Create a compact diagnostic core and versioned migration manifest first. Migrate the existing marker
imports and receipt lifecycle into that core, then migrate local policy hooks through a correlated
event adapter. Next remove planning/gate and process-only rule machinery, classify and reduce scan
families against the manifest, and reconcile CI/required statuses with the exact branch matrix. The
paired Agreement Task owns the cross-cutting contract; child Tasks own independently verifiable delivery
slices. `/tmp/robota-harness-diet-plan.md` is the active detailed execution checklist and is refreshed
after every merged slice.

## Affected Files

- `.agents/tasks/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` — initiative record
- `.agents/tasks/completed/INFRA-2698-add-diagnostic-result-and-report-core.md` — first child
- `.design/decisions/ADR-004-diagnostic-first-harness-policy.md` — accepted repository-policy decision
- `scripts/harness/diagnostic-core.mjs`, `diagnostic-renderer.mjs`, receipt/event-adapter modules, and tests — first delivery slice
- `scripts/harness/run-all-scans.mjs` and its direct production/test importers — runner migration
- `.claude/settings.json`, `.claude/hooks/`, `.husky/` — local-policy migration
- `scripts/harness/gate*.mjs`, `scripts/harness/scan-*.mjs`, baselines, package scripts — gate/scan migration
- `.github/workflows/ci.yml`, `.github/workflows/scans-full.yml`, `.github/workflows/review-gate.yml`, `.github/workflows/workflow-provenance-gate.yml`, `.github/required-status-checks.json` — CI migration
- `scripts/harness/scan-workflow-provenance.mjs`, `scripts/harness/check-review-gate.mjs`, and a final-audit script — policy split and live-state verification
- `.agents/harness-diagnostic-migration.json` and its tests — frozen source population and disposition matrix
- `.agents/rules/`, `.agents/skills/`, `AGENTS.md` — recommended-workflow documentation

## Completion Criteria

- [ ] TC-01: versioned `clean`, `finding`, `unavailable`, and `diagnostic-publication-unavailable` fixtures validate their state-specific fields, stable IDs, severity, locations, examined-subject provenance, evidence, and recommendation in machine-readable and concise human reports.
- [ ] TC-02: a seeded policy finding, rejected detector, timed-out detector, and output-truncated detector all remain visible in the final report while the default diagnostic command exits 0 and renders completed sibling results.
- [ ] TC-03: a two-run receipt fixture proves that a finding or unavailable result is re-rendered on an unchanged-tree reuse, while only a wholly clean covered result may be reused without its detector rerunning.
- [ ] TC-04: every PreToolUse registration and Husky exit source in the migration manifest either emits one correlated shared diagnostic or is retired with a reason; no repository-process policy path exits non-zero.
- [ ] TC-05: the migration manifest has exactly one classified disposition for each of the 161 baseline scans, each hook/Husky source, and every current required-status context; unknown/new sources fail manifest validation.
- [ ] TC-06: every retained diagnostic scan publishes an examined subject or explicit unavailable state and cannot make the default diagnostic run fail for a policy finding; retained product/security quality checks remain separately executable.
- [ ] TC-07: the branch × context × disposition matrix separates review/security quality from review/PR-body process diagnostics, publishes the report artifact and bounded annotations, and removes all harness-policy contexts from merge requirements without demoting retained product/security quality checks.
- [ ] TC-08: a deterministic fresh-`origin/develop` audit clones or worktrees the merged SHA, runs seeded visibility/unavailability probes and the normal diagnostic suite, inspects hook registration plus effective GitHub rulesets, and stores the complete report as evidence.
- [ ] TC-09: a static migration-inventory test maps every current `gate*.mjs` policy entrypoint and mandatory process instruction in `.agents/rules/`, `.agents/skills/`, and `AGENTS.md` to a manifest disposition; migrated commands emit diagnostics without a policy exit and retained documentation is recommendation/report guidance rather than a workflow veto.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                 | Notes                                                                       |
| ----- | ----------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| TC-01 | unit        | Versioned schema/renderer fixtures                                              | Child INFRA-2698 owns the first implementation.                             |
| TC-02 | integration | Seeded subprocess rejection, timeout, output-limit, and sibling-result fixtures | Proves the final renderer always runs.                                      |
| TC-03 | integration | Two-run receipt reuse fixture                                                   | A known result cannot disappear on cache reuse.                             |
| TC-04 | integration | Hook/Husky discovery and correlated-event fixture commands                      | Covers duplicate matcher execution and each policy exit source.             |
| TC-05 | unit        | Manifest validation against frozen baseline inventory                           | Prevents accidental population shrinkage.                                   |
| TC-06 | unit        | Registry classification/report tests plus retained quality commands             | Product/security checks stay distinct.                                      |
| TC-07 | CI smoke    | Workflow, status-matrix, report-artifact, and review/security split tests       | Includes workflow-provenance disposition.                                   |
| TC-08 | integration | Isolated fresh-develop final-audit script plus read-only `gh` inspection        | Final evidence is gathered only after all child work lands.                 |
| TC-09 | integration | Gate/doc inventory fixture plus migrated-command exit/report assertions         | Covers the otherwise unrepresented gate and policy-document migration rows. |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The initiative changes repository-maintenance hooks, diagnostics, and CI workflow behavior;
it introduces no user-facing Robota CLI command, TUI interaction, browser flow, SDK API, or installed
package behavior for an end user to execute.

## Tasks

- [x] INFRA-2698 — done — `.agents/tasks/completed/INFRA-2698-add-diagnostic-result-and-report-core.md`
- [ ] BEHAVIOR-2698 — todo — `.agents/tasks/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-11

**Status upgrade:** draft → review-ready

**Per-criterion result:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --lane L2 --dry-run` reported 20 mechanical PASS, 0 FAIL, and 7 semantic PENDING-GUARDIAN.

- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — `run-all-scans.mjs` has 161 registered scans with only three advisory on PRs, and seven PreToolUse policy scripts have exit-1/2 refusal paths; the Problem identifies the resulting ordinary-work vetoes rather than a generic preference for fewer checks.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — from a clean `origin/develop` checkout, `pnpm harness:scan -- --skip dist --skip build-contracts` exposes the registry/policy-hook behaviour; the 2026-09-11 baseline records 154 completed checks, 5 skipped, and 5 advisory findings.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — the GitHub Actions distinction between non-blocking jobs, warnings, and durable reports, together with ESLint's warning/`--max-warnings` separation, directly supports rejecting unstructured advisory conversion and selecting explicit `clean`/`finding`/`unavailable` reporting with concise CI output plus a complete artifact.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — alternative 3 is chosen because it removes process vetoes while preserving visible findings; its cost is explicitly accepted as increased merge throughput and possible process-debt accumulation, countered by severity, trend/count, remediation, and retained product-quality checks.
- GATE-WRITE — New-surface placement (conditional): PASS as N/A — this refactors existing repository harness, hook, scan, and CI policy paths; it introduces no package, app, presentation/public interface, product-family surface, or layer-boundary reclassification. The document expressly leaves package source and public APIs unchanged.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — TC-01 covers the result/report contract, TC-02 non-blocking visible findings and unavailable state, TC-03 local hooks, TC-04 scan classification, TC-05 CI/required-status separation, and TC-06 the complete retired-veto and visibility audit.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — each TC names a rendered report, visible seeded state plus exit code, hook exit behaviour, registry/report state, CI artifact/summary state, or a fresh-checkout audit result that can be observed.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `fa575ab0c44b58e57b240617a23940f949c798bb` · base `origin/develop@fa575ab0c44b58e57b240617a23940f949c798bb` · document `.agents/spec-docs/draft/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` blob `e117584ea68a7528be418a8a7deba542ff077dc5` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-11

**Status remains:** draft
**Recheck scope:** The mechanical recheck reported 20 PASS, 0 FAIL, and the seven semantic criteria below as `PENDING-GUARDIAN`.
**Per-criterion result:**

- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — the Problem identifies both the 161 registered scans / three advisory-in-PR baseline and the seven policy hook scripts with refusal exits, then states the observable effect: ordinary work is vetoed after a concern is reported.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — it gives a clean-`origin/develop` invocation, `pnpm harness:scan -- --skip dist --skip build-contracts`, and records the observed 154 completed, five skipped, and five advisory findings baseline.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — the documented GitHub Actions split between non-blocking execution, visible annotations, and durable output, plus ESLint warning semantics, directly support rejecting an unstructured advisory-only option and selecting a structured, durable result contract.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — alternative 3 accepts a potentially higher rate of merged process debt in exchange for removing workflow vetoes, and names severity, trend/counts, remediation, and retained product-quality jobs as its counterweight.
- GATE-WRITE — New-surface placement (conditional): FAIL — the Decision creates a dependency-free `diagnostic-core` layer and a renderer/event-adapter boundary, which is a new shared contract/core placement and is therefore not N/A under `spec-workflow.md`'s new-module rule. The document does not name the closest existing structural analog and product-family classification, nor does it record an independent placement verdict specifically verifying that the new core is shared-core reuse rather than a sibling-product dependency.
  **Required action:** satisfy the named placement criterion for the new `diagnostic-core`/renderer boundary, then re-run GATE-WRITE.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: FAIL — TC-01 through TC-08 cover the result contract, runner failure visibility, receipt reuse, hook/Husky paths, manifest, scan classification, CI/status matrix, and final audit; none observably requires the separately scoped `scripts/harness/gate*.mjs` and `.agents/rules/`, `.agents/skills/`, `AGENTS.md` policy-only workflow machinery to be migrated or retired. Those affected-scope rows therefore lack a corresponding completion criterion/test row.
  **Required action:** add observable completion coverage for each currently unrepresented gate/workflow-document migration sub-item, then re-run GATE-WRITE.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — every current TC specifies a fixture, process outcome, manifest validation, retained command, matrix/artifact, or isolated audit with observable assertions; no criterion merely asserts completion.

**Placement follow-up evidence (to be evaluated in the next GATE-WRITE recheck):** an independent
focused reviewer verified that `scripts/harness/shared.mjs` is the closest structural analogue: it is
a harness-local reusable module (195 current production/test importers), while the proposed core is
stricter and I/O-free. `scripts/harness/README.md` and root `package.json` classify this directory as
private repository tooling exposed by root `harness:*` commands, rather than a `packages/*` or `apps/*`
product family. The reviewer also confirmed that `run-all-scans.mjs` owns registry/process/receipt I/O
and has at least 12 production marker/registry consumers, so it cannot own the shared result contract;
the verified direction is `diagnostic-core` ← renderer ← runner/receipt/hook/CI adapters, with no
core/renderer dependency on the runner or a product package. A new package was rejected because the
contract has no external product consumer.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/draft/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` blob `aa3d2cd76ae4` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-11

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` already carries [ARCHITECTURE-PLACEMENT]
  **Required action:** a first GATE-WRITE run expects an empty log

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/draft/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` blob `c2c2d5d6820a` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-11

**Status upgrade:** draft → review-ready
**Recheck scope:** The guardian re-evaluated the seven L2 semantic criteria after the new
diagnostic-core placement decision/evidence and TC-09 were added. The preceding mechanical-recheck
entry records the tool's first-run-log limitation separately; this semantic recheck does not alter it.

- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — the Problem names the measured 161-scan/three-advisory baseline, seven PreToolUse refusal scripts, and the observable consequence: ordinary work can be vetoed after the harness has already identified a concern.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — a clean `origin/develop` checkout and `pnpm harness:scan -- --skip dist --skip build-contracts` are specified, with the observed 154 completed, five skipped, and five advisory findings baseline.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — the cited GitHub Actions non-blocking/annotation/artifact model and ESLint warning/threshold model directly inform the rejection of an unstructured advisory conversion and the selected versioned, durable diagnostic report.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — alternative 3 explicitly exchanges process vetoes for a possible increase in merged process debt, and commits severity, trend/counts, remediation, and separately retained product/security quality signals as the counterweight.
- GATE-WRITE — New-surface placement (conditional): PASS — `New Diagnostic-Core Placement` classifies `diagnostic-core.mjs` as private repository development-tooling shared core, mirrors the existing harness-local `scripts/harness/shared.mjs` analogue, and rejects both a runner-owned contract and a new product package. It records the inward-only direction `diagnostic-core` ← renderer ← runner/receipt/hook/CI adapters, with no product-package or runner dependency. The recorded independent `architecture-audit-fanout` structure result (`r20260910175415`, 42/42 coverage) and the focused reviewer evidence in this log independently cover that analogue, classification, and dependency direction.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — TC-01 through TC-08 observably cover the result contract, detector failure visibility, receipt reuse, hooks/Husky, the frozen manifest, scan classification, CI/status split (including workflow provenance), and final audit; TC-09 now separately maps every `gate*.mjs` policy entrypoint and mandatory process instruction in `.agents/rules/`, `.agents/skills/`, and `AGENTS.md` to a disposition and checks their non-veto/report-guidance outcome.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — every TC names a schema fixture, seeded subprocess/receipt/hook/inventory fixture, manifest or matrix assertion, retained command, or deterministic audit with a verifiable output; none merely asserts that the migration is complete.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `fa575ab0c44b58e57b240617a23940f949c798bb` · base `origin/develop@fa575ab0c44b58e57b240617a23940f949c798bb` · document `.agents/spec-docs/draft/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` blob `88c844abc1d1c171bdee0e0996db163731941f4e` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "하네스 다이어트를 하겠습니다. 지금 하네스는 너무 많은걸 강제로 강요하고 있습니다. 이제는 세세하게 제어하고 강제하는 하네스보다 큰 틀에서 방향을 잡아주는 하네스로 바꾸겠습니다. 강요하고 강제하는 하네스 보다는 문제가 있으면 정확히 알려주고, 강제는 아니고, 모델이 인지할수 있게 하고, 사전에 정의된 문제가 조용히 넘어가지 않게 명확히 전달만 하면 된다고 생각합니다. 그래서 강제로 제한하는 것들 중 뭐를 제거할수 있는지 계획을 먼저 짠 후 /tmp폴더에 문서로 만들고 그 문서의 todo 리스트를 반복해서 처리해서 모든게 다 origin/develop 브랜치에 머지될 때까지 반복하세요."
**Given:** 2026-09-11, this conversation
**Review fingerprint:** e85d7f53bedf (review 8fcccd57, type/tags bfe113ca)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-11, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (e85d7f53bedf) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/backlog/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` blob `75d819dad6fb` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Independent review verdict:** `ENDORSE`

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the current-conversation instruction directs the exact outcome this Agreement records: first make the `/tmp` plan, then repeatedly execute its TODO items until all work is merged into `origin/develop`; its stated design boundary is to replace detailed harness coercion with clear, non-silent, non-forcing problem communication. The Agreement neither adds a product goal nor broadens that requested repository-harness migration.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS as N/A — the recorded approval route is `DIRECT`; no delegated class is invoked, so no class-scope authorization is being asserted or relied on.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS — the independent guardian reviewed the new-surface placement. `diagnostic-core.mjs` mirrors the existing private harness-local shared module `scripts/harness/shared.mjs`, rather than a `packages/*` product API; its proposed I/O-free inward-only direction (`diagnostic-core` ← renderer ← runner/receipt/hook/CI adapters) avoids the current runner-owned registry/process-I/O dependency. The independent `architecture-audit-fanout` structure result `r20260910175415` covers all 42/42 planned structure cells, and the placement section records the rejected runner-owned and new-package alternatives. **REVIEW VERDICT: ENDORSE.**

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/backlog/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-11

**Status remains:** review-ready
**Failed criteria:**

- GATE-APPROVAL — User has provided explicit approval in the current conversation: GATE-APPROVAL names no approval route. gate-catalogue.md requires `**Approval route:**` to be `DIRECT` or `CLASS`; an entry that names neither is FAIL, not DIRECT by default. Add the route; do not add the document to the baseline, which is frozen for approvals that predate this floor.
  **Required action:** rewrite the entry in the delegated-approval form
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: GATE-APPROVAL names no approval route. gate-catalogue.md requires `**Approval route:**`to be`DIRECT`or`CLASS`; an entry that names neither is FAIL, not DIRECT by default. Add the route; do not add the document to the baseline, which is frozen for approvals that predate this floor.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: GATE-APPROVAL names no approval route. gate-catalogue.md requires `**Approval route:**` to be `DIRECT` or `CLASS`; an entry that names neither is FAIL, not DIRECT by default. Add the route; do not add the document to the baseline, which is frozen for approvals that predate this floor.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: GATE-APPROVAL names no approval route. gate-catalogue.md requires `**Approval route:**` to be `DIRECT` or `CLASS`; an entry that names neither is FAIL, not DIRECT by default. Add the route; do not add the document to the baseline, which is frozen for approvals that predate this floor.
  **Required action:** rewrite the entry in the delegated-approval form

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/backlog/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` blob `904d48db6da1` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "하네스 다이어트를 하겠습니다. 지금 하네스는 너무 많은걸 강제로 강요하고 있습니다. 이제는 세세하게 제어하고 강제하는 하네스보다 큰 틀에서 방향을 잡아주는 하네스로 바꾸겠습니다. 강요하고 강제하는 하네스 보다는 문제가 있으면 정확히 알려주고, 강제는 아니고, 모델이 인지할수 있게 하고, 사전에 정의된 문제가 조용히 넘어가지 않게 명확히 전달만 하면 된다고 생각합니다. 그래서 강제로 제한하는 것들 중 뭐를 제거할수 있는지 계획을 먼저 짠 후 /tmp폴더에 문서로 만들고 그 문서의 todo 리스트를 반복해서 처리해서 모든게 다 origin/develop 브랜치에 머지될 때까지 반복하세요."
**Given:** 2026-09-11, this conversation
**Review fingerprint:** e85d7f53bedf (review 8fcccd57, type/tags bfe113ca)
**Independent review verdict:** `ENDORSE`

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the current-conversation instruction directs the exact outcome this Agreement records: first make the `/tmp` plan, then repeatedly execute its TODO items until all work is merged into `origin/develop`; its stated design boundary is to replace detailed harness coercion with clear, non-silent, non-forcing problem communication. The Agreement neither adds a product goal nor broadens that requested repository-harness migration.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS as N/A — the recorded approval route is `DIRECT`; no delegated class is invoked, so no class-scope authorization is being asserted or relied on.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS — the independent guardian reviewed the new-surface placement. `diagnostic-core.mjs` mirrors the existing private harness-local shared module `scripts/harness/shared.mjs`, rather than a `packages/*` product API; its proposed I/O-free inward-only direction (`diagnostic-core` ← renderer ← runner/receipt/hook/CI adapters) avoids the current runner-owned registry/process-I/O dependency. The independent `architecture-audit-fanout` structure result `r20260910175415` covers all 42/42 planned structure cells, and the placement section records the rejected runner-owned and new-package alternatives. **REVIEW VERDICT: ENDORSE.**

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `fa575ab0c44b` · base `origin/develop@fa575ab0c44b` · document `.agents/spec-docs/backlog/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-11

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-11; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (9)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 378 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 5 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "sequenced",
  "sequencedArtifacts": [
    ".agents/spec-docs/todo/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md",
    ".agents/tasks/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md"
  ],
  "taskPath": ".agents/tasks/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md",
  "specPath": ".agents/spec-docs/todo/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/post-merge-cycle.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md",
    ".agents/tasks/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0f9277b567b3` · base `origin/develop@0f9277b567b3` · document `.agents/spec-docs/todo/AGREEMENT-2698-coordinate-the-diagnostic-first-harness-migration.md` blob `be5e2ab89449` (modified)

### [GATE-IMPLEMENT] — 🔴 NON-COMPLIANCE | 2026-09-11

**Status remains:** approved
**Violation:** The parent Agreement's first GATE-IMPLEMENT checkpoint was attempted after integration
commit `0f9277b567b314e5855b6e8b10733f26b2fbce41` had already delivered the diagnostic core, runner
changes, and a completed child Task/spec pair. The independent guardian therefore found the parent
checkpoint retrospective rather than a plan made before implementation.
**Required action:** Do not activate this parent record as the A04 planning checkpoint. Open a new,
properly issue-backed A04 Task/spec pair and complete its gates before any A04 source edit. If its
issue is a child issue, obtain the required independent external-lifecycle retention review first.
**Ledger disposition:** The uncommitted preliminary parent scenario record did not name an exact Task
path and is superseded by BEHAVIOR-2698's committed, exact-path PLAN record. It is intentionally not
carried forward as a second PLAN signal; this NON-COMPLIANCE entry and the halted request-gate record
preserve the failed parent attempt and its required correction.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
GATE VERDICT: NON-COMPLIANCE
