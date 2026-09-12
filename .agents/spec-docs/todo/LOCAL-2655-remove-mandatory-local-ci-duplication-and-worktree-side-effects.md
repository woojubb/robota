---
status: approved
type: RULE
tags: [cli]
lane: L1
---

# LOCAL-2655: Remove mandatory local CI duplication and worktree side effects

Paired with `.agents/tasks/LOCAL-2655-remove-mandatory-local-ci-duplication-and-worktree-side-effects.md`. Arising from [issue #2655](https://github.com/woojubb/robota/issues/2655).

## Problem

The mandatory local CI mirror creates a temporary Git worktree in `runDistFreeScanSuite`, despite
the owner's no-worktree constraint. Pre-push also prunes worktrees and repeats the remote scans job
after scoped verification. Its full-mirror receipt depends on local executable fingerprints: Git's
hook PATH changed the resolved Git binary on this host, repeating already-passed verification.
These couplings delay #2655 without changing its product. The existing CI scans job already owns
the fresh-checkout repository-contract, hermetic and dist-independent checks.

## Prior Art Research

Waived: this removes redundant internal orchestration using the existing CI job; no external API,
toolchain or product contract is introduced. Independent repository analysis traced the existing
CI owner and the automatic local call paths before this decision.

## Architecture Review

### Affected Scope

Pre-push orchestration modules, explicit local diagnostic runners and their stage declarations,
required-check local reachability metadata/checker, existing unit regressions, and the active rules
and skills that mandate the removed duplication. No package source, root manifest, workflow,
hook registration, gate evaluator, lane table or remote setting changes.

### Alternatives Considered

1. Remove automatic local CI duplication and use the existing remote job for pristine validation.
   - Pro: deletes worktree creation and repeated work without a replacement Git implementation.
   - Con: complete repository-contract/pristine results arrive on CI, not on the local fast path.
2. Replace the temporary worktree with a copied checkout and a Git-owner identity adapter.
   - Pro: could retain local pristine verification.
   - Con: requires new history/index/receipt/scan adapters and dependency-link isolation; a plain
     copy borrowing built workspace links would not establish pristine correctness.

### Decision

**Alternative 1.** Local verification owns affected product checks, formatting and focused
regressions in the existing checkout. The existing CI scans job exclusively supplies the complete
repository-contract/hermetic/pristine verdict; its workflow and tests remain intact. Remove the
local self-test, hermetic and dist-free mirror stages and their worktree materializer. Keep the
existing explicit diagnostic command for useful product stages, but remove full CI certification
and pre-push receipt reuse rather than inventing a replacement receipt or Git adapter. Preserve
shared clean-tree helpers when removing receipt-only consumers.

Scope was validated against both automatic pre-push and explicit diagnostic consumers. Independent
analysis identified two limitations that this decision explicitly preserves rather than hides:
local built-tree scans are not pristine evidence, and the remote develop ruleset currently applies
to no branch. No remote protection mutation is authorized here. Actual eleven-context CI results
are checked before an agent merge; this is not a claim of restored server-side enforcement.
The lane is L1 because all executable changes are internal tooling outside the L2 path table;
changing a workflow, hook registration or gate/approval semantics would reopen that scope.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — automatic pre-push and explicit diagnostic paths inspected; CI remains the existing owner.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Delete duplicate execution and worktree side effects from automatic local entry points. Remove
unreachable materialization code and full-verification receipt issuance/reuse; do not remove
shared helpers or the tests of product/worktree behavior that CI still executes. Represent CI-owned
checks honestly in local reachability metadata, without calling a deliberate non-mirror technically
impossible. Align active guidance in the same batch. Run only inspected focused tests locally;
never create a real worktree to verify its absence. Mocks capture command plans and failed-command
propagation; remote CI supplies the unmodified full-suite behavior.

## Affected Files

- `scripts/harness/pre-push-{runtime,work-run,verification-execution,ci-mirror,local-checks}.mjs`
- `scripts/harness/verify-like-ci*.mjs`, `ci-mirror-{stages,exclusions,map}.mjs`
- `scripts/harness/verification-receipt*.mjs` only for dead full-receipt consumers, preserving shared helpers
- `scripts/harness/scan-required-check-local-reachability.mjs`
- `.github/required-status-checks.json` local diagnostic declarations only; remote required contexts unchanged
- Corresponding existing tests under `scripts/harness/__tests__/`
- Active guidance under `.agents/rules/`, `.agents/skills/`, `.claude/agents/`, and existing feedback memory as needed
- This Task/spec pair and the existing execution ledgers

## Completion Criteria

- [ ] TC-01: Pre-push sequence/execution tests exit 0 and capture no worktree command, CI-suite mirror or full-receipt reuse; failed local checks still fail. The original implementation fails the removal regression.
- [ ] TC-02: Explicit diagnostic tests exit 0 with no local self-test/hermetic/dist-free stage or worktree materializer, no full-CI receipt issuance, and an explicit local-only summary even without `--only`.
- [ ] TC-03: CI map/local-reachability tests exit 0, preserve all eleven develop contexts and their existing CI job coverage, and admit deliberate CI ownership without pretending local execution is impossible.
- [ ] TC-04: Affected static scans and formatting exit 0; active guidance no longer requires the removed local mirror, and focused tests are run without creating or pruning worktrees.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                                     | Notes                                                                   |
| ----- | --------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| TC-01 | Unit      | `pre-push-sequence.test.mjs`, `pre-push-mirrors-ci-scans.test.mjs`                                  | RED/GREEN with injected execution; no real worktrees                    |
| TC-02 | Unit      | `verify-like-ci-execution.test.mjs`, `verify-like-ci.test.mjs`                                      | Local-only stage and result contract; inspect fixtures before execution |
| TC-03 | Unit      | `ci-mirror-map.test.mjs`, `required-check-local-reachability.test.mjs`                              | Existing CI command coverage and eleven contexts retained               |
| TC-04 | Suite     | `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Built-tree static check, not a pristine or full CI verdict              |

## User Execution Test Scenarios

Not applicable.

**Reason:** Only repository contributor verification orchestration changes; installed SDK, CLI and
application interactions are unchanged. Harness command behavior is covered by the engineering tests.

## Tasks

- [ ] `.agents/tasks/LOCAL-2655-remove-mandatory-local-ci-duplication-and-worktree-side-effects.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-12

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "너가 작업하는데 방해가 되는 하네스는 제거하는 방향으로 갈겁니다."
**Given:** 2026-09-12, this conversation
**Review fingerprint:** bb1a9a375cb9 (review 4a251fcd, type/tags 2f92467b)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-12, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (bb1a9a375cb9) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `56552374a04f` · base `origin/develop@56552374a04f` · document `.agents/spec-docs/draft/LOCAL-2655-remove-mandatory-local-ci-duplication-and-worktree-side-effects.md` blob `45aeb222cd67` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-12

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 566 chars, 5 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 4 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 4 Test Plan rows = 4 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 4 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-12, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (bb1a9a375cb9) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/LOCAL-2655-remove-mandatory-local-ci-duplication-and-worktree-side-effects.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/LOCAL-2655-remove-mandatory-local-ci-duplication-and-worktree-side-effects.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `56552374a04f` · base `origin/develop@56552374a04f` · document `.agents/spec-docs/draft/LOCAL-2655-remove-mandatory-local-ci-duplication-and-worktree-side-effects.md` blob `140672694aaa` (untracked)
