---
title: 'ARCH-002-p6: agent-cli provider 인프라 올바른 레이어 배치 + 재수출 shim 삭제'
status: backlog
created: 2026-05-17
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-executor, packages/agent-framework
---

# ARCH-002-p6 — agent-cli provider 인프라 올바른 레이어 배치

## Context

ARCH-002 원칙("UI는 TUI에, 로직은 UI 없이도 동작")에 따라 Phase 5까지 완료한 후 남은
구조적 위반. `agent-cli/src/utils/` 안에 CLI에 특화되지 않은 provider 인프라 파일
3개가 존재하고, 가치 없는 재수출 shim 3개가 직접 import를 가로막고 있다.

각 코드의 올바른 위치는 "agent-framework로 일괄 이동"이 아니라 각자 책임에 맞는 레이어다.

| 파일                                                                         | 올바른 위치                                      | 근거                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `provider-factory.ts` — `createProviderFromSettings`, `readProviderSettings` | **agent-executor**                               | provider 인스턴스 생성이 이미 agent-executor 책임. `createProviderFromConfig`, `createProviderFromProfile` 소유자 |
| `provider-factory.ts` — `readMergedProviderSettings`                         | **agent-framework**                              | settings I/O 레이어 소유자. `readSettings`, `getProviderSettingsPaths` 소유자                                     |
| `provider-configuration.ts` 전체                                             | **agent-framework**                              | `readSettings`/`writeSettings` 소유자 — 순수 설정 I/O                                                             |
| `settings-check.ts` — `checkSettingsFile`                                    | **agent-framework**                              | settings 검증, 같은 레이어                                                                                        |
| `provider-definition.ts` (shim)                                              | 삭제 → `@robota-sdk/agent-core` 직접 import      |                                                                                                                   |
| `provider-settings.ts` (shim)                                                | 삭제 → `@robota-sdk/agent-framework` 직접 import |                                                                                                                   |
| `env-ref.ts` (shim)                                                          | 삭제 → `@robota-sdk/agent-core` 직접 import      |                                                                                                                   |

## 기존 백로그와의 관계

이 항목은 아래 기존 백로그와 범위가 겹친다. 구현 시 통합 또는 선행 완료 후 진행한다.

- **ARCH-FIX-021** (`provider-factory` → agent-executor): provider 해석·인스턴스 생성 로직 이동 — 이 항목이 커버하는 내용과 동일. ARCH-FIX-023 선행 필요.
- **ARCH-FIX-022** (`settings-check` validation → agent-framework): provider 설정 검증 로직 이동.
- **ARCH-FIX-023** (`env-ref` → agent-core): $ENV: 참조 유틸리티 이동.

**권장 실행 순서**: ARCH-FIX-023 → ARCH-FIX-021 → ARCH-FIX-022 → 이 항목의 잔여(shim 삭제, provider-configuration.ts 이동).

## Violations

### 1. `utils/provider-factory.ts` — provider 인스턴스 생성 로직이 CLI에

`createProviderFromSettings`는 `createProviderFromConfig` / `createProviderFromProfile`
(agent-executor)와 `readMergedProviderSettingsFromPaths` (agent-framework)를 조합해
IAIProvider 인스턴스를 만든다. provider 인스턴스 생성은 agent-executor의 책임이다.

`readMergedProviderSettings(cwd)`는 settings 파일 경로 해석 + 병합이므로 agent-framework
settings I/O 레이어에 속한다.

- **위반 이유**: provider 생성 로직이 agent-cli에 갇혀 headless/server 환경에서 재사용 불가.
- **수정**: `createProviderFromSettings`, `readProviderSettings` → agent-executor.
  `readMergedProviderSettings` → agent-framework.
  ARCH-FIX-021 범위와 동일. 해당 항목으로 처리.

### 2. `utils/provider-configuration.ts` — 순수 설정 I/O가 CLI에

`applyProviderConfiguration`, `applyProviderSwitch`, `resolveProviderSettingsWriteTargetPath`,
`applyActiveModelChange`는 `readSettings`/`writeSettings`/`getProviderSettingsPaths`
(모두 agent-framework 소유)만 사용하며 CLI 의존성이 없다.

- **위반 이유**: agent-framework 함수만 사용하는 순수 설정 I/O 로직이 CLI 레이어에.
- **수정**: `packages/agent-framework/src/settings/provider-configuration.ts`로 이동.
  agent-cli는 `@robota-sdk/agent-framework`에서 직접 import.

### 3. `utils/settings-check.ts` — 검증 로직 + 재수출 혼재

`checkSettingsFile`은 파일 존재 확인 + JSON 파싱 + `checkSettingsDocument` 호출만 한다.
나머지 exports는 agent-core / agent-framework의 재수출이다.

- **위반 이유**: 범용 검증 로직이 CLI에 갇혀 있고, 재수출이 직접 import를 가로막는다.
- **수정**: `checkSettingsFile`만 agent-framework으로 이동; 재수출 라인 삭제.
  ARCH-FIX-022 범위와 동일. 해당 항목으로 처리.

### 4. 재수출 shim 3개 — 가치 없는 pass-through

`provider-definition.ts`, `provider-settings.ts`, `env-ref.ts`는
agent-core / agent-framework 심벌을 agent-cli 네임스페이스로 재수출하는 것 외에
어떤 변환이나 로직도 없다.

- **위반 이유**: import 경로를 불투명하게 만들어 실제 의존 관계가 보이지 않는다.
- **수정**: 세 파일 삭제. 소비자는 원천 패키지에서 직접 import.
  `env-ref.ts` 삭제는 ARCH-FIX-023과 동일. 해당 항목으로 처리.

## Acceptance Criteria

- `createProviderFromSettings`, `readProviderSettings`가 `@robota-sdk/agent-executor`에서 export된다.
- `readMergedProviderSettings`, `applyProviderConfiguration`, `applyProviderSwitch`,
  `resolveProviderSettingsWriteTargetPath`, `applyActiveModelChange`, `checkSettingsFile`이
  `@robota-sdk/agent-framework`에서 export된다.
- `agent-cli/src/utils/provider-factory.ts` 파일이 없다.
- `agent-cli/src/utils/provider-configuration.ts` 파일이 없다.
- `agent-cli/src/utils/settings-check.ts` 파일이 없다.
- `agent-cli/src/utils/provider-definition.ts` 파일이 없다.
- `agent-cli/src/utils/provider-settings.ts` 파일이 없다.
- `agent-cli/src/utils/env-ref.ts` 파일이 없다.
- `pnpm --filter @robota-sdk/agent-cli typecheck` 통과.
- `pnpm --filter @robota-sdk/agent-framework typecheck` 통과.
- `pnpm --filter @robota-sdk/agent-executor typecheck` 통과.
- `pnpm --filter @robota-sdk/agent-cli test` 전체 통과.
- `pnpm --filter @robota-sdk/agent-framework test` 전체 통과.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-executor typecheck` 에러 없음
- [ ] `pnpm --filter @robota-sdk/agent-framework typecheck` 에러 없음
- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 에러 없음
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전부 통과
- [ ] `pnpm --filter @robota-sdk/agent-framework test` 전부 통과
- [ ] `grep -rn "from.*utils/provider-factory\|from.*utils/provider-configuration\|from.*utils/settings-check\|from.*utils/provider-definition\|from.*utils/provider-settings\|from.*utils/env-ref" packages/agent-cli/src` — 결과 없음

## User Execution Test Scenarios

이 작업은 내부 리팩토링이다. 사용자 관점의 CLI 동작은 동일하게 유지되어야 한다.

### Scenario 1: 프로바이더 설정 커맨드 동작 확인

**Prerequisites**: robota CLI 빌드 완료, 기존 settings 파일 있는 환경

**Steps**:

```bash
robota --configure-provider test --type openai --model gpt-4o --set-current
```

**Expected**: `Provider profile saved to <path>` 메시지 출력 후 정상 종료

**Evidence**: (구현 후 채움)

### Scenario 2: 인터랙티브 초기 설정 동작 확인

**Prerequisites**: robota CLI 빌드 완료, 설정 파일 없는 환경 (`~/.robota/settings.json` 삭제)

**Steps**:

1. `robota` 실행 — 프로바이더 선택 프롬프트 표시 확인
2. 프로바이더 선택 및 API 키 입력 진행
3. 설정 저장 후 TUI 진입 확인

**Expected**: 기존과 동일한 초기 설정 플로우 동작

**Evidence**: (구현 후 채움)
