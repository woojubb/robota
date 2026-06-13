---
title: 'CLI-B11: 세션 전환 컨텍스트 복원 — 재발 방지 테스트 누락'
status: done
created: 2026-05-31
priority: critical
urgency: now
area: packages/agent-transport, packages/agent-framework
depends_on: []
---

## 왜 이 버그가 사전에 방지되지 못했는가

### 직접 원인: 검증이 잘못된 레이어에 집중됨

이번 수정 과정에서 작성된 검증 코드(`real-resume-verify-v3.mjs`)는
`InteractiveSession`을 직접 생성해 컨텍스트 복원을 검증했다.

그러나 실제 버그는 **그 위 레이어**에 있었다:

```
render.tsx          → TuiInteractionChannel 생성 (resumeSessionId 없이)
App.tsx             → onSessionSwitch 시 setActiveSessionId만 호출
                       채널은 그대로 재사용
AppInner (remount)  → 같은 채널 받음 → InteractiveSession 복원 없음 → context 0%
```

`InteractiveSession` 수준의 테스트가 통과해도 `render.tsx ↔ App.tsx ↔ TuiInteractionChannel`
경계의 버그를 전혀 감지하지 못한다.

### 간접 원인: TuiInteractionChannel이 공개되지 않아 직접 테스트 불가

`TuiInteractionChannel`은 `packages/agent-transport`의 내부 클래스로,
패키지 외부에서 import할 수 없다. 이 때문에:

- 채널이 올바른 `resumeSessionId`로 생성되는지 단위 테스트로 검증 불가
- `createChannel(sessionId)` 팩토리가 실제로 호출되는지 검증 불가
- 세션 전환 시 새 채널이 생성되는지 검증 불가

### 간접 원인: React 컴포넌트 레이어에 테스트 없음

`App.tsx`의 `onSessionSwitch` 핸들러 동작을 검증하는 테스트가 없다.
핸들러 내부 로직 변경이 있어도 회귀를 감지할 수 없다.

## 누락된 테스트 목록

| ID   | 시나리오                                                | 검증 조건                                                        | 잡히는 버그                          |
| ---- | ------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------ |
| TC-A | 초기 채널 없이 세션 피커에서 세션 선택                  | `createChannel`이 선택된 sessionId로 호출됨                      | CLI 세션 전환 context 0% (이번 버그) |
| TC-B | 세션 전환 후 새 채널의 context 상태 확인                | `newChannel.interactiveSession.getContextState().usedTokens > 0` | CLI 세션 전환 context 0% (이번 버그) |
| TC-C | 세션 전환 시 구 채널 stop 호출 확인                     | `oldChannel.stop()`이 정확히 1회 호출됨                          | 구 채널 리소스 누수 방지             |
| TC-D | `createChannel` 없이 fallback 경로 (props.channel 반환) | `createChannel` 미제공 시 기존 channel 사용 (하위 호환)          | 팩토리 누락 시 렌더 크래시 방지      |
| TC-E | 연속 세션 전환 (A→B→C)                                  | 각 전환마다 새 채널 생성, 이전 채널 stop, 최신 채널 context 정상 | 다중 전환 누적 버그 방지             |

## 구현 계획

### 접근: TuiInteractionChannel 팩토리 패턴을 unit-testable하게 추출

`App.tsx`의 세션 전환 로직은 `createChannel` 팩토리만 의존하므로,
팩토리를 mock으로 주입하면 채널 생성 검증이 가능하다.

```typescript
// 테스트에서 createChannel mock 주입
const mockCreateChannel = vi.fn().mockImplementation((resumeSessionId) =>
  createMockChannel(resumeSessionId)
);

// App 렌더링 시 주입
render(<App channel={initialChannel} createChannel={mockCreateChannel} ... />);

// 세션 전환 트리거
await triggerSessionSwitch('session-123');

// 검증
expect(mockCreateChannel).toHaveBeenCalledWith('session-123');
expect(mockCreateChannel).toHaveBeenCalledTimes(1);
```

### 필요한 작업

1. `packages/agent-transport/src/tui/__tests__/session-switch-channel.test.tsx` 작성
   - TC-A ~ TC-E 커버
   - `App` 컴포넌트를 `ink-testing-library` 또는 `@testing-library/react`로 렌더
   - `createChannel` mock 주입으로 채널 생성 횟수·인자 검증

2. `packages/agent-transport/src/tui/__tests__/channel-factory-integration.test.ts` 작성
   - `createChannel(sessionId)` 호출 시 `InteractiveSession.getContextState().usedTokens > 0` 검증
   - 실제 `FileSessionStore`와 실제 `Session` 사용 (mock 금지)
   - 이 테스트가 `real-resume-verify-v3.mjs`의 공식 CI 등가물

## User Execution Test Scenarios

### Scenario 1: /resume 세션 선택 후 context % 표시

1. 메시지가 20개 이상인 세션이 존재하는 환경에서 CLI 실행
2. `/resume` 입력 → 세션 피커 열림
3. 해당 세션 선택
4. 상태바에 Context > 0% 표시되는지 확인

**Expected**: `Context: NN% (XXK/YYYYK tokens)` (NN > 0)
**Previously**: `Context: 0% (0K/1M tokens)`

**Evidence (2026-06-13, real binary `bin/robota.cjs` v3.0.0-beta.73 in a real PTY,
isolated HOME + temp project, sessions persisted via the real
`createProjectSessionStore` write path):**

```
[boot] status: Context: 0% (0K/200K tokens)
[after first /resume select] status: Context: 6% (11.9K/200K tokens)
```

CI equivalents added in this change: `packages/agent-transport/src/tui/__tests__/
session-switch-channel.test.tsx` (TC-A/C/D/E — mock factory call args/count, old-channel
stop, fallback, consecutive switches) and `packages/agent-transport/src/tui/__tests__/
channel-factory-integration.test.ts` (TC-B — real store, restored `usedTokens > 0`).

### Scenario 2: 연속 세션 전환 후 context % 유지

1. A 세션 → 피커 → B 세션 선택 → context > 0% 확인
2. 다시 `/resume` → A 세션 선택 → context > 0% 확인

**Expected**: 각 전환마다 해당 세션의 실제 context % 반영

**Evidence (2026-06-13, same PTY run — two different persisted sessions selected
consecutively, each switch reflects that session's own context):**

```
[after first /resume select] status: Context: 6% (11.9K/200K tokens)   ← session B (30 msgs)
[after second /resume select] status: Context: 16% (31.8K/200K tokens) ← session A (80 msgs)
```
