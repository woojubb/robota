---
status: approved
type: INFRA
tags: [harness, typescript]
lane: L1
---

# HARNESS-2401: use GitHub issue numbers for new spec identifiers

Paired with `.agents/tasks/HARNESS-2401-issue-number-backed-spec-identifiers.md`. Arising from [issue #2401](https://github.com/woojubb/robota/issues/2401).

## Problem

The current allocator reads a mutable counter-like union of records, citations, and issue references,
so two sessions can choose the same next number before either branch is published. This occurs when
`pnpm harness:task:allocate <PREFIX> <TITLE>` is run for new work: it can return a number that is not
the registering Issue's server-issued identity. New work must resolve an existing GitHub Issue or
create one first, then use that Issue number in the new `<PREFIX>-<issue-number>` Task/spec ID. Existing
legacy IDs remain readable and unchanged.

## Prior Art Research

- **Server-issued identifiers:** GitHub and GitLab allocate the issue number/IID when creation succeeds
  and return it in the response. Robota should resolve an existing Issue first; otherwise create one and
  derive the new ID only from the returned number—never from `max + 1`. ([GitHub REST API](https://docs.github.com/en/rest/issues/issues),
  [GitLab Issues API](https://docs.gitlab.com/api/issues/))
- **Container-scoped identity:** GitHub lookups require `owner/repo/issue_number`; GitLab uses
  `project/iid`. Robota must validate the repository scope and must not treat a bare number as globally
  unique. ([GitHub REST API](https://docs.github.com/en/rest/issues/issues),
  [GitLab Issues API](https://docs.gitlab.com/api/issues/))
- **Creation failure is a stop condition:** GitHub Issue creation requires a title and suitable
  permissions and can fail because Issues are disabled, validation fails, or access/rate limits apply.
  Allocation must stop before writing a Task/spec when creation or required-label verification fails.
  ([GitHub issue creation](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue))
- **Compatibility:** Atlassian distinguishes mutable human-readable issue keys from immutable internal
  IDs. By analogy, Robota will use Issue-backed identifiers only for new records and preserve legacy
  identifiers and citations unchanged. ([Atlassian issue ID guidance](https://support.atlassian.com/jira/kb/how-to-get-issue-id-from-the-jira-user-interface/))

## Architecture Review

### Affected Scope

- `scripts/harness/allocate-work-item-id.mjs`
- `scripts/harness/new-spec.mjs`
- `scripts/harness/__tests__/allocate-work-item-id.test.mjs`
- `scripts/harness/__tests__/new-spec.test.mjs`
- `.agents/tasks/README.md`
- `.agents/skills/user-request-gate/SKILL.md`
- `.agents/skills/backlog-pipeline/SKILL.md`

### Alternatives Considered

1. Keep the current counter/union allocator and only improve the push-time collision scan.
   - Pro: no GitHub write is required and the existing local command remains familiar.
   - Con: two unpublished sessions can still choose the same number; detection remains after the race.
2. Use the registering GitHub Issue number as the numeric component of every new ID, creating the Issue
   when no existing Issue is supplied, while preserving old IDs.
   - Pro: GitHub supplies the number atomically and the Task/spec pair shares an externally resolvable
     identity; no local max-plus-one race remains for new work.
   - Con: allocation needs authenticated GitHub access for creation or lookup and must fail closed on
     creation, lookup, or ID-conflict errors.

### Decision

Choose Alternative 2. The issue number is the only allocation value supplied by the external system
that serializes issue creation; the local counter is therefore removed from the new-work path. The
change is intentionally forward-only: existing `<PREFIX>-NNN` records, citations, phases, and parsers
remain valid. Reachability was checked across the allocator, Task/spec scaffold, task-path and collision
parsers; no replaced parser capability is dropped. The adversarial pass covers duplicate exact-title
issues, failed GitHub access/creation, a selected Issue whose `<PREFIX>-<number>` is already claimed, and
legacy records whose numeric component differs from their Issue number.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: not a CLI command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Add an Issue-resolution seam to the allocator: accept an existing `--issue N`, otherwise find an
   exact existing Issue title or create an enhancement Issue with `status:needs-triage`; read back the
   returned number and required labels before continuing.
2. Replace only the new allocation result with `<PREFIX>-<issue-number>`, refuse a claimed ID, and keep
   the legacy union/counter helpers available for compatibility tests and historical records.
3. Require `new-spec.mjs` to accept an issue-backed ID by default and require an explicit `--legacy-id`
   when scaffolding a pre-existing record whose numeric component is not its Issue number.
4. Update Task/spec workflow guidance and focused tests, including no-write behavior on Issue failure,
   exact-title reuse, Issue creation, conflict refusal, legacy parser compatibility, and scaffold pairing.

## Affected Files

- `scripts/harness/allocate-work-item-id.mjs`
- `scripts/harness/new-spec.mjs`
- `scripts/harness/__tests__/allocate-work-item-id.test.mjs`
- `scripts/harness/__tests__/new-spec.test.mjs`
- `.agents/tasks/README.md`
- `.agents/skills/user-request-gate/SKILL.md`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs scripts/harness/__tests__/new-spec.test.mjs` → exits 0, including Issue reuse/creation, conflict refusal, and legacy-ID controls.
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0 for the changed harness and workflow documents.
- [x] TC-03: `pnpm harness:task:allocate <PREFIX> "issue-backed allocation test" --issue 2401 --dry-run` → outputs `<PREFIX>-2401` and writes no Task; with `--issue` omitted, an exact existing title is reused or a GitHub Issue is created and its returned number is used.
- [x] TC-04: `node scripts/harness/new-spec.mjs HARNESS-2401 --type INFRA --issue 2401 --lane L1 --dry-run` → exits 0 and outputs a draft paired to the HARNESS-2401 Task; a legacy ID without `--legacy-id` exits 1.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                          | Notes                                                                                                                                                                             |
| ----- | --------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on allocator and scaffolder tests | PASS: the exact two-file command passed 85 tests; the related five-file regression set passed 143 tests. Includes Issue reuse/creation, conflict refusal, and legacy-ID controls. |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`              | Regression over the changed harness/docs set; recorded after the work-run receipt closure is sealed.                                                                              |
| TC-03 | CLI       | `pnpm harness:task:allocate … --issue 2401 --dry-run`    | PASS: `<PREFIX>-2401` output with no Task written. Omitted-Issue creation is mocked in unit tests because it mutates GitHub.                                                      |
| TC-04 | CLI       | `node scripts/harness/new-spec.mjs … --dry-run`          | PASS: draft rendered for HARNESS-2401; confirms Issue/ID pairing and explicit legacy escape.                                                                                      |

## User Execution Test Scenarios

<!-- One scenario per user-observable surface this change delivers: the exact command a user runs,
     the observable result, and the evidence file. A scenario exercises the implemented code path;
     reading a document to prove the document is well written is not one (backlog-execution.md). -->

## Tasks

- [ ] `.agents/tasks/HARNESS-2401-issue-number-backed-spec-identifiers.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-06

**Status remains:** draft
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "이제부터 스펙을 생성 하기 전에 이슈가 있다면 이 슈 넘버를 가져오고 이슈가 없다면 아니 이슈가 생성 되어 있지 않다면 깃헙 이슈를 생성 하고 번호를 따서 스펙 번호에 붙 인다. 그러면 이제 중복 되지 않겠지. 이 규칙을 적용해서 커밋 푸시 머지 해줘"
**Given:** 2026-09-06, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base cac1040da690) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/HARNESS-2401-issue-number-backed-spec-identifiers.md) is at or above the floor L0)
**Review fingerprint:** 89c152210e83 (review bf02d56b, type/tags 7d7be320)
**Failed criteria:**

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form

**Judged at:** HEAD `cac1040da690` · base `origin/develop@cac1040da690` · document `.agents/spec-docs/draft/HARNESS-2401-issue-number-backed-spec-identifiers.md` blob `be53956a406a` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-06, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base cac1040da690) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/HARNESS-2401-issue-number-backed-spec-identifiers.md) is at or above the floor L0)
**Review fingerprint:** 89c152210e83 (review bf02d56b, type/tags 7d7be320)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (89c152210e83) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `cac1040da690` · base `origin/develop@cac1040da690` · document `.agents/spec-docs/draft/HARNESS-2401-issue-number-backed-spec-identifiers.md` blob `e42f9abb0c61` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 548 chars, 4 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (89c152210e83) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2401-issue-number-backed-spec-identifiers.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2401-issue-number-backed-spec-identifiers.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `cac1040da690` · base `origin/develop@cac1040da690` · document `.agents/spec-docs/draft/HARNESS-2401-issue-number-backed-spec-identifiers.md` blob `7d5f12213f35` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs scripts/harness/__tests__/new-spec.test.mjs`
**Exit:** 0
**Output:** (last 10 of 15 line(s))

```
 ✓ scripts/harness/__tests__/allocate-work-item-id.test.mjs (41 tests) 2035ms
   ✓ the claimed set is wider than the record filenames > reads an ID out of a record filename, live or completed  413ms
   ✓ a clone behind its upstream is refused, not answered (issue #2184) > is fresh when the clone is at the upstream tip  331ms
   ✓ a clone behind its upstream is refused, not answered (issue #2184) > THE CASE: reports stale, naming the gap, once upstream moves — even before a fetch  420ms
   ✓ a clone behind its upstream is refused, not answered (issue #2184) > offline is not stale: a fetch that fails measures against the local upstream ref  332ms

 Test Files  2 passed (2)
      Tests  85 passed (85)
   Start at  02:34:12
   Duration  2.41s (transform 329ms, setup 0ms, collect 601ms, tests 3.07s, environment 0ms, prepare 138ms)
```

**Judged at:** HEAD `cc0b6e5701f7` · base `origin/develop@cac1040da690` · document `.agents/spec-docs/todo/HARNESS-2401-issue-number-backed-spec-identifiers.md` blob `ff8574f5748c` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-06

**Command:** `pnpm harness:task:allocate ZZTEST "issue-backed allocation test" --issue 2401 --dry-run`
**Exit:** 0
**Output:** (last 7 of 7 line(s))

```
> robota-monorepo@0.1.0 harness:task:allocate /Users/jungyoun/Documents/dev/woojubb/robota-4
> node scripts/harness/allocate-work-item-id.mjs "ZZTEST" "issue-backed allocation test" "--issue" "2401" "--dry-run"

::measured:: HEAD is 0 commit(s) behind origin/develop@cac1040da
::issue:: #2401 (existing)
::examined:: 2401 claimed work-item id(s); 1092 from records, 2392 from citations, 412 from issue titles and bodies
ZZTEST-2401
```

**Judged at:** HEAD `cc0b6e5701f7` · base `origin/develop@cac1040da690` · document `.agents/spec-docs/todo/HARNESS-2401-issue-number-backed-spec-identifiers.md` blob `8a9ed66d2dbb` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-06

**Command:** `node scripts/harness/new-spec.mjs HARNESS-2401 --type INFRA --issue 2401 --lane L1 --dry-run`
**Exit:** 0
**Output:** (last 10 of 96 line(s))

```
Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/HARNESS-2401-issue-number-backed-spec-identifiers.md` — todo

## Evidence Log
new-spec: dry run — target .agents/spec-docs/draft/HARNESS-2401-issue-number-backed-spec-identifiers.md (not written)
```

**Judged at:** HEAD `cc0b6e5701f7` · base `origin/develop@cac1040da690` · document `.agents/spec-docs/todo/HARNESS-2401-issue-number-backed-spec-identifiers.md` blob `7ec3682be1fe` (modified)
