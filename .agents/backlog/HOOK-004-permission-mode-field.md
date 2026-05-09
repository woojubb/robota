---
title: 'HOOK-004: IHookInput에 permission_mode 필드 추가'
status: done
created: 2026-05-09
priority: medium
urgency: later
area: hooks
depends_on: HOOK-001
---

## Problem

CC 스펙은 모든 훅 stdin JSON에 `permission_mode` 필드를 포함한다.
CC 공식 값: `"default"`, `"plan"`, `"acceptEdits"`, `"auto"`, `"dontAsk"`, `"bypassPermissions"` (6가지).
훅 스크립트가 현재 permission mode에 따라 동작을 다르게 하는 것이 CC의 일반적인 패턴이다.
SDK의 `IHookInput`에 이 필드가 없어 CC 기준 스크립트가 항상 빈 값을 받는다.

## Required Change

### 1. `packages/agent-core/src/hooks/types.ts`

`IHookInput`에 필드 추가:

```typescript
/** Current permission mode — Claude Code compatible (all events) */
permission_mode?: string;
```

### 2. 훅 발화 지점 전체

`session-run.ts`, `session-lifecycle.ts`, `tool-hook-helpers.ts`의 모든 `IHookInput` 생성 지점에서 `permission_mode` 전달.

Session이 현재 permission mode를 알고 있어야 하므로, `IRunContext`에 `permissionMode` 필드를 추가하거나 `getPermissionMode()` 함수를 주입하는 방식으로 전달 경로를 설계해야 한다.

## Test Plan

- 각 훅 이벤트 발화 시 stdin JSON에 `permission_mode` 포함 확인
- `jq '.permission_mode'` 로 읽었을 때 올바른 값 반환 확인

## User Execution Test Scenarios

Not applicable — internal hook input field change.
