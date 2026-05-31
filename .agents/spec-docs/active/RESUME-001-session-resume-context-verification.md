---
status: approved
type: BEHAVIOR
tags: [session, context, resume, status-bar, test-coverage]
---

# RESUME-001: 세션 리줌 후 컨텍스트 복구 검증 — contextReferences·usedTokens·상태바

## Problem

BEHAVIOR-001(PR #656)에서 `injectRawMessage`를 통해 메시지 구조 복원을 수정했다. 그러나 세션 리줌의 나머지 두 축인 **contextReferences 복구**와 **컨텍스트 토큰/상태바**는 구현은 있으나 자동 테스트로 검증되지 않았다.

현재 상황:

- 세션 리줌 후 `/context list` 결과가 이전 세션의 컨텍스트 참조를 반환하는지 검증 테스트 없음
- 리줌 직후 `getContextState().usedTokens = 0` — 상태바가 항상 0%를 표시하는 버그
- 리줌 직후 0%는 사용자에게 잘못된 컨텍스트 사용 현황을 보여 줌 (이전 대화가 길었어도 0%로 표시)
- 리줌 후 첫 submit 이후 상태바가 복원된 메시지를 포함한 올바른 값을 보여주는지 검증 없음
- messages 구조가 복원된 뒤 LLM 호출에 올바르게 전달되는지 end-to-end 검증 없음

재현 조건:

1. 세션에서 `@file` 참조 등으로 파일을 컨텍스트에 추가하고 여러 턴 대화
2. 세션 종료 (세션 파일 저장됨)
3. `robota --resume <id>` 로 재시작
4. 상태바 → 0% 표시 (버그)
5. `/context list` 실행 → 이전 세션 파일 목록 포함 여부 불확실

### 코드 점검 결과 — 현재 구현 상태

| 기능                            | 저장                                             | 복구 코드                                      | 테스트         |
| ------------------------------- | ------------------------------------------------ | ---------------------------------------------- | -------------- |
| messages (tool_use+tool_result) | ✅ `IInteractiveSessionRecord.messages`          | ✅ `injectRawMessage` (BEHAVIOR-001)           | ✅ TC-01~TC-06 |
| contextReferences               | ✅ `IInteractiveSessionRecord.contextReferences` | ✅ `histTracker.restoreState()`                | ❌ 없음        |
| usedTokens                      | ❌ 저장 안 됨                                    | ❌ 리줌 후 0 (버그)                            | ❌ 없음        |
| `/context list` 결과            | —                                                | ✅ `listContextReferences()` reads histTracker | ❌ 없음        |
| 상태바 contextState             | —                                                | `getContextState()` → contextTracker           | ❌ 없음        |

**핵심 버그**: `injectRawMessage()`는 `conversationStore`에만 메시지를 추가하며 `contextTracker`를 갱신하지 않는다. 따라서 리줌 직후 `contextTracker.usedTokens = 0`이고 상태바는 항상 0%를 표시한다.

## Architecture Review

### Affected Scope

- `packages/agent-session/src/session-record.ts` (또는 해당 타입 파일) — `IInteractiveSessionRecord.usedTokens` 필드 추가
- `packages/agent-session/src/context-window-tracker.ts` — `restoreUsedTokens(n: number)` 메서드 추가
- `packages/agent-framework/src/interactive/interactive-session-persistence.ts` — `persistSession()`에 `usedTokens` 포함
- `packages/agent-framework/src/interactive/interactive-session-restore.ts` — `loadSessionRecord()` 반환에 `usedTokens` 포함
- `packages/agent-framework/src/interactive/interactive-session.ts` — `restoreSessionRecordIfNeeded()`에서 `restoreUsedTokens()` 호출
- `packages/agent-framework/src/interactive/__tests__/` — 신규 테스트 파일 및 기존 파일에 TC 추가

### Alternatives Considered

**A. 리줌 후 usedTokens = 0 그대로 허용 (의도적 동작으로 명세화)**

- Pro: 구현 변경 없음
- Con: 사용자는 긴 대화를 리줌했을 때 컨텍스트가 얼마나 사용됐는지 알 수 없음 — 상태바 0% 표시는 명백한 정보 손실

**B. 복원된 messages에서 토큰 추정 후 contextTracker 초기화**

- Pro: 세션 포맷 변경 없음
- Con: 추정값이므로 실제 LLM 카운트와 편차 발생; 모델마다 토큰화 방식 달라 정확도 불안정

**C. 세션 저장 시 usedTokens를 IInteractiveSessionRecord SSOT 필드로 신설** ← 채택

- Pro: LLM API 응답의 정확한 값 복원; `usedTokens`가 세션 레코드의 SSOT로 자리잡아 향후 세션 목록 표시·분석 도구(OBS-001 연계)·통계 등 다른 소비자도 활용 가능
- Con: 세션 레코드 포맷에 필드 추가 — 기존 세션 파일은 해당 필드 없음 → `undefined` 시 0으로 fallback (자연스러운 하위 호환)

### Decision

**Option C 채택** — `usedTokens`를 `IInteractiveSessionRecord`의 SSOT 필드로 신설한다.

근거:

1. **정확성**: LLM API 응답에서 받은 정확한 값을 저장·복원한다. 추정값은 구조적으로 부정확하다.
2. **SSOT 확장성**: `usedTokens`는 세션 리줌 외에도 세션 목록 표시, OBS-001 분석, 향후 컨텍스트 관리 UI 등 여러 소비자가 활용할 수 있는 공유 사실(fact)이다.
3. **구현 범위 최소**: `maxTokens`는 provider config에서 읽으므로 저장 불필요. `usedTokens` 단일 필드 추가로 충분하다.
4. **기존 세션 파일 호환**: `usedTokens?: number` 선택적 필드이므로 기존 파일은 `undefined → 0`으로 자연 처리된다.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — 기존 interactive-session 테스트 파일 14개 전체 확인
- [x] 대안 최소 2개 검토 완료 (A, B, C)
- [x] 결정 근거 문서화 완료

## Solution

### Step 1 — usedTokens SSOT 필드 신설 및 복원 구현

**1-a. 타입 확장** — `IInteractiveSessionRecord`에 `usedTokens?: number` 추가

**1-b. 저장** — `persistSession()`에서 `session.getContextState().usedTokens`를 레코드에 포함

**1-c. contextTracker 복원 메서드 추가** — `ContextWindowTracker.restoreUsedTokens(n: number)`:

```typescript
restoreUsedTokens(n: number): void {
  this.contextUsedTokens = n;
}
```

**1-d. 복원 호출** — `restoreSessionRecordIfNeeded()`에서 `record.usedTokens`가 있으면 `session.restoreUsedTokens(record.usedTokens)` 호출

**결과**: 리줌 직후 상태바가 이전 세션의 정확한 토큰 퍼센트를 표시한다.

### Step 2 — 검증 테스트 작성

신규 파일 `interactive-session-resume-context.test.ts` 및 기존 테스트 파일에 아래 TC를 추가한다.

**TC-01: contextReferences 저장→리줌 라운드트립**

- 세션 생성, 파일 컨텍스트 참조 추가, 세션 저장
- 동일 세션 ID로 리줌
- `listContextReferences()` 반환값에 저장된 파일 경로 포함 단언

**TC-02: 리줌 직후 getContextState()가 저장된 usedTokens를 반환**

- 저장 시 `usedTokens = 5_000`인 세션을 리줌
- 리줌 직후 `getContextState().usedTokens === 5_000` 단언
- `usedPercentage > 0` 단언 — 상태바 0% 버그 수정 확인

**TC-03: 리줌 후 첫 submit 완료 시 getContextState()가 갱신된 토큰 수 반환**

- 리줌 → submit → mock provider가 `usageMetadata.totalTokens = 8_000` 반환
- `getContextState().usedTokens === 8_000` 단언

**TC-04: 리줌 후 /context list = 시스템 refs + 저장된 user refs, 중복 없음**

- 시스템 컨텍스트(AGENTS.md 등) + 이전 세션에서 저장한 user ref 모두 포함
- 중복 항목 없음 단언

**TC-05: 리줌 후 첫 submit 시 provider.chat()에 복원된 messages가 전달됨**

- provider의 `chat()` 호출 인자 캡처
- 복원된 tool_use+tool_result 쌍이 structured object로 포함됨 단언

**TC-06: listInjectionContextReferences()가 리줌 후 중복 주입 방지**

- 프롬프트 전처리 시 복원된 컨텍스트 파일이 다시 주입되지 않음 단언

## Affected Files

| 파일                                                                                            | 변경 종류 | 내용                                                               |
| ----------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `packages/agent-session/src/session-record.ts` (타입 위치 확인 필요)                            | 수정      | `IInteractiveSessionRecord.usedTokens?: number` 추가               |
| `packages/agent-session/src/context-window-tracker.ts`                                          | 수정      | `restoreUsedTokens(n: number)` 메서드 추가                         |
| `packages/agent-framework/src/interactive/interactive-session-persistence.ts`                   | 수정      | `persistSession()`에 `usedTokens` 포함                             |
| `packages/agent-framework/src/interactive/interactive-session-restore.ts`                       | 수정      | `loadSessionRecord()` 반환 타입에 `usedTokens` 포함                |
| `packages/agent-framework/src/interactive/interactive-session.ts`                               | 수정      | `restoreSessionRecordIfNeeded()`에 `restoreUsedTokens()` 호출 추가 |
| `packages/agent-framework/src/interactive/__tests__/interactive-session-resume-context.test.ts` | **신규**  | TC-01, TC-02, TC-04, TC-06                                         |
| `packages/agent-framework/src/__tests__/history-cross-package.test.ts`                          | 수정      | TC-03, TC-05 추가                                                  |

## Completion Criteria

- [ ] TC-01: 리줌 후 `listContextReferences()`가 이전 세션에서 저장한 파일 경로를 반환한다
- [ ] TC-02: 리줌 직후 `getContextState().usedTokens`가 저장된 값과 일치하고 `usedPercentage > 0`이다
- [ ] TC-03: 리줌 후 첫 submit 완료 시 `getContextState().usedTokens`가 provider 응답의 토큰 수로 갱신된다
- [ ] TC-04: 리줌 후 `listContextReferences()`에 시스템 refs + 저장된 user refs가 중복 없이 포함된다
- [ ] TC-05: 리줌 후 첫 submit 시 `provider.chat()` 호출 인자에 복원된 tool_use+tool_result 쌍이 structured object로 포함된다
- [ ] TC-06: `listInjectionContextReferences()`가 리줌 후 저장된 refs를 올바르게 반환해 프롬프트 전처리가 중복 주입하지 않는다

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                         | Notes                                 |
| ----- | ----------- | ------------------------------------------------------- | ------------------------------------- |
| TC-01 | Unit        | vitest — InteractiveSession + real SessionStore fixture | contextReference round-trip           |
| TC-02 | Unit        | vitest — getContextState() 리줌 직후 단언               | usedTokens 복원 확인 (버그 수정 검증) |
| TC-03 | Integration | vitest — mock provider `usageMetadata` 반환             | 첫 submit 후 토큰 갱신 확인           |
| TC-04 | Unit        | vitest — listContextReferences() 결합 단언              | 시스템 + 사용자 refs                  |
| TC-05 | Unit        | vitest — provider.chat() 호출 인자 캡처                 | messages 구조 검증                    |
| TC-06 | Unit        | vitest — listInjectionContextReferences()               | 중복 주입 방지                        |

## Tasks

- [ ] `.agents/tasks/RESUME-001.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-05-31

**Status upgrade:** draft → review-ready

- **Frontmatter:** `---` block present at line 1; `status: draft` at line 2; `type: BEHAVIOR` is a valid type value; `tags: [session, context, resume, status-bar, test-coverage]` present.
- **Problem:** Concrete symptom identified — "리줌 직후 `getContextState().usedTokens = 0` — 상태바가 항상 0%를 표시하는 버그" with specific function name and observable wrong output. Reproduction condition provided as 5-step sequence (`robota --resume <id>`). No TBD/TODO found.
- **Architecture Review:** All 4 checklist items are `[x]`. Sibling scan `[x]` with explicit completion evidence ("기존 interactive-session 테스트 파일 14개 전체 확인"). Alternatives A, B, C each have distinct Pro/Con entries. Decision cites 4 trade-off reasons (정확성, SSOT 확장성, 구현 범위 최소, 기존 파일 호환).
- **Completion Criteria:** All 6 items (TC-01 through TC-06) have TC-N prefix. Each criterion uses observable behavior form with concrete assertions (function names, expected values, structural predicates). No vague phrases ("works correctly", "no errors", "implemented", "displays correctly") found.
- **Test Plan:** `## Test Plan` section present. 6 TC rows match exactly the 6 TC items in Completion Criteria. Every row has non-empty Test Type and Tool/Approach (all vitest-based). No manual-only rows; Notes column used for context annotations rather than justification — acceptable since no row requires a manual justification.
- **Structure:** Tasks section present (line 174). Evidence Log section present and was empty before this entry. No `## Status` or `## Classification` sections in body.

### [GATE-APPROVAL] — ✅ PASS | 2026-05-31

**Status upgrade:** review-ready → approved

- User approval statement (verbatim): "승인"
- Statement is unambiguous and directs implementation of RESUME-001.
- No architecture or frontmatter changes after approval.
