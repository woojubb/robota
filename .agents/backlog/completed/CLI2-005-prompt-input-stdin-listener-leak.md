---
title: 'CLI2-005: promptInput Ctrl+C 경로에서 stdin 리스너 누수'
status: done
created: 2026-05-10
priority: medium
urgency: soon
area: cli
source: dev-prelaunch-report-2026-05-10
---

## Problem

`packages/agent-cli/src/cli.ts:133-136`의 `promptInput` 함수에서 사용자가 Ctrl+C(`\x03`)를 누르면 `process.exit(0)`을 직접 호출하기 전에 stdin의 `onData` 리스너를 제거하지 않고 raw mode도 복원하지 않는다.

```typescript
} else if (ch === '\x03') {
    process.stdout.write('\n');
    process.exit(0);  // stdin listener never removed, raw mode never restored
}
```

테스트 환경이나 `process.exit`가 모킹된 경우 리스너 누수가 발생한다. 또한 raw mode가 복원되지 않으면 터미널 상태가 오염될 수 있다.

## Required Change

`process.exit(0)` 호출 전에 stdin 정리를 수행한다.

```typescript
} else if (ch === '\x03') {
    stdin.removeListener('data', onData);
    stdin.setRawMode(wasRaw ?? false);
    stdin.pause();
    process.stdout.write('\n');
    process.exit(0);
}
```

## Scope

- `packages/agent-cli/src/cli.ts` — `promptInput()` 함수의 Ctrl+C 처리 분기

## Test Plan

1. `promptInput()`의 Ctrl+C 경로에 대한 단위 테스트 추가: `process.exit` 모킹 후 `stdin.removeListener` 및 `setRawMode` 호출 확인
2. `pnpm typecheck` 및 `pnpm lint` 통과 확인
3. 정상 입력 경로 회귀 없음 확인

## User Execution Test Scenarios

Not applicable. 이 변경은 `process.exit`가 모킹된 테스트 환경에서만 관찰 가능한 내부 리소스 정리 버그다. 일반 사용자 실행 환경에서는 `process.exit(0)`이 즉시 프로세스를 종료하므로 누수가 런타임에 영향을 주지 않는다. 검증은 Test Plan의 단위 테스트로 수행한다.
