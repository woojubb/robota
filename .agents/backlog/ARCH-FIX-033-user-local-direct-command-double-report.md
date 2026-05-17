---
title: 'ARCH-FIX-033: fix double error reporting in user-local-direct-command'
status: backlog
created: 2026-05-17
priority: low
urgency: soon
area: packages/agent-cli
---

## Problem

`packages/agent-cli/src/user-local-direct-command.ts`의 오류 처리가 이중 보고를 한다:

```typescript
if (!result.success) {
  terminal.writeError(output); // 1. 에러 출력
  throw new Error(output); // 2. 동일 메시지로 throw → 상위에서 또 출력
}
```

상위 오류 핸들러가 catch한 예외를 다시 출력하면 동일 메시지가 두 번 표시된다.

또한 trimEnd 조건식이 불필요하게 복잡하다:

```typescript
// 현재
const output = result.message.endsWith('\n') ? result.message.trimEnd() : result.message;
// trimEnd()는 trailing whitespace가 없어도 안전하므로 조건 불필요
```

## Proposed Change

오류 보고 책임을 단일화한다. 상위에서 출력하는 구조라면:

```typescript
if (!result.success) {
  throw new Error(output); // 상위에서 단일 출력
}
```

상위에서 출력하지 않는 구조라면:

```typescript
if (!result.success) {
  terminal.writeError(output);
  return true; // 이미 출력했으므로 throw 불필요, exit code는 별도 처리
}
```

호출 지점(`bin.ts`)의 오류 처리 방식을 확인한 후 일관된 방향으로 결정한다.

trimEnd 정리:

```typescript
const output = result.message.trimEnd();
```

## Scope

- `packages/agent-cli/src/user-local-direct-command.ts`
- `packages/agent-cli/src/bin.ts` — 호출 지점 오류 처리 방식 확인 및 정렬

## Test Plan

- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

### Scenario 1: user-local 명령 실패 시 에러 메시지 1회만 출력

- Prerequisites: 빌드 완료
- Steps: `robota user-local <존재하지 않는 서브커맨드>` 실행
- Expected: 에러 메시지가 터미널에 정확히 1번 출력
- Evidence: _(to be filled after implementation)_
