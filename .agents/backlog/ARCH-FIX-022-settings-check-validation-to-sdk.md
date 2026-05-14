---
title: 'ARCH-FIX-022: agent-cli의 provider 설정 검증 로직(checkSettingsDocument)을 agent-core로 이동'
status: backlog
created: 2026-05-14
priority: medium
urgency: later
area: agent-cli, agent-core
related: [ARCH-FIX-021, ARCH-FIX-023]
---

## 레이어 위반 내용

`agent-cli/src/utils/settings-check.ts`에 provider 설정 유효성 검사 로직이 있다.

| 함수                                                   | 내용                                                 | 판정                                                |
| ------------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------- |
| `checkSettingsDocument(settings, providerDefinitions)` | 파싱된 설정 문서가 usable provider를 포함하는지 검사 | **agent-core** (ARCH-FIX-023 이후) — 아래 분석 참조 |
| `checkSettingsFile(filePath, providerDefinitions)`     | 파일을 읽고 `checkSettingsDocument` 호출             | **CLI** — 파일 I/O를 수반하므로 CLI에 남음          |

## 의존성 분석

현재 `settings-check.ts`의 의존 체인:

```
checkSettingsDocument
  → findProviderDefinition           (agent-core ✓)
  → getProviderCredentialRequirement (agent-core ✓)
  → IProviderDefinition              (agent-core ✓)
  → IProviderCredentialRequirement   (agent-core ✓)
  → TProviderCredentialField         (agent-core ✓)
  → hasUsableSecretReference         (agent-sdk ← 위반)
```

**[[ARCH-FIX-023]] 완료 후** (`hasUsableSecretReference` → `agent-core`):

- `checkSettingsDocument`의 모든 의존성이 `agent-core`만 남음
- 순수 검증 로직 + zero-dep → **`agent-core`** 이동 가능

`agent-core`는 "Foundation contracts, engine, events, hooks, permissions"를 소유하며,
provider 설정의 유효성 판별 규칙은 도메인 계약의 일부다.
SDK, CLI, 웹앱 등 모든 소비자가 동일한 검증 규칙을 공유해야 한다.

## 이동 범위

### [[ARCH-FIX-023]] 완료 후 → `agent-core`

```
agent-core/src/providers/settings-check.ts  (신규)
  - checkSettingsDocument(settings, providerDefinitions): TSettingsCheck
  - TSettingsCheck  ('missing' | 'valid' | 'corrupt' | 'incomplete')
  - 내부 helpers: hasUsableProviderConfig, isUsableProviderProfile,
                  hasUsableRequiredProviderCredential, resolveProviderCredentialValue
```

`agent-core/index.ts`에서 `checkSettingsDocument`, `TSettingsCheck` export.

### `agent-cli`에 잔류 (파일 I/O)

```
agent-cli/src/utils/settings-check.ts  (축소)
  - checkSettingsFile(filePath, providerDefinitions)  ← 파일 읽기 + agent-core 함수 호출
```

`checkSettingsFile`는 파일을 읽은 뒤 `@robota-sdk/agent-core`의 `checkSettingsDocument`를 호출하는 얇은 wrapper.

## 수용 기준

- [ ] ARCH-FIX-023 완료 (선행 조건)
- [ ] `checkSettingsDocument`, `TSettingsCheck`가 `agent-core`에서 export
- [ ] `agent-cli/src/utils/settings-check.ts`가 `@robota-sdk/agent-core`에서 import
- [ ] `agent-cli`의 `checkSettingsFile`은 잔류하되 내부에서 agent-core 함수 호출
- [ ] `pnpm typecheck && pnpm lint && pnpm test` 전 범위 통과

## Test Plan

- Unit: 이동된 `checkSettingsDocument` 기존 동작 동일 (valid/incomplete/corrupt 판별)
- Lint: `agent-cli/utils/settings-check.ts`가 검증 로직을 자체 구현하지 않음

## User Execution Test Scenarios

Not applicable — 내부 로직 이동이며 사용자 노출 동작 변화 없음.
provider 설정 검증 동작은 ARCH-FIX-021의 시나리오 1로 커버.

## 의존 관계

- [[ARCH-FIX-023]] — hasUsableSecretReference agent-core 이동 (선행 필수)
- [[ARCH-FIX-021]] — provider-factory 이동과 함께 진행하면 provider 설정 관련 코드 정리 일괄 완료
