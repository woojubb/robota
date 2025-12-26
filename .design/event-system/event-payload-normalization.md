# Event Payload + Context Spec (최신)

> 이 문서는 이벤트의 “payload”와 “context”가 어떤 역할을 가지는지에 대한 **현재 스펙만** 정의합니다.

## 원칙
- 관계/계층/출처는 **오직 `context.ownerPath`**로만 표현한다.
- payload에는 **도메인 데이터만** 포함한다.
- EventService는 owner-bound 인스턴스가 단일 진실이며, timestamp/source 같은 공통 필드는 인스턴스가 처리한다.

## Context
### `context.ownerPath` (필수)
- absolute full path
- 세그먼트: `{ type: string; id: string }`
- 마지막 세그먼트는 현재 emitter의 owner

예시:
```ts
ownerPath = [
  { type: 'agent', id: 'agent_0' },
  { type: 'execution', id: 'exec_0' },
  { type: 'thinking', id: 'thinking_0' },
  { type: 'tool', id: 'tool_call_0' },
]
```

## Payload
### 허용(대표)
- `parameters`: 실행/렌더링에 필요한 입력 데이터
- `metadata`: 로깅/추적용 확장 데이터(값 타입은 제한된 유니온)
- `result`: 완료/오류 결과(도메인 데이터)
- `statusHistory`: 상태 전이(도메인 데이터)
- `extensions.robota.originalEvent`: raw event snapshot(디버그/추적 목적)

### 금지
- `rootExecutionId`, `parentExecutionId`, `executionLevel`, `executionPath`, `path` 등 ownerPath에서 파생 가능한 계층 필드
- 수동 `timestamp`/`sourceType`/`sourceId` 주입(공통 필드는 EventService가 처리)
- 이벤트명 문자열 리터럴

## Tool → Agent 생성 시 컨텍스트 규칙
- Tool 실행 컨텍스트는 다음 2가지를 가진다:
  - `eventService`(tool-call owner-bound)
  - `baseEventService`(unbound base)
- Tool이 agent를 생성해야 한다면 `baseEventService`에서 agent owner-bound 인스턴스를 만든다.
- 새 agent의 ownerPath는 기존 ownerPath에 `{ type: 'agent', id }`만 append한다.

## 금지사항(전역)
- ID 파싱/정규식/캐시/지연 연결/대체 경로 금지
- 중복 억제 로직 금지
