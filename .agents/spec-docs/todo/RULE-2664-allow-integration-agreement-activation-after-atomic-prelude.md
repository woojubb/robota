---
status: approved
type: RULE
tags: [typescript]
lane: L2
---

# RULE-2664: Allow integration AGREEMENT activation after its atomic prelude

## Problem

After BRANCH-2664 landed, a fresh `integration/agreement-2664` created from current
`origin/develop` and replaying the two approved AGREEMENT planning commits fails
`node scripts/harness/scan-user-execution-plan-order.mjs`. The integration analyser requires an
active parent checkpoint even when no child merge exists yet. When the valid GATE-IMPLEMENT
transition is staged, the pre-commit path evaluates the already-committed planning-only history
first and returns the same finding before it can validate the staged checkpoint. Consequently, the
only transition that could satisfy the history rule cannot be committed through the normal hook.

## Prior Art Research

Waived: this is a bounded regression in a repository-local history state machine introduced by
BRANCH-2664. The exact intended migration sequence and trusted integration identity are already
specified and covered by repository fixtures; external product behavior offers no comparable
contract.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs` — integration AGREEMENT pre-child state.
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — planning-only, staged
  activation, and fail-closed child-boundary regressions.

### Alternatives Considered

1. **Commit the activation with hooks bypassed or under a temporary non-integration branch name.**
   - Pro: no scanner change.
   - Con: makes the required evidence depend on bypassing the mechanism that is supposed to prove it.
2. **Require the active checkpoint in every integration state, including before the first push.**
   - Pro: keeps the current implementation unchanged.
   - Con: preserves the bootstrap cycle because the staged checkpoint cannot be examined until the
     committed history already contains it.
3. **Accept a matching pending atomic AGREEMENT only before any child merge, then require the active
   checkpoint at the first child boundary (chosen).**
   - Pro: admits the documented two-commit migration and its ordinary staged activation while keeping
     child execution gated by the active parent checkpoint.
   - Con: the integration analyser must distinguish pre-child pending state from child-bearing history.

### Decision

Choose alternative 3. Resolve the parent identity from either the existing active checkpoint or the
single-history analyser's exact pending atomic AGREEMENT. Read the approved `todo/` spec only for the
pre-child state. If a child merge exists, continue requiring the active checkpoint before inspecting
any child segment. This preserves the strict child boundary and removes only the impossible bootstrap
cycle. The recommendation is validated against the real AGREEMENT-2664 replay, the staged transition,
and adversarial fixtures for a child merged before activation and a mismatched integration identity.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — integration history, staged checkpoint, clean sync, and child merge fixtures inspected.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Teach integration history analysis to recognize its matching `pendingBasename` as a valid
   planning-only AGREEMENT state.
2. Resolve the AGREEMENT spec from `todo/` while pending and from `active/` after its checkpoint.
3. Refuse any child merge unless the parent checkpoint exists and is active.
4. Add RED/GREEN fixtures for planning-only history, staged activation, committed activation, and
   the pre-activation child refusal.

## Affected Files

- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`

## Completion Criteria

- [ ] TC-01: `findHistoryFindings` returns no findings for a matching atomic AGREEMENT prelude on
      `integration/agreement-2664` before any child merge.
- [ ] TC-02: `findStagedFindings` returns no findings for the exact `todo/` to `active/` parent
      AGREEMENT transition, and committed history remains clean afterward.
- [ ] TC-03: An integration history with a child merge before the parent active checkpoint returns
      the stable matching-valid-atomic-AGREEMENT refusal.
- [ ] TC-04: A malformed or branch-ID-mismatched pending AGREEMENT remains rejected without weakening
      duplicate, undeclared, out-of-order, or malformed child checks.
- [ ] TC-05: `pnpm exec vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
      and the affected harness contract command both exit 0.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                      | Notes |
| ----- | ----------- | ------------------------------------------------------------------------------------ | ----- |
| TC-01 | unit        | Temporary Git fixture calling `findHistoryFindings` on the planning-only branch      |       |
| TC-02 | integration | Temporary Git fixture calling `findStagedFindings`, committing, then reading history |       |
| TC-03 | regression  | Temporary Git fixture merging one child before parent activation                     |       |
| TC-04 | regression  | Existing and new malformed integration-history fixtures                              |       |
| TC-05 | integration | Focused Vitest plus affected harness contract verification                           |       |

## Tasks

- [ ] `.agents/tasks/RULE-2664-allow-integration-agreement-activation-after-atomic-prelude.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering check: PASS — GATE-WRITE is the entry gate with no predecessor; the document is in `.agents/spec-docs/draft/` and declares `status: draft`.
- GATE-WRITE — Mechanical criteria handoff: PASS — the existing mechanical run reported 20 PASS, 0 FAIL, and 7 semantic criteria pending guardian judgement; the Evidence Log was empty before this entry, and five Completion Criteria rows (`TC-01` through `TC-05`) match five Test Plan rows.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — the Problem names `node scripts/harness/scan-user-execution-plan-order.mjs`, the fresh `integration/agreement-2664` history, and the incorrect finding that rejects both its approved two-commit prelude and the only staged activation transition that can satisfy the rule.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — the failure is reproduced on an integration branch created from current `origin/develop` after replaying the two approved AGREEMENT planning commits, both when scanning committed planning-only history and when the valid GATE-IMPLEMENT transition is staged through the pre-commit path.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision (evidence-based recommendation, not asserted): PASS — the explicit repository-local regression waiver identifies the approved migration sequence and existing fixtures as the applicable evidence; the alternatives and Decision use that evidence to reject hook bypass and an always-active requirement, and select pending-prelude admission only before the first child boundary.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — the Decision accepts additional integration-analyser state discrimination to remove the bootstrap cycle while preserving the stricter requirement that every child-bearing history already contain the active parent checkpoint.
- GATE-WRITE — New-surface placement (conditional): N/A — the spec changes an existing repository-local history scanner and its existing test module; it introduces no package, app, presentation/interface surface, layer reclassification, product-family boundary, or sibling-product dependency.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — TC-01 covers the matching planning-only prelude, TC-02 staged and committed parent activation, TC-03 the fail-closed pre-activation child boundary, TC-04 malformed or mismatched preludes plus preservation of existing refusals, and TC-05 the focused and affected verification commands.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — TC-01 and TC-02 require named analyser functions to return no findings and committed history to remain clean; TC-03 and TC-04 require stable rejection outcomes; TC-05 requires two named commands to exit 0.

**Judged by:** `backlog-gate-guard` (semantic criteria; mechanical criteria by `gate.mjs` this run)
**Judged at:** HEAD `f8dc5a0458c461fbe0f6a1c3b9ee03b36e93076f` · base `origin/develop@f8dc5a0458c461fbe0f6a1c3b9ee03b36e93076f` · document `.agents/spec-docs/draft/RULE-2664-allow-integration-agreement-activation-after-atomic-prelude.md` blob `a286e46db3a85ae1a4f1cace2ece0e26d3b7e8ae` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 0260151f35c3 (review a4c4d59b, type/tags 3f38f499)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (0260151f35c3) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `f8dc5a0458c4` · base `origin/develop@f8dc5a0458c4` · document `.agents/spec-docs/backlog/RULE-2664-allow-integration-agreement-activation-after-atomic-prelude.md` blob `1b1dc39530bf` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 0260151f35c3 (review a4c4d59b, type/tags 3f38f499)

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the quoted current-conversation instruction explicitly approves the recommendation then under review, and the owner's subsequent `승인함.` confirms the presented RULE-2664 bootstrap-remediation slice. The document limits that approved recommendation to admitting the matching planning-only AGREEMENT prelude while retaining the active-parent requirement before any child merge; it does not substitute a different item or rely on a relay.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the recorded route is `DIRECT`; no delegated class, registry entry, or class-scope authorization is asserted or required.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — the spec modifies the existing repository-local integration-history analyser and its existing test module only. It introduces no package, app, presentation or interface surface, layer reclassification, product-family boundary, or sibling-product dependency, so the independent new-surface placement review condition does not apply.
- GATE-APPROVAL — implementation-before-approval trigger: not triggered — HEAD equals `origin/develop`, and the worktree contains only the paired planning artifacts plus the user-request gate ledger; no harness implementation or test source file has been changed.

**Judged by:** `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `f8dc5a0458c461fbe0f6a1c3b9ee03b36e93076f` · base `origin/develop@f8dc5a0458c461fbe0f6a1c3b9ee03b36e93076f` · document `.agents/spec-docs/backlog/RULE-2664-allow-integration-agreement-activation-after-atomic-prelude.md` blob `39567702ee928a9d3f4f8419a3eda16b4cce4206` (untracked, before this evidence append)

GATE VERDICT: PASS
