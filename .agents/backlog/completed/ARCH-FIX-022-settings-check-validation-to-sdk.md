---
title: 'ARCH-FIX-022: agent-cli의 provider 설정 검증 로직(checkSettingsDocument)을 agent-sdk로 이동'
status: backlog
created: 2026-05-14
priority: medium
urgency: later
area: agent-cli, agent-sdk
related: [ARCH-FIX-021]
---

## 레이어 위반 내용

`agent-cli/src/utils/settings-check.ts`에 provider 설정 유효성 검사 로직이 있다.

| 함수                                                   | 내용                                                 | 판정                                       |
| ------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------ |
| `checkSettingsDocument(settings, providerDefinitions)` | 파싱된 설정 문서가 usable provider를 포함하는지 검사 | **agent-sdk** — provider command API 계층  |
| `checkSettingsFile(filePath, providerDefinitions)`     | 파일을 읽고 `checkSettingsDocument` 호출             | **CLI** — 파일 I/O를 수반하므로 CLI에 남음 |

`checkSettingsDocument`는:

- `IProviderDefinition`(agent-core), `IProviderCredentialRequirement`(agent-core) 타입만 사용
- `hasUsableSecretReference`(agent-sdk) 사용 → agent-sdk 계층에 속함
- 파일 I/O 없음
- "이 settings document에 usable provider가 있는가?" — **provider setup flow의 일부**, command-level 비즈니스 로직

`agent-sdk/src/command-api/provider/`에 이미 provider command API가 위치한다.
`createProviderSetupFlow`, `runProviderSetupPromptFlow` 등 provider setup 관련 로직과 같은 계층이 적절하다.
SDK 소비자(웹앱, 서버 등)도 동일한 검증이 필요할 수 있으므로 CLI에만 있어서는 안 된다.

## 이동 범위

### agent-sdk로 이동

```
agent-sdk/src/command-api/provider/settings-check.ts  (신규 또는 기존 파일에 통합)
  - checkSettingsDocument(settings, providerDefinitions): TSettingsCheck
  - TSettingsCheck  ('missing' | 'valid' | 'corrupt' | 'incomplete')
  - 내부 helpers: hasUsableProviderConfig, isUsableProviderProfile,
                  hasUsableRequiredProviderCredential, resolveProviderCredentialValue
```

`agent-sdk/index.ts`에서 `checkSettingsDocument`, `TSettingsCheck` export.

### agent-cli에 잔류 (파일 I/O)

```
agent-cli/src/utils/settings-check.ts  (축소)
  - checkSettingsFile(filePath, providerDefinitions)  ← 파일 읽기 + SDK 함수 호출
```

`checkSettingsFile`는 파일을 읽은 뒤 `@robota-sdk/agent-sdk`의 `checkSettingsDocument`를 호출하는 얇은 wrapper.

## 수용 기준

- [ ] `checkSettingsDocument`, `TSettingsCheck`가 `agent-sdk`에서 export
- [ ] `agent-cli/src/utils/settings-check.ts`가 `@robota-sdk/agent-sdk`에서 import
- [ ] `agent-cli`의 `checkSettingsFile`은 잔류하되 내부에서 SDK 함수 호출
- [ ] `pnpm typecheck && pnpm lint && pnpm test` 전 범위 통과

## Test Plan

- Unit: 이동된 `checkSettingsDocument` 기존 동작 동일 (valid/incomplete/corrupt 판별)
- Lint: `agent-cli/utils/settings-check.ts`가 검증 로직을 자체 구현하지 않음

## User Execution Test Scenarios

Not applicable — 내부 로직 이동이며 사용자 노출 동작 변화 없음.
provider 설정 검증 동작은 ARCH-FIX-021의 시나리오 1로 커버.

## 의존 관계

- [[ARCH-FIX-021]] — provider-factory 이동과 함께 진행하면 provider 설정 관련 코드 정리 일괄 완료
