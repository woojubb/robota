---
title: 'CLIR-H03: tui-mode.ts — providerSettings.name을 providerOverride에 잘못 사용 (type vs profile name)'
status: todo
created: 2026-05-17
priority: high
urgency: soon
area: packages/agent-cli, packages/agent-framework
---

## 배경

코드리뷰 보고서: `.design/agent-cli-review-2026-05-17.html` #H-03

`packages/agent-cli/src/modes/tui-mode.ts:36–37`에서 `TuiTransport`에 아래처럼 전달한다:

```typescript
providerOverride: providerSetup.providerSettings.name,  // ← 오류
providerType:     providerSetup.providerSettings.name,  // ← 올바름
```

## 문제 상세

`IProviderConfig.name`은 **provider type 문자열**이다 (예: `"anthropic"`, `"openai"`).
이는 `provider-merge.ts`의 `resolveActiveProvider`에서 `name: profile.type`으로 할당됨으로써 확인된다.

반면 `TuiTransport`의 `providerOverride`는 `useSideEffects.ts`에서 `applyActiveModelChange`에 전달되어
`{ providerOverride }` 옵션으로 사용된다. `applyProviderSwitch` 기준으로는
**프로파일 이름** (예: `"my-anthropic"`)이 키가 된다.

- `providerType`에 type 문자열 전달: **올바름** (SessionStatusBar가 `getProviderDisplayName(providerType)` 호출)
- `providerOverride`에 type 문자열 전달: **오류** — 잘못된 프로파일을 조회하거나 무시하게 됨

클리닉 사례가 드러나지 않는 이유: 대부분의 사용자가 type과 동일한 이름의 프로파일을 쓰거나,
모델 전환 기능이 특정 상황에서만 활성화되기 때문이다.

## 권장 조치

`IProviderSetup`에 `activeProfileName: string | undefined` 필드를 추가한다.
`createProviderSetup`에서 `opts.provider`(프로파일 이름 override) 또는
설정에서 읽은 `merged.currentProvider`를 그 필드에 저장한다.

`tui-mode.ts`를 다음과 같이 수정한다:

```typescript
providerOverride: providerSetup.activeProfileName,   // 프로파일 이름
providerType:     providerSetup.providerSettings.name, // type 문자열
```

## Test Plan

- [ ] `pnpm --filter @robota-sdk/agent-cli typecheck` 0 errors
- [ ] `pnpm --filter @robota-sdk/agent-cli test` 전체 통과
- [ ] `IProviderSetup.activeProfileName` 필드가 추가됨을 확인
- [ ] type 이름과 다른 프로파일 이름을 사용하는 테스트 케이스 추가
- [ ] `applyActiveModelChange` 경로에서 올바른 프로파일 이름이 전달됨을 확인

## User Execution Test Scenarios

### Scenario 1 — 커스텀 이름 프로파일로 provider override 동작 확인

**Prerequisites**: `pnpm build`, type과 다른 이름의 provider 프로파일 설정

```bash
robota --configure-provider my-custom-anthropic --type anthropic --model claude-sonnet-4-6 --set-current
```

**Steps**:

```bash
robota --provider my-custom-anthropic
# TUI에서 모델 전환 시도 (예: /provider 명령)
```

**Expected**: `my-custom-anthropic` 프로파일이 올바르게 인식되고 모델 전환이 정상 동작함.
type 이름(`anthropic`)이 아닌 프로파일 이름으로 조회가 이루어짐.

**Evidence**: (구현 후 채울 것)

**Cleanup**: 세션 종료 (`/exit`)
