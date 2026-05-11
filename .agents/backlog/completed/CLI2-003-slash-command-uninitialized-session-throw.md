---
title: 'CLI2-003: 슬래시 커맨드 실행 직후 미초기화 세션에서 throw'
status: done
created: 2026-05-10
priority: high
urgency: soon
area: cli
source: qa-prelaunch-report-2026-05-10-v2
---

## Problem

앱 시작 직후 세션 초기화 전에 슬래시 커맨드(예: `/help`)를 빠르게 입력하면 unhandled exception이 발생할 수 있다.

`packages/agent-cli/src/ui/hooks/useSlashRouting.ts:74`:

```typescript
const ctx = interactiveSession.getContextState(); // try-catch 없음
```

`applySystemCommandResult()` 함수에서 `getContextState()`를 보호 없이 호출한다. `InteractiveSession.getContextState()`는 내부적으로 `getSessionOrThrow()`를 호출하고, 세션이 아직 초기화되지 않았으면 `Error('InteractiveSession not initialized...')`를 throw한다 (`packages/agent-sdk/src/interactive/interactive-session.ts:340-343`).

## Required Change

`getContextState()` 호출을 try-catch로 보호하거나, 미초기화 상태에서 기본값을 반환하도록 처리한다.

```typescript
// useSlashRouting.ts — applySystemCommandResult() 내부
try {
  const ctx = interactiveSession.getContextState();
  manager.setContextState({ ... });
} catch {
  // Session not yet initialized — skip context update
}
```

장기적으로는 `InteractiveSession`이 `isReady()` 메서드나 `onReady` 이벤트를 노출하여 폴링 없이 초기화 완료를 감지할 수 있도록 SDK를 개선한다. (`DEV-L-002` 참조)

## Scope

- `packages/agent-cli/src/ui/hooks/useSlashRouting.ts:74` — `getContextState()` 호출 보호

## Test Plan

1. 앱 시작 직후 타이밍 관련 단위 테스트 추가: 미초기화 상태에서 슬래시 커맨드 라우팅 호출 시 throw 없음 확인
2. `pnpm typecheck` 통과 확인
3. 기존 슬래시 커맨드 동작 회귀 없음 확인 (초기화 완료 후 정상 동작)

## User Execution Test Scenarios

### 시나리오 1: 앱 시작 직후 즉시 슬래시 커맨드 입력

**전제조건**: `robota` 바이너리 설치, 빠른 입력 가능한 환경

**실행 단계**:

```bash
robota
```

TUI가 열리는 즉시(로딩 중) `/help` 입력

**기대 결과**: 오류 없이 처리된다. 세션 초기화 전이면 컨텍스트 업데이트가 조용히 스킵되고, 초기화 완료 후에는 정상 동작한다.

**증거 필드** (구현 후 기입):

- 관찰 결과: \_
- 오류 발생 여부: \_
