---
title: 'ARCH-FIX-021: agent-cli의 provider 해석·인스턴스 생성 로직을 agent-runtime/agent-sdk로 분산 이동'
status: backlog
created: 2026-05-14
priority: high
urgency: later
area: agent-cli, agent-sdk, agent-runtime
related: [ARCH-FIX-020, ARCH-FIX-023, BGTASK-001]
---

## 레이어 위반 내용

`agent-cli/src/utils/provider-factory.ts` (286줄)에 파일 I/O가 아닌 **비즈니스 로직**이 대거 포함되어 있다.

| 함수                                         | 내용                                                    | 판정                                                   |
| -------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| `createProviderFromProfile(profile)`         | `ISerializableProviderProfile` → `IAIProvider` 변환     | **agent-runtime** (ARCH-FIX-023 이후) — 아래 분석 참조 |
| `createProviderFromConfig(settings)`         | `IProviderConfig` → `IAIProvider` 인스턴스 생성         | **agent-runtime** (ARCH-FIX-023 이후)                  |
| `normalizeProviderConfig(settings)`          | raw settings → `IProviderConfig` 정규화 + defaults 적용 | **agent-runtime** (ARCH-FIX-023 이후)                  |
| `resolveProfileApiKey(profile)`              | apiKey / apiKeyEnv 해소                                 | **agent-runtime** (ARCH-FIX-023 이후)                  |
| `resolveActiveProvider(settings, override)`  | 설정 문서에서 active provider 결정                      | **agent-sdk** 또는 agent-runtime — R-1 리서치 필요     |
| `readMergedProviderSettingsFromPaths(paths)` | 여러 파일 merge → `TProviderSettingsDocument`           | **agent-sdk** — `TProviderSettingsDocument` 의존       |
| `mergeSettings()` / `mergeProviders()`       | 설정 deep merge                                         | **agent-sdk** — `TProviderSettingsDocument` 의존       |
| `getProviderSettingsPaths(cwd)`              | 어느 파일을 스캔할지 경로 목록 반환                     | **CLI** — 제품 결정 사항                               |
| `readProviderSettings(cwd)`                  | I/O 오케스트레이터                                      | **CLI** — 파일 읽기 진입점                             |

## 의존성 분석

현재 `provider-factory.ts`의 핵심 의존 체인:

```
createProviderFromProfile  →  normalizeProviderConfig  →  resolveEnvReference (agent-sdk ← 위반)
                           →  findProviderDefinition   (agent-core ✓)
                           →  createProviderFromConfig →  IProviderDefinition.createProvider (agent-core ✓)

resolveActiveProvider      →  TProviderSettingsDocument (agent-sdk ← 현재 위치)
readMergedProviderSettings →  TProviderSettingsDocument (agent-sdk)
                           →  파일 I/O
```

**ARCH-FIX-023 완료 후** (`resolveEnvReference` → `agent-core`):

- `normalizeProviderConfig`, `createProviderFromConfig`, `createProviderFromProfile`, `resolveProfileApiKey`의
  모든 의존성이 `agent-core`만 남음 → **`agent-runtime`** 이동 가능
- `resolveActiveProvider`는 `TProviderSettingsDocument` (agent-sdk 타입) 의존 → R-1 확인 필요
- `readMergedProviderSettingsFromPaths`, `mergeSettings`, `mergeProviders`는
  `TProviderSettingsDocument`(agent-sdk) 의존 → **`agent-sdk`** 유지

## 리서치 과제

### R-1: `TProviderSettingsDocument` 타입 이동 가능성

`TProviderSettingsDocument`는 `agent-sdk/src/command-api/provider/provider-settings.ts`에 정의되어 있다.
해당 타입 자체의 의존성:

- `TUniversalValue` (agent-core) — 타입 전용 의존

타입이 `agent-core`로 이동 가능하다면 `resolveActiveProvider`도 `agent-runtime`으로 내려갈 수 있다.
단, `provider-settings.ts`의 다른 함수들(`buildProviderProfile`, `upsertProviderProfile` 등)은
assembly-level 로직이므로 agent-sdk에 잔류.

## 이동 범위

### [[ARCH-FIX-023]] 완료 후 → `agent-runtime`

```
agent-runtime/src/providers/provider-factory.ts  (신규)
  - createProviderFromProfile()
  - createProviderFromConfig()
  - normalizeProviderConfig()
  - resolveProfileApiKey()
  (+ resolveActiveProvider — R-1 결과에 따라)
```

`agent-runtime/index.ts`에서 필요한 것을 export.

### → `agent-sdk` (TProviderSettingsDocument 의존)

```
agent-sdk/src/providers/provider-merge.ts  (신규 또는 기존 파일에 통합)
  - readMergedProviderSettingsFromPaths()
  - mergeSettings() / mergeProviders()
  (+ resolveActiveProvider — R-1 결과에 따라)
```

`agent-sdk/index.ts`에서 필요한 것을 export.

### `agent-cli`에 잔류 (제품 정책 + 파일 I/O)

```
agent-cli/src/utils/provider-factory.ts  (축소)
  - getProviderSettingsPaths(cwd)   ← CLI 스캔 경로 목록 (제품 결정)
  - readProviderSettings(cwd)       ← 파일 I/O 진입점, 하위 패키지 함수 호출
  - createProviderFromSettings(cwd) ← 파일 I/O + SDK/runtime 조합
```

### `agent-cli` re-export 정리

이동된 함수들의 re-export를 `agent-cli`에 남기지 않는다.
CLI 내부 소비자는 `@robota-sdk/agent-runtime` 또는 `@robota-sdk/agent-sdk`에서 직접 import.

## 수용 기준

- [ ] ARCH-FIX-023 완료 (선행 조건)
- [ ] `createProviderFromProfile`, `createProviderFromConfig`, `normalizeProviderConfig`, `resolveProfileApiKey`가 `agent-runtime`에서 export
- [ ] `readMergedProviderSettingsFromPaths`, `mergeSettings`, `mergeProviders`가 `agent-sdk`에서 export
- [ ] `agent-cli/src/utils/provider-factory.ts`가 위 함수들을 각 패키지에서 import
- [ ] `child-process-subagent-worker.ts`(ARCH-FIX-020 이동 후 agent-sdk)가 `@robota-sdk/agent-runtime`에서 함수 사용
- [ ] `pnpm typecheck && pnpm lint && pnpm test` 전 범위 통과

## Test Plan

- Unit: 이동된 `createProviderFromProfile` 기존 동작 동일 (profile → provider instance)
- Unit: `readMergedProviderSettingsFromPaths` merge 로직 기존 동작 동일
- Integration: CLI startup 시 provider 생성 정상 (regression 없음)
- Lint: `agent-cli/utils/provider-factory.ts`가 이동된 함수를 자체 구현하지 않음

## User Execution Test Scenarios

### 시나리오 1 — CLI 시작 시 provider 생성 regression 없음

**전제 조건**: Robota CLI 설치됨, 설정 파일에 provider 구성 완료

1. Robota CLI 실행
2. 프로바이더 초기화 성공 및 첫 프롬프트 표시 확인
3. 프롬프트 입력 후 AI 응답 수신 확인

**예상 결과**: 이동 전과 동일하게 동작

**증거 필드**: (구현 후 기록)

## 의존 관계

- [[ARCH-FIX-023]] — resolveEnvReference agent-core 이동 (선행 필수)
- [[ARCH-FIX-020]] — child-process-subagent-worker가 createProviderFromProfile을 사용
