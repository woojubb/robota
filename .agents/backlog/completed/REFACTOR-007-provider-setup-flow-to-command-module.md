---
title: 'REFACTOR-007: provider setup flow state machine → agent-command-provider 이동'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-sdk, packages/agent-command-provider
---

## Problem

`packages/agent-sdk/src/command-api/provider/provider-setup-flow.ts` (309줄)가 provider setup flow 전체 state machine을 SDK 내부에서 구현한다. 규칙 81은 "provider settings/profile helpers may be SDK common APIs, while /provider command flow must consume those APIs as a command module would" 임을 명시한다.

`packages/agent-sdk/src/index.ts`가 621줄 배럴로 과대 성장한 원인 중 하나다.

Rule violation: SDK command common API boundary — setup flow state machine은 agent-command-provider 책임.

Source: COMBINED-007 (SA-005)

## Scope

1. `provider-setup-flow.ts`의 state machine 로직을 `packages/agent-command-provider/src/`로 이동.
2. agent-sdk는 순수 데이터 helper(profile builder, validator, reader)만 유지.
3. `agent-sdk/src/index.ts`에서 이동한 심벌들의 export 제거.
4. `agent-command-provider`의 `package.json`에 의존성 추가 필요 여부 검토.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-command-provider test` — 통과
- `pnpm --filter @robota-sdk/agent-sdk test` — 통과
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

### 시나리오: /provider 커맨드 동작 확인

**전제조건**: Robota CLI 로컬 빌드.

**단계**:

1. `robota` 실행
2. `/provider` 입력 후 provider 설정 flow 진행
3. 프로바이더 추가/선택/테스트가 정상 동작하는지 확인

**기대 결과**: 이동 전과 동일하게 `/provider` 커맨드가 정상 동작함.

**Evidence**: `[실행 후 기록]`
