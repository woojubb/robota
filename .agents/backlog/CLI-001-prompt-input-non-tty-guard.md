---
title: 'CLI-001: promptInput() 비-TTY 환경 크래시 방지 가드 추가'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: cli
source: qa-prelaunch-report-2026-05-10
---

## Problem

`packages/agent-cli/src/cli.ts:99-133`의 `promptInput()` 함수가 `stdin.isTTY` 확인 없이
`stdin.setRawMode(true)`를 호출한다. CI 환경이나 파이프된 입력처럼 stdin이 TTY가 아닌 경우
`setRawMode is not a function` TypeError로 크래시한다.

```typescript
function promptInput(label: string, masked = false): Promise<string> {
  return new Promise<string>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true); // stdin이 TTY가 아니면 throw
    // ...
  });
}
```

`robota --configure` 실행 시 이 함수가 호출된다. CI/CD 자동화나 스크립트 환경에서
`--configure`를 호출하면 에러 메시지 없이 프로세스가 크래시한다.

## Required Change

```typescript
function promptInput(label: string, masked = false): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      reject(
        new Error(
          `Cannot prompt for input: stdin is not a TTY.\n` +
            `Use environment variables instead: ROBOTA_API_KEY=<key> robota`,
        ),
      );
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    // ... 기존 로직 유지
  });
}
```

또는 비-TTY 환경에서 라인 입력 모드(readline)로 대체하여 CI에서도 동작하게 할 수 있다.
설계 방향은 구현 전 사용자 컨펌 필요.

## Scope

- `packages/agent-cli/src/cli.ts` — `promptInput()` 함수에 `isTTY` 가드 추가

## Test Plan

- `promptInput()` 단위 테스트: 비-TTY 환경에서 명확한 에러 메시지 반환 확인
- `stdin.isTTY = false` mock으로 시뮬레이션

## User Execution Test Scenarios

**Prerequisites:** `pnpm build` (agent-cli)

**Scenario — 파이프 환경에서 --configure 실행 (크래시 방지 확인):**

```bash
echo "" | robota --configure
```

**Expected observable result (수정 후):**

```
Error: Cannot prompt for input: stdin is not a TTY.
Use environment variables instead: ROBOTA_API_KEY=<key> robota
```

Exit code: 1 (정상 에러 종료)

**현재 동작 (버그):**

```
TypeError: stdin.setRawMode is not a function
    at promptInput (...)
```

(스택 트레이스와 함께 비정상 크래시)

**Cleanup:** 없음

**Evidence:** (구현 후 채울 것)
