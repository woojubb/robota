---
title: 'CLI-B12: TuiInteractionChannel 생명주기 — React 외부 생성으로 인한 구조적 사각지대'
status: todo
created: 2026-05-31
priority: high
urgency: soon
area: packages/agent-transport
depends_on: [CLI-B11]
---

## 현재 아키텍처의 문제

### 채널이 React 외부에서 생성됨

```
render.tsx  → new TuiInteractionChannel(opts)   # React 외부, 앱 수명과 동일
            → render(<App channel={channel} />)

App.tsx     → setActiveSessionId(id)            # React state 변경
AppInner    → key={activeSessionId} remount      # React에서 세션 전환 감지
            → 하지만 channel은 변하지 않음        # ← 구조적 불일치
```

채널 생명주기(외부 JS 객체)와 세션 생명주기(React state)가 분리되어,
세션 전환 시 둘이 동기화되지 않는 버그가 발생했다(CLI-B11의 근본 원인).

이번 수정에서 `createChannel` 팩토리를 prop으로 넘기는 방식으로 패치했지만,
채널이 여전히 React 외부에서 시작되는 구조적 문제는 남아있다.

### TuiInteractionChannel이 공개되지 않음

`TuiInteractionChannel`은 `packages/agent-transport`의 내부 클래스로
패키지 index에서 export되지 않는다. 이 때문에:

- 외부 테스트에서 직접 import 불가
- 채널 생성 경로를 독립적으로 단위 테스트 불가
- 채널 ↔ InteractiveSession 계약을 격리 검증 불가

### 현재 상태 요약

| 항목                                   | 현재                      | 이상적                                |
| -------------------------------------- | ------------------------- | ------------------------------------- |
| 채널 생성 위치                         | `render.tsx` (React 외부) | React 내부 또는 명확한 lifecycle hook |
| 세션 전환 시 채널 교체                 | `App.tsx` onSessionSwitch | 채널 교체가 자동화된 구조             |
| TuiInteractionChannel 외부 테스트 가능 | 불가 (비공개)             | 가능 (export 또는 테스트 seam 제공)   |
| 채널 생명주기 소유자                   | `render.tsx` + `App.tsx`  | 단일 소유자                           |

## 개선 방향 (설계 확정 필요)

### Option A: 채널 생성을 App 내부로 이동

`render.tsx`에서 채널을 생성하는 대신 `createChannel` 팩토리만 전달하고,
`App`이 내부에서 `useMemo`/`useRef`로 채널을 관리한다.

```tsx
// render.tsx
render(<App createChannel={createChannel} ... />);

// App.tsx
const [channel, setChannel] = useState(() => createChannel(props.resumeSessionId));
// 세션 전환 시
const newChannel = createChannel(newSessionId);
setChannel(newChannel);
```

장점: 채널 생명주기가 React state와 완전히 동기화
단점: `App.tsx` 초기 렌더에서 채널 생성 (side effect in render 주의)

### Option B: TuiInteractionChannel에 switchSession() 메서드 추가

기존 채널 객체에 `switchSession(id: string): Promise<void>` 를 추가해
내부 `InteractiveSession`을 교체한다.

```typescript
await channel.switchSession('session-123');
// channel 내부의 InteractiveSession이 교체됨
// App.tsx의 React state 변경 없이 처리
```

장점: React 구조 변경 최소
단점: 채널이 mutable 상태를 가지게 되어 테스트·추론이 더 복잡해짐

### Option C: TuiInteractionChannel export + 테스트 seam 추가 (최소 변경)

현재 패치(createChannel 팩토리)를 유지하되,
`TuiInteractionChannel`을 `@internal` 표시와 함께 export하고
CLI-B11 테스트에서 직접 사용할 수 있게 한다.

장점: 최소 변경, CLI-B11 테스트 작성 가능
단점: 아키텍처 문제 자체는 해결되지 않음

## 구현 전 설계 확정 필요

이 백로그는 **설계 결정이 필요한 항목**이다.
구현 전 Option A/B/C 중 하나를 사용자와 확정한 후 진행할 것.

설계 기준:

- 채널 ↔ 세션 생명주기 동기화 보장
- CLI-B11 테스트가 채널 생성 경로를 직접 검증 가능
- React 외부 side effect 최소화

## 완료 기준

- [ ] 설계안 확정 (사용자 컨펌)
- [ ] 채널 생명주기 소유자가 단일화됨
- [ ] `TuiInteractionChannel` 또는 동등한 인터페이스를 외부 테스트에서 사용 가능
- [ ] CLI-B11의 TC-A ~ TC-E가 이 구조 위에서 안정적으로 동작
