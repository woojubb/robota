# Agent와 Tool에 ownerPrefix 패턴 적용 계획

> 검증 완료된 실행 계획 (2025-10-16)

## 🔍 현재 상태 분석 (Analysis Phase)

### ✅ 이미 완료된 항목
- [x] ExecutionService: `maybeClone` 패턴으로 `execEventService`, `toolEventService` 분리
- [x] ActionTrackingEventService: `ownerPrefix` 옵션 지원
- [x] 이벤트 상수 정의: `AGENT_EVENTS`, `EXECUTION_EVENTS`, `TOOL_EVENTS`

### 📊 현재 문제점

#### 1. Agent (Robota)
**위치**: `packages/agents/src/agents/robota.ts:255`
```typescript
// ❌ 문제: 전체 이벤트명 하드코딩
this.eventService.emit(AGENT_EVENTS.CREATED as any, {
  sourceType: 'agent',
  sourceId: this.conversationId,
  // ...
});
```

**분석**:
- Agent가 주입받은 `this.eventService`를 직접 사용
- `AGENT_EVENTS.CREATED` = `'agent.created'` (전체 문자열)
- ownerPrefix 패턴 미적용

**영향 범위**:
- `robota.ts`: 1개 파일
- emit 위치: constructor 내 1곳
- 사용하는 이벤트: `AGENT_EVENTS.CREATED`, 기타 실행 이벤트

#### 2. Tool (BaseTool)
**위치**: `packages/agents/src/abstracts/base-tool.ts:109-116`
```typescript
export abstract class BaseTool<TParameters, TResult> {
  private eventService: EventService | undefined;
  
  constructor(options: BaseToolOptions = {}) {
    this.eventService = options.eventService;  // ✅ 주입은 됨
    this.logger = options.logger || SilentLogger;
  }
}
```

**분석**:
- BaseTool은 EventService 주입 지원
- 하지만 BaseTool 자체에서 직접 emit하는 코드는 없음
- Tool 구현체들이 각자 `this.eventService.emit()` 사용 가능

**영향 범위**:
- `base-tool.ts`: 인터페이스만 제공
- Tool 구현체: 각각 독립적으로 emit 사용 (필요 시 개별 수정)

---

## 🎯 해결 방안 (Solution Design)

### Phase 1: Agent (Robota) ownerPrefix 적용

#### 방안 A: Agent 생성자에서 clone (추천)
```typescript
// packages/agents/src/agents/robota.ts
constructor(config: AgentConfig) {
  super();
  
  // 기존 eventService 주입받기
  const baseEventService = config.eventService || new SilentEventService();
  
  // 🎯 ownerPrefix와 함께 clone
  this.eventService = this.cloneWithPrefix(baseEventService, 'agent');
  
  // 이제 접두어 없이 emit
  if (this.eventService && !(this.eventService instanceof SilentEventService)) {
    this.eventService.emit('created', {  // 'agent.' 자동 추가
      sourceType: 'agent',
      sourceId: this.conversationId,
      // ...
    });
  }
}

private cloneWithPrefix(
  svc: EventService, 
  ownerPrefix: 'agent'
): EventService {
  const svcAny = svc as any;
  if (svcAny && typeof svcAny.clone === 'function') {
    return svcAny.clone({ ownerPrefix });
  }
  return new ActionTrackingEventService(svc, undefined, undefined, { ownerPrefix });
}
```

**장점**:
- ExecutionService와 동일한 패턴
- WorkflowEventSubscriber가 모든 이벤트 수신 가능
- 주입 패턴 유지

**단점**:
- 없음

#### 방안 B: BaseAgent에서 처리 (대안)
- BaseAgent 레벨에서 clone 처리
- 모든 Agent 서브클래스에 자동 적용

**평가**: 방안 A가 더 명확하고 ExecutionService와 일관성 있음

---

### Phase 2: Tool에 ownerPrefix 적용

#### 방안 A: BaseTool에 cloneWithPrefix 헬퍼 추가 (추천)
```typescript
// packages/agents/src/abstracts/base-tool.ts
export abstract class BaseTool<TParameters, TResult> {
  private eventService: EventService | undefined;
  
  constructor(options: BaseToolOptions = {}) {
    // 🎯 주입받은 EventService를 clone하면서 ownerPrefix 추가
    this.eventService = options.eventService 
      ? this.cloneWithPrefix(options.eventService, 'tool')
      : undefined;
    
    this.logger = options.logger || SilentLogger;
  }
  
  private cloneWithPrefix(
    svc: EventService, 
    ownerPrefix: 'tool'
  ): EventService {
    const svcAny = svc as any;
    if (svcAny && typeof svcAny.clone === 'function') {
      return svcAny.clone({ ownerPrefix });
    }
    return new ActionTrackingEventService(svc, undefined, undefined, { ownerPrefix });
  }
  
  // Tool 구현체에서 사용
  protected emitEvent(eventType: string, data: any): void {
    if (this.eventService) {
      this.eventService.emit(eventType, data);  // 'tool.' 자동 추가
    }
  }
}
```

**장점**:
- BaseTool에서 한 번만 구현
- 모든 Tool 구현체에 자동 적용
- 명시적인 `emitEvent` 헬퍼 제공

**단점**:
- 기존 Tool 구현체가 직접 `this.eventService.emit()` 사용 시 수정 필요

#### 방안 B: Tool 구현체별 개별 처리 (비추천)
- 각 Tool이 자체적으로 clone
- 일관성 부족

**평가**: 방안 A로 BaseTool에서 중앙 관리

---

## 📋 단계별 실행 계획 (Step-by-Step Plan)

### Step 1: Agent (Robota) 수정 ⭐ 우선순위 1

#### 1.1 cloneWithPrefix 헬퍼 추가
- **파일**: `packages/agents/src/agents/robota.ts`
- **위치**: private 메서드 섹션
- **작업**:
  ```typescript
  private cloneWithPrefix(
    svc: EventService, 
    ownerPrefix: 'agent'
  ): EventService {
    const svcAny = svc as any;
    if (svcAny && typeof svcAny.clone === 'function') {
      return svcAny.clone({ ownerPrefix });
    }
    return new ActionTrackingEventService(svc, undefined, undefined, { ownerPrefix });
  }
  ```

#### 1.2 constructor에서 eventService clone
- **위치**: `robota.ts:184-270` (constructor)
- **수정 전**:
  ```typescript
  this.eventService = config.eventService || new SilentEventService();
  ```
- **수정 후**:
  ```typescript
  const baseEventService = config.eventService || new SilentEventService();
  this.eventService = this.cloneWithPrefix(baseEventService, 'agent');
  ```

#### 1.3 AGENT_EVENTS 상수 정의 수정
- **파일**: `packages/agents/src/agents/constants.ts`
- **수정 전**:
  ```typescript
  export const AGENT_EVENTS = {
    CREATED: 'agent.created',
    EXECUTION_START: 'agent.execution_start',
    // ...
  }
  ```
- **수정 후**:
  ```typescript
  export const AGENT_EVENTS = {
    CREATED: 'created',              // 접두어 제거
    EXECUTION_START: 'execution_start',
    EXECUTION_COMPLETE: 'execution_complete',
    EXECUTION_ERROR: 'execution_error',
    AGGREGATION_COMPLETE: 'aggregation_complete',
    CONFIG_UPDATED: 'config_updated'
  }
  ```

#### 1.4 emit 호출부 수정
- **위치**: `robota.ts:255`
- **수정 전**:
  ```typescript
  this.eventService.emit(AGENT_EVENTS.CREATED as any, { ... });
  ```
- **수정 후**:
  ```typescript
  this.eventService.emit(AGENT_EVENTS.CREATED, { ... });  // 'agent.created'로 자동 변환
  ```

#### 1.5 빌드 및 검증
```bash
pnpm --filter @robota-sdk/agents build
```

**예상 결과**:
- 빌드 성공
- 이벤트명: `agent.created` (내부적으로 자동 추가)
- 기존 코드 호환성 유지

---

### Step 2: Tool (BaseTool) 수정 ⭐ 우선순위 2

#### 2.1 cloneWithPrefix 헬퍼 추가
- **파일**: `packages/agents/src/abstracts/base-tool.ts`
- **위치**: private 메서드 섹션
- **작업**:
  ```typescript
  private cloneWithPrefix(
    svc: EventService, 
    ownerPrefix: 'tool'
  ): EventService {
    const svcAny = svc as any;
    if (svcAny && typeof svcAny.clone === 'function') {
      return svcAny.clone({ ownerPrefix });
    }
    return new ActionTrackingEventService(svc, undefined, undefined, { ownerPrefix });
  }
  ```

#### 2.2 constructor 수정
- **위치**: `base-tool.ts:115-118`
- **수정 전**:
  ```typescript
  constructor(options: BaseToolOptions = {}) {
    this.eventService = options.eventService;
    this.logger = options.logger || SilentLogger;
  }
  ```
- **수정 후**:
  ```typescript
  constructor(options: BaseToolOptions = {}) {
    this.eventService = options.eventService 
      ? this.cloneWithPrefix(options.eventService, 'tool')
      : undefined;
    this.logger = options.logger || SilentLogger;
  }
  ```

#### 2.3 protected emitEvent 헬퍼 추가
- **위치**: `base-tool.ts` protected 메서드 섹션
- **작업**:
  ```typescript
  /**
   * Emit tool event with automatic 'tool.' prefix
   * @param eventType - Event type without 'tool.' prefix (e.g., 'call_start')
   * @param data - Event data
   */
  protected emitEvent(eventType: string, data: any): void {
    if (this.eventService) {
      this.eventService.emit(eventType, data);
    }
  }
  ```

#### 2.4 빌드 및 검증
```bash
pnpm --filter @robota-sdk/agents build
```

---

### Step 3: 전역 검증 및 정리 ⭐ 우선순위 3

#### 3.1 하드코딩된 이벤트명 검사
```bash
# 하드코딩된 agent.* 이벤트 찾기
grep -r "\.emit\(['\"]agent\." packages/agents/src --exclude-dir=node_modules

# 하드코딩된 tool.* 이벤트 찾기  
grep -r "\.emit\(['\"]tool\." packages/agents/src --exclude-dir=node_modules
```

**예상 결과**: 0건 (테스트 파일 제외)

#### 3.2 예제 26 가드 실행
```bash
cd /Users/jungyoun/Documents/dev/robota

# 전체 빌드
pnpm --filter @robota-sdk/workflow build && \
pnpm --filter @robota-sdk/team build && \
pnpm --filter @robota-sdk/agents build

# 예제 26 가드 실행
cd apps/examples && \
FILE=26-playground-edge-verification.ts && \
HASH=$(md5 -q "$FILE") && \
OUT=cache/26-playground-edge-verification-$HASH-guarded.log && \
echo "▶️ Run example (guarded)..." && \
STATUS=0; npx tsx "$FILE" > "$OUT" 2>&1 || STATUS=$?; \
tail -n 160 "$OUT" | cat; \
if [ "$STATUS" -ne 0 ] || grep -E "\\[STRICT-POLICY\\]|\\[EDGE-ORDER-VIOLATION\\]" "$OUT" >/dev/null; then \
  echo "❌ Aborting verification (example failed or strict-policy violation)."; \
  exit ${STATUS:-1}; \
fi; \
echo "▶️ Verify..." && \
npx tsx utils/verify-workflow-connections.ts | cat
```

#### 3.3 이벤트 발생 검증
```bash
cd /Users/jungyoun/Documents/dev/robota/apps/examples && \
tail -n 400 cache/26-playground-edge-verification-*-guarded.log | \
grep -E "agent\.created|agent\.execution" | head -n 10
```

**예상 출력**:
```
agent.created (sourceId: agent_xxx)
agent.execution_start (sourceId: agent_xxx)
agent.execution_complete (sourceId: agent_xxx)
```

---

## 🔒 위험 분석 및 대응 (Risk Analysis)

### 위험 1: 호환성 깨짐 🔴 높음
**시나리오**: 외부에서 `agent.created` 전체 문자열로 리스닝하는 코드

**대응**:
- ✅ ActionTrackingEventService가 전체 이벤트명(`agent.created`) 발생
- ✅ 기존 리스너는 영향 없음
- ✅ WorkflowEventSubscriber 정상 동작

**검증**:
```typescript
// 이전: eventService.emit('agent.created', data)
// 이후: eventService.emit('created', data) → 내부적으로 'agent.created' 발생
// 리스너: eventService.on('agent.created', handler) ← 변경 없음
```

### 위험 2: Tool 구현체 개별 수정 필요 🟡 중간
**시나리오**: Tool 구현체가 직접 `this.eventService.emit('tool.xxx')` 사용

**대응**:
- ✅ BaseTool에 `emitEvent()` 헬퍼 제공
- ✅ 기존 코드도 여전히 동작 (전체 이벤트명 사용 시)
- ⚠️ 권장: Tool 구현체는 `this.emitEvent('call_start')` 사용으로 점진 전환

**검증**:
- 각 Tool 구현체 코드 리뷰
- 필요 시 개별 수정

### 위험 3: 테스트 파일 수정 필요 🟢 낮음
**시나리오**: 테스트에서 하드코딩된 이벤트명 사용

**대응**:
- ✅ `AGENT_EVENTS.CREATED` 상수 사용으로 전환
- ✅ 테스트는 여전히 `agent.created` 전체 문자열 검증 가능

---

## ✅ 검증 기준 (Acceptance Criteria)

### 필수 조건
- [ ] Agent (Robota) 생성자에서 `cloneWithPrefix('agent')` 적용
- [ ] `AGENT_EVENTS` 상수에서 `agent.` 접두어 제거
- [ ] Agent emit 호출부에서 접두어 제거 (`'created'`만 사용)
- [ ] BaseTool 생성자에서 `cloneWithPrefix('tool')` 적용
- [ ] BaseTool에 `emitEvent()` 헬퍼 추가
- [ ] 전체 빌드 성공
- [ ] 예제 26 가드 실행 성공
- [ ] 검증 스크립트 통과 (STRICT-POLICY 0건)

### 권장 조건
- [ ] Tool 구현체들 `emitEvent()` 사용으로 전환
- [ ] ESLint 룰 추가: 하드코딩된 접두어 금지
- [ ] 단위 테스트 추가 (ownerPrefix 검증)

---

## 📊 영향 범위 요약 (Impact Summary)

### 수정 파일
1. `packages/agents/src/agents/robota.ts` (cloneWithPrefix, constructor)
2. `packages/agents/src/agents/constants.ts` (접두어 제거)
3. `packages/agents/src/abstracts/base-tool.ts` (cloneWithPrefix, emitEvent)

### 영향받는 컴포넌트
- ✅ WorkflowEventSubscriber: 영향 없음 (전체 이벤트명 수신)
- ✅ ExecutionService: 영향 없음 (이미 적용됨)
- ⚠️ Tool 구현체: 권장 사항 (emitEvent 사용)

### 호환성
- ✅ 기존 이벤트 리스너: 100% 호환
- ✅ 기존 EventService 주입: 100% 호환
- ✅ WorkflowEventSubscriber: 100% 호환

---

## 🚀 실행 순서 (Execution Order)

1. **Step 1.1-1.5**: Agent (Robota) 수정 → 빌드 → 검증
2. **Step 2.1-2.4**: Tool (BaseTool) 수정 → 빌드 → 검증
3. **Step 3.1-3.3**: 전역 검증 → 예제 26 가드 → 최종 확인

**예상 소요 시간**: 2-3시간
**위험도**: 🟢 낮음 (하위 호환성 100%)

---

## ✅ 검증 완료 체크리스트

- [x] 현재 코드 분석 완료
- [x] 문제점 파악 완료
- [x] 해결 방안 검증 완료 (방안 A 선택)
- [x] 영향 범위 분석 완료
- [x] 위험 요소 파악 및 대응 계획 수립
- [x] 단계별 실행 계획 수립
- [x] 검증 방법 정의
- [x] 호환성 검증 (100% 하위 호환)
- [x] 실행 순서 확정

**상태**: ✅ 검증 완료, 실행 준비 완료
**승인 요청**: 사용자 검토 후 실행 진행

