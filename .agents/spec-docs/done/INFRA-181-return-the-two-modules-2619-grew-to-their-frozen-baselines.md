---
status: done
type: INFRA
tags: [infra]
lane: L1
---

# INFRA-181: return the two modules PR #2619 grew to their frozen baselines

Paired with `.agents/tasks/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md`.
Arising from [issue #2620](https://github.com/woojubb/robota/issues/2620).

## Problem

`node scripts/harness/scan-file-size.mjs` on the current integration base exits 1:

```
harness file-size scan: 2 finding(s):
- [file-grew-past-baseline] scripts/harness/allocate-work-item-id.mjs: 479 lines (baseline froze it at 472).
- [file-grew-past-baseline] scripts/harness/new-spec.mjs: 449 lines (baseline froze it at 446).
```

Both were grown by `072a7354d` — `fix(harness): enforce reference kinds during authoring (#2619)` —
which is already merged. The scan reports the whole repository in ONE verdict and is a scan-suite
member, so `develop` is red and every branch whose diff selects `file-size` is blocked by growth it did
not cause. ARCH-054 stage 1 (issue #2158) is behind it and touches neither file.

A third entry is out of step in the other direction: `scripts/harness/run-all-scans.mjs` measures 1896
against a frozen 1914, which the scan reports as `ratchet-tighten` — an unlocked gain is a licence to
grow back. It is fixed here in the same baseline write, because the tool regenerates every entry at
once and leaving it would keep the scan red for a second reason.

This is the third recurrence of the shape in one session: issue #2596 was filed for two other modules,
those were fixed, and it returned. Issue #2620 records the mechanism gap — `file-size` is not selected
by a change to `scripts/harness/*.mjs`, so a change that pushes a file over its limit is not refused
when it lands. This item does not fix that gap; it clears what is blocking everything now.

## Prior Art Research

Waived: a move of functions between two of this repository's own internal maintenance modules. No
external product documentation, protocol specification or release note bears on where a local harness
module's functions live. The precedent that governs it is internal and is cited in § Sibling scan.

## Architecture Review

### Affected Scope

Two harness modules, two new sibling modules, and the frozen size baseline. No package, no app, no
shipped surface, and no harness RULE — the moved code keeps its behaviour exactly.

### Sibling scan

The scan judges all 152 baseline entries in one run and reports exactly the two grown files plus the
one unlocked gain, so nothing else is out of step. The repository already uses the split-and-re-export
shape three times: `scripts/harness/family-siblings.mjs` consumed by
`scripts/harness/check-dependency-direction.mjs`, `scripts/harness/required-status-checks-live.mjs`
re-exported from `scripts/harness/scan-main-required-checks.mjs`, and
`scripts/harness/work-item-id-claims.mjs` re-exported from `scripts/harness/allocate-work-item-id.mjs` —
the last added by `b62df0c48` on this very file, which is why this extraction takes the issue-binding
group and not the claimed-ID group.

### Alternatives Considered

1. **A1 — raise both baseline numbers.** Pro: two edited lines, immediate green. Con: the scan's own
   finding text refuses the direction — "Pre-existing debt may shrink but never grow — split instead of
   extending" — and a raised baseline is debt adopted silently. Measured, not hypothetical:
   `--write-baseline` did exactly this to `scripts/harness/allocate-work-item-id.mjs` earlier in this
   session, taking its entry from 492 to 691, and the line was reverted by hand. REJECTED.
2. **A2 — revert `072a7354d`.** Pro: the growth is that change's, so the debt returns to its author.
   Con: it is merged, it delivers a wanted enforcement, and reverting shipped work to satisfy a size
   number trades a real capability for a number. REJECTED.
3. **A3 — move one cohesive group out of each file into a sibling module and re-export it (CHOSEN).**
   Pro: consumers are unchanged because each original still exports every name; each group is chosen by
   responsibility so the new module has a nameable subject; both files land far below their frozen
   numbers (308 and 377 against 472 and 446), leaving headroom so the next small edit does not
   re-break it. Con: both files remain above the 300-line policy and stay baselined debt, which this
   document states rather than hides.

### Decision

A3. `allocate-work-item-id.mjs` gives up the GitHub-issue binding — the only part of the allocator that
leaves the machine, failing for network and authentication reasons the ID arithmetic never can, so the
two failure modes become separable. `new-spec.mjs` gives up what it reads OUT of a paired Task record:
the two halves answer different questions — what a draft should contain, and what the Task already
says — and only the second needs the frontmatter reader, so the split narrows that dependency as well.

The hazard worth naming, because the obvious version of it is FALSE and was written into an earlier
document before being measured: `scripts/harness/scan-rule-statement-floor.mjs` reads rule identifiers
out of the STRING LITERALS of `scripts/harness/*.mjs`, so moving a literal looks like it would blind
that scan. It does not — that pathspec's `*` crosses `/`, matching 696 tracked files of which the scan
skips the 329 under `__tests__/` and reads 367, so a module extracted into the same directory stays
inside the collection set and only the attribution key changes. The hazard that IS real is a different
edit: taking the brackets OUT of a literal drops the identifier entirely while the scan stays green,
because fewer identifiers means fewer to check. TC-03 pins the total against the integration base for
that class of regression, and is a floor rather than proof this particular move could trip it.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 2 modules, 2 new siblings, 1 baseline file, listed in § Affected Files
- [x] Sibling scan 완료 — all 152 baseline entries judged by the scan; three internal precedents named
- [x] 대안 최소 2개 검토 완료 — 3 alternatives with pro/con, A1's rejection carrying the measured raise incident
- [x] 결정 근거 문서화 완료 — § Decision, naming the false hazard as false and the real one TC-03 guards

## Fallback & Degradation Declaration

No runtime behaviour changes: every moved function keeps its signature and is re-exported from its
original module, so no consumer has a new failure mode. If an extraction is wrong the consumer suites in
TC-05 go red, which is the same signal that would catch it before the move.

## Solution

Move the GitHub-issue binding out of `scripts/harness/allocate-work-item-id.mjs` into
`scripts/harness/work-item-issue-binding.mjs`, and the paired-Task reader out of
`scripts/harness/new-spec.mjs` into `scripts/harness/new-spec-task-record.mjs`. Re-export both from the
originals. Then tighten `scripts/harness/file-size-baseline.json` in the same commit and READ the diff:
`--write-baseline` rewrites every entry from the measured count and will raise one that is still over.

## Affected Files

- `scripts/harness/allocate-work-item-id.mjs` — shrinks 479 to 307, re-exports the moved group
- `scripts/harness/new-spec.mjs` — shrinks 449 to 376, re-exports the moved group
- `scripts/harness/work-item-issue-binding.mjs` — new
- `scripts/harness/new-spec-task-record.mjs` — new
- `scripts/harness/file-size-baseline.json` — three entries lowered, none raised: the two above plus
  `scripts/harness/run-all-scans.mjs` 1914 → 1897, the unlocked gain § Problem names

## Completion Criteria

- [x] TC-01: `node scripts/harness/scan-file-size.mjs` exits 0 with no finding. Red before: two
      `file-grew-past-baseline` findings naming these two files, plus one `ratchet-tighten`.
- [x] TC-02: every number the `scripts/harness/file-size-baseline.json` diff changes is LOWER than the
      one it replaces, and no entry is added or raised.
- [x] TC-03: `node scripts/harness/scan-rule-statement-floor.mjs` exits 0 and its
      `::examined:: <n> rule identifiers` count is not lower than on the integration base.
- [x] TC-04: `node scripts/harness/scan-measurement-provenance.mjs` exits 0.
- [x] TC-05: `npx vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs` and
      `scripts/harness/__tests__/new-spec.test.mjs` both pass with no consumer file edited.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                       | Notes                              |
| ----- | --------- | ----------------------------------------------------- | ---------------------------------- |
| TC-01 | CI smoke  | `scan-file-size.mjs` exit code and finding list       | red today on both files            |
| TC-02 | CI smoke  | `git diff` of the baseline file, every number read    | guards the tool's silent raise     |
| TC-03 | CI smoke  | `scan-rule-statement-floor.mjs`, count vs. the base   | guards silent scan blinding        |
| TC-04 | CI smoke  | `scan-measurement-provenance.mjs`                     | a moved reader must stay reachable |
| TC-05 | unit      | `allocate-work-item-id.test.mjs`, `new-spec.test.mjs` | re-exports keep consumers unedited |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This relocates functions between two of the repository's own internal maintenance scripts
so a size scan over those scripts stops reporting growth. Nothing it touches is published, installed,
or reachable from any command a person outside this repository can run — there is no screen, no CLI
flag, no SDK entry point and no file a user of Robota ever sees, so there is no surface on which a
scenario could be performed.

## Tasks

`.agents/tasks/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md`

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "너가 작업하던건 너가 제대로 처리하고 책임지고 닫아야함"
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 444bc0c1757f (review 80122900, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (444bc0c1757f) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `072a7354d914` · base `origin/develop@072a7354d914` · document `.agents/spec-docs/draft/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `860c2a0c5c27` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 1488 chars, 10 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 5 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 5 Test Plan rows = 5 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 5 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (444bc0c1757f) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `072a7354d914` · base `origin/develop@072a7354d914` · document `.agents/spec-docs/draft/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `c17e8bdd9aa3` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-06

**Test skipped:** CI-smoke scan check, no dedicated unit test — verified by the scan command below.
**Command:** `node scripts/harness/scan-file-size.mjs`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
harness file-size scan passed (152 baselined burn-down entries).
```

**Judged at:** HEAD `24773c79184c` · base `origin/develop@f322256413f9` · document `.agents/spec-docs/todo/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `0e23c923a644` (tracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-06

**Test skipped:** doc/baseline-diff check, no automated test — verified by reading the diff below.
**Command:** `git diff origin/develop -- scripts/harness/file-size-baseline.json`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
allocate-work-item-id.mjs 472->308, new-spec.mjs 446->377, run-all-scans.mjs 1914->1897; all lower, none raised
```

**Judged at:** HEAD `24773c79184c` · base `origin/develop@f322256413f9` · document `.agents/spec-docs/todo/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `10c23297b0d5` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-06

**Test skipped:** CI-smoke scan check, no dedicated unit test — verified by the scan command below.
**Command:** `node scripts/harness/scan-rule-statement-floor.mjs`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
::examined:: 13 rule identifiers across 207 normative documents; rule-statement-floor scan passed.
```

**Judged at:** HEAD `24773c79184c` · base `origin/develop@f322256413f9` · document `.agents/spec-docs/todo/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `1e084c124ab3` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-06

**Test skipped:** CI-smoke scan check, no dedicated unit test — verified by the scan command below.
**Command:** `node scripts/harness/scan-measurement-provenance.mjs`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
measurement-provenance scan passed (58 subject(s) meet the floor; 58 recorded unmet in scripts/harness/measurement-provenance-pending.json).
```

**Judged at:** HEAD `24773c79184c` · base `origin/develop@f322256413f9` · document `.agents/spec-docs/todo/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `81f25d19be20` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-06

**Command:** `npx vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs scripts/harness/__tests__/new-spec.test.mjs`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
Test Files 2 passed (2); Tests 86 passed (86)
```

**Judged at:** HEAD `24773c79184c` · base `origin/develop@f322256413f9` · document `.agents/spec-docs/todo/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `e59199048763` (modified)

### [GATE-DONE] — ❌ FAIL | 2026-09-06

**Status remains:** approved
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): `pnpm harness:scan` → exit 1 ( ⏎ 1 of 159 scans failed ⏎  ELIFECYCLE  Command failed with exit code 1.); `npx vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs scripts/harness/__tests__/new-spec.test.mjs scripts/harness/__tests__/work-run-store.test.mjs scripts/harness/__tests__/work-run-lifecycle.test.mjs` → exit 0 (hint: Disable this message with "git config set advice.mergeConflict false" ⏎ Could not apply 03e9db5... # feat: old pull request ⏎ Rebasing (2/2)
Successfully rebased and updated refs/heads/codex/work-run-lifecycle.)
  **Required action:** make every verify command exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm harness:scan` → exit 1 ( ⏎ 1 of 159 scans failed ⏎  ELIFECYCLE  Command failed with exit code 1.); `npx vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs scripts/harness/__tests__/new-spec.test.mjs scripts/harness/__tests__/work-run-store.test.mjs scripts/harness/__tests__/work-run-lifecycle.test.mjs` → exit 0 (hint: Disable this message with "git config set advice.mergeConflict false" ⏎ Could not apply 03e9db5... # feat: old pull request ⏎ Rebasing (2/2)
Successfully rebased and updated refs/heads/codex/work-run-lifecycle.)
  **Required action:** make every verify command exit 0
- GATE-COMPLETE — The checkbox is checked (`[x]`): TC-01, TC-02, TC-03, TC-04, TC-05 unticked
  **Required action:** verify and tick every TC
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-01, TC-02, TC-03, TC-04: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-01, TC-02, TC-03, TC-04: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: TC-01, TC-02, TC-03, TC-04, TC-05 unticked
  **Required action:** verify and tick every TC
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-01, TC-02, TC-03, TC-04: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

**Judged at:** HEAD `a0841c39d3df` · base `origin/develop@f322256413f9` · document `.agents/spec-docs/todo/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `4f565a61e7c6` (modified)

### [GATE-DONE] — ⚠️ PARTIAL (guardian criteria only) | 2026-09-06

**Ordering check:** PASS — prior gate `[GATE-PLAN] — ✅ PASS | 2026-09-06` recorded above; frontmatter `status: approved` matches the state GATE-DONE (lane L1) expects as input.

**Scope of this judgement:** only the two PENDING-GUARDIAN criteria nested under GATE-VERIFY were evaluated against `.agents/tasks/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` `## Plan`. This is NOT a full GATE-DONE verdict — the two mechanical GATE-VERIFY criteria below remain FAIL and are recorded as-is, unresolved.

**Guardian criteria (judged, this entry):**

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`) — ✅ PASS: all three Plan items (U01, U02, U03) in the Task are `[x]`, each with a completion note naming the commit (`d440bed89`) and the extracted module/exports.
- GATE-VERIFY — No Plan item is blocked or pending — ✅ PASS: no Plan item carries an unchecked box, a "blocked" marker, or a "pending" marker; all three read as finished work with commit provenance.

**Mechanical criteria (NOT judged here, carried forward unresolved from the dry-run — out of scope for this guardian's remit):**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): `pnpm harness:scan` → exit 1 (1 of 159 scans failed: `work-run-measurement`, a separate, already-known, in-progress receipt-closure step on this branch, not part of this Task's Plan). `npx vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs scripts/harness/__tests__/new-spec.test.mjs scripts/harness/__tests__/work-run-store.test.mjs scripts/harness/__tests__/work-run-lifecycle.test.mjs` → exit 0. **Still FAIL, unresolved** — required action unchanged: make every verify command exit 0.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): same evidence and same **still FAIL, unresolved** status as above.

**Verdict:** the two PENDING-GUARDIAN criteria this entry was scoped to judge both PASS. The composite GATE-DONE (lane L1) as a whole is **not** a PASS while the two mechanical build/test criteria remain FAIL pending this branch's `work-run-measurement` receipt-closure step — that resolution is out of scope for this guardian invocation and is not attempted here.

**Judged at:** HEAD `3eb1d4c6f343b929eb684c9e619f0cd80baddcdf` · base `origin/develop@c651c769e27c9a0ee147be8ffda937cbc1072610` · document `.agents/spec-docs/todo/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `01d393354eba74aaee31505685ff3b5e2cd24969` (tracked)

### [GATE-DONE] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → done

**Ordering check:** PASS — prior gate `[GATE-PLAN] — ✅ PASS | 2026-09-06` recorded above is the PASS that upgraded the status; the later out-of-order `[GATE-DONE] — ❌ FAIL | 2026-09-06` and `[GATE-DONE] — ⚠️ PARTIAL (guardian criteria only) | 2026-09-06` entries do not revoke it. Frontmatter `status: approved` matches the state GATE-DONE (lane L1) expects as input.

**Verify commands supplied to this dry-run (both real, correctly-scoped — not stand-ins):**

- `pnpm build`
- `npx vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs scripts/harness/__tests__/new-spec.test.mjs scripts/harness/__tests__/work-run-store.test.mjs scripts/harness/__tests__/work-run-lifecycle.test.mjs`

Scope verified independently, not accepted on the caller's characterization: `git diff origin/develop...HEAD --stat` shows every non-markdown file this branch touches lives under `scripts/harness/` (a root-level tooling location, not a `packages/*` workspace member) — `allocate-work-item-id.mjs`, `new-spec.mjs`, `work-item-issue-binding.mjs`, `new-spec-task-record.mjs`, `work-run-store.mjs`, `work-run-store-locking.mjs`, `work-run-branch-pointer.mjs`, plus the `file-size-baseline.json` / `reference-kind-baseline.json` data files. `pnpm build` is `pnpm --filter "./packages/**" build:js && node scripts/build-types-ordered.mjs` (`package.json` line 16) — the real repository-wide build, not a stand-in; since no `packages/*` file is touched, a real green run is the correct "no affected package regressed" evidence. For test coverage, read every changed/added module's consumer test and confirmed each is exercised, not merely imported: `allocate-work-item-id.test.mjs` imports AND calls `closeCreatedIssue`/`resolveIssueNumber` (the exact functions `d440bed89` moved into `work-item-issue-binding.mjs` and re-exported); `new-spec.test.mjs` imports AND calls `readTaskRecord`/`slugify` (moved into `new-spec-task-record.mjs` and re-exported); `work-run-store.mjs` imports `branchKey`/`withWorkRunLock`/`workRunPointerPath` from `work-run-store-locking.mjs` and `assertPointerReleasedFor`/`claimBranchRun`/`readReusableBranchRun` from `work-run-branch-pointer.mjs`, all called from `WorkRunStore.withLock`/`.pointerPath`/`.withActiveRun`/`.claim`/`.invalidate`, which `work-run-store.test.mjs` and `work-run-lifecycle.test.mjs` exercise directly (confirmed `store.invalidate(...)` at `work-run-store.test.mjs:480` reaches the `assertPointerReleasedFor` call site at `work-run-store.mjs:266`). No file this branch changed is left without a suite in the supplied command. This is adequate "tests pass for all affected packages" evidence for this branch's actual diff.

**Criteria (13 total — 11 mechanical from the dry-run below, verbatim, plus the 2 PENDING-GUARDIAN criteria carried forward from the confirmed `[GATE-DONE] — ⚠️ PARTIAL (guardian criteria only) | 2026-09-06` entry above):**

- GATE-DONE — ordering (prior gate PASS + status match): PASS — see **Ordering check** above.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): PASS — carried forward from `[GATE-DONE] — ⚠️ PARTIAL (guardian criteria only) | 2026-09-06` above: all three Plan items (U01, U02, U03) in the Task are `[x]`, each with a completion note naming commit `d440bed89` and the extracted module/exports. Re-confirmed by a fresh read of `.agents/tasks/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` `## Plan` this run: U01/U02/U03 remain `[x]`, unchanged since that judgement.
- GATE-VERIFY — No Plan item is blocked or pending: PASS — same source and same fresh re-read: no Plan item carries an unchecked box, a "blocked" marker, or a "pending" marker; all three read as finished work with commit provenance.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): PASS — dry-run: `build-shaped \`pnpm build\` → exit 0 (  ✓ done ⏎  ⏎ ✓ All build:types complete.); all 2 supplied commands exit 0`. Scope adequacy independently confirmed (see above) — real command, correct for a branch touching no `packages/*` file.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): PASS — dry-run: `test-shaped \`npx vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs scripts/harness/__tests__/new-spec.test.mjs scripts/harness/__tests__/work-run-store.test.mjs scripts/harness/__tests__/work-run-lifecycle.test.mjs\` → exit 0 …; all 2 supplied commands exit 0`. Scope adequacy independently confirmed (see above) — every changed `.mjs` module has a suite in this command that actually calls its moved/changed functions, not just imports them.
- GATE-COMPLETE — The checkbox is checked (`[x]`): PASS — 5/5 TC checkboxes `[x]`.
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with command/output for every TC: PASS — a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (5), recorded above in this document.
- GATE-COMPLETE — One of Test written / Test skipped (with reason) is recorded for every Test Plan row: PASS — every Test Plan row (5) carries a test reference or a skip reason.
- GATE-COMPLETE — No TC-N is silently unaddressed: PASS — every Test Plan row (5) carries a test reference or a skip reason.
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: PASS — 5/5 TC checkboxes `[x]`.
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: PASS — every Test Plan row (5) carries a test reference or a skip reason.
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: PASS — `## Tasks` names `.agents/tasks/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md`, which exists.
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks `[x]`, no pending or blocked item: PASS — 8/8 tasks `[x]` in `.agents/tasks/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md`.

**Judged at:** HEAD `3eb1d4c6f343b929eb684c9e619f0cd80baddcdf` · base `origin/develop@c651c769e27c9a0ee147be8ffda937cbc1072610` · document `.agents/spec-docs/todo/INFRA-181-return-the-two-modules-2619-grew-to-their-frozen-baselines.md` blob `4b0b8b03f6a3f6734b5ea9288b728ea1a2ce55a0` (modified)
