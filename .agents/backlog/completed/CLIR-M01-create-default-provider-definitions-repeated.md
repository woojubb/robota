---
title: 'CLIR-M01: provider-startup.ts — createDefaultProviderDefinitions() 기본 인자 4중 복제 제거'
status: done
created: 2026-05-17
completed: 2026-05-17
priority: medium
urgency: later
area: packages/agent-cli
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #M-01

`packages/agent-cli/src/startup/provider-startup.ts`에서 4개 함수가 각각
`providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions()`를
기본 인자로 선언한다.

```typescript
// provider-startup.ts:31, 58, 78, 106 — 4곳 동일 패턴
export function handleProviderConfigurationArgs(
  ...,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
)
export async function ensureConfig(
  ...,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
)
export async function runInteractiveProviderSetup(
  ...,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
)
export function formatMissingProviderConfigMessage(
  ...,
  providerDefinitions: readonly IProviderDefinition[] = createDefaultProviderDefinitions(),
)
```

## 문제 상세

실제 호출 지점(`config-phase.ts`)에서는 항상 `commandSetup.providerDefinitions`를
인자로 전달하므로 기본값이 실행 경로에서 사용되지 않는다. 그러나 이 패턴은:

1. 함수 시그니처가 "기본값으로 작동할 수 있다"는 거짓 계약을 표시한다.
2. `@robota-sdk/agent-provider`에 대한 암묵적 결합을 4곳에 복제한다.
3. 각 함수를 단독으로 호출할 때마다 `createDefaultProviderDefinitions()`가 새로 실행된다.

## 권장 조치

4개 함수에서 `providerDefinitions` 기본 인자를 제거하고 파라미터를 필수로 변경한다.
호출 계층인 `config-phase.ts`가 항상 `commandSetup.providerDefinitions`를 명시적으로 전달한다.
현재 코드에서 이미 그렇게 동작하므로 Breaking Change가 아니다.

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전체 통과
- [ ] `grep -n "createDefaultProviderDefinitions" packages/agent-cli/src/startup/provider-startup.ts` — 기본 인자 선언 없음 (import 자체는 제거 가능)
- [ ] `config-phase.ts` 호출 지점에서 `providerDefinitions`가 명시적으로 전달됨을 확인

## User Execution Test Scenarios

이 작업은 내부 리팩토링이다. 사용자 관점의 CLI 동작은 동일하게 유지되어야 한다.

### Scenario 1 — provider 설정 명령 정상 동작 확인

**Prerequisites**: `pnpm build`

**Steps**:

```bash
robota --configure-provider test --type openai --model gpt-4o --set-current
```

**Expected**: `Provider profile saved to <path>` 메시지 출력 후 정상 종료. 기존과 동일.

**Evidence (2026-05-17)**:

```
$ OPENAI_API_KEY=sk-fake-key robota --configure-provider test --type openai --model gpt-4o --api-key-env OPENAI_API_KEY --set-current
Provider profile saved to /Users/jungyoun/.robota/settings.json
EXIT: 0
```

(빌드된 CLI: packages/agent-cli/dist/node/bin.js, 테스트 후 ~/.robota/settings.json 삭제 완료)
