---
title: 'DQ-AUDIT-006: 에러/관측 위생 — 타입 throw 일관성 + 훅 실패 관측 + 스텁 메트릭'
status: done
created: 2026-06-14
completed: 2026-06-14
priority: medium
urgency: later
area: packages/agent-core, packages/agent-provider, packages/agent-session, packages/agent-plugin
depends_on: []
---

# DQ-AUDIT-006: 에러/관측 위생

타입 에러 계층(`RobotaError`)이 존재함에도 일관 적용되지 않음. 근거: 설계 품질 감사.

## 포함 findings

- **DQ-13 (P2) — raw `throw new Error()` 우세.** 426건 raw vs 216건 typed. 핫스팟:
  `agent-core/src/services/execution-stream.ts:86,138`(→`ConfigurationError`),
  `agent-provider/src/anthropic/provider.ts:76,307-316`(→`ConfigurationError`/`ValidationError`).
  raw throw는 error-handling 플러그인이 `category`/`recoverable`로 분기 못 하게 함. → core 서비스 +
  provider 경로 raw throw를 `RobotaError` 서브클래스로 교체(인프라 이미 존재, 일관성 패스).
- **DQ-14 (P2) — fire-and-forget 훅이 `.catch(() => {})`로 에러 삼킴.**
  `agent-session/src/session-lifecycle.ts:71`, `session-run.ts:197,256` 등 — 훅 실패가 로그/이벤트/메트릭
  없이 사라짐(silent degradation). → 최소 `logger.warn` 또는 훅-실패 이벤트 emit으로 surface.
- **DQ-15 (P2) — `getStats()` 0-고정 스텁 메트릭.** `agent-plugin/src/error-handling/error-handling-plugin.ts:246-247`
  `totalRetries: 0 // TODO`, `successfulRecoveries: 0 // TODO` — 계약이 약속한 필드가 항상 0(추상화가
  거짓말). → 실제 카운터 연결 또는 구현 전까지 인터페이스에서 필드 제거.

## Completion Criteria

- [x] TC-01: core 서비스 + provider 핫스팟의 raw `throw new Error`가 적절한 `RobotaError` 서브클래스로 교체
- [x] TC-02: 훅 실패가 로그/이벤트로 surface (빈 `.catch(()=>{})` 0건, grep 검증)
- [x] TC-03: `IErrorHandlingPluginStats`가 실측값 반환 또는 미구현 필드 제거 (0-고정 + TODO 제거)
- [x] TC-04: 영향 패키지 typecheck/test + `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type     | Approach                                               |
| ----- | ------------- | ------------------------------------------------------ |
| TC-01 | Unit          | throw 케이스가 올바른 에러 클래스/`category` 산출 검증 |
| TC-02 | Unit          | 훅 실패 주입 시 warn/event 발생 검증                   |
| TC-03 | Unit          | 재시도/복구 카운터 증가 검증                           |
| TC-04 | Build/Harness | filter typecheck + vitest + harness:scan               |

## User Execution Test Scenarios

Not applicable — 내부 에러 타이핑/로깅 일관성 개선. 정상 경로 사용자 동작 무변경
(훅 실패 가시화는 진단성 향상, 기존 기능 변화 없음).

## Tasks

- [x] DQ-13 throw 교체 → DQ-14 훅 관측 → DQ-15 메트릭

## Evidence Log

### 구현 완료 — 2026-06-14

**DQ-13 (타입 throw):** core 실행 핫스팟 `execution-stream.ts`의 provider 클러스터(no provider configured /
not found / chatStream 없음 / streaming 미지원) 4건을 `ConfigurationError`로 교체. `anthropic/provider.ts`의
client/apiKey/executor 요구(76) → `ConfigurationError`, `validateMessages`의 array/empty/role 검증 3건 →
`ValidationError`(field 명시). error-handling 플러그인이 `category`/`recoverable`로 분기 가능해짐.

**DQ-14 (훅 실패 관측):** agent-session의 fire-and-forget 훅 `.catch(() => {})` 5건(session-lifecycle,
session-run ×2, session-history-ops, tool-hook-helpers)을 `createLogger` 기반 `logger.warn('...hook failed',
{ error })`로 교체. 훅 실패가 더 이상 무음으로 사라지지 않음.

**DQ-15 (실측 메트릭):** error-handling 플러그인의 0-고정 `totalRetries`/`successfulRecoveries` 스텁(+TODO)을
실제 인스턴스 카운터로 연결 — 재시도 발생 시 `totalRetries++`, 재시도 후 성공 시 `successfulRecoveries++`.
`getStats()`가 실값 반환.

**검증 증거:**

- grep: `.catch(() => {})` agent-session 0건. agent-core/provider/session/plugin typecheck 통과.
- 테스트: agent-core **720**, agent-provider **554**, agent-session **72**, agent-plugin **298** 전부 passed
  (플러그인 getStats 테스트 포함). 빌드 통과. `pnpm harness:scan` **25/25 passed**, conformance PASS.

User Execution Test Scenario gate: Not applicable(내부 에러 타이핑/로깅/메트릭 일관성, 정상 경로 사용자 동작 무변경).
