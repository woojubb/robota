---
status: done
type: BEHAVIOR
tags: [cli, typescript]
---

# CLI-057: Grep tool — implement `count` output mode and `headLimit`, align description with schema (covers backlog CLI-057)

## Problem

The Grep builtin's LLM-facing description promises capabilities the schema does not have
(`packages/agent-tools/src/builtins/grep-tool.ts:229`):

- "Output modes: … 'count' shows match counts" — but `GrepSchema.outputMode` is only
  `['files_with_matches', 'content']` (grep-tool.ts:36-41). An LLM emitting
  `outputMode: "count"` fails schema validation.
- "Use head_limit to control result size" — no such parameter exists in the schema; LLM calls
  passing it are silently stripped or rejected, and large result sets cannot be capped.

Reproduce: in any session ask the agent to "count matches using Grep's count mode" — the tool
call fails validation (enum mismatch) and the agent wastes a turn.

## Architecture Review

### Affected Scope

- `packages/agent-tools/src/builtins/grep-tool.ts` — schema (`count` enum value, `headLimit`
  param), `searchFile` count branch, result capping, description rewrite
- `packages/agent-tools/src/__tests__/grep-tool.test.ts` — new test file (none exists today)
- `packages/agent-tools/docs/SPEC.md` — Grep contract row update (if it lists modes)

### Alternatives Considered

**A. Implement both `count` mode and `headLimit` (preferred by the backlog)**

- Pro: both are cheap on top of the existing match pipeline (`searchFile` already collects
  `matchingIndices`; capping is an array slice); restores the LLM contract without weakening it
- Con: slightly larger schema surface to maintain

**B. Reduce the description to the actually supported modes/parameters**

- Pro: one-line change
- Con: removes a useful capability the description already trained users/LLMs to expect;
  `count` and result capping are standard grep affordances (rg `--count`, `head`) that save
  context tokens — deleting them is a product regression relative to the documented contract

**C. Name the new parameter `head_limit` (snake_case) to match the old description text**

- Pro: matches the previous description string verbatim
- Con: every other Grep schema field is camelCase (`contextLines`, `outputMode`); a mixed-case
  schema is a worse contract than updating one description word

### Decision

**A + camelCase 채택** — implement `count` and `headLimit`; description rewritten to name
`headLimit` (consistent with the existing camelCase schema fields, rejecting C). B rejected
because the implementation cost is a few lines on an already-built pipeline and the description
has been advertising the capability — honoring it is strictly better than retracting it.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-tools 단일 패키지 (builtins + tests + SPEC)
- [x] Sibling scan 완료 — 다른 builtin(read/glob)의 limit 파라미터 관례 확인: Read는 `limit`
      (행 수), Glob은 결과 무제한. Grep의 `headLimit`은 결과 항목 수 캡으로 정의하고 잘림 시
      말미에 명시적 truncation 마커를 남긴다 (CLI-031 truncation notice 관례와 일치)
- [x] 대안 최소 2개 검토 완료 — A(구현)/B(설명 축소)/C(snake_case) 3안 검토
- [x] 결정 근거 문서화 완료 — Decision 섹션 참조

## Solution

1. Schema: `outputMode: z.enum(['files_with_matches', 'content', 'count'])`; add
   `headLimit: z.number().int().positive().optional()` — "Maximum number of result lines
   (file paths, content lines, or count rows) to return; excess is truncated with a marker".
2. `searchFile`: `count` mode returns `[`${filePath}:${matchingIndices.length}`]` (rg
   `--count` format, per-file rows).
3. `grepFileTool`: after collecting `allOutputLines`, if `headLimit` is set and exceeded,
   slice to `headLimit` and append `(+N more results truncated by headLimit)`.
4. Description rewrite: list the three real modes; reference `headLimit` (camelCase).
5. New `grep-tool.test.ts` covering all three modes, headLimit capping + marker, invalid regex
   error, glob filtering (fixture: temp dir).

## Affected Files

- `packages/agent-tools/src/builtins/grep-tool.ts`
- `packages/agent-tools/src/__tests__/grep-tool.test.ts` (new)
- `packages/agent-tools/docs/SPEC.md`

## Completion Criteria

- [x] TC-01: Grep executes with `outputMode: 'count'` and returns `path:count` rows per
      matching file (unit test on a temp fixture)
- [x] TC-02: `headLimit: 2` on a search with >2 results returns exactly 2 result lines plus a
      `(+N more results truncated by headLimit)` marker; without `headLimit` all results return
- [x] TC-03: schema validation accepts `outputMode: 'count'` and `headLimit` (zod parse test),
      and the tool description string mentions only schema-supported parameters
      (`headLimit`, no `head_limit`; modes exactly files_with_matches/content/count)
- [x] TC-04: existing modes regress-free — files_with_matches and content (with contextLines)
      behavior covered by tests
- [x] TC-05: `pnpm --filter @robota-sdk/agent-tools build && pnpm --filter @robota-sdk/agent-tools test`
      exit 0; SPEC.md Grep row updated if applicable

## Test Plan

| TC-ID | Test Type  | Tool / Approach                                               | Notes                                                                                                                                                                                   |
| ----- | ---------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit       | vitest + temp-dir fixture, count mode output assert           | `packages/agent-tools/src/__tests__/grep-tool.test.ts` > "TC-01: count mode returns path:count rows for matching files only"                                                            |
| TC-02 | unit       | vitest — headLimit slice + truncation marker                  | `grep-tool.test.ts` > "TC-02: headLimit caps results and appends a truncation marker", "TC-02: without headLimit all results are returned"                                              |
| TC-03 | unit       | zod safeParse + description string assertions                 | `grep-tool.test.ts` > "TC-03: schema accepts count mode and headLimit; rejects non-positive headLimit", "TC-03: description mentions only schema-supported parameters"                  |
| TC-04 | unit       | vitest — files_with_matches / content(contextLines) snapshots | `grep-tool.test.ts` > "TC-04: files_with_matches returns matching file paths", "TC-04: content mode includes context lines with markers", "TC-04: glob filter restricts searched files" |
| TC-05 | build/test | pnpm filter build + test                                      | Command-based verification — `pnpm --filter @robota-sdk/agent-tools build && test` exit 0 (see [GATE-VERIFY] / [GATE-COMPLETE: TC-05] entries)                                          |

## Tasks

- Tasks file: `.agents/tasks/completed/CLI-057.md` (5 tasks, T1–T5, mapped to TC-01~TC-05)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-11

**Status upgrade:** draft → review-ready

- Frontmatter: YAML block present; `status: draft`; `type: BEHAVIOR` (valid 11-prefix value); `tags: [cli, typescript]` present
- Problem: concrete symptom (grep-tool.ts:229 description advertises `count` mode and `head_limit` absent from `GrepSchema` at grep-tool.ts:36-41; LLM `outputMode: "count"` calls fail enum validation) + reproduction condition (ask agent to count matches via Grep count mode → validation failure, wasted turn); no TBD/TODO/vague single-sentence description
- Architecture Review Checklist: all 4 items `[x]`; sibling scan `[x]` with completion evidence (Read `limit` / Glob conventions surveyed; `headLimit` defined as result-item cap with truncation marker per CLI-031 convention)
- Alternatives Considered: 3 entries (A implement both / B reduce description / C snake_case naming), each with explicit pro and con
- Decision: references driving trade-offs — few-line implementation cost on existing pipeline vs. retracting an advertised capability (rejects B); camelCase schema consistency vs. verbatim description match (rejects C)
- Completion Criteria: TC-01 through TC-05, all TC-prefixed; each in command form or observable-behavior form; no banned vague phrases ("works correctly", "no errors", etc.)
- Test Plan: section present; 5 rows = 5 TC-N criteria (count matches); every row has non-empty Test Type and Tool/Approach; no "manual" rows, so empty Notes acceptable
- Structure: `## Tasks` present with placeholder; `## Evidence Log` present and empty at gate run; no `## Status` or `## Classification` body sections

### [GATE-APPROVAL] — ✅ PASS | 2026-06-11

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation (2026-06-10): after the orchestrating agent presented 14 audit backlog items (CLI-049~062) including CLI-057 (Grep tool description advertises count mode and head_limit that don't exist), the user stated verbatim: "cjk 관련된 것 빼고 나머지 모두 진행해줘. pr을 올리면서 머지하며 작업해줘. feature 브랜치 -> develop -> main"
- Approval is direct and unambiguous for this spec: it covers all presented items except CJK-related ones (CLI-061/062); CLI-057 is not CJK-related, so it is within the approved set
- No Architecture Review or frontmatter type/tags modifications after approval
- No implementation work (file edits, code commits) started for this scope before this gate ran

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-11

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-057.md` exists with 5 tasks — T1 (TC-03: schema `count` enum + `headLimit` param + description rewrite), T2 (TC-01: searchFile count branch → `path:count` rows), T3 (TC-02: headLimit slice + truncation marker), T4 (TC-04: regression tests for files_with_matches / content+contextLines), T5 (TC-05: SPEC.md Grep row update + build/test green)
- Tasks file path recorded in `## Tasks` section of this spec (updated from placeholder during this gate run)
- Task ↔ Completion Criteria correspondence: every TC-N (TC-01~TC-05) has exactly one mapped task (T2→TC-01, T3→TC-02, T1→TC-03, T4→TC-04, T5→TC-05); no TC-N unmapped
- No NON-COMPLIANCE: no implementation commits exist for this scope ahead of the tasks file
- Note: tasks file references the spec at `.agents/spec-docs/active/` anticipating the stage move; spec currently resides in `todo/` — not a gate criterion, recorded for the pipeline to reconcile on stage transition

### [GATE-COMPLETE: TC-01] — ✅ | 2026-06-11

**Test:** `packages/agent-tools/src/__tests__/grep-tool.test.ts` > "TC-01: count mode returns path:count rows for matching files only" — temp fixture with 3 matching files returns `a.txt:2`, `b.txt:1`, `c.md:1` rows (pass).

### [GATE-COMPLETE: TC-02] — ✅ | 2026-06-11

**Tests:** "TC-02: headLimit caps results and appends a truncation marker" — headLimit 2 on 3 results → 2 rows + `(+1 more results truncated by headLimit)`; "TC-02: without headLimit all results are returned" (both pass).

### [GATE-COMPLETE: TC-03] — ✅ | 2026-06-11

**Tests:** "TC-03: schema accepts count mode and headLimit; rejects non-positive headLimit" (headLimit 0 → ValidationError) and "TC-03: description mentions only schema-supported parameters" (contains 'count' + headLimit, no head_limit) — both pass.

### [GATE-COMPLETE: TC-04] — ✅ | 2026-06-11

**Tests:** files_with_matches path output, content mode with contextLines markers (`:2:beta`, `:1-alpha`), glob filter `*.md`, invalid-regex error path — all pass (9/9 in the file).

### [GATE-COMPLETE: TC-05] — ✅ | 2026-06-11

**Commands:** `pnpm --filter @robota-sdk/agent-tools build` ok; typecheck 0 errors; lint 0 errors (28 pre-existing warnings); test 159/159 across 11 files. SPEC.md Grep rows updated (export table + file tree) to document the three modes and headLimit.

### [GATE-VERIFY] — ✅ PASS | 2026-06-11

**Status upgrade:** in-progress → verifying

- Tasks file completion: `.agents/tasks/completed/CLI-057.md` — all 5 tasks (T1–T5) marked `[x]`; no blocked or pending tasks
- Build: `pnpm --filter @robota-sdk/agent-tools build` re-run by gate guard — exit 0, CJS + ESM (node/browser) bundles + d.ts emitted, "Build complete"
- Tests: `pnpm --filter @robota-sdk/agent-tools test` re-run by gate guard — 11 test files passed, 159/159 tests passed (includes `grep-tool.test.ts` 9 tests)
- Repo-wide build intentionally not run per pipeline scoping instruction; affected package is agent-tools only (per Affected Scope)

### [GATE-COMPLETE] — ✅ PASS | 2026-06-11

**Status upgrade:** verifying → done

- Completion Criteria: TC-01~TC-05 all checked `[x]` in `## Completion Criteria`
- Per-TC evidence: `[GATE-COMPLETE: TC-01]`…`[GATE-COMPLETE: TC-05]` entries all present with test references / command results
- Test references verified against source by gate guard: `packages/agent-tools/src/__tests__/grep-tool.test.ts` contains the cited tests — TC-01 (1), TC-02 (2), TC-03 (2), TC-04 (3) plus invalid-regex error test = 9 tests, matching the 9/9 cited; all pass in the 159/159 run
- Test Plan: all 5 TC-N rows updated with test file/test-name references (TC-01~04) or command-based verification note (TC-05); no row left without a reference or skip reason
- Tasks file archived: `.agents/tasks/completed/CLI-057.md` exists; original `.agents/tasks/CLI-057.md` no longer present
- `## Tasks` section reflects archived path (`.agents/tasks/completed/CLI-057.md`)
