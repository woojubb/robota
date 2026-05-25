---
title: 'CORE-004: 상태없는 임베디드 모드 — 파일시스템 의존 제거'
status: todo
created: 2026-05-25
priority: high
urgency: soon
area: packages/agent-framework
depends_on: []
---

## Background

`createAgentRuntime`은 항상 다음 파일시스템 접근을 시도한다:

1. `getUserSettingsPath()` → `~/.robota/settings.json` 읽기
2. `createProjectSessionStore(cwd)` → `.robota/sessions/` 디렉터리 생성
3. `BundlePluginLoader(pluginsDir)` → `~/.robota/plugins/` 로드 (bare: false 시)
4. `loadConfig(cwd)` → `.robota.json` 읽기 (bare: false 시)

이로 인해:

- **서버리스(Vercel Edge, AWS Lambda)** 에서는 파일시스템이 read-only이거나 없음
- **Docker 컨테이너** 에서 홈 디렉터리가 없는 경우 에러 발생
- **테스트 환경** 에서 불필요한 설정 파일 생성

현재 `bare: true` + `sessionStore: undefined` 조합으로 부분 해결 가능하지만,
문서화되지 않았고 `sessionStore: undefined` 전달 방법이 직관적이지 않다.

```typescript
// 현재: sessionStore를 명시적으로 undefined로 전달해야 함 (비직관)
const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider,
  sessionStore: undefined, // 'sessionStore' key 존재해야 적용됨
});
const session = runtime.createSession({ bare: true });
```

## 목표

```typescript
// 목표: 명시적 stateless 모드
const runtime = createAgentRuntime({
  provider,
  mode: 'stateless', // ← 파일시스템 접근 없음
});

// 또는 플래그 조합을 문서화된 헬퍼로
const runtime = createStatelessRuntime({ provider });
```

## 구현 범위 (옵션 A — mode 플래그)

```typescript
export interface IAgentRuntimeConfig {
  // ...기존...
  /**
   * 'stateless': disable all filesystem side-effects (session store,
   * settings read, plugin load). Suitable for serverless/edge.
   * Default: 'default' (full CLI mode).
   */
  mode?: 'default' | 'stateless';
}
```

`mode: 'stateless'` 시:

- `sessionStore` 자동으로 `undefined` (no-op)
- settings read → 기본값 사용 (파일 읽기 없음)
- plugin loading 건너뜀

## 구현 범위 (옵션 B — createStatelessRuntime 헬퍼)

```typescript
// packages/agent-framework/src/index.ts
export function createStatelessRuntime(config: {
  provider: IAIProvider;
  cwd?: string;
}): IAgentRuntime;
```

내부적으로 `createAgentRuntime({ ..., sessionStore: undefined, mode: 'stateless' })` 호출.

## Test Plan

- `createStatelessRuntime` 또는 `mode: 'stateless'`로 생성 후 session 실행
- `~/.robota/settings.json` 파일 생성/읽기 없음 확인
- `.robota/sessions/` 디렉터리 생성 없음 확인
- `pnpm test` 통과

## User Execution Test Scenarios

### Scenario 1: 파일시스템 접근 없이 실행

**Steps:**

```typescript
const runtime = createStatelessRuntime({ provider: new AnthropicProvider({ apiKey }) });
const session = runtime.createSession({ permissionMode: 'bypassPermissions' });
session.on('complete', (r) => console.log(r.response));
await session.submit('Hello!');
```

**Expected:** 파일시스템 접근 없이 응답 반환
