---
title: 'CORE-004: createStatelessRuntime 헬퍼 — 파일시스템 없는 임베디드 모드'
status: done
done_at: 2026-05-25
pr: '610'
created: 2026-05-25
priority: high
urgency: soon
area: packages/agent-framework
depends_on: []
---

## Background

`createAgentRuntime`은 항상 다음 파일시스템 접근을 한다:

1. `getUserSettingsPath()` → `~/.robota/settings.json` (설정 읽기용 기본 어댑터 생성)
2. `createProjectSessionStore(cwd)` → `.robota/sessions/` (세션 영속 스토어 생성)
3. `InteractiveSession.init()` → `~/.robota/plugins/` (bare: false 시 플러그인 로드)

서버리스(Vercel Edge, AWS Lambda), Docker 최소 이미지, 테스트 환경에서 이 접근이
에러를 일으킨다.

## 아키텍처 분석 — 이미 있는 것들

```typescript
// IAgentRuntimeConfig에 commandHostAdapters가 이미 있음
export interface IAgentRuntimeConfig {
  commandHostAdapters?: ICommandHostAdapters; // ← settings read/write를 DI로 교체 가능
  sessionStore?: IInteractiveSessionStore; // ← key 존재 시 custom/undefined 가능
}

// 조건부 sessionStore 생성 (이미 구현)
const sessionStore =
  'sessionStore' in config
    ? config.sessionStore // ← undefined 포함, 명시 전달 시 사용
    : createProjectSessionStore(); // ← key 없으면 기본 파일 스토어
```

`commandHostAdapters`를 no-op으로, `sessionStore`를 `undefined`로 전달하면
파일시스템 없이 동작 가능하다. 그러나:

1. 이 패턴이 문서화되지 않음
2. `sessionStore: undefined` 전달 방법이 비직관적
3. `ICommandHostAdapters` 타입을 사용자가 직접 만들어야 함

## 목표: createStatelessRuntime 편의 팩토리

`agent-framework/src/runtime/`에 신규 편의 함수 추가. 내부적으로 `createAgentRuntime`에
적절한 기본값을 전달하는 thin wrapper.

```typescript
// packages/agent-framework/src/runtime/stateless-runtime.ts
export function createStatelessRuntime(config: {
  provider: IAIProvider;
  cwd?: string;
}): IAgentRuntime;
```

내부 동작:

```typescript
return createAgentRuntime({
  cwd: config.cwd ?? process.cwd(),
  provider: config.provider,
  sessionStore: undefined, // 세션 영속 없음
  commandHostAdapters: {
    settings: {
      read: () => getDefaultSettings(), // 파일 읽기 없이 기본값 반환
      write: () => {}, // no-op
    },
  },
});
```

세션 생성 시 기본값:

```typescript
runtime.createSession({
  permissionMode: 'bypassPermissions',
  bare: true, // AGENTS.md/CLAUDE.md 로드 건너뜀
  // ...사용자 옵션
});
```

## 설계 원칙

- `createStatelessRuntime`은 `createAgentRuntime`의 thin wrapper
- 새 레이어나 추상화가 아님
- `IAgentRuntimeConfig`의 기존 DI 포인트(commandHostAdapters, sessionStore)를 활용
- 파일시스템 접근 = 0인 경우를 명시적으로 표현하는 것이 목적

## 변경 범위

1. `packages/agent-framework/src/runtime/stateless-runtime.ts` 신규 생성
2. `packages/agent-framework/src/index.ts`에 `createStatelessRuntime` export 추가
3. `IAgentRuntimeConfig`의 `commandHostAdapters` 문서 보강

## Test Plan

- `createStatelessRuntime({ provider })` 생성 후 세션 실행
- 실행 전후로 `~/.robota/` 파일시스템 변경 없음 확인
- `pnpm test` 통과

## User Execution Test Scenarios

### Scenario 1: 파일시스템 없이 실행

```typescript
const runtime = createStatelessRuntime({
  provider: new AnthropicProvider({ apiKey }),
});
const session = runtime.createSession({ permissionMode: 'bypassPermissions' });
session.on('complete', (r) => console.log(r.response));
await session.submit('Hello!');
// Expected: 응답 반환, 파일시스템 미수정
```
