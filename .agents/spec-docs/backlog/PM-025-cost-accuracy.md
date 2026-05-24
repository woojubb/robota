---
status: review-ready
type: DATA
tags: [cli, cost, ux]
---

# PM-025: /cost 정확도 개선 — provider 가격표 내장 + 실시간 계산

## Problem

`/cost` 명령이 토큰 사용량을 표시하지만 USD 비용이 부정확하거나 표시되지 않는다. 개발자가 AI 도구 도입 시 비용 예측이 핵심 의사결정 요소인데 "얼마 들었는지 모르는" 상태는 신뢰를 낮춘다.

재현 조건: `/cost` 실행 → USD 금액이 0으로 표시되거나 누락됨.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/pricing.ts` — 모델 가격표 신규 추가
- `packages/agent-cli/src/commands/cost-command.ts` — USD 계산 및 표시

### Alternatives Considered

- **Alt A (채택): 가격표 코드에 하드코딩 + 릴리스마다 업데이트** — Pro: 외부 의존성 없음, 오프라인 동작. Con: 가격 변경 시 릴리스 필요.
- **Alt B: 런타임에 가격 API 조회** — Pro: 항상 최신 가격. Con: 네트워크 의존성, 오프라인 환경 불가, 속도 저하.

### Decision

Alt A 채택. 정적 가격표를 `pricing.ts`에 내장. 주요 Claude 모델(Opus, Sonnet, Haiku)과 OpenAI, Gemini 모델 포함. 가격 변경 시 CHANGELOG에 명시.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — cost-command.ts, usage 추적 코드 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

`pricing.ts`에 주요 모델 가격표 추가. 각 API 호출마다 `usage.input_tokens + usage.output_tokens`를 누적. `/cost` 실행 시 입력/출력 토큰 × 단가 = USD 표시.

## Affected Files

- `packages/agent-framework/src/pricing.ts`
- `packages/agent-cli/src/commands/cost-command.ts`

## Completion Criteria

- [ ] TC-01: `/cost` 실행 → 입력/출력 토큰 수와 USD 금액 표시
- [ ] TC-02: 알려진 모델 사용 시 USD가 0으로 표시되지 않음
- [ ] TC-03: 가격표에 claude-sonnet-4-6, claude-haiku-4-5, claude-opus-4-7 포함
- [ ] TC-04: 세션 누적 비용이 정확히 합산됨 (여러 턴 합계)

## Test Plan

| TC-ID | Test Type | Tool / Approach                     | Notes                                    |
| ----- | --------- | ----------------------------------- | ---------------------------------------- |
| TC-01 | unit      | vitest — cost command output        | Mock usage data, verify USD in output    |
| TC-02 | unit      | vitest — pricing table lookup       | Known model ID → non-zero price returned |
| TC-03 | unit      | vitest — pricing table completeness | Check claude-sonnet-4-6 entry exists     |
| TC-04 | unit      | vitest — multi-turn cost sum        | Sum of 3 turns equals total displayed    |

## Tasks

- [ ] `.agents/tasks/PM-025.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-24

**Status upgrade:** draft → review-ready

- Frontmatter: `---` block present; `status: draft` confirmed; `type: DATA` is a valid prefix; `tags: [cli, cost, ux]` present.
- Problem section: concrete symptom present ("`/cost` 실행 → USD 금액이 0으로 표시되거나 누락됨"); reproduction condition present; no TBD/TODO/vague single-sentence descriptions.
- Architecture Review Checklist: all 4 items are `[x]`; sibling scan `[x]` with explicit evidence ("cost-command.ts, usage 추적 코드 확인"); Alternatives Considered has 2 entries (Alt A, Alt B) each with pro/con; Decision references the trade-off (offline/no-external-deps vs network dependency).
- Completion Criteria: 4 items (TC-01–TC-04), all with TC-N prefix; command/observable-behavior form; no vague language.
- Test Plan: section present; 4 rows matching TC-01–TC-04 (count matches); all rows have non-empty Test Type ("unit") and Tool/Approach (vitest); no manual rows requiring Notes.
- Structure: Tasks section present with placeholder; Evidence Log section present and was empty; no `## Status` or `## Classification` body sections found.
