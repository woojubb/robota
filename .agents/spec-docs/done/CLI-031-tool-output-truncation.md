---
status: done
type: BEHAVIOR
tags: [cli]
---

# CLI-031: 도구 출력 30,000자 truncation 사용자 알림

## Problem

Bash, Read 등 도구의 출력이 30,000자를 초과하면 잘려서 모델에 전달된다. 잘림 발생 시 사용자에게 명확한 알림이 없어 모델이 불완전한 출력을 기반으로 잘못된 결론을 내릴 수 있다.

재현 조건: `pnpm test` 실행 결과가 매우 길 때 모델이 중간에 잘린 출력을 "모든 테스트 통과"로 잘못 해석하는 경우.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/assembly/create-session.ts` — 도구 출력 처리 시 truncation 표시 추가

### Alternatives Considered

- **Alt A (채택): 모델 메시지에 truncation 표시 텍스트 삽입** — Pro: 모델이 truncation을 인식하고 적절히 응답 가능. Con: 메시지 포맷 변경이 필요.
- **Alt B: TUI에만 시각적 표시** — Pro: 모델 메시지 불변. Con: 모델은 여전히 truncation을 모름, 핵심 문제 미해결.

### Decision

Alt A 채택. 출력이 truncation threshold에 도달할 때 모델에게 전달되는 메시지 말미에 `[출력이 잘렸습니다...]` 표시 텍스트를 추가. 모델이 truncation 사실을 인식하고 더 짧은 출력을 요청하거나 대안을 제시할 수 있도록 함.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — create-session.ts, tool output pipeline 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

도구 출력 처리 시 길이가 임계값(30,000자)을 초과하면 출력 말미에 truncation 알림 텍스트를 삽입하여 모델에게 전달.

## Affected Files

- `packages/agent-framework/src/assembly/create-session.ts`

## Completion Criteria

- [x] TC-01: 30,000자 초과 도구 출력 → 모델에게 전달되는 메시지에 truncation 알림 포함
- [x] TC-02: 30,000자 이하 출력 → truncation 알림 없음
- [x] TC-03: truncation 알림 텍스트가 "출력이 잘렸습니다" 또는 동등한 표현을 포함

## Test Plan

| TC-ID | Test Type | Tool / Approach                   | Notes                                    |
| ----- | --------- | --------------------------------- | ---------------------------------------- |
| TC-01 | unit      | vitest — tool output length mock  | Mock output > 30000 chars, check message |
| TC-02 | unit      | vitest — tool output length mock  | Mock output < 30000, verify no notice    |
| TC-03 | unit      | vitest — message string assertion | Check truncation notice text content     |

## Tasks

- [x] `.agents/tasks/completed/CLI-031.md` — archived

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: BEHAVIOR` is valid (in 11-prefix list); `tags: [cli]` present.
- Problem section: concrete symptom present (`pnpm test` output truncated → model misinterprets as all-pass); reproduction condition present (when tool output exceeds 30,000 chars); no TBD/TODO/vague single-sentence found.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with evidence (`create-session.ts, tool output pipeline 확인`); Alternatives Considered has 2 entries (Alt A, Alt B) each with Pro/Con; Decision references trade-off (model must know about truncation to respond appropriately).
- Completion Criteria: all 3 items carry TC-N prefix (TC-01, TC-02, TC-03); each uses observable behavior form; no prohibited vague language ("works correctly", "no errors", "implemented", "displays correctly") found.
- Test Plan: section present; 3 rows match 3 TC-N items exactly (count matches); all rows have non-empty Test Type (`unit`) and Tool/Approach (`vitest`); no manual rows requiring Notes justification, but all rows include non-empty Notes anyway.
- Structure: `## Tasks` section present with placeholder; `## Evidence Log` section present and was empty before this entry; no `## Status` or `## Classification` body sections found.
- TC-N count match: Completion Criteria = 3 (TC-01..TC-03), Test Plan rows = 3 (TC-01..TC-03). ✅

### [GATE-APPROVAL] — ✅ PASS | 2026-05-25

**Status upgrade:** review-ready → approved

- Approved by: user explicit statement ("네 승인합니다. 이어서 끝까지 작업하세요")
- Approved batch: CLI group (CLI-027~048)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-05-25

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-031.md`
- Tasks: TC-01: 30,000자 초과 시 truncation 알림 포함, TC-02: 30,000자 이하 시 알림 없음, TC-03: truncation 알림 텍스트 내용 확인

### [GATE-VERIFY] — ✅ PASS | 2026-05-25

**Status upgrade:** in-progress → verifying

- All tasks in `.agents/tasks/CLI-031.md` marked complete ✅
- Build: pnpm build PASS (pre-verified 2026-05-25)
- Test: pnpm test PASS (pre-verified 2026-05-25)
- TC-01: `grep -n "MAX_TOOL_OUTPUT_CHARS\|truncateToolResult" packages/agent-session/src/tool-hook-helpers.ts` → `truncateToolResult` at line 22 inserts `[... output truncated: ...]` text when data.length > MAX_TOOL_OUTPUT_CHARS (30_000) ✅
- TC-02: `grep "data.length <= MAX_TOOL_OUTPUT_CHARS" packages/agent-session/src/tool-hook-helpers.ts` → line 24 returns original result unchanged when within limit ✅
- TC-03: `grep "truncated" packages/agent-session/src/tool-hook-helpers.ts` → line 30 inserts `"[... output truncated: N chars total, showing first and last 15,000 chars ...]"` — English equivalent of 출력이 잘렸습니다; confirmed by test at `packages/agent-session/src/__tests__/tool-hook-helpers.test.ts` line 149 `expect(out.data).toContain('truncated')` ✅

### [GATE-COMPLETE] — ✅ PASS | 2026-05-25

**Status upgrade:** verifying → done

- [GATE-COMPLETE: TC-01] `grep "truncateToolResult" packages/agent-session/src/tool-hook-helpers.ts` → line 22-32: inserts `[... output truncated: ...]` text when data.length > MAX_TOOL_OUTPUT_CHARS (30_000); permission-enforcer.ts line 150 calls it on every tool result ✅
- [GATE-COMPLETE: TC-02] `grep "data.length <= MAX_TOOL_OUTPUT_CHARS" packages/agent-session/src/tool-hook-helpers.ts` → line 24: returns original result when within 30,000 char limit ✅
- [GATE-COMPLETE: TC-03] `grep "output truncated" packages/agent-session/src/tool-hook-helpers.ts` → line 30: text is `"[... output truncated: N chars total, showing first and last 15,000 chars ...]"` — equivalent to "출력이 잘렸습니다"; test file asserts `.toContain('truncated')` ✅
- All TC-N verified and checked. Test Plan: all 3 TCs covered by vitest tests in `packages/agent-session/src/__tests__/tool-hook-helpers.test.ts` describe block 'truncateToolResult'.
- Tasks archived to `.agents/tasks/completed/CLI-031.md`
