# Agent와 Tool ownerPrefix 문서 (Archive)

> 2025-10-16에 정리한 세부 실행 계획은 `.design/open-tasks/CURRENT-TASKS.md`의 **Priority 2 · A-3 이벤트 소유권 정비** 섹션으로 완전히 편입되었습니다.  
> Action item과 체크박스는 CURRENT-TASKS 한 곳에서만 관리합니다. 이 문서는 배경·설계 의도를 남기는 참고용 자료입니다.

## 목적
- ExecutionService에서 도입한 `ownerPrefix` 검증 모델을 Agent/Tool 계층에도 일관되게 적용한다.
- EventService 기본 구현이 아닌, `ActionTrackingEventService` 같은 확장 구현에서만 접두어 자동 부착/검증이 동작한다는 사실을 명시한다.
- Agent·Tool은 추상 클래스 레벨에서만 EventService를 의존하고, 접두어는 clone 시점에 주입한다(DIP).

## 핵심 개념 요약
### 1. Clone with Prefix
- `eventService.clone({ ownerPrefix: 'agent' | 'tool', executionContext })` 형태로 새 인스턴스를 만든다.
- clone API가 없다면 `new ActionTrackingEventService(base, undefined, executionContext, { ownerPrefix })`로 감싼다.
- emit 호출부는 `'agent.created'`처럼 전체 접두어를 작성하지 않고 상수의 suffix만 전달한다.

### 2. Agent 적용 지침
- 파일: `packages/agents/src/agents/robota.ts`
- 생성자에서 주입받은 EventService를 `cloneWithPrefix(base, 'agent')` 패턴으로 재생성해 `this.eventService`에 저장한다.
- `AGENT_EVENTS`는 `'created'`, `'execution_start'`처럼 suffix만 유지한다. 실제 접두어 부착은 EventService가 담당한다.
- Robota 내부에서는 ActionTrackingEventService 확장체를 사용할 수 있도록 config/eventService 주입 경로를 모두 검토한다.

### 3. Tool 적용 지침
- 파일: `packages/agents/src/abstracts/abstract-tool.ts`
- 생성자에서 `options.eventService`가 주어지면 `cloneWithPrefix(service, 'tool')`로 wrapping 한다.
- Tool 구현체는 `this.emitEvent('call_start', payload)` 형태로 suffix만 넘기고, helper는 ownerPrefix 검증이 활성화된 EventService를 호출한다.
- Tool이 Agent를 생성할 때는 `eventService.clone({ ownerPrefix: 'agent' })`를 통해 하위 Agent에도 접두어 규칙을 전파한다.

### 4. 검증 서비스 사용 범위
- ActionTrackingEventService는 ExecutionService, Agent, Tool, Plugin 등 EventService를 주입받는 모든 레이어에서 재사용한다.
- 기본 EventService를 사용할 경우 접두어 검증이 수행되지 않으므로, 생산 코드에서는 항상 ActionTrackingEventService(또는 동일 기능을 제공하는 확장체)를 사용한다.

## CURRENT-TASKS 내 연동 위치
- `.design/open-tasks/CURRENT-TASKS.md` → **Priority 2 · A-3 이벤트 소유권 정비**
  - Agent ownerPrefix 적용
  - Tool/Plugin/Module 이벤트 소유권 검증
  - ESLint/검증 스크립트 도입 계획

## 참고 코드 스니펫
```typescript
// Agent 예시
const baseEventService = config.eventService || new SilentEventService();
this.eventService = this.cloneWithPrefix(baseEventService, 'agent');
this.eventService.emit(AGENT_EVENTS.CREATED, payload);

// Tool 예시
constructor(options: AbstractToolOptions = {}) {
  this.eventService = options.eventService
    ? this.cloneWithPrefix(options.eventService, 'tool')
    : undefined;
}

protected emitEvent(eventType: string, data: Record<string, unknown>): void {
  this.eventService?.emit(eventType, data);
}
```

## 참고 링크
- `.design/open-tasks/CURRENT-TASKS.md`
- `packages/agents/src/services/action-tracking-event-service.ts`
- `packages/agents/src/agents/robota.ts`
- `packages/agents/src/abstracts/abstract-tool.ts`

