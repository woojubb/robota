---
title: 'HOOK-006: hook-runner stdout JSON 응답 파싱 추가'
status: done
created: 2026-05-09
priority: medium
urgency: later
area: hooks
depends_on: HOOK-001
---

## Problem

CC 스펙에서 훅 스크립트는 stdout으로 JSON을 반환하여 동작을 제어할 수 있다.
SDK의 `runHooks()`는 현재 stdout을 단순 문자열로 수집만 하며 JSON 파싱을 하지 않는다.

## CC stdout JSON 스키마 (공식 문서 기준)

### 공통 필드 (모든 이벤트)

```json
{
  "continue": false,
  "stopReason": "설명",
  "suppressOutput": true,
  "systemMessage": "AI에게 전달할 메시지"
}
```

### PreToolUse 전용

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow | deny | ask | defer",
    "updatedInput": { "수정된": "파라미터" }
  }
}
```

- `deny` → 도구 차단 (exit 2와 동일 효과)
- `updatedInput` → 도구 파라미터를 수정하여 실행 가능
- 다중 훅 우선순위: `deny > defer > ask > allow`

### UserPromptSubmit 전용

```json
{
  "decision": "block",
  "hookSpecificOutput": {
    "additionalContext": "AI 컨텍스트에 주입할 텍스트"
  }
}
```

## Required Change

### `packages/agent-core/src/hooks/hook-runner.ts`

stdout이 유효한 JSON이면 파싱하여 처리:

1. **공통 처리**: `continue: false` → blocked 반환
2. **PreToolUse**: `hookSpecificOutput.permissionDecision` 파싱, `deny` → blocked, `updatedInput` 반환
3. **UserPromptSubmit**: `decision: "block"` → blocked, `hookSpecificOutput.additionalContext` → stdout에 포함
4. **다중 훅 우선순위**: PreToolUse에서 deny > defer > ask > allow 순으로 최종 결정

### `IRunHooksResult` 확장

```typescript
export interface IRunHooksResult {
  blocked: boolean;
  reason?: string;
  stdout: string;
  /** 파싱된 updatedInput (PreToolUse only) */
  updatedInput?: Record<string, unknown>;
  /** 파싱된 permissionDecision (PreToolUse only) */
  permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer';
}
```

## Implementation Notes

- JSON 파싱 실패 시 raw stdout을 그대로 수집 (기존 동작 유지)
- 이벤트 타입별 분기는 `input.hook_event_name`으로 구분
- `updatedInput` 지원 시 `PermissionEnforcer`에서 수정된 파라미터로 도구 실행

## Test Plan

- PreToolUse 훅이 `{ hookSpecificOutput: { permissionDecision: "deny" } }` 반환 시 차단 확인
- UserPromptSubmit 훅이 `{ hookSpecificOutput: { additionalContext: "extra" } }` 반환 시 AI 컨텍스트 주입 확인
- JSON 파싱 실패 시 graceful 처리 확인

## User Execution Test Scenarios

**Prerequisites:** `pnpm build` (agent-core dist must exist)

**Setup:** No API key required. The demo script uses `@robota-sdk/agent-core` public API directly.

**Scenarios:**

1. `{ continue: false, stopReason: "..." }` → any hook event is blocked
2. PreToolUse `{ hookSpecificOutput: { permissionDecision: "deny" } }` → tool is blocked
3. `{ systemMessage: "..." }` → text is injected into stdout for AI context

**Command:**

```
node scripts/examples/hook-json-response-demo.mjs
```

**Expected observable result:**

```
=== Scenario 1: { continue: false } blocks the hook event ===

runHooks result: { "blocked": true, "reason": "Security policy violation", "stdout": "" }
  blocked === true: YES ✓
  reason contains stopReason text: YES ✓

=== Scenario 2: permissionDecision: deny blocks PreToolUse ===

runHooks result: { "blocked": true, ..., "permissionDecision": "deny" }
  blocked === true: YES ✓
  permissionDecision === "deny": YES ✓

=== Scenario 3: systemMessage injected into stdout for AI context ===

runHooks result: { "blocked": false, "stdout": "User has elevated permissions today." }
  blocked === false: YES ✓
  stdout contains systemMessage text: YES ✓

PASS — HOOK-006 JSON response parsing is correctly implemented.
```

**Cleanup:** No state to clean up.

## Execution Evidence (2026-05-09)

**Command executed:**

```
node scripts/examples/hook-json-response-demo.mjs
```

**Actual output:**

```
=== Scenario 1: { continue: false } blocks the hook event ===

runHooks result: {
  "blocked": true,
  "reason": "Security policy violation",
  "stdout": ""
}
  blocked === true: YES ✓
  reason contains stopReason text: YES ✓

=== Scenario 2: permissionDecision: deny blocks PreToolUse ===

runHooks result: {
  "blocked": true,
  "reason": "Blocked by hook (permissionDecision: deny)",
  "stdout": "",
  "permissionDecision": "deny"
}
  blocked === true: YES ✓
  permissionDecision === "deny": YES ✓

=== Scenario 3: systemMessage injected into stdout for AI context ===

runHooks result: {
  "blocked": false,
  "stdout": "User has elevated permissions today."
}
  blocked === false: YES ✓
  stdout contains systemMessage text: YES ✓

PASS — HOOK-006 JSON response parsing is correctly implemented.
```

**Exit code:** 0

**Observed result matches expected:** YES
