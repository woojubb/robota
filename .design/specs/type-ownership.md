# 타입 소유권(SSOT) 스펙 (최신)

## 목표
- 타입은 **owner가 1곳**만 존재한다(SSOT).
- 소비처는 owner 패키지의 **public export만** import한다.
- type alias는 `T*`, interface는 `I*` 접두어를 사용한다(신규/수정 코드부터).

## owner 축(요약)
- `@robota-sdk/agents` 소유
  - Event axis: `EventContext`, ownerPath segment, event constants
  - Event history/log axis: `IEventHistoryRecord`, `IEventHistoryModule`
  - Tool axis: tool contract types, ToolExecutionContext
  - Message axis: 메시지 계약
  - Shared value axis: UniversalValue/LoggerData 등
- `@robota-sdk/workflow` 소유
  - workflow graph axis: node/edge/structure
  - projection/apply axis: workflow projection contracts
- 기타 패키지(`openai`, `remote`, `team`, `playground`, `apps/*`)
  - 원칙: owner 타입 “소비”만 한다(재정의/복제 금지)

## 금지 패턴
- 동일 의미 타입을 소비처에서 재선언(드리프트 위험)
- 의미 없는 alias(`type A = B`)
- services/managers/plugins 레이어가 contract 타입을 재-export 하여 import 경로를 오염
- event log 레코드 shape를 owner 축과 별개로 재정의


