---
status: done
type: BEHAVIOR
tags: [cli]
---

# CTX-001: 컨텍스트 트래커가 정확한(프로바이더 기반) 토큰 추정을 사용하도록 수정

## Problem

CLI 상태줄/usage 요약에서 **토큰 사용량과 컨텍스트가 크게 어긋나** 보인다. 예:
`Usage: exact 86.4K tokens (in 83.7K / out 2.7K) · Context 1% (11.3K/1M)`.

원인 분석:

- `Usage`의 `promptTokens`(83.7K)는 **한 턴의 모든 에이전트 라운드에 걸친 프로바이더 청구 입력 토큰의
  합**(`extractTurnUsage`이 각 assistant 메시지의 `inputTokens`를 누적)이라 크게 나오는 것이 정상이다.
- `Context`(11.3K)는 `ContextWindowTracker`가 `estimateSerializedContextTokens(history)` =
  `JSON.stringify(history).length / 4`로 계산한다 — **대화 history JSON만** 세고, **시스템 프롬프트 +
  도구 스키마를 제외**하며, 프로바이더의 실제 토큰 수를 쓰지 않는 거친 추정이다 → **과소 계상**.

핵심 불일치: **core 실행 가드**(`execution-round-context.ts`, `execution-round-tool-results.ts`)는
정확한 추정기 `estimateContextTokensFromMessages`(메시지 메타데이터의 프로바이더 토큰 + floor 사용)를
쓰는데, **세션 표시·auto-compact**(`ContextWindowTracker`)만 거친 `estimateSerializedContextTokens`를
쓴다. `ContextWindowTracker`의 주석은 "shared core estimator를 써서 session display·/context·
auto-compact·core 실행 가드가 동일한 effective token state를 본다"고 적혀 있으나 실제로는 다른(거친)
함수를 호출 — **주석과 구현 불일치(회귀)**.

**재현 조건:** `ContextWindowTracker.updateFromHistory`가 `estimateSerializedContextTokens(history)`를
호출(`packages/agent-session/src/context-window-tracker.ts`). 프로바이더 usage가 메타데이터에 있어도
무시되어 컨텍스트가 실제보다 낮게 표시되고, auto-compact 임계 판단도 과소 계상된다.

## Architecture Review

### Affected Scope

- `packages/agent-session/src/context-window-tracker.ts` — `updateFromHistory`가 정확한 추정기
  `estimateContextTokensFromMessages(history).usedTokens` 사용(core 가드와 동일 추정기로 통일)

### Alternatives Considered

1. **표시만 따로 정확하게 계산하고 auto-compact는 거친 추정 유지.**
   - Con: 두 경로가 또 어긋남; auto-compact가 과소 계상돼 컨텍스트가 실제보다 차도 늦게 트리거(오버플로 위험). Rejected.
2. **`ContextWindowTracker`가 core와 동일한 `estimateContextTokensFromMessages`를 사용.**
   - Pro: 주석의 명시된 의도 충족; 표시·auto-compact·core 가드가 동일 effective token state; 프로바이더 토큰
     반영으로 시스템+도구 포함한 정확한 컨텍스트; auto-compact는 같거나 더 이르게(안전) 트리거.
   - Con: 컨텍스트 표시 수치가 (정확히) 커짐 — 의도된 수정.

### Decision

**Alternative 2.** `estimateSerializedContextTokens` → `estimateContextTokensFromMessages(history).usedTokens`.
정확한 추정기는 최신 메시지의 프로바이더 토큰(terminal일 때 그 값, 아니면 max(serialized, provider, floor))을
사용하므로 시스템 프롬프트+도구를 포함한 실제 컨텍스트를 반영한다. 새 값은 항상 기존(거친) 값 이상이라
auto-compact는 같거나 더 이르게 트리거(과소 계상 제거 → 오버플로 위험 감소). 무회귀: 최신 메시지에 프로바이더
usage가 없으면 serialized로 폴백(기존과 동일).

참고: `Usage`(누적 청구)와 `Context`(현재 창 점유)는 본질적으로 다른 지표이므로 동일해지지 않는다. 본
수정은 `Context`를 **정확**하게 만들 뿐(과소 계상 제거), 둘을 같게 만들지 않는다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-session(context-window-tracker)
- [x] Sibling scan 완료 — core `execution-round-context.ts`/`execution-round-tool-results.ts`가 이미 `estimateContextTokensFromMessages` 사용 확인 후 동일 추정기로 통일
- [x] 대안 최소 2개 검토 완료 — 2개(표시만 / 통일)
- [x] 결정 근거 문서화 완료 — 주석 의도 충족 + auto-compact 안전(과소 계상 제거) 근거 기록

## Solution

`context-window-tracker.ts`: import를 `estimateContextTokensFromMessages`로 교체하고
`updateFromHistory`에서 `this.contextUsedTokens = estimateContextTokensFromMessages(history).usedTokens`.

## Affected Files

- `packages/agent-session/src/context-window-tracker.ts`
- `packages/agent-session/src/context-window-tracker.test.ts`

## Completion Criteria

- [x] TC-01: 최신(terminal) assistant 메시지에 프로바이더 usage(`inputTokens`/`outputTokens`)가 있고 serialized history가 작을 때, `getContextState().usedTokens`가 프로바이더 total(≈input+output)을 반영(serialized 추정이 아니라)함을 단언하는 단위 테스트 통과
- [x] TC-02: 최신 메시지에 프로바이더 usage가 없을 때는 serialized 추정으로 폴백(기존 동작 무회귀)함을 단언하는 단위 테스트 통과(기존 large-user-message 테스트 유지/통과)
- [x] TC-03: `ContextWindowTracker`가 `estimateSerializedContextTokens` 대신 `estimateContextTokensFromMessages`를 import/사용함을 단언하는 커맨드폼 테스트(`rg` 0건/1건) 통과
- [x] TC-04: `pnpm --filter @robota-sdk/agent-session build` + `test` + `pnpm typecheck` → exit 0; `harness:scan` 통과

## Test Plan

Type BEHAVIOR + tags cli → 트래커 추정 정확도(프로바이더 반영/폴백) 단위 테스트 + import 검사 + 빌드/테스트/타입체크/스캔.

| TC-ID | Test Type              | Tool / Approach                                      | Notes    |
| ----- | ---------------------- | ---------------------------------------------------- | -------- |
| TC-01 | RULE (unit)            | vitest — terminal 프로바이더 usage 반영 단언         |          |
| TC-02 | RULE (unit)            | vitest — usage 없음 → serialized 폴백 단언           |          |
| TC-03 | CI pipeline smoke test | `rg` import 교체 단언                                | 커맨드폼 |
| TC-04 | CI pipeline smoke test | `pnpm build` + `test` + `typecheck` + `harness:scan` | 커맨드폼 |

## User Execution Test Scenarios

- **시나리오 — 컨텍스트 정확도 확인:** 전제: 프로바이더 설정. 실행: `robota`로 몇 턴 대화 후 상태줄/usage
  요약의 `Context` 확인. 기대: `Context`가 시스템 프롬프트+도구를 포함한 실제 컨텍스트(프로바이더 토큰)에
  근접해 표시(이전처럼 history-only로 과소 표시되지 않음). `Usage`(누적 청구)는 여전히 더 클 수 있음(정상).
  정리: 없음. Evidence: 수정 전후 `Context` 수치 비교(구현 후 기록).

환경: 실제 프로바이더 키 필요(로컬 설정). 단위 테스트로 추정 로직 검증.

## Tasks

- [x] [.agents/tasks/CTX-001.md](../../tasks/CTX-001.md) — task breakdown (TC-01..TC-04)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-14

**Status upgrade:** draft → review-ready
Frontmatter present (`status`, `type: BEHAVIOR`, `tags: [cli]`). Problem states the observed symptom
(Usage 86.4K vs Context 11.3K) with root-cause analysis: `promptTokens` is cumulative per-turn billed
input (correct); `Context` under-reports because `ContextWindowTracker` uses the crude
`estimateSerializedContextTokens` (history-JSON only) while the core guards use the accurate
`estimateContextTokensFromMessages` — and the tracker's own comment contradicts its implementation.
Architecture Review: 4 checklist items `[x]`; Sibling scan cites the core consumers; 2 Alternatives with
Con/Pro; Decision records comment-intent alignment + auto-compact safety. Completion Criteria TC-01..TC-04
command-form/observable; Test Plan rows match TC set 1:1.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-14

**Status upgrade:** review-ready → approved
Explicit user approval (verbatim): "토큰 사용량과 context가 이렇게 다르게 나오는게 문제가 없는지 확인하고
바로잡아줘" — directly authorizes verifying the token/context discrepancy and fixing it. The investigation
confirmed a real under-count bug (history-only crude estimate); this spec is the fix. No post-approval drift.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-14

**Status upgrade:** approved → in-progress
Task file `.agents/tasks/CTX-001.md` created and linked. One task per Completion Criterion (TC-01..TC-04)
plus the estimator-swap task. Test Plan present (≥50 chars).

### [GATE-VERIFY] — ✅ PASS | 2026-06-14

**Status upgrade:** in-progress → verifying
All tasks `[x]`. `pnpm --filter @robota-sdk/agent-session build` → exit 0. `pnpm --filter
@robota-sdk/agent-session --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-transport test`
→ exit 0 (agent-session 14 files incl. the 2 tracker cases, agent-framework 99, agent-transport 61), no
regressions. `pnpm typecheck` → exit 0 (monorepo). `pnpm harness:scan` → exit 0, 25/25. No
package.json/lockfile change.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-14

**Status upgrade:** verifying → done
Per-TC:

- [GATE-COMPLETE: TC-01] agent-session vitest (`context-window-tracker.test.ts`) — `TC-01: reflects the provider-reported tokens ... when the latest message carries usage` PASS: tiny serialized history but a 40.5K provider total → `usedTokens >= 40_000`.
- [GATE-COMPLETE: TC-02] vitest `TC-02: falls back to serialized estimate when the latest message carries no usage` PASS: the large-user-message case still yields `usedTokens >= 80_000` (no regression).
- [GATE-COMPLETE: TC-03] `rg -c "estimateSerializedContextTokens" context-window-tracker.ts` → 0; `rg -c "estimateContextTokensFromMessages"` → 3 (import + JSDoc + call). Estimator swapped.
- [GATE-COMPLETE: TC-04] agent-session build + the 3-package test + `pnpm typecheck` + `pnpm harness:scan` all exit 0.
- Safety: the accurate count is always ≥ the crude count (`max(serialized, provider, floor)`), so session auto-compact (threshold 83.5%) can only trigger earlier, never later — removes the under-count overflow risk and aligns with core execution guards.
