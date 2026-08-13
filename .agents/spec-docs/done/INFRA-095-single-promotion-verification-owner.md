---
status: done
type: INFRA
tags: [typescript]
---

# INFRA-095: Single owner for promotion release verification

## Problem

`scripts/harness/promote.mjs` currently assembles the `develop → main` promotion branch and then runs
`pnpm harness:verify:release` locally. After the branch is pushed, the protected main PR's required
`release-grade verification` job runs the same root command again. Recent promotion evidence measured
the local copy at roughly seven minutes and the protected CI copy at roughly twelve minutes. The two
runs verify different commits only by construction detail: the local promotion head and the PR head
carry the same develop tree, while protected CI is the only result that GitHub's ruleset can consume.

The duplicate does not shorten the required critical path and makes every promotion pay the full
release sweep twice. It also adds a `--skip-release-gate` bypass solely because scratch tests cannot
run the workspace gate, creating two modes for an action whose protected result still comes only from CI.

## Prior Art Research

[GitHub's status-check documentation](https://docs.github.com/en/pull-requests/reference/status-checks)
states that required checks must pass before a protected-branch PR can merge, and GitHub Actions
produces those checks. Its
[protected-branch documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
adds that a rule may require a specific GitHub App as the accepted status source. Therefore a local
process result cannot substitute for the protected GitHub check that decides merge eligibility. This
directly rules out alternative 2 and supports alternative 3: retain the trusted required check and
remove only the redundant automatic local copy.

The current repository confirms the same ownership: `.github/workflows/ci.yml` names
`release-grade verification` as the sole substantive main-only release job,
`.github/required-status-checks.json` requires it, and `scripts/harness/scan-main-required-checks.mjs`
reconciles the live ruleset. The local release command remains useful for explicit diagnosis, but
automatically running it immediately before an unavoidable protected copy is duplicate orchestration.

The larger alternative in INFRA-054 is a trusted workflow that verifies exact `origin/develop` and
fast-forwards `main`. That would remove the synthetic promotion commit and the duplicate completely,
but it needs a dedicated write identity, protected environment approval, live ruleset changes, and
owner decisions about hotfix routing and loss of promotion-PR annotations. Those external decisions
are not required to remove today's local duplicate safely.

## Architecture Review

### Affected Scope

- `scripts/harness/promote.mjs` — deterministic promotion branch assembler.
- `scripts/harness/__tests__/promote.test.mjs` — scratch repository behavior.
- `scripts/harness/__tests__/promotion-preflight-parity.test.mjs` — promotion verification ownership.
- `.agents/rules/git-branch.md` and `.agents/rules/verification.md` — current operator contract.
- `scripts/harness/README.md` — discoverable command ownership.

### Alternatives Considered

1. Keep both full runs.
   - Pro: catches a failure before opening the PR.
   - Con: duplicates the dominant release sweep and cannot replace protected CI.
2. Keep only the local run and let the main PR trust a local receipt.
   - Pro: avoids GitHub runner duplication.
   - Con: local receipts are not trusted remote attestations and do not satisfy branch protection.
3. Keep the promotion PR and make its required CI job the single automatic release-verification owner.
   - Pro: removes the duplicate without weakening the protected boundary or requiring external setup.
   - Con: a release defect is discovered after the PR opens; operators may still run the diagnostic command explicitly.
4. Complete INFRA-054's trusted fast-forward workflow now.
   - Pro: removes both duplicate verification and the synthetic PR merge.
   - Con: materially expands scope into external credentials, environments, rulesets, and unresolved owner policy.

### Decision

Choose alternative 3. `promote.mjs` owns clean-tree validation, fresh refs, merge-tree conflict
analysis, exact develop-tree equality, promotion ancestry A1/A2/A3, rollback, and next-command output.
It does not spawn the release sweep and has no skip flag. The required main-PR job remains the only
automatic owner of `pnpm harness:verify:release`; the root command remains available for explicit local
diagnosis. This is a repository developer-workflow change, not a product or package API.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — promotion assembler, main required checks, local diagnostic, and INFRA-054 inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None. Missing or failed required CI continues to block the main PR; local ancestry and tree failures
continue to abort and discard the promotion branch.

## Solution

Remove `spawn`, environment path assembly, `--skip-release-gate`, the automatic child process, and
local-pass/skip output from `promote.mjs`. Replace them with one explicit statement that the branch is
structurally ready and the protected PR will run `release-grade verification`; print
`pnpm harness:verify:release` only as an optional diagnostic, never as an automatic prerequisite.

Rewrite scratch tests so every case uses the same production path, assert no release-gate child is spawned,
and retain all dirty-tree/conflict/drift/rollback checks. Replace the old “local preflight mirrors
protect-main” test with a parsed ownership contract: the workflow owns exactly one release entrypoint,
the assembler does not invoke it, the required-check mapping still names the job, and the diagnostic
root script remains present. Update current rules without rewriting archived historical evidence.

## Affected Files

- `scripts/harness/promote.mjs`
- `scripts/harness/__tests__/promote.test.mjs`
- `scripts/harness/__tests__/promotion-preflight-parity.test.mjs`
- `.agents/rules/git-branch.md`
- `.agents/rules/verification.md`
- `scripts/harness/README.md`
- `.agents/tasks/INFRA-095-single-promotion-verification-owner.md`

## Completion Criteria

- [x] TC-01: `promote.mjs` has no automatic release-gate spawn and accepts no release-gate bypass flag.
- [x] TC-02: executable scratch tests preserve clean-tree, ref, conflict, tree-equality, A1/A2/A3,
      rollback, dry-run, and ready-branch behavior.
- [x] TC-03: parsed workflow/required-check tests prove `release-grade verification` remains required
      and owns exactly one `pnpm harness:verify:release`; the root diagnostic remains reachable.
- [x] TC-04: current rules and harness documentation name protected CI as the sole automatic owner and
      do not instruct automatic local duplication.
- [x] TC-05: focused tests, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` exit 0.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                                                                                                                                | Notes                                                     |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| TC-01 | Unit/source contract   | `scripts/harness/__tests__/promotion-preflight-parity.test.mjs` — `promotion verification has one automatic owner`                                                             | Reject child spawn and bypass tokens.                     |
| TC-02 | Integration            | `scripts/harness/__tests__/promote.test.mjs > promote.mjs`                                                                                                                     | Real scratch git repositories, no network.                |
| TC-03 | Workflow contract      | `scripts/harness/__tests__/promotion-preflight-parity.test.mjs` — `promotion verification has one automatic owner`                                                             | Exact job/entrypoint ownership.                           |
| TC-04 | Documentation contract | `scripts/harness/__tests__/scan-required-check-local-reachability.test.mjs` — `over the declaration this repository actually ships`; plus `pnpm harness:scan`                  | Current rules only; archived evidence remains historical. |
| TC-05 | Regression             | Test skipped: this criterion directly executes the aggregate root verification commands; wrapping them in another test would duplicate the gate rather than test new behavior. | Record direct exit results; no product scenario.          |

## Tasks

- [x] `.agents/tasks/completed/INFRA-095-single-promotion-verification-owner.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-14

**Status upgrade:** draft → review-ready
Frontmatter, concrete duplicate-run symptom and reproduction, official GitHub status-check research,
four alternatives with trade-offs, the completed architecture checklist, five TC criteria with five
Test Plan rows, Tasks placeholder, and empty Evidence Log all satisfy the catalogue.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-14

**Status upgrade:** review-ready → approved
User approval: “추천 우선순위 대로 전부 진행해서 완료해줘” authorizes priority 2 from the reasoned
recommendation. Independent proposal review returned `ENDORSE`: protected CI is the only automatic
result branch protection consumes, structural promotion preparation remains local, and INFRA-054 is
correctly excluded pending external configuration and owner policy decisions.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-14

**Status upgrade:** approved → in-progress
The linked Task exists with TC-01 through TC-05 and a substantive Test Plan. Implementation may begin
against the approved single-owner boundary.

### Engineering evidence | 2026-08-14

- TC-01/TC-03: `promotion-preflight-parity.test.mjs`, 5/5 PASS, exit 0. The source contract rejects
  a release child-process seam and bypass tokens while parsing exactly one protected CI entrypoint.
- TC-02: `promote.test.mjs`, 12/12 PASS, exit 0. Real scratch repositories cover clean/dirty,
  dry-run, conflict, tree equality, fresh bare-origin fetch, A1/A2/A3, ready branch, and rollback for
  a distinct branch, checked-out target, and detached HEAD.
- TC-04: required-check tests plus `pnpm harness:scan`, 50/50 focused tests and 108 scans PASS,
  exit 0; current rule and README ownership agree with protected CI.
- TC-05: final `pnpm harness:verify-like-ci`, 12/12 stages PASS, exit 0, 4m 7.3s. The run included
  repository-contract 2,232/2,232, hermetic 1,055/1,055, typecheck, and both scan suites.

### [GATE-VERIFY] — ✅ PASS | 2026-08-14

**Status upgrade:** in-progress → verifying
Independent fresh verification passed 30/30 focused tests and 108 harness scans. The task has no
blocked or unchecked criterion; package build scope is not applicable because no package/app changed,
while the recorded final `verify-like-ci` covered all 12 workspace stages. Spec-to-code inspection
confirmed no release child or bypass, exactly one protected-CI release entrypoint, and the retained
root diagnostic.

### [GATE-COMPLETE: TC-01] — ✅ VERIFIED | 2026-08-14

- Command: `pnpm exec vitest run scripts/harness/__tests__/promotion-preflight-parity.test.mjs`.
- Result: exit 0; 5/5 tests passed. The `promotion verification has one automatic owner` suite
  rejects child-process execution seams and the retired bypass tokens in `promote.mjs`.

### [GATE-COMPLETE: TC-02] — ✅ VERIFIED | 2026-08-14

- Command: `pnpm exec vitest run scripts/harness/__tests__/promote.test.mjs`.
- Result: exit 0; 12/12 tests passed. The `promote.mjs (INFRA-051)` suite exercised dirty/ref,
  dry-run, conflict, exact tree, real bare-origin fetch, A1/A2/A3, ready branch, and exact rollback
  from distinct-branch, checked-out-target, and detached states.

### [GATE-COMPLETE: TC-03] — ✅ VERIFIED | 2026-08-14

- Commands: the focused parity suite above plus
  `pnpm exec vitest run scripts/harness/__tests__/scan-main-required-checks.test.mjs scripts/harness/__tests__/scan-required-check-local-reachability.test.mjs`.
- Result: exit 0; the combined focused run passed 50/50 tests. Parsed CI retained exactly one
  `pnpm harness:verify:release` entrypoint and the root diagnostic script remained defined.

### [GATE-COMPLETE: TC-04] — ✅ VERIFIED | 2026-08-14

- Actions: inspected `.agents/rules/git-branch.md`, `.agents/rules/verification.md`, and
  `scripts/harness/README.md`; ran `pnpm harness:scan`.
- Result: exit 0; 108 scans passed, 2 skipped. Current documents consistently name protected CI as
  sole automatic owner, while archived historical evidence remains untouched.

### [GATE-COMPLETE: TC-05] — ✅ VERIFIED | 2026-08-14

- Command: `pnpm harness:verify-like-ci`.
- Result: exit 0; all 12 stages passed in 4m 7.3s, including repository-contract 2,232/2,232,
  hermetic 1,055/1,055, typecheck, and both scan suites.
- Test skipped: this criterion is the direct aggregate execution of the authoritative root gates;
  wrapping them in another automated test would duplicate the gate rather than test new behavior.

### [GATE-COMPLETE EVIDENCE SUMMARY] — READY | 2026-08-14

- TC-01 through TC-05 are checked and each has exact verification output plus a test reference or
  explicit skip reason. The active task is completion-ready with no blocker.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → done
TC-01 through TC-05 each have labelled command/result/exit evidence and an exact test reference or
explicit skip reason. The linked task had all five Plan items complete with no blocker; this PASS
authorizes the atomic terminal status and archive transition.
