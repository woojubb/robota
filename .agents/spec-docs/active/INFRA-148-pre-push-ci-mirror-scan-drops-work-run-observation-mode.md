---
status: in-progress
type: INFRA
tags: [harness, git, ci, measurement]
lane: L2
---

# INFRA-148: preserve Work-Run observation through the pre-push CI mirror

## Problem

PR #2566 reproduced a split-brain Work-Run measurement inside one `git push`. The dedicated
pre-push gate called `validateWorkRunRange` with `prObservation: pre-push` and passed. Later, after
222 contract files / 4,617 tests, 222 stripped follow-up tests, and 71 hermetic files / 1,118 tests
passed, `pre-push-verification-execution.mjs` launched the required `harness:scan` CI mirror as a
new process. That nested `scan-work-run-measurement.mjs` process had lost the enclosing observation
and defaulted to `post-push`, so it rejected the still-local candidate as `post-pr-local-fix`.

The failure is deterministic for an authorized post-findings generation whose new head has not yet
reached GitHub. It cannot be fixed inside PR #2566 because that generation's authorization scope is
immutable, and `--no-verify` is prohibited. The missing context must land independently from a fresh
`origin/develop` branch, after which PR #2566 can rebase and use the normal hook.

## Prior Art Research

- Git defines `pre-push` as a local, pre-publication boundary and supplies the candidate and current
  remote object IDs before publication. Remote `post-receive` happens only after a ref update.
  [Git hooks — `pre-push`](https://git-scm.com/docs/githooks#_pre_push)
- A GitHub Actions `push` workflow observes already-published remote state: `GITHUB_SHA` identifies
  the pushed tip of `GITHUB_REF`, while runner variables make the remote event explicit.
  [GitHub Actions push events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push)
  and [variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables)
- GitHub environment-file values become visible only to later steps. A same-step nested command must
  receive context directly in its child environment.
  [GitHub workflow commands — environment variables](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-an-environment-variable)
- Node child-process APIs inherit `process.env` by default, while an explicit `options.env` replaces
  it. A launcher that adds context must merge the parent environment rather than discard it.
  [Node.js `child_process`](https://nodejs.org/api/child_process.html)

The common model is to determine candidate-versus-published state at the boundary that has
authoritative evidence, then transport that typed decision inward. A nested validator cannot
reconstruct the enclosing pre-publication phase reliably from `HEAD` or remote state.

## Architecture Review

### Affected Scope

- `scripts/harness/pre-push.mjs` — command runner support for a per-command environment overlay
- `scripts/harness/pre-push-verification-execution.mjs` — scope `pre-push` observation to the nested
  required-scans mirror
- `scripts/harness/scan-work-run-measurement.mjs` — parse the harness-owned observation value and
  pass it explicitly into repository validation
- focused tests under `scripts/harness/__tests__/`
- paired Task/spec and Work-Run lifecycle artifacts

### Alternatives Considered

1. Carry one typed observation value in the nested scan child environment.
   - Pro: preserves the lifecycle fact across `pnpm`/Node process boundaries without changing the
     mirrored command, and can reject invalid values before validation.
   - Con: adds one harness-private environment contract that must be kept scoped to one child.
2. Append an observation CLI argument to the required-scans mirror.
   - Pro: explicit at the command line.
   - Con: the repository mechanically requires the local mirror argv to equal the CI scans command;
     changing it creates false parity and couples CI to a local-only phase.
3. Skip Work-Run measurement when the pre-push sequence reaches its nested scan.
   - Pro: avoids duplicate measurement work.
   - Con: the local CI mirror would stop exercising a required scan and could hide integration drift.
4. Bypass the hook for PR #2566 and rely on hosted CI.
   - Pro: no implementation work.
   - Con: violates the repository's zero-exception `--no-verify` rule and hides a reproducible defect.

### Decision

Choose alternative 1. Define one harness-private observation environment key whose closed vocabulary
is exactly `pre-push | post-push`. The pre-push verification sequence adds `pre-push` only to the
nested required-scans command. The command runner merges that overlay with `process.env`; unrelated
commands receive no overlay. `scan-work-run-measurement.mjs` parses the value at its process boundary,
passes a valid value explicitly to `validateWorkRunRange`, retains the existing `post-push` behavior
when the key is absent, and fails with a specific diagnostic when the value is present but invalid.

The CI scans command and argv remain unchanged, so `pre-push-mirrors-ci-scans` continues to prove
command parity. GitHub Actions and standalone scans do not receive the local overlay and therefore
retain post-publication semantics. There is no inference from network state and no fallback from an
invalid explicit value. The new environment key remains root-private harness plumbing and creates no
package or public SDK surface.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — existing pre-push runner, verification sequence, CI mirror contract, and
      Work-Run scanner were inspected; the bridge remains in their root-private harness family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None. An absent internal key intentionally preserves the scanner's current standalone/CI
`post-push` default. A present but invalid key is an integrity error and fails closed; it never
degrades to either lifecycle meaning.

## Solution

1. Add focused failing tests for per-command environment propagation and scanner-boundary parsing.
2. Extend the pre-push command runner with an optional environment overlay merged over `process.env`.
3. Attach `pre-push` only to the nested required-scans mirror command.
4. Parse and validate the environment key in the Work-Run measurement scanner and pass the typed
   observation to repository validation.
5. Prove CI argv parity, focused behavior, harness tiers, and the original normal-push path.

## Affected Files

| Path | Change |
| --- | --- |
| `scripts/harness/pre-push.mjs` | Merge an optional per-command environment overlay for child processes |
| `scripts/harness/pre-push-verification-execution.mjs` | Scope the pre-push observation to the nested scans mirror |
| `scripts/harness/scan-work-run-measurement.mjs` | Validate and forward the process observation |
| `scripts/harness/__tests__/**` | Regression, boundary, leakage, and command-parity coverage |
| `.agents/tasks/INFRA-148-pre-push-ci-mirror-scan-drops-work-run-observation-mode.md` | Persistent work record |

## Completion Criteria

- [ ] TC-01: the nested required-scans process receives `pre-push`, and an authorized unpublished
      post-findings head is evaluated as a pre-push candidate rather than `post-pr-local-fix`.
- [ ] TC-02: absent observation context retains the scanner's current `post-push` default, while
      explicit `pre-push` and `post-push` values reach repository validation unchanged.
- [ ] TC-03: any present value outside `pre-push | post-push` fails closed with a specific diagnostic
      before Work-Run repository validation starts.
- [ ] TC-04: unrelated pre-push child commands receive no observation overlay, inherited environment
      entries survive merging, and the required-scans argv remains exactly aligned with CI.
- [ ] TC-05: focused tests, harness contract/hermetic tiers, `pnpm harness:scan`, independent local
      review, and the normal PR #2566 push path all pass without a hook bypass.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| --- | --- | --- | --- |
| TC-01 | Sequence regression | Pre-push verification execution test plus Work-Run fixture for an unpublished authorized generation | Reproduces the original nested-scan failure shape |
| TC-02 | Boundary unit | Scanner adapter tests for absent, `pre-push`, and `post-push` inputs | Asserts exact value forwarded to validation |
| TC-03 | Negative unit | Scanner adapter test with an invalid environment value | Requires named fail-closed diagnostic and no validator call |
| TC-04 | Contract/sequence | Command-runner environment tests and existing CI mirror parity test | Covers merge preservation, leakage, and unchanged argv |
| TC-05 | Regression/integration | Focused suites, `pnpm harness:test:contracts`, `pnpm harness:test:hermetic`, `pnpm harness:scan`, local review, and hosted push evidence | Hook bypass is forbidden; hosted push closes the original reproduction |

## User Execution Test Scenarios

Not applicable. This change governs repository-internal pre-push verification and exposes no Robota
CLI, TUI, browser, or public SDK behavior. Its observable contract is covered by harness sequence,
boundary, and hosted push evidence.

## Tasks

- [ ] `.agents/tasks/INFRA-148-pre-push-ci-mirror-scan-drops-work-run-observation-mode.md`

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-01

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: the file begins with a closed `---`
  frontmatter block. — `mechanical`
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft` is present. — `mechanical`
- GATE-WRITE — `type:` is exactly one allowed value: `type: INFRA` is in the 11-value catalogue.
  — `mechanical`
- GATE-WRITE — `tags:` field present: four tags are present. — `mechanical`
- GATE-WRITE — Contains a concrete symptom: PR #2566's dedicated pre-push Work-Run validation passes
  with `prObservation: pre-push`, then the nested required-scans process defaults to `post-push` and
  rejects the same unpublished candidate as `post-pr-local-fix` after the enumerated passing test tiers.
  — `semantic`
- GATE-WRITE — Contains a reproduction condition: the Problem identifies an authorized post-findings
  generation whose new head is still local, the nested `harness:scan` process boundary where observation
  is lost, and PR #2566 as the concrete occurrence. — `semantic`
- GATE-WRITE — Does not contain TBD/TODO or a vague single-sentence description: the Problem is seven
  concrete sentences and contains neither placeholder. — `mechanical`
- GATE-WRITE — Prior Art Research section present: `## Prior Art Research` is present. — `mechanical`
- GATE-WRITE — Research is substantiated: it cites Git hook, GitHub Actions event/variable and
  environment-file documentation plus the Node child-process API. — `mechanical`
- GATE-WRITE — Research waiver alternative: N/A — cited documentation satisfies the research route, so
  no waiver is required. — `mechanical`
- GATE-WRITE — Research findings feed Alternatives/Decision: Git and GitHub establish the authoritative
  pre-publication versus published boundaries, GitHub environment-file timing rules out a same-step
  indirect handoff, and Node environment inheritance supports the chosen merged child-environment
  overlay over the CLI-parity-breaking and scan-skipping alternatives. — `semantic`
- GATE-WRITE — All four Architecture Review Checklist items are `[x]`: 4/4 are checked. — `mechanical`
- GATE-WRITE — Sibling scan is checked with completion evidence: it names the pre-push runner,
  verification sequence, CI mirror contract, and Work-Run scanner and classifies the bridge in their
  root-private harness family. — `mechanical`
- GATE-WRITE — Alternatives Considered has at least two entries with pro/con: four numbered alternatives
  each state both. — `mechanical`
- GATE-WRITE — Decision references the driving trade-off: a scoped environment overlay preserves the
  authoritative observation across nested processes while keeping CI argv parity and standalone/CI
  post-push semantics, at the cost of one validated harness-private environment contract. — `semantic`
- GATE-WRITE — New-surface placement: the conditional internal process-boundary interface is placed with
  the analogous existing pre-push runner, verification sequence, CI mirror contract, and Work-Run
  scanner in the root-private harness family; the observation contract is shared inside that harness
  boundary and creates no dependency on a sibling PRODUCT, package, app, or public SDK surface.
  — `semantic`
- GATE-WRITE — Every Completion Criterion has a `TC-NN` prefix: five criteria are prefixed TC-01 through
  TC-05. — `mechanical`
- GATE-WRITE — At least one criterion covers each distinct sub-item: TC-01 covers the original nested-scan
  regression, TC-02 valid/default boundary values, TC-03 invalid-value refusal, TC-04 environment
  inheritance/leakage and argv parity, and TC-05 full regression plus normal-push verification.
  — `semantic`
- GATE-WRITE — Each criterion uses observable form: every TC names a received/forwarded value, explicit
  diagnostic and call suppression, environment/argv state, classified candidate result, or passing gate
  and push outcome. — `semantic`
- GATE-WRITE — No Completion Criterion uses a banned vague phrase: none of `works correctly`, `no errors`,
  `implemented`, or `displays correctly` appears. — `mechanical`
- GATE-WRITE — Test Plan section present: `## Test Plan` is present. — `mechanical`
- GATE-WRITE — One Test Plan row exists per TC: five rows match TC-01 through TC-05. — `mechanical`
- GATE-WRITE — Each Test Plan row has non-empty Test Type and Tool/Approach: all five do and none contains
  TBD. — `mechanical`
- GATE-WRITE — Manual rows have explanatory Notes: N/A — zero rows use `manual`. — `mechanical`
- GATE-WRITE — Tasks section present with placeholder: the unchecked exact paired Task path is present.
  — `mechanical`
- GATE-WRITE — Evidence Log was empty before this first GATE-WRITE entry. — `mechanical`
- GATE-WRITE — No `## Status` or `## Classification` section exists in the body. — `mechanical`

**Independent guardian verdict:** `GATE-WRITE: PASS` — the gate script measured all 20 mechanical
criteria PASS with zero failures, and independent review found all seven pending semantic criteria
satisfied. Completion Criteria and Test Plan counts match at 5/5.

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-01

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "타당한 근거와 함께 추천안을 제시하면 타당할경우 자동 승인하겠습니다"
**Given:** 2026-09-01, this conversation
**Review fingerprint:** f2ae8e45e083 (review 3a862190, type/tags ab706b79)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-01, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f2ae8e45e083) equals the document's current fingerprint

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-01

**Status remains:** review-ready

- GATE-APPROVAL — ordering: PASS — the prior GATE-WRITE PASS is recorded and the document is
  `status: review-ready` under `.agents/spec-docs/backlog/`.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: FAIL —
  `타당한 근거와 함께 추천안을 제시하면 타당할경우 자동 승인하겠습니다` is a conditional
  standing instruction for a category of future recommendations. It does not name INFRA-148, this
  document path, or this document's Decision, and therefore does not clearly confirm this design and
  authorize its implementation. `backlog-execution.md` explicitly states that standing authorization
  is not, on its own, approval of any particular spec.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A for the recorded DIRECT
  route. The instruction cannot be reclassified to rescue the gate: the only registered classes are
  `LANE-L0-L1` and `BACKLOG-ZERO-MIGRATION`, while INFRA-148 is an L2 harness implementation and matches
  neither scope.
- GATE-APPROVAL — Independent architecture validation (conditional): FAIL — the Decision introduces a
  new harness-private process-boundary environment interface. The GATE-WRITE placement evidence locates
  it in the root-private harness family, but the Evidence Log contains no independent
  `proposal-reviewer` `ENDORSE` that explicitly covers that placement and no retained structure-channel
  result, which this conditional criterion requires before approval.
- GATE-APPROVAL — NON-COMPLIANCE trigger: not triggered — the worktree contains only the untracked paired
  Task/spec planning artifacts and no implementation path or implementation commit. The missing
  document-specific approval and independent placement review are correctable gate failures.

**Independent guardian verdict:** `GATE-APPROVAL: FAIL` — the recorded standing instruction does not
satisfy Route DIRECT for this specific document, no registered Route CLASS covers it, and the required
independent placement endorsement is absent.

GATE VERDICT: FAIL

### [PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-09-01

Independent proposal review inspected the actual process chain and confirmed each premise: the
dedicated pre-push validator already supplies `prObservation: pre-push`; the nested required-scans
process loses it; the scanner consequently reaches the repository validator's `post-push` default;
and the proposed environment overlay repairs exactly that process boundary.

The reviewer explicitly endorsed placement across the existing root-private harness owners:
`pre-push.mjs` owns child-process environment merging,
`pre-push-verification-execution.mjs` owns which nested command receives the overlay, and
`scan-work-run-measurement.mjs` owns parsing process input into repository validation. It confirmed
that the overlay changes neither the `CI_SCANS_JOB_MIRROR` command nor argv, absence preserves
standalone/CI `post-push`, and an invalid explicit value can fail before repository validation. No
package, product, public-surface, dependency-direction, placement, or scope defect remains.

`REVIEW VERDICT: ENDORSE`

### [GATE-APPROVAL] — ✅ PASS | 2026-09-02

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-02, this conversation
**Review fingerprint:** f2ae8e45e083 (review 3a862190, type/tags ab706b79)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-02, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (f2ae8e45e083) equals the document's current fingerprint

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS —
  the recorded `승인함` was given immediately in reply to the explicit request `INFRA-148의 현재
  Decision을 승인하며 구현 진행을 승인함`. The request names this document, its current
  Decision, and implementation authorization, so the reply clearly confirms this design rather than a
  standing category, a clarifying answer, silence, or approval of another item.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — the valid route is
  DIRECT and relies on the document-specific instruction above, not on a delegated class.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS/N/A — INFRA-148 changes
  root-private plumbing among the existing pre-push runner, verification sequence, and Work-Run scanner;
  it introduces no new package, app, presentation/interface surface, or layer/product-family
  reclassification. In addition, the recorded independent proposal review explicitly inspected those
  owners and placement and returned `REVIEW VERDICT: ENDORSE` with no placement or dependency-direction
  defect.

**Independent guardian verdict:** `GATE-APPROVAL: PASS` — the latest DIRECT instruction is specific and
unambiguous for INFRA-148, Route CLASS is not used, and the independent placement evidence satisfies the
applicable architecture check. The prior FAIL remains preserved as historical evidence.

GATE VERDICT: PASS

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-02

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-02; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-148-pre-push-ci-mirror-scan-drops-work-run-observation-mode.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-148-pre-push-ci-mirror-scan-drops-work-run-observation-mode.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 446 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->
```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/INFRA-148-pre-push-ci-mirror-scan-drops-work-run-observation-mode.md",
  "specPath": ".agents/spec-docs/todo/INFRA-148-pre-push-ci-mirror-scan-drops-work-run-observation-mode.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-148-pre-push-ci-mirror-scan-drops-work-run-observation-mode.md",
    ".agents/tasks/INFRA-148-pre-push-ci-mirror-scan-drops-work-run-observation-mode.md"
  ]
}
```
<!-- checkpoint-evidence:v1:end -->
