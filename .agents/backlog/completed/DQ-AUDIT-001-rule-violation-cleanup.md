---
title: 'DQ-AUDIT-001: 규칙 위반 정리 — core 벤더 디폴트 리터럴 + deprecated 죽은 메서드'
status: done
created: 2026-06-14
completed: 2026-06-14
priority: high
urgency: now
area: packages/agent-core
depends_on: []
---

# DQ-AUDIT-001: 규칙 위반 정리

설계 품질 감사(`.design/architecture-audit/2026-06-14/design-quality-audit.md`)에서 발견된 두 건의
직접 규칙 위반. 가장 저렴하고 명확하여 즉시 수정 대상(사용자 승인 2026-06-14).

## DQ-02 — agent-core 팩토리에 벤더명 하드코딩 (P1)

`packages/agent-core/src/managers/agent-factory-helpers.ts:64-65`

```ts
defaultModel: options.defaultModel || 'gpt-4',
defaultProvider: options.defaultProvider || 'openai',
```

벤더 중립이어야 할 foundation 계층에 `'gpt-4'`/`'openai'`를 런타임 fallback 디폴트로 박았다.
"no product names in code" + "no fallback(silent degradation)" 규칙 위반.

**Decision:** 리터럴 제거. provider는 이미 `applyAgentDefaults`가 `config.aiProviders[0].name`에서
도출하므로 벤더 문자열 불필요. model은 명시 요구 — `config.defaultModel.model` 또는 팩토리
`options.defaultModel`이 없으면 `validateAgentConfig`가 이미 `defaultModel.model` 누락을 검출해
throw한다(silent 'gpt-4' 대체 제거). 미배포 프로젝트로 하위호환 고려 없음.

## DQ-03 — deprecated 죽은 메서드 getAvailableModels (P1)

`packages/agent-core/src/managers/ai-provider-manager.ts:199-212` — `warn` 후 항상 `[]` 반환,
`IManager`(`interfaces/manager.ts:76`) 계약에 잔존, 실제 호출처 0건(인터페이스 선언 + 구현뿐).
"no deprecated code(삭제 또는 마이그레이션)" 규칙 위반.

**Decision:** `IManager.getAvailableModels` 선언 + `AiProviderManager` 구현 모두 삭제. 모델 메타데이터가
필요하면 이미 존재하는 `IProviderDefinition` 카탈로그 경로 사용.

## Affected Files

- `packages/agent-core/src/managers/agent-factory-helpers.ts` — 리터럴 제거, `TResolvedFactoryOptions`에서 model/provider optional화
- `packages/agent-core/src/managers/agent-factory.ts` — 디버그 로그 필드 정합
- `packages/agent-core/src/managers/ai-provider-manager.ts` — `getAvailableModels` 삭제
- `packages/agent-core/src/interfaces/manager.ts` — 인터페이스 선언 삭제

## Completion Criteria

- [ ] TC-01: `resolveFactoryOptions`에 `'gpt-4'`/`'openai'` 리터럴이 없다 (grep 0건)
- [ ] TC-02: `config.defaultModel`/팩토리 `defaultModel` 둘 다 없이 strictValidation 켜고 `createAgent` 호출 시 명확한 ValidationError throw (silent 벤더 대체 없음)
- [ ] TC-03: `getAvailableModels`가 `IManager`/`AiProviderManager`에서 제거됨 (grep 0건)
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-core typecheck && test` 통과
- [ ] TC-05: `pnpm harness:scan` 통과

## Test Plan

| TC-ID    | Test Type  | Approach                                                 |
| -------- | ---------- | -------------------------------------------------------- |
| TC-01/03 | Static     | `rg`로 리터럴/심볼 부재 확인                             |
| TC-02    | Unit       | agent-factory 테스트에 model 미지정 시 throw 케이스 추가 |
| TC-04    | Build/Unit | filter typecheck + vitest                                |
| TC-05    | Harness    | `pnpm harness:scan`                                      |

## User Execution Test Scenarios

Not applicable — agent-core 내부 SDK 계약 변경. 사용자 대면 CLI/TUI/브라우저 동작 변화 없음
(silent 벤더 fallback 제거는 잘못된 설정을 더 명확히 에러로 surface할 뿐, 정상 경로 무변경).
Test Plan의 unit/build/harness 증거로 검증.

## Tasks

- [x] DQ-02 리터럴 제거 + 타입 조정
- [x] DQ-03 메서드/선언 삭제
- [x] 테스트 추가 + 전체 재실행

## Evidence Log

### 구현 완료 — 2026-06-14

**DQ-02:** `agent-factory-helpers.ts` — `resolveFactoryOptions`에서 `|| 'gpt-4'` / `|| 'openai'` 제거.
`TResolvedFactoryOptions`를 `Required<Pick<...infra fields>> & Pick<...model/provider optional>`로 변경해
벤더 디폴트 주입 제거. `applyAgentDefaults`는 model을 `config.defaultModel.model ?? options.defaultModel`로,
provider를 `config.defaultModel.provider ?? aiProviders[0].name ?? options.defaultProvider`로 해석하고,
해석 불가 시 `ConfigurationError`를 throw(silent 벤더 대체 제거).

**DQ-03:** `IManager.getAvailableModels` 선언(`interfaces/manager.ts`) + `AiProviderManager` 구현
(`managers/ai-provider-manager.ts`) 삭제. `ConfigurationError`/`logger`는 파일 내 타 용처로 잔존(미사용 import 없음).

**검증 증거:**

- TC-01/03: `rg "'gpt-4'|'openai'|getAvailableModels"` → 편집 3파일 0건, `getAvailableModels` 레포 전체 0건.
- TC-02: 신규 테스트 `should throw when no model can be resolved (no vendor fallback)` 추가 —
  `new AgentFactory()`(디폴트 없음) + `defaultModel` 없는 config로 `createAgent` 시 `ConfigurationError` reject 확인.
- TC-04: `pnpm --filter @robota-sdk/agent-core typecheck` 통과; `test` → **48 files / 712 tests passed**;
  `lint` → 0 errors(기존 경고만); `build` → 완료. 다운스트림 `agent-session`/`agent-framework`/`agent-cli` typecheck 통과.
- TC-05: `pnpm harness:scan` → **all 25 scans passed**, conformance PASS.

User Execution Test Scenario gate: Not applicable(내부 SDK 계약, 사용자 대면 동작 무변경) — done-gate 충족.
