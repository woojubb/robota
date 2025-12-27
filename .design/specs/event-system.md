# 이벤트 시스템 스펙 (최신)

## 목표
- 이벤트 관계/계층/출처는 **오직 `EventContext.ownerPath`**로만 표현한다.
- 이벤트명은 **상수만** 사용한다(문자열 리터럴 금지).
- EventService는 **owner-bound 인스턴스**가 단일 진실이다.

## 1) EventContext / ownerPath
- `ownerPath`는 **absolute full path**다.
- 세그먼트는 `{ type: string; id: string }` 형태다.
- 마지막 세그먼트는 현재 emitter의 owner다.

예시:
```ts
ownerPath = [
  { type: 'agent', id: 'agent_0' },
  { type: 'execution', id: 'exec_0' },
  { type: 'thinking', id: 'thinking_0' },
  { type: 'tool', id: 'tool_call_0' },
]
```

## 2) EventService (owner-bound)
- EventService는 단일 owner에 바운드된 인스턴스로 사용한다.
- emit 전에 `context.ownerPath`가 absolute full path인지 검증한다(필수).
- 호출부(ExecutionService/Tool/Agent)는 **payload에 도메인 데이터만** 넣는다.

## 3) Payload vs Context 규칙
### payload에 유지(도메인 데이터)
- `parameters`, `metadata`, `result`, `statusHistory`
- `extensions.robota.originalEvent`(raw snapshot, 디버그/추적 목적)

### payload에서 금지(= ownerPath로 파생 가능)
- `rootExecutionId`, `parentExecutionId`, `executionLevel`, `executionPath`, `path`
- 수동 `timestamp` / `sourceType` / `sourceId` 주입

## 4) Tool → Agent 생성 시 규칙
- Tool 실행 컨텍스트는 다음 2가지를 가진다:
  - `eventService`: tool-call owner-bound
  - `baseEventService`: unbound base
- Tool이 agent를 생성해야 한다면, **`baseEventService`에서 agent owner-bound 인스턴스를 만든다**.
- 새 agent의 ownerPath는 기존 ownerPath에 `{ type: 'agent', id }`만 append한다.
- 금지: tool-call owner-bound 인스턴스를 agent owner-bound로 “겹쳐 바인딩”.

## 5) 이벤트 상수 규칙
- `EXECUTION_EVENTS`, `TOOL_EVENTS`, `AGENT_EVENTS` 등 **소유 모듈의 상수만** 사용한다.
- emit/on/switch에서 문자열 리터럴 이벤트명은 금지한다.

## 6) 시나리오/재생(playback)
- scenario/recorder는 “실행 재현”을 위한 도구이며, 이벤트/관계 규칙은 동일하게 **ownerPath-only**를 따른다.
- delegated 실행에서도 `ownerPath`는 absolute full path로 전파된다.

## 7) 검증 기준(정규화 영향 평가)
- **필수 필드**
  - 모든 이벤트는 `context.ownerPath`를 반드시 포함한다(비어 있으면 실패).
  - 모든 `ownerPath` 세그먼트는 `{ type, id }`이며 `id`는 빈 문자열이 아니어야 한다.
- **금지 규칙**
  - 이벤트 payload에 `rootExecutionId`, `parentExecutionId`, `executionLevel`, `executionPath`, `path` 같은 계층/관계 필드를 두지 않는다.
  - 이벤트 payload에 `sourceType/sourceId`를 수동으로 주입하지 않는다.
- **링킹 규칙**
  - 노드/엣지 생성 시 관계는 오직 `context.ownerPath`로만 결정한다(문자열 파싱/추측/순서 기반 선택 금지).
  - linkage 정보가 없으면 연결을 “대체”하지 않고, 해당 이벤트 처리를 실패로 끝낸다(No-Fallback).
- **실행 검증**
  - 예제 실행 후 `apps/examples/utils/verify-workflow-connections.ts` 검증이 통과해야 한다.


