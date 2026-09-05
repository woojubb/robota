---
status: done
type: RULE
tags: [harness, governance]
lane: L1
---

# INFRA-165: ignore inherited receipts when correlating merge commits

## Problem

Merging current develop into S2 fails prepare-commit-msg with "ambiguous work-run receipt closure" because four receipts already committed in merge parents appear as additions against HEAD. pendingTerminalReceiptCorrelation treats every staged receipt as newly pending. This blocks valid integration despite no new receipt closure.

## Prior Art Research

Waived: bounded internal Git correlation bug; existing receipt validation remains authoritative.

## Architecture Review

### Affected Scope

Work-run pending-receipt correlation and its existing hook integration tests only.

### Alternatives Considered

1. Skip all receipt checks during merges.
   - Pro: unblocks the merge.
   - Con: admits genuinely new or modified closure data.
2. Ignore only staged receipt blobs proven identical in real merge parents.
   - Pro: separates inherited history while retaining validation for new changes.
   - Con: needs fail-closed Git object inspection.

### Decision

**Delivery mode:** `single`

Use alternative 2 under the owner instruction "잘못된 하네스나 작업 비효율을 유발하는 하네스를 발견하면 나에게 보고하고 개선해". Read actual MERGE_HEAD and immutable parent blobs; do not trust a commit-message source flag or an arbitrary branch name. Preserve existing ordinary commit behavior. Rebase behavior is explicitly outside this fix.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: repository machinery, no product surface
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Before counting pending receipt changes, exclude only unchanged parent-owned receipts during an actual in-progress merge. Verify the indexed object matches a merge parent object, retaining mode/path identity. Missing merge state is the ordinary path; unreadable or malformed state is not permission to suppress checks. If any receipt remains pending, apply the existing exact single-added-receipt, mixed-path and terminal-schema validation unchanged.

## Affected Files

- `scripts/harness/work-run-pending-receipt.mjs`
- `scripts/harness/__tests__/work-run-hook.test.mjs`
- This spec and paired Task. No hook policy, rebase behavior, CI or product source changes.

## Completion Criteria

- [x] TC-01: Real merge imports containing multiple unchanged receipts already present in merge parents return no pending terminal receipt correlation.
- [x] TC-02: A genuinely new receipt, changed receipt or receipt mixed with other closure paths retains existing fail-closed validation.
- [x] TC-03: Real Git fixture regression is RED on the original implementation, then the work-run hook suite and syntax checks pass after the bounded fix.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                                                                           | Notes                                                                      |
| ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TC-01 | Integration | `scripts/harness/__tests__/work-run-hook.test.mjs` — `tracked work-run Git hooks > does not treat receipts inherited from a merge parent as new closures` | Real Git branches and MERGE_HEAD, four inherited receipts.                 |
| TC-02 | Integration | `scripts/harness/__tests__/work-run-hook.test.mjs` — `tracked work-run Git hooks`, including the inherited-receipt test's opposite-path assertions        | Altered/new/mixed receipt and non-merge controls.                          |
| TC-03 | Regression  | `scripts/harness/__tests__/work-run-hook.test.mjs` — `tracked work-run Git hooks`, and node --check                                                       | Original RED, fixed 15-test GREEN, then final full gate PASS on 573e3e860. |

## User Execution Test Scenarios

Not applicable.

**Reason:** This is repository-internal commit correlation machinery, not a shipped CLI or SDK capability. Git fixtures verify the process behavior; no product user surface changes.

## Tasks

- [x] `.agents/tasks/completed/INFRA-165-ignore-inherited-receipts-when-correlating-merge-commits.md` — focused verification, final full gate and remote develop integration passed.

## Evidence Log

### Implementation verification — 2026-09-05

Original regression RED: /tmp/infra165-red.log, ambiguous pending receipt failure. Final focused run: /tmp/infra165-final-green-3.log, 15/15 tests PASS (14.44 seconds). Intermediate fixture setup failures are preserved separately. Both changed JavaScript files pass node --check and git diff --check. No transpilation/build target exists for these native Node ESM scripts. Independent source review: recover_approved_artifacts, actionable findings 0. Final integrated gate remains pending under root ownership after receipt closure.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "잘못된 하네스나 작업 비효율을 유발하는 하네스를 발견하면 나에게 보고하고 개선해"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** 002e2a721e42 (review 485728a4, type/tags beb69ef8)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (002e2a721e42) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `579aca454726` · base `origin/develop@579aca454726` · document `.agents/spec-docs/draft/INFRA-165-ignore-inherited-receipts-when-correlating-merge-commits.md` blob `ba31c56c1d81` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 331 chars, 3 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 3 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows = 3 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 3 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (002e2a721e42) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-165-ignore-inherited-receipts-when-correlating-merge-commits.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-165-ignore-inherited-receipts-when-correlating-merge-commits.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `579aca454726` · base `origin/develop@579aca454726` · document `.agents/spec-docs/draft/INFRA-165-ignore-inherited-receipts-when-correlating-merge-commits.md` blob `c72293442cb7` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs";const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/work-run-hook.test.mjs"]);process.stdout.write(r.stdout??"");process.stderr.write(r.stderr??"");process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 33 line(s))

```
{"status":"trailed","runId":"15f3f55b-5dba-4c0c-932e-12b28eaed13d","receipt":"g0-r0"}
{"status":"trailed","runId":"15f3f55b-5dba-4c0c-932e-12b28eaed13d","receipt":"g0-r0"}
Switched to a new branch 'codex/receipt-closure'
{"status":"trailed","runId":"state-lost-run","receipt":"g0-r0"}
Switched to a new branch 'codex/receipt-closure'
{"schemaVersion":1,"runId":"4d786b9f-2936-4788-bce3-5845699ca091","events":[{"schemaVersion":1,"runId":"4d786b9f-2936-4788-bce3-5845699ca091","sequence":1,"previousHash":null,"type":"work.claimed","at":"2026-09-05T10:15:46.120Z","data":{"branch":"codex/receipt-closure"},"hash":"65f68978726c1e0b03940a86afbbf57bdae2fa3b6a9dc31035625e167bd4ec54"}]}
{"status":"trailed","runId":"4d786b9f-2936-4788-bce3-5845699ca091","receipt":"g0-r0"}
Switched to a new branch 'codex/receipt-closure'
Switched to a new branch 'codex/receipt-closure'
HEAD is now at b048ead chore: base
```

**Judged at:** HEAD `8833f601b881` · base `origin/develop@579aca454726` · document `.agents/spec-docs/todo/INFRA-165-ignore-inherited-receipts-when-correlating-merge-commits.md` blob `362c34e977d9` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs";const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/work-run-hook.test.mjs"]);process.stdout.write(r.stdout??"");process.stderr.write(r.stderr??"");process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 33 line(s))

```
{"status":"trailed","runId":"15f3f55b-5dba-4c0c-932e-12b28eaed13d","receipt":"g0-r0"}
{"status":"trailed","runId":"15f3f55b-5dba-4c0c-932e-12b28eaed13d","receipt":"g0-r0"}
Switched to a new branch 'codex/receipt-closure'
{"status":"trailed","runId":"state-lost-run","receipt":"g0-r0"}
Switched to a new branch 'codex/receipt-closure'
{"schemaVersion":1,"runId":"4d786b9f-2936-4788-bce3-5845699ca091","events":[{"schemaVersion":1,"runId":"4d786b9f-2936-4788-bce3-5845699ca091","sequence":1,"previousHash":null,"type":"work.claimed","at":"2026-09-05T10:15:46.120Z","data":{"branch":"codex/receipt-closure"},"hash":"65f68978726c1e0b03940a86afbbf57bdae2fa3b6a9dc31035625e167bd4ec54"}]}
{"status":"trailed","runId":"4d786b9f-2936-4788-bce3-5845699ca091","receipt":"g0-r0"}
Switched to a new branch 'codex/receipt-closure'
Switched to a new branch 'codex/receipt-closure'
HEAD is now at b048ead chore: base
```

**Judged at:** HEAD `8833f601b881` · base `origin/develop@579aca454726` · document `.agents/spec-docs/todo/INFRA-165-ignore-inherited-receipts-when-correlating-merge-commits.md` blob `8578a0ee925f` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-05

**Command:** `node --input-type=module -e 'import {vitestInvocation} from "./scripts/harness/harness-vitest-process.mjs";const r=vitestInvocation(process.cwd(),["scripts/harness/__tests__/work-run-hook.test.mjs"]);process.stdout.write(r.stdout??"");process.stderr.write(r.stderr??"");process.exit(r.status??1);'`
**Exit:** 0
**Output:** (last 10 of 33 line(s))

```
{"status":"trailed","runId":"15f3f55b-5dba-4c0c-932e-12b28eaed13d","receipt":"g0-r0"}
{"status":"trailed","runId":"15f3f55b-5dba-4c0c-932e-12b28eaed13d","receipt":"g0-r0"}
Switched to a new branch 'codex/receipt-closure'
{"status":"trailed","runId":"state-lost-run","receipt":"g0-r0"}
Switched to a new branch 'codex/receipt-closure'
{"schemaVersion":1,"runId":"4d786b9f-2936-4788-bce3-5845699ca091","events":[{"schemaVersion":1,"runId":"4d786b9f-2936-4788-bce3-5845699ca091","sequence":1,"previousHash":null,"type":"work.claimed","at":"2026-09-05T10:15:46.120Z","data":{"branch":"codex/receipt-closure"},"hash":"65f68978726c1e0b03940a86afbbf57bdae2fa3b6a9dc31035625e167bd4ec54"}]}
{"status":"trailed","runId":"4d786b9f-2936-4788-bce3-5845699ca091","receipt":"g0-r0"}
Switched to a new branch 'codex/receipt-closure'
Switched to a new branch 'codex/receipt-closure'
HEAD is now at b048ead chore: base
```

**Judged at:** HEAD `8833f601b881` · base `origin/develop@579aca454726` · document `.agents/spec-docs/todo/INFRA-165-ignore-inherited-receipts-when-correlating-merge-commits.md` blob `ccacf6965733` (modified)

### [GATE-DONE] — ✅ PASS | 2026-09-05

**Status upgrade:** approved → done

**Guardian:** recover_approved_artifacts, independent of implementation author. Existing actual verification evidence reviewed; no commands rerun for record creation. This entry records the present completion judgment, not a retrospective planning approval.

**Ordering:** PASS — lane L1, current spec status `approved` in `todo/`, with recorded GATE-PLAN PASS and prior DIRECT approval. L1 DONE combines GATE-VERIFY and GATE-COMPLETE criteria.

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): PASS — exact paired INFRA-165 Task has TC-01, TC-02 and TC-03 checked, 3/3.
- GATE-VERIFY — No Plan item is blocked or pending: PASS — all three planned work items complete; no blocked/pending Plan item.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): PASS — native Node ESM harness-only change, no affected product package build. Existing actual `node --check` on both changed modules succeeded (implementation evidence and caller's actual execution report). `/tmp/infra165-verify-like-ci.log` reports affected dist-free scan PASS and product build explicitly N/A; this does not claim a product build ran.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): PASS — existing canonical vitestInvocation work-run hook run in `/tmp/infra165-final-green-3.log` has 15/15 tests PASS, exit 0, 14.44 seconds. Final `/tmp/infra165-verify-like-ci.log` reports all 11 stages PASS, including harness-self-test and harness-hermetic-test. Intermediate failures remain preserved; no failed run is relabelled.
- GATE-COMPLETE — The checkbox is checked (`[x]`): PASS for TC-01, TC-02 and TC-03, individually checked in Completion Criteria.
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: PASS for each of TC-01, TC-02 and TC-03 — each existing entry contains the exact canonical vitestInvocation command, actual output and exit 0. Original regression RED is separately retained at `/tmp/infra165-red.log` and shows the ambiguous pending receipt failure before the fix.
- GATE-COMPLETE — **One of the following is recorded:** PASS for each TC — all three Test Plan rows name `scripts/harness/__tests__/work-run-hook.test.mjs` and the actual `tracked work-run Git hooks` describe; TC-01 additionally names the exact inherited-receipt test. TC-02 opposite-path assertions cover new/changed/mode-changed/deleted receipts and unreadable merge parent; existing ordinary controls remain.
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: PASS — three TC rows, three explicit references, no missing row.
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: PASS — 3/3.
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: PASS — TC-01 through TC-03 have exact file/describe references.
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: PASS — `.agents/tasks/INFRA-165-ignore-inherited-receipts-when-correlating-merge-commits.md` exists and is the paired Task.
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: PASS — the exact active Task exists, all three Plan items are checked, and no blocked or pending work remains in its Plan. Archive/status disposition is a post-PASS caller action.

**Evidence binding:** Delivered commit `573e3e860b34684edaeff98a212af76e45c25a05`, prior base `579aca454726eb1eeeb1ccf1602f9bd4207e0808`. Fresh fetch and remote ls-remote independently confirmed delivery to develop, with expected five files and no unrelated changes. Current S2-tree source hashes match that reviewed/delivered implementation: pending-receipt module SHA256 `4e70c8c09be9eb45acf916b6912caae1f2bdb9a5806e355632aeed9063dbd9fc`; hook tests SHA256 `511f6087d79be34bcc6985dc02177bb82f05c2bff7a5d2002cdfaa33bb6b10b9`. Later changes to this item are Test Plan reference clarification and Task Issue #2583 linkage, not executable inputs. Independent code review ACTIONABLE FINDINGS: 0 and MERGE VERIFIED: PASS remain bound to these hashes.

**Product user scenario:** N/A — exact Task records `SCENARIO DRAFTED: not-applicable | 0` for repository-internal Git correlation, not a shipped product surface. No new runtime scenario success is claimed.

**Verdict reason:** All L1 DONE completion and scoped verification criteria are met by actual preserved evidence. This judgment covers INFRA-165 only, not the separate S2 final gate. Status transition, archive and issue closure remain caller-owned.
