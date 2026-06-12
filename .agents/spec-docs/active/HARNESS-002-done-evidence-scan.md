---
status: in-progress
type: RULE
tags: [harness, typescript]
---

# HARNESS-002: Done-backlog evidence regression scan

## Problem

Done-backlog evidence has become false over time with no alarm. Documented cases: CLI-033
claimed 10 headless E2E tests (files no longer exist); CLI-042 claimed grep parallelization
(code is sequential again); CLI-046 claimed `--denied-tools` delivery (flag was never
threaded); REL-003 (critical) sat in `completed/` with status done while the OpenAPITool
stub it was supposed to remove still existed (caught 2026-06-11 only by the unrelated
HARNESS-008 stub-marker scan). The done gate validates at completion time only; nothing
re-validates later, so any later refactor can silently invalidate recorded evidence.

Reproduction: delete any test file referenced in a `.agents/backlog/completed/*.md` evidence
section — `pnpm harness:scan` stays green.

## Architecture Review

### Affected Scope

- `scripts/harness/check-done-evidence.mjs` (new scan) — extract repo-file paths referenced
  in completed-backlog evidence sections; fail when a referenced file no longer exists
- `scripts/harness/run-all-scans.mjs` — register the new scan (aggregating runner,
  HARNESS-011)
- `package.json` — `harness:scan:done-evidence` script
- `scripts/harness/__tests__/check-done-evidence.test.mjs` (new) — fixture-based unit tests
- `.agents/rules/backlog-execution.md` — rule: done evidence for code-changing backlogs
  MUST reference durable artifacts (test file paths)
- `.agents/backlog/completed/*.md` — initial live triage of stale references

### Alternatives Considered

1. **Path-existence scan over completed-backlog evidence sections + durable-artifact rule
   (chosen).**
   - Pro: mechanical, zero-maintenance check that catches the observed failure class
     (referenced file deleted/renamed); aligns with the AGENTS.md principle "prefer a
     mechanical check over more prose"; runs in the same aggregator as the other 22 scans.
   - Con: cannot detect semantic decay (file exists but the test no longer covers the
     claim) — accepted: semantic re-verification is the per-item done gate's job; this scan
     guards the durable-artifact layer beneath it.
2. **Re-run the referenced tests, not just check existence.**
   - Pro: catches semantic decay too.
   - Con: turns a scan into a full test orchestrator (per-package filters, build deps,
     runtimes — minutes per run); the full test suite already runs in CI, so a still-green
     referenced test adds no information beyond existence + suite-green.
3. **One-time audit of completed/ without a recurring scan.**
   - Pro: cheapest.
   - Con: the problem IS recurrence — evidence was true once and decayed; a one-time sweep
     repeats the same blind spot.

### Decision

Alternative 1. The driving trade-off is detection depth vs scan cost: existence checking is
the highest-value/lowest-cost layer (every documented incident involved a now-missing or
never-existing artifact) and composes with CI's suite-green signal to cover semantics.
Extraction rule: paths matching repo-file patterns (`packages/...`, `apps/...`,
`scripts/...` with a file extension) inside completed-backlog markdown; prose without paths
is skipped; an explicit `<!-- evidence-superseded: <reason> -->` annotation (same or
preceding line) exempts a stale reference that has documented replacement evidence.

_Correction during implementation (within the approved Decision): extraction is limited to
EVIDENCE regions (a heading or "Evidence"-led list/bold line opens a region; the next
non-evidence heading closes it) — matching the parent backlog's wording ("test-file paths
referenced in evidence sections"). The draft's whole-document scanning produced 226
findings on the live tree, nearly all historical path mentions in Problem/Plan prose of
pre-convention backlogs whose files were moved by later refactors — those are not evidence
claims and annotating them would be noise, not signal. Evidence-region scanning leaves the
real decayed-evidence class (3 live findings, all triaged with superseded annotations)._

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `scripts/harness/check-*.mjs` 기존 스캔 22종과 등록 방식
      (`run-all-scans.mjs` 집계, HARNESS-011) 확인; 기존 스캔 unit test 패턴
      (fixture 디렉터리 + vitest) 확인 — 동일 구조 채택; done-gate 규칙 문서는
      `.agents/rules/backlog-execution.md`가 소유(중복 작성 금지) 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `check-done-evidence.mjs`: read `.agents/backlog/completed/*.md`; extract candidate repo
   paths (regex over `packages/|apps/|scripts/` + extension); for each, check existence
   from repo root; report every missing path with its backlog file; exit non-zero if any
   missing and not annotated `evidence-superseded`.
2. Register in `run-all-scans.mjs` (scan count 22 → 23) + `harness:scan:done-evidence`
   pnpm script.
3. Unit tests with fixtures: existing path passes; missing path fails naming backlog +
   path; prose without paths skipped; superseded annotation exempts.
4. Rule line in `.agents/rules/backlog-execution.md`: done evidence for code-changing
   backlogs must cite durable artifacts (test file paths) — enforced by this scan.
5. Initial live triage: run on current `completed/`; for each finding, restore the
   reference or annotate with replacement evidence (CLI-033/042/046/REL-003 already have
   replacement coverage from later backlogs — annotate accordingly).

## Affected Files

- `scripts/harness/check-done-evidence.mjs` (new)
- `scripts/harness/__tests__/check-done-evidence.test.mjs` (new)
- `scripts/harness/run-all-scans.mjs`
- `package.json`
- `.agents/rules/backlog-execution.md`
- `.agents/backlog/completed/*.md` (triage annotations)

## Completion Criteria

- [ ] TC-01: fixture with an existing referenced path → scan passes (exit 0)
- [ ] TC-02: fixture with a missing referenced path → scan fails (exit ≠ 0) naming both the
      backlog file and the missing path
- [ ] TC-03: fixture with prose only (no repo paths) → skipped, scan passes
- [ ] TC-04: fixture with a missing path annotated `evidence-superseded` → scan passes and
      reports the exemption count
- [ ] TC-05: `pnpm harness:scan:done-evidence` runs the scan standalone;
      `pnpm harness:scan` includes it in the aggregate (23 scans reported)
- [ ] TC-06: live run on current `completed/` is green after triage (every stale reference
      restored or annotated with replacement evidence)
- [ ] TC-07: `.agents/rules/backlog-execution.md` contains the durable-artifact evidence
      rule referencing this scan

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                        | Notes                                                                 |
| ----- | ----------- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| TC-01 | unit        | vitest — fixture completed-backlog dir                 | pass path                                                             |
| TC-02 | unit        | vitest — fixture with missing path                     | failure message content                                               |
| TC-03 | unit        | vitest — prose-only fixture                            | skip behavior                                                         |
| TC-04 | unit        | vitest — superseded-annotation fixture                 | exemption behavior                                                    |
| TC-05 | integration | run pnpm scripts, assert exit codes + aggregate output | standalone + aggregated registration                                  |
| TC-06 | integration | live scan run on repo                                  | triage completion proof                                               |
| TC-07 | manual      | rule doc diff review                                   | doc prose — verified by direct read at GATE-COMPLETE, not automatable |

## Tasks

- [ ] `.agents/tasks/HARNESS-002.md` — T1~T8 (TC-01~TC-07 매핑 + wrap-up)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: RULE` is one of the 11 allowed prefixes; `tags: [harness, typescript]` present.
- Problem — concrete symptom: documented false-evidence cases (CLI-033, CLI-042, CLI-046, REL-003) with specific claims vs. actual state; no TBD/TODO/vague single-sentence text.
- Problem — reproduction condition: "delete any test file referenced in a `.agents/backlog/completed/*.md` evidence section — `pnpm harness:scan` stays green".
- Architecture Review Checklist: all 4 items `[x]`; Sibling scan item `[x]` with completion evidence (22 existing `check-*.mjs` scans, `run-all-scans.mjs` registration via HARNESS-011, fixture+vitest test pattern, rule-doc ownership confirmed).
- Alternatives Considered: 3 entries, each with explicit Pro and Con.
- Decision: references the driving trade-off (detection depth vs scan cost) and the extraction/exemption rule.
- Completion Criteria: 7 items, all prefixed TC-01..TC-07; each uses Command form or Observable behavior form (exit codes, output content, doc content); no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: section present; 7 rows match 7 TC-N in Completion Criteria (count matches: 7 = 7); every row has non-empty Test Type and Tool/Approach with no "TBD"; the single manual row (TC-07) has a non-empty Notes entry explaining why it is not automatable (doc prose, direct read at GATE-COMPLETE).
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and empty before this first GATE-WRITE entry; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied exactly "승인함" on 2026-06-13, after being told verbatim that replying "승인함" authorizes implementation of the 11 designs.
- Approval directed at this spec: the consolidated approval request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건" individually summarized HARNESS-002's design (23rd scan for test-file paths in `.agents/backlog/completed/*.md` evidence, durable-artifact rule, `evidence-superseded` annotation, initial triage of CLI-033/042/046/REL-003) and stated approval would advance GATE-APPROVAL → per-item implementation; the user's "승인함" is a direct, unambiguous confirmation covering this spec. The earlier release instruction ("머지하고 main 릴리스 진행해줘") and clarifying exchange ("그래서 뭐?") were not treated as approval.
- No post-approval modification of Architecture Review or frontmatter type/tags: only post-GATE-WRITE changes were the guard's Evidence Log entry, the frontmatter status upgrade draft → review-ready, and prettier formatting (commit cd5b1053a, PR #705).
- No implementation before this gate: `.agents/tasks/HARNESS-002.md` does not exist; `scripts/harness/check-done-evidence.mjs` does not exist; no `harness:scan:done-evidence` script in `package.json`; no commits touching these paths.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/HARNESS-002.md` exists (verified on branch `feat/harness-002-done-evidence`; untracked new file in `git status`, no prior implementation commits).
- Tasks file path recorded: spec `## Tasks` section lists `.agents/tasks/HARNESS-002.md — T1~T8 (TC-01~TC-07 매핑 + wrap-up)`.
- Tasks ↔ Completion Criteria mapping (at minimum one task per TC-N): T1↔TC-01 (existing path passes), T2↔TC-02 (missing path fails naming backlog + path), T3↔TC-03 (prose-only skipped), T4↔TC-04 (evidence-superseded exemption + count), T5↔TC-05 (standalone pnpm script + run-all-scans aggregate 23 scans), T6↔TC-06 (live triage green), T7↔TC-07 (backlog-execution.md durable-artifact rule); T8 is wrap-up (harness tests green, PR to develop, backlog archive) beyond the TC set.
- NON-COMPLIANCE trigger checked: no implementation commits exist before tasks-file creation — `scripts/harness/check-done-evidence.mjs` absent, `run-all-scans.mjs` and `package.json` untouched in working tree; only spec move todo/ → active/ and the tasks file are present.
