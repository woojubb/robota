---
title: 'DEV-001: useSideEffects.ts의 as unknown as ISideEffects 이중 캐스팅 — 사이드 이펙트 경로 dead code'
status: todo
created: 2026-05-10
priority: high
urgency: now
area: cli
source: qa-prelaunch-report-2026-05-10-v2, dev-prelaunch-report-2026-05-10
---

## Problem

`packages/agent-cli/src/ui/hooks/useSideEffects.ts:239-241`에서 `InteractiveSession`을 `ISideEffects` 인터페이스로 이중 캐스팅한다.

```typescript
function getHostSideEffects(interactiveSession: InteractiveSession): ISideEffects {
  return interactiveSession as unknown as ISideEffects;
}
```

`ISideEffects`는 `_pendingModelId`, `_resetRequested`, `_exitRequested`, `_triggerResumePicker`, `_sessionName`, `_statusLinePatch` 등의 언더스코어 플래그를 선언하는데, `InteractiveSession`은 이 필드들을 실제로 갖고 있지 않다. JavaScript에서 존재하지 않는 optional 속성을 읽으면 `undefined`를 반환하므로, `if (sideEffects._pendingModelId)` 등의 조건 분기는 항상 `false`가 되어 dead code가 된다.

또한 `command-effect-handler.ts:66`에서는 `sideEffects._statusLinePatch = effect.patch`로 쓰기 작업을 수행하는데, 실제로는 `InteractiveSession` 인스턴스에 동적 속성을 덧붙이는 것이다.

**참조**: QA-M-002, DEV-H-001 (중복 → 단일 이슈로 통합)

## Required Change

`CommandEffectQueue`(이미 존재함)를 사이드 이펙트의 SSOT로 사용한다. `getHostSideEffects` 패턴을 완전히 제거하고 모든 사이드 이펙트를 `commandEffectQueue` / `applyCommandEffects`를 통해 처리한다.

1. `getHostSideEffects()` 함수 제거
2. `_statusLinePatch` 쓰기를 `deps.applyStatusLinePatch(effect.patch)` 콜백으로 이동 (line 67에 이미 존재)
3. `ISideEffects` 인터페이스를 `CommandEffectQueue`가 이미 제공하는 타입으로 대체하거나 제거
4. 사이드 이펙트 플래그를 `InteractiveSession` 대신 별도의 상태 객체에서 관리

## Scope

- `packages/agent-cli/src/ui/hooks/useSideEffects.ts`
- `packages/agent-cli/src/ui/hooks/command-effect-handler.ts`
- `ISideEffects` 인터페이스 정의 파일 (확인 후 업데이트)

## Test Plan

1. `pnpm --filter @robota-sdk/agent-cli typecheck` — 타입 오류 없음 확인
2. `pnpm --filter @robota-sdk/agent-cli test` — 기존 테스트 모두 통과 확인
3. 모델 변경(`_pendingModelId`), 세션 리셋(`_resetRequested`), 종료(`_exitRequested`) 경로를 단위 테스트로 커버
4. `pnpm build` — 빌드 성공 확인

## User Execution Test Scenarios

### Scenario 1: 모델 전환 사이드 이펙트 동작 확인

**Prerequisites**: robota CLI 설치, 유효한 프로바이더 API 키 설정

**Steps**:

```bash
robota
# TUI 시작 후
/model  # 모델 변경 커맨드 실행
# 다른 모델 선택
# 새 모델로 대화 시도
```

**Expected observable result**: 모델 변경 후 세션이 변경된 모델로 대화가 진행됨. 이전에는 `_pendingModelId`가 항상 falsy여서 변경 효과가 없었음.

**Evidence**: (구현 후 기록)

### Scenario 2: 세션 리셋 사이드 이펙트 동작 확인

**Prerequisites**: robota CLI TUI 모드 실행 중

**Steps**:

```bash
/reset  # 세션 리셋 커맨드 실행
```

**Expected observable result**: 세션이 실제로 초기화되어 대화 히스토리가 지워짐

**Evidence**: (구현 후 기록)
