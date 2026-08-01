---
title: 'HOOK-007: CommandExecutor 기본 타임아웃 10s → 600s로 조정'
status: done
created: 2026-05-09
priority: medium
urgency: later
area: hooks
depends_on: HOOK-001
---

## Problem

CC 스펙의 command 훅 기본 타임아웃은 **600초(10분)** 다.
SDK의 `CommandExecutor`는 `DEFAULT_TIMEOUT_SECONDS = 10`으로 설정되어 있다.

CC 기준으로 작성된 훅 스크립트 중 10초를 초과하는 작업(typecheck, API 호출, 무거운 lint 등)은 SDK에서 즉시 타임아웃 실패한다.

**초기 백로그에서 60s로 잘못 기술했으나 공식 문서 재검증 결과 CC 기본값은 600s(10분).**

## Required Change

### `packages/agent-core/src/hooks/executors/command-executor.ts`

```typescript
const DEFAULT_TIMEOUT_SECONDS = 600; // 10 → 600 (10분, CC 기본값과 동일)
```

## Note

개별 훅 정의에서 `timeout` 필드로 오버라이드 가능하므로 기본값만 조정하면 된다.
`ICommandHookDefinition.timeout`은 이미 있으므로 소비자가 짧게 지정하는 것도 가능.

## Test Plan

- `timeout` 미지정 훅 실행 시 600초 이내 완료되면 성공 확인
- `timeout: 5` 지정 시 5초 초과 시 실패 확인

## User Execution Test Scenarios

**Prerequisites:** `pnpm build` (agent-core dist must exist)

**Setup:** No API key required. The demo script uses `@robota-sdk/agent-core` public API directly.

**Scenarios:**

0. Verify `DEFAULT_TIMEOUT_SECONDS = 600` in source
1. `timeout: 1` + 2s sleep command → times out in ~1s (non-blocking, `blocked: false`)
2. `timeout: 5` + 2s sleep command → succeeds in ~2s, stdout contains "hook completed"

**Command:**

```
node scripts/examples/hook-timeout-demo.mjs
```

**Expected observable result:**

```
=== Part 0: DEFAULT_TIMEOUT_SECONDS = 600 in source ===
  command-executor.ts DEFAULT_TIMEOUT_SECONDS = 600
  DEFAULT_TIMEOUT_SECONDS === 600: YES ✓

=== Part 1: timeout:1 + 2s command → hook times out ===
  elapsed: ~1000ms
  blocked === false (timeout = non-blocking exit code 1, not exit 2): YES ✓
  completed in ~1s (not 2s): YES ✓

=== Part 2: timeout:5 + 2s command → hook succeeds ===
  elapsed: ~2000ms
  blocked === false: YES ✓
  stdout contains "hook completed": YES ✓
  completed in ~2s (not timed out): YES ✓

PASS — HOOK-007 timeout behavior is correctly implemented.
```

**Cleanup:** No state to clean up.

## Execution Evidence (2026-05-09)

**Command executed:**

```
node scripts/examples/hook-timeout-demo.mjs
```

**Actual output:**

```
=== Part 0: DEFAULT_TIMEOUT_SECONDS = 600 in source ===

  command-executor.ts DEFAULT_TIMEOUT_SECONDS = 600
  DEFAULT_TIMEOUT_SECONDS === 600: YES ✓

=== Part 1: timeout:1 + 2s command → hook times out ===

  elapsed: 1004ms
  runHooks result: {
  "blocked": false,
  "stdout": ""
}
  blocked === false (timeout = non-blocking exit code 1, not exit 2): YES ✓
  completed in ~1s (not 2s): YES ✓

=== Part 2: timeout:5 + 2s command → hook succeeds ===

  elapsed: 2017ms
  runHooks result: {
  "blocked": false,
  "stdout": "hook completed"
}
  blocked === false: YES ✓
  stdout contains "hook completed": YES ✓
  completed in ~2s (not timed out): YES ✓

PASS — HOOK-007 timeout behavior is correctly implemented.
```

**Exit code:** 0

**Observed result matches expected:** YES
