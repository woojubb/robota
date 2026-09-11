---
status: in-progress
type: BEHAVIOR
tags: [cli]
lane: L2
---

# BEHAVIOR-2698: Preserve non-clean diagnostic evidence across scan receipt reuse

Paired with `.agents/tasks/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md`.
Arising from [issue #2698](https://github.com/woojubb/robota/issues/2698) as its receipt-reuse cause;
the parent Agreement owns the wider policy migration.

## Problem

`scan-receipt.mjs` persists only a schema-v1 `status: "pass"` identity. When a covered scan produces a
non-clean structured diagnostic that does not make the command exit non-zero (for example, a rejected
detector becomes `unavailable`), the receipt has no place to retain it. On the next clean,
unchanged-tree invocation, `run-all-scans.mjs` takes the receipt-hit branch, supplies an empty
diagnostic array, and reports that covered scans were not re-run. The known unavailable or finding
evidence is then absent from the output and the hit resembles a clean result.

The failure is reproducible with a two-run fixture: first run a covered detector that produces a
structured `finding` or `unavailable` outcome and records the matching receipt; on the second run with
the same identity, the previous diagnostic ID must still be visible and that named covered detector
must run. A receipt representing a wholly clean covered result is the sole case allowed to skip its
covered detector without another execution.

## Prior Art Research

- GitHub Actions creates a dependency cache only after a successful job; an unavailable cache is not
  presented as a hit. [GitHub Actions dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- GitLab makes failed-output retention an explicit `on_failure` or `always` cache policy rather than
  inferring success from cache access. [GitLab CI cache policy](https://docs.gitlab.com/ci/yaml/#cachewhen)
- Buildkite treats caches as temporary performance accelerators and keeps logs/reports as durable,
  addressable artifacts. [Buildkite caching](https://buildkite.com/docs/pipelines/best-practices/caching)
  and [artifacts](https://buildkite.com/docs/guides/artifacts)
- Gradle requires declared inputs/outputs for reuse and visibly distinguishes `FROM-CACHE` from
  `FAILED`. [Gradle build cache](https://docs.gradle.org/current/userguide/build_cache.html) and
  [task outcomes](https://docs.gradle.org/current/userguide/gradle_optimizations.html)

These references converge on a cache being a performance optimization, never a substitute for failure
evidence. Robota will retain a validated report when it is non-clean, render that evidence explicitly
on a matching hit, and treat unreadable or incompatible report data as a miss. The report must not be
silently converted into clean state merely because the tree identity matches.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-receipt.mjs` — schema, validation, identity match, receipt write, and reuse plan.
- `scripts/harness/run-all-scans.mjs` — receipt-hit orchestration, deterministic replay, selective re-check,
  and prevention of a partial re-check from replacing a full receipt.
- `scripts/harness/diagnostic-core.mjs` and `diagnostic-renderer.mjs` — existing private versioned
  report validation/rendering reused without new exports or a package boundary.
- `scripts/harness/__tests__/scan-receipt.test.mjs` and `run-all-scans.test.mjs` — schema and two-run
  behavioral regression coverage.

### Alternatives Considered

1. Treat every non-clean report as an ordinary cache miss and rerun all covered scans. Pro: no receipt
   payload extension. Con: the original evidence is not re-rendered and clean siblings lose the
   performance benefit even though they remain trustworthy.
2. Persist a non-clean report and replay it, but skip every covered detector on a hit. Pro: lowest
   repeat-run cost. Con: a known non-clean detector never gets a fresh attempt, contrary to the
   approved requirement that only wholly clean covered work may skip rerun.
3. Persist a strict, versioned immutable report; replay it and re-run only its named covered
   non-clean detectors; never replace the full receipt from this partial re-check (chosen). Pro:
   preserves evidence, permits recovery observation, and keeps clean covered work reusable. Con:
   requires an explicit v2 receipt schema and a small runner orchestration seam.

### Decision

Choose alternative 3. `scan-receipt.mjs` will own a v2 receipt validation boundary that accepts either
an explicit wholly-clean covered state or a `diagnostic-core` validated report. A matching receipt
whose report is wholly clean returns the existing covered-scan reuse plan. A matching receipt with
non-clean results returns the immutable report plus the unique named covered scans to re-run; each
result must identify one selected covered scan, otherwise the receipt is a miss. The runner renders
the stored report before gathering that selective re-check. It does not write a new receipt because
the fresh work was not a complete covered suite.

The existing private `diagnostic-core.mjs` is the shared I/O-free owner for validation and
`diagnostic-renderer.mjs` remains the deterministic presentation adapter. Receipt storage and the
runner are existing imperative adapters that depend inward on those modules. This introduces no
package, product surface, public API, or new architectural placement; it applies the parent
Agreement's already-reviewed direction `diagnostic-core` ← renderer ← runner/receipt adapters.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — private harness receipt, runner, report core/renderer, and focused tests are named above.
- [x] Sibling scan 완료 — `verification-receipt.mjs` and the current scan-receipt clean-tree/cache-miss behavior were compared; no product CLI command family is involved.
- [x] 대안 최소 2개 검토 완료 — three storage/re-run alternatives state both benefits and costs.
- [x] 결정 근거 문서화 완료 — the chosen path preserves non-clean evidence and fresh observation while retaining safe clean reuse.

## Fallback & Degradation Declaration

None. Invalid, unsupported, duplicate, or unmappable diagnostic receipt data is not a fallback to
clean: it is an explicit cache miss and causes a full observed run. A partial non-clean re-check never
replaces the complete receipt, so it cannot accidentally certify unrun covered detectors.

## Solution

Extend the scan receipt schema with a strict diagnostic-report field and validate it with the existing
private diagnostic core. Teach reuse planning to distinguish a wholly clean matching report from a
non-clean matching report. Factor the receipt-aware runner orchestration behind an injected test seam:
a clean hit runs only tree-external scans, while a non-clean hit first renders the persisted report and
runs the union of tree-external scans and named affected covered scans. Return complete-run diagnostic
data to the receipt writer only; the selective re-check is report-only and cannot overwrite the
receipt. Keep missing, old, malformed, and incompatible receipts on the current full-run path.

## Affected Files

- `.agents/tasks/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md` — Task and test plan.
- `scripts/harness/scan-receipt.mjs` — v2 receipt schema, validation, and reuse-plan result.
- `scripts/harness/run-all-scans.mjs` — deterministic replay and selective re-check orchestration.
- `scripts/harness/__tests__/scan-receipt.test.mjs` — receipt-schema and plan fixtures.
- `scripts/harness/__tests__/run-all-scans.test.mjs` — two-run replay/re-run behavior fixtures.

## Completion Criteria

- [ ] TC-01: A valid v2 clean receipt and a valid v2 non-clean diagnostic report pass receipt validation; a v1, malformed, incompatible, duplicate, or unmappable report is a cache miss and is never reported as reused.
- [ ] TC-02: A matching wholly clean receipt runs no covered detector and visibly reports normal receipt reuse; tree-external scans retain their existing always-run behavior.
- [ ] TC-03: A two-run fixture with a cached `finding` renders the original stable diagnostic ID on its unchanged-tree hit, re-runs the named covered detector, and does not write a replacement full receipt from that partial re-check.
- [ ] TC-04: A two-run fixture with a cached `unavailable` result has the same replay/re-run behavior, while a full observed clean run writes the only reusable clean receipt.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| ----- | --------- | --------------- | ----- |
| TC-01 | unit | `scripts/harness/__tests__/scan-receipt.test.mjs` | Table-driven valid and invalid schema/report cases. |
| TC-02 | integration | receipt-aware runner fixture in `run-all-scans.test.mjs` | Counts covered versus tree-external detector calls. |
| TC-03 | integration | two-run seeded-finding fixture | Captures the prior stable ID, replay output, rerun count, and no partial overwrite. |
| TC-04 | integration | two-run seeded-unavailable and clean fixtures | Covers unavailable replay and sole clean no-op reuse. |

## Tasks

- [ ] `.agents/tasks/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md` — paired Task

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-11

**Status upgrade:** draft → review-ready

**Per-criterion result:** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --lane L2 --dry-run` reported 20 mechanical PASS, 0 FAIL, and 7 semantic PENDING-GUARDIAN.

- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — the receipt stores only schema-v1 pass identity, so an unchanged-tree receipt hit supplies no prior diagnostic array and makes a known finding or unavailable result absent from the visible output.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — the defined two-run fixture first writes a covered non-clean result, then repeats the same receipt identity; it requires the prior stable ID to remain visible and the named covered detector to run again, while a wholly clean covered receipt alone may skip.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — the cited GitHub Actions, GitLab, Buildkite, and Gradle cache/artifact semantics support the decision that cache reuse cannot substitute for non-clean evidence, yielding the chosen validated report replay plus selective re-check.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — the selected immutable v2 report preserves evidence and observes recovery while retaining clean-scan reuse; the explicit cost is an added receipt schema and small runner seam.
- GATE-WRITE — New-surface placement (conditional): PASS as N/A — this changes existing private receipt and runner adapters and reuses the already-reviewed private diagnostic core/renderer without introducing a package, app, public interface, product-family surface, or layer reclassification.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — TC-01 covers v2 validation and cache-miss safety, TC-02 the clean-hit path, TC-03 finding replay/selective re-check/no partial overwrite, and TC-04 unavailable replay plus clean receipt persistence.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — every criterion names receipt validation, detector invocation counts, captured stable diagnostic IDs, rendered replay, or receipt-write behavior observable in the named fixture tests.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `0f9277b567b3` · base `origin/develop@0f9277b567b3` · document `.agents/spec-docs/draft/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md` blob `81898bc1bdb0` (untracked)

GATE VERDICT: PASS

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-11, this conversation
**Review fingerprint:** 3f7cd69b4f7d (review d12fec45, type/tags 807c253e)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-11, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3f7cd69b4f7d) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0f9277b567b3` · base `origin/develop@0f9277b567b3` · document `.agents/spec-docs/backlog/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md` blob `b1764da12c67` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-11

**Status remains:** review-ready
**Failed criteria:**

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: `"승인함"` is an approval word, but neither the quoted utterance nor the evidence entry binds it to BEHAVIOR-2698's receipt-reuse design. The document was authored later as a distinct child slice; the catalogue expressly excludes approval of a different item in the same conversation from Route DIRECT.
  **Required action:** obtain and record a new direct approval that identifies this receipt-reuse design, or use a pre-existing registered CLASS route with its required evidence.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS as N/A — the recorded route is DIRECT, so no delegated class is asserted.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS as N/A — the slice changes existing private receipt and runner adapters and reuses the existing private diagnostic core/renderer; it introduces neither a package, app, public interface, product-family surface, nor a layer reclassification.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `0f9277b567b3` · base `origin/develop@0f9277b567b3` · document `.agents/spec-docs/backlog/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md` blob `9485da4167c9` (untracked)

GATE VERDICT: FAIL

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "BEHAVIOR-2698의 scan receipt 재사용 시 non-clean 진단 보존·재표시·선택적 재실행 설계를 승인합니다."
**Given:** 2026-09-11, this conversation
**Review fingerprint:** 3f7cd69b4f7d (review d12fec45, type/tags 807c253e)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-11, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (3f7cd69b4f7d) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `0f9277b567b3` · base `origin/develop@0f9277b567b3` · document `.agents/spec-docs/backlog/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md` blob `48e5de58f943` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-11

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "BEHAVIOR-2698의 scan receipt 재사용 시 non-clean 진단 보존·재표시·선택적 재실행 설계를 승인합니다."
**Given:** 2026-09-11, this conversation

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the user names BEHAVIOR-2698 and explicitly approves its receipt-reuse design's non-clean preservation, replay, and selective re-execution; this is not a standing authorization or approval of another item.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS as N/A — this is a DIRECT approval; no delegated class is asserted or required.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS as N/A — the design changes existing private receipt and runner adapters and reuses the existing private diagnostic core/renderer; it introduces no new package, app, public interface, product-family surface, or layer reclassification.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `0f9277b567b3` · base `origin/develop@0f9277b567b3` · document `.agents/spec-docs/backlog/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md` blob `f06ba7a7c84a` (untracked)

GATE VERDICT: PASS

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-11

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-11; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 489 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md",
  "specPath": ".agents/spec-docs/todo/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md",
    ".agents/tasks/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `aa91baef2564` · base `origin/develop@0f9277b567b3` · document `.agents/spec-docs/todo/BEHAVIOR-2698-preserve-non-clean-diagnostic-evidence-across-scan-receipt-reuse.md` blob `e0a77700d5a4` (untracked)
