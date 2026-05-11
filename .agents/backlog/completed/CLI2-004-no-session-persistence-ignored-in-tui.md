---
title: 'CLI2-004: --no-session-persistence 플래그가 인터랙티브 TUI 모드에서 무시됨'
status: done
created: 2026-05-10
priority: medium
urgency: soon
area: cli
source: qa-prelaunch-report-2026-05-10-v2
---

## Problem

`--no-session-persistence` 플래그는 print mode(`-p`)에서는 올바르게 처리되지만, 인터랙티브 TUI 모드에서는 항상 세션이 저장된다.

`packages/agent-cli/src/cli.ts:361, 399`:

```typescript
// 헤드리스(-p) 모드: 올바르게 처리됨
sessionStore: args.noSessionPersistence ? undefined : sessionStore,

// 인터랙티브 TUI 모드: noSessionPersistence 무시, 항상 sessionStore 전달
renderApp({
  ...
  sessionStore,   // noSessionPersistence 체크 없음
  ...
});
```

## Required Change

인터랙티브 모드 `renderApp()` 호출 시에도 동일한 조건을 적용한다.

```typescript
renderApp({
  ...
  sessionStore: args.noSessionPersistence ? undefined : sessionStore,
  ...
});
```

## Scope

- `packages/agent-cli/src/cli.ts` — `renderApp()` 호출부 `sessionStore` 전달 조건 수정

## Test Plan

1. `--no-session-persistence` 플래그로 TUI 세션 시작 후 종료, 세션 저장소에 기록이 남지 않음 확인
2. `-p` 모드와 TUI 모드 동작 일치 확인
3. `--no-session-persistence` 미지정 시 세션 저장 정상 동작 회귀 없음 확인

## User Execution Test Scenarios

### 시나리오 1: TUI 모드에서 세션 비저장 확인

**전제조건**: `robota` 바이너리 설치, 세션 저장 디렉토리 접근 가능

**실행 단계**:

```bash
# 세션 저장소 초기 상태 확인
ls ~/.robota/sessions/ 2>/dev/null || echo "empty"

# --no-session-persistence로 TUI 세션 시작
robota --no-session-persistence
```

TUI에서 메시지를 주고받은 뒤 종료(`/exit` 또는 Ctrl+C)

```bash
# 세션 저장 여부 확인
ls ~/.robota/sessions/
```

**기대 결과**: 세션 종료 후 저장소에 새로운 세션 파일이 생성되지 않는다.

**증거 필드** (구현 후 기입):

- 세션 저장소 파일 목록 변화: \_
