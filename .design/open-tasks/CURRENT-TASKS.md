# 현재 진행 작업 (1-2주 목표)

> 즉시 실행해야 할 핵심 작업들입니다. 우선순위 순으로 정렬되어 있습니다.

## 📅 업데이트: 2025-10-16

---

## 🔥 Priority 1: Agent Event Normalization (진행중)

### 완료된 단계
- [x] 단계 1: Agent가 스스로 올바른 이벤트 emit 보장
- [x] 단계 2: Agent.created에서 Agent 노드 생성
- [x] 단계 4: Tool 핸들러의 Agent 노드 중복 생성 방지
- [x] 단계 5: 도구측 대리 이벤트 발행 제거
- [x] 단계 6: 예제 26 동작/데이터 동등성 확인
- [x] 단계 7: 최종 정리 (Tool 핸들러 분기 삭제)

### 남은 작업

#### 단계 3: execution_start 상태 전이 우선 (하위 호환)
- [ ] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `agent.execution_start` 수신 시:
    - [ ] 기존 Agent 노드 있으면 status=running 등 상태만 갱신
    - [ ] 기존 Agent 노드 없을 때만 "임시 생성" (하위 호환용)
- [ ] 빌드/가드/검증 실행
- [ ] Agent 노드 수 점검(중복 증가 없음)

#### 단계 6.5: 단일 전환 단계 (Decision Gate)
- [ ] Agent 핸들러: `agent.execution_start`는 상태 전이만 (노드 생성 절대 금지)
- [ ] 단계 3의 "없을 때만 임시 생성" 하위호환 로직 완전 제거
- [ ] 팀/툴 발행자: `tool.agent_execution_started` emit 완전 제거
- [ ] 상수 제거: `packages/team/src/events/constants.ts`
- [ ] 빌드/가드/검증 (원샷 검증)

#### 단계 6.6: Fork/Join round2 thinking 연결 교정
- [ ] `packages/workflow/src/handlers/agent-event-handler.ts`
  - [ ] `execution.assistant_message_start`에서 연결 소스 결정 규칙 교정
  - [ ] 동일 `rootExecutionId` 내 최신 thinking 노드 찾기 (Path-Only)
  - [ ] `tool_result` 중 `parentThinkingNodeId` 일치하면 `analyze` 엣지
  - [ ] 미발견 시 `user_message → thinking` (processes)
- [ ] 빌드/가드/검증
- [ ] round2 연결 검증: `tool_result → thinking_round2 (analyze)`

#### 단계 8: Subscriber Path Map Reader (선택, 우선순위 낮음)
- [ ] `PathMapReader` 객체 설계 (읽기 전용)
- [ ] 명시 필드만으로 인덱스 구축
- [ ] Agent 핸들러 등에 적용
- [ ] `getAllNodes()` 직접 스캔과 결과 동등성 검증

#### 단계 9: base-* → abstract-* 마이그레이션 (신규)
- [ ] 1차 스캔: `packages/agents/src/abstracts/base-*.ts` 전수 조사 후 사용 빈도 낮은 순으로 우선순위 확정<br/>(후보: `base-plugin.ts`, `base-module.ts`, `base-executor.ts`, `base-ai-provider.ts`, `base-tool-manager.ts`, `base-workflow-runner.ts`)
- [ ] 파일별 계획 수립: 
  - [ ] `abstract-*.ts` 신규 생성 + 파일 상단에 “ABSTRACT CLASS” 주석 추가
  - [ ] `DEFAULT_ABSTRACT_LOGGER` 기본값 적용, 추상 타입만 참조하도록 점검
  - [ ] EventService, ownerPrefix, DIP 위반 여부 코드 리뷰
- [ ] 참조 교체 단계:
  - [ ] 관련 import/타입을 `abstract-*`로 전환 (Path-Only 검증)
  - [ ] 예제/서비스에서 `ActionTrackingEventService` 직접 참조 금지 확인
- [ ] 품질 게이트:
  - [ ] `pnpm --filter @robota-sdk/agents build`
  - [ ] `cd apps/examples && npx tsx 10-agents-basic-usage.ts` (로그 가드 규칙 준수)
  - [ ] 필요한 경우 Guarded Example 26 재검증
  - [ ] `.design/open-tasks/CURRENT-TASKS.md` 체크박스 `[x]` 업데이트
- [ ] `base-*` 파일 제거: 모든 참조 교체/빌드 통과 후 개별 파일 삭제
- [ ] 로그/문서: 변경된 추상 클래스 목록과 진행 현황을 CURRENT-TASKS에 주기적으로 반영
- [x] 1차 완료 항목: `base-plugin.ts → abstract-plugin.ts` (Plugins manager & 모든 plugin 구현체 `AbstractPlugin` 상속 전환, guard 빌드/예제 통과)
- [x] 2차 완료 항목: `base-module.ts → abstract-module.ts`
  - [x] `base-module.ts` 구조/의존성 분석 및 import 사용처 목록화 (`Robota`, module registries 등)
  - [x] `packages/agents/src/abstracts/abstract-module.ts` 신규 생성 + 상단 "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 기본 주입
  - [x] `ModuleExecutionContext`, `ModuleStats` 등 기존 타입/인터페이스를 그대로 이전하고, 클래스명 `AbstractModule`로 명확화
  - [x] 모든 구현/매니저에서 `BaseModule` import를 `AbstractModule`로 전환, 타입 정의(`AgentConfig.modules`) 업데이트
  - [x] `base-module.ts`는 임시 re-export 스텁 + "안쓰는 것이니 차후에 삭제 필요" 주석만 남기고 최종 삭제 전까지 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts` 로그 가드 실행 (필요 시 26번 예제 가드 준비)
  - [x] 문서 업데이트 및 체크박스 반영 후 다음 `base-*` 대상 선정
- [x] 3차 완료 항목: `base-executor.ts → abstract-executor.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (`ExecutionService`, executor registry 등)
  - [x] `abstract-executor.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 기본값 적용
  - [x] Executor 추상 인터페이스/타입을 그대로 이전하고 DIP 위반 여부 재검토
  - [x] 모든 구현부에서 `BaseExecutor` import를 `AbstractExecutor`로 전환
  - [x] 기존 파일은 임시 re-export 스텁으로 유지, 최종 삭제 전까지 "안쓰는 것이니..." 주석 부착
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 4차 완료 항목: `base-ai-provider.ts → abstract-ai-provider.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (AIProviders 매니저, provider 구현체 등)
  - [x] `abstract-ai-provider.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 기본값 적용
  - [x] Provider 공용 타입/메서드를 그대로 이전하고 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseAIProvider`/`BaseProvider` import를 `AbstractAIProvider`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석만 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`, provider별 build(OpenAI/Google/Anthropic)
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [ ] 5차 진행 예정: `base-tool-manager.ts → abstract-tool-manager.ts`
  - [ ] (파일 미존재) 현재 `tool-manager.ts`가 직접 구현되어 있어 `base-tool-manager.ts` 없음 → 참고용으로 기록만 유지
  - [ ] 향후 필요 시 tool manager 추상화 범위 정의
- [x] 6차 완료 항목: `base-provider.ts → abstract-provider.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Provider registry/manager 등)
  - [x] `abstract-provider.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] Provider 베이스 메서드/상태 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseProvider` import를 `AbstractProvider`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 7차 완료 항목: `base-workflow-converter.ts → abstract-workflow-converter.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Workflow converter 구현체 등)
  - [x] `abstract-workflow-converter.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 헬퍼/통계/검증 메서드 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseWorkflowConverter` import를 `AbstractWorkflowConverter`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 8차 완료 항목: `base-workflow-validator.ts → abstract-workflow-validator.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Workflow validator 구현체 등)
  - [x] `abstract-workflow-validator.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 헬퍼/통계/룰 관리 로직 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseWorkflowValidator` import를 `AbstractWorkflowValidator`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 9차 완료 항목: `base-visualization-generator.ts → abstract-visualization-generator.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (Mermaid generator 등)
  - [x] `abstract-visualization-generator.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 템플릿 메서드/헬퍼 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseVisualizationGenerator` import를 `AbstractVisualizationGenerator`로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 10차 완료 항목: `base-layout-engine.ts → abstract-layout-engine.ts`
  - [x] 사용 빈도 및 import 의존성 조사 (layout engine 구현체 등)
  - [x] `abstract-layout-engine.ts` 신규 생성 + "ABSTRACT CLASS" 주석, `DEFAULT_ABSTRACT_LOGGER` 적용
  - [x] 공용 템플릿/통계 로직 이전 및 DIP 준수 여부 검토
  - [x] 모든 구현부에서 `BaseLayoutEngine` import를 `AbstractLayoutEngine`으로 전환
  - [x] 기존 파일은 임시 re-export 스텁 + "안쓰는 것이니..." 주석 유지
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 다음 대상 선정
- [x] 11차 완료 항목: `base-tool.ts → abstract-tool.ts`
  - [x] 기존 `abstract-tool.ts` 구조 재검토, "ABSTRACT CLASS" 주석 및 `DEFAULT_ABSTRACT_LOGGER` 기본 주입 정책 위반 여부 점검
  - [x] `BaseTool` import 사용처 전수 조사 (`FunctionTool`, `MCPTool`, `Robota`, Playground executor 등) 후 `AbstractTool`로 명시 전환 여부 확인
  - [x] `base-tool.ts`가 재-export 스텁(`안쓰는 것이니...`) 형태로만 남아있음을 검증하고 불필요 로직 제거 여부 재확인
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 및 다음 대상(Manager/Agent)으로 진행
- [x] 12차 완료 항목: `base-manager.ts → abstract-manager.ts`
  - [x] `AbstractManager`(초기 버전) 기능 점검 후 `BaseManager` 잔여 구현 제거 및 재-export 스텁화
  - [x] `Tools`, `Plugins`, `AIProviders`, `ModuleRegistry` 등 매니저 구현에서 `AbstractManager` 상속 여부 확인
  - [x] `base-manager.ts` 상단 "안쓰는 것이니..." 주석 유지 + 재-export만 남도록 정리
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 업데이트 후 Agent 단계로 이동
- [x] 13차 완료 항목: `base-agent.ts → abstract-agent.ts`
  - [x] `packages/agents/src/abstracts/abstract-agent.ts` 신규 생성, "ABSTRACT CLASS" 주석 및 기존 공용 로직 이전
  - [x] `Robota` 및 관련 테스트(`robota.test.ts`)를 `AbstractAgent` 기반으로 업데이트하고 DIP 위반 여부 점검
  - [x] `base-agent.ts`는 재-export 스텁 + "안쓰는 것이니..." 주석으로 축소, 향후 삭제 준비
  - [x] 검증: `pnpm --filter @robota-sdk/agents build`, `apps/examples && npx tsx 10-agents-basic-usage.ts`
  - [x] CURRENT-TASKS 체크박스 반영 및 남은 Agent Event Normalization 작업 재정비


### 검증 명령어
```bash
pnpm --filter @robota-sdk/workflow build && \
pnpm --filter @robota-sdk/team build && \
pnpm --filter @robota-sdk/agents build && \
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

---

## 🔧 Priority 2: Fork/Join Path-Only 마무리

### A-1. ExecutionService path 자동 주입/검증 강화
- [ ] `packages/agents/src/services/execution-service.ts`
  - [ ] emit 전 path 검증 로직 추가
  - [ ] clone tail(required) 누락 시 즉시 throw
  - [ ] 검증 에러 메시지 표준화

### A-2. WorkflowState 경량화
- [ ] `packages/workflow/src/services/workflow-state.ts`
  - [ ] 보류/임시 큐/배리어 관련 상태·API 제거
  - [ ] Path-Only 원칙에 맞게 단순화

### A-3. 이벤트 소유권 정비
**목표**: 이벤트 접두어를 원천적으로 보호하여 잘못된 소유권 사용 방지

> **중요**: 접두어 자동 부착/검증은 `ActionTrackingEventService` 같이 `EventService`를 확장한 구현에서만 제공된다. `EventService` 인터페이스의 기본 기능으로 간주하지 말고, Robota/ExecutionService/Tool 구현에서 반드시 이 확장 서비스를 주입하거나 clone하여 사용해야 한다. 기본 EventService를 직접 사용할 경우에는 접두어 검증이 수행되지 않으므로, 모든 emit 지점은 ownerPrefix 주입이 된 ActionTrackingEventService 인스턴스를 사용하도록 계획에 포함한다.

#### 현재 문제점
```typescript
// ❌ 현재: 어디서든 execution.* 이벤트를 발생시킬 수 있음
someService.emit('execution.start', data);  // 잘못된 소유권
toolService.emit('execution.complete', data);  // 잘못된 소유권
```

#### 해결 방안: Prefix Injection via Clone Pattern
**주입(Injection) 패턴 기반**: EventService를 외부에서 주입받고, clone 시 `ownerPrefix` 추가

```typescript
// 1️⃣ Robota Agent 생성 - 외부에서 EventService 주입
const agent = new Robota({
  name: 'MyAgent',
  eventService: workflowEventSubscriber,  // 외부에서 생성된 EventService 주입
  // ...
});

// 2️⃣ ExecutionService - 주입받은 EventService를 clone하면서 ownerPrefix 추가
class ExecutionService {
  constructor(
    aiProviders: AIProviderManagerInterface,
    tools: ToolManagerInterface,
    conversationHistory: ConversationHistory,
    eventService?: EventService,  // ✅ 외부에서 주입받음
    executionContext?: ToolExecutionContext
  ) {
    this.baseEventService = eventService || new SilentEventService();
    
    // 🎯 핵심: clone 시 ownerPrefix 주입
    const maybeClone = (svc: EventService, ownerPrefix: 'execution' | 'tool'): EventService => {
      const svcAny = svc as any;
      if (svcAny && typeof svcAny.clone === 'function') {
        // clone 메서드가 있으면 ownerPrefix와 함께 clone
        return svcAny.clone({ ownerPrefix, executionContext });
      }
      // 없으면 ActionTrackingEventService로 감싸서 ownerPrefix 주입
      return new ActionTrackingEventService(svc, undefined, executionContext, { ownerPrefix });
    };
    
    // execution.* 전용 EventService
    this.execEventService = maybeClone(this.baseEventService, 'execution');
    // tool.* 전용 EventService  
    this.toolEventService = maybeClone(this.baseEventService, 'tool');
  }
  
  async execute() {
    // 접두어 없이 나머지 부분만 사용
    this.execEventService.emit('start', data);      // 내부적으로 'execution.start'로 변환
    this.execEventService.emit('complete', data);   // 내부적으로 'execution.complete'로 변환
  }
}

// 3️⃣ Tool 구현체 - 동일 패턴 적용
class MyTool extends BaseTool {
  constructor(eventService?: EventService) {
    const toolEventService = eventService 
      ? eventService.clone?.({ ownerPrefix: 'tool' }) || eventService
      : new SilentEventService();
    
    this.eventService = toolEventService;
  }
  
  async execute() {
    // 접두어 없이 나머지 부분만 사용
    this.eventService.emit('call_start', data);     // 내부적으로 'tool.call_start'로 변환
    this.eventService.emit('call_complete', data);  // 내부적으로 'tool.call_complete'로 변환
  }
}
```

#### ActionTrackingEventService 내부 구현 (이미 완료)
```typescript
// packages/agents/src/services/event-service.ts
export class ActionTrackingEventService implements EventService {
  private readonly ownerPrefix?: string;
  private readonly strictPrefix: boolean;

  constructor(
    baseEventService?: EventService, 
    logger?: SimpleLogger, 
    executionContext?: ToolExecutionContext, 
    options?: { ownerPrefix?: string; strictPrefix?: boolean }
  ) {
    this.baseEventService = baseEventService || new SilentEventService();
    this.ownerPrefix = options?.ownerPrefix;
    this.strictPrefix = options?.strictPrefix ?? true;
  }

  emit(eventType: string, data: any): void {
    let fullEventType = eventType;
    
    // 🎯 접두어 자동 추가
    if (this.ownerPrefix && !eventType.includes('.')) {
      fullEventType = `${this.ownerPrefix}.${eventType}`;
    }
    
    // 🎯 접두어 검증 (다른 접두어 사용 시 에러)
    if (this.ownerPrefix && this.strictPrefix && eventType.includes('.')) {
      const [prefix] = eventType.split('.');
      if (prefix !== this.ownerPrefix) {
        throw new Error(
          `[EVENT-PREFIX-VIOLATION] Cannot emit '${eventType}'. ` +
          `This EventService owns '${this.ownerPrefix}.*' events only.`
        );
      }
    }
    
    // 실제 이벤트 발생
    this.baseEventService.emit(fullEventType, data);
  }
  
  // clone 메서드 지원
  clone(options?: { ownerPrefix?: string; executionContext?: ToolExecutionContext }): EventService {
    return new ActionTrackingEventService(
      this.baseEventService,
      this.logger,
      options?.executionContext || this.executionContext,
      { 
        ownerPrefix: options?.ownerPrefix || this.ownerPrefix,
        strictPrefix: this.strictPrefix
      }
    );
  }
}
```

#### 주요 흐름
```
1. 최상위: WorkflowEventSubscriber (모든 이벤트 수신)
           ↓ (주입)
2. Robota: eventService로 받음
           ↓ (주입)
3. ExecutionService: 받은 eventService를 clone
   - execEventService = clone({ ownerPrefix: 'execution' })
   - toolEventService = clone({ ownerPrefix: 'tool' })
           ↓
4. 각 서비스에서 emit 시:
   - this.execEventService.emit('start', data) → 'execution.start'
   - this.toolEventService.emit('call_start', data) → 'tool.call_start'
```

#### 장점
1. **원천 차단**: clone 시점에 접두어가 고정되어 변경 불가
2. **주입 패턴 유지**: 기존 DI 구조를 해치지 않음
3. **간결한 코드**: emit 시 `start` 대신 `execution.start` 반복 불필요
4. **명확한 소유권**: 각 서비스가 자신의 접두어만 사용
5. **Workflow 추적 호환**: WorkflowEventSubscriber가 모든 이벤트 수신 가능

#### 구현 체크리스트
- [x] `ActionTrackingEventService`에 `ownerPrefix` 옵션 추가 (이미 완료)
- [x] `emit()` 메서드에서 접두어 자동 추가 로직 구현 (이미 완료)
- [x] 잘못된 접두어 사용 시 에러 throw (이미 완료)
- [x] `ExecutionService`에 `maybeClone` 패턴 적용 (이미 완료)
- [ ] `Agent` (Robota)에서 자체 이벤트 발생 시 `ownerPrefix: 'agent'` 적용
- [ ] `Tool` 기본 클래스에 `ownerPrefix: 'tool'` 패턴 적용
- [ ] 기존 emit 호출부 수정 (접두어 제거)
  ```typescript
  // Before
  this.execEventService.emit('execution.start', data);
  
  // After  
  this.execEventService.emit('start', data);  // 'execution.' 자동 추가
  ```
- [ ] 타 모듈의 `execution.*` emit 전역 검사 및 제거
- [ ] ESLint 룰 추가: "하드코딩된 접두어 사용 금지"
- [ ] 단위 테스트 작성 (접두어 검증, 에러 케이스)
- [ ] 통합 테스트: 예제 26 가드 실행 및 검증

#### 참고 코드 위치
- `packages/agents/src/services/execution-service.ts` (line 142-154): maybeClone 구현
- `packages/agents/src/services/event-service.ts` (line 283-299): ActionTrackingEventService 생성자
- `packages/agents/src/agents/robota.ts` (line 514-520): EventService 주입

### A-4. Continued Conversation Path-Only
- [ ] ExecutionService(user_message) path = [rootId, executionId] 보장
- [ ] `response(last) → user_message(continues) → thinking(processes)` 시퀀스
- [ ] 예제 27 재검증

---

## 🎨 Priority 3: Playground Tools DnD

### B-1. 브릿지/레지스트리 보강
- [ ] `apps/web/src/lib/playground/robota-executor.ts`
  - [ ] executor 에러를 UI 표준 에러로 변환

### B-2. Tools 목록 관리(UI)
- [ ] `ToolItem` 타입 선언 및 유효성 체크
- [ ] `toolItems` 상태 초기값 및 setter
- [ ] 사이드바 카드 리스트 렌더 (스크롤/접근성)
- [ ] `+ Add Tool` 모달 (name, description)
- [ ] ID 생성 규칙 (kebab + 6자리 토큰) 및 중복 방지
- [ ] 추가 후 정렬 및 포커스 이동
- [ ] 삭제/이름변경 (선택)

### B-3. DnD 상호작용 보강
- [ ] 빠른 연속 드롭 디바운스
- [ ] 중복 드롭 시 UI 유지

### B-4. UI 오버레이 상태 (addedToolsByAgent)
- [ ] 타입 정의: `AddedToolsByAgent = Record<AgentId, string[]>`
- [ ] 상위 페이지 상태 `addedToolsByAgent` 구현
- [ ] `onToolDrop(agentId, tool)` 집합 추가
- [ ] `WorkflowVisualization`에 props 전달
- [ ] `AgentNode` 렌더 시 합집합 뱃지 표시
- [ ] 병합 규칙: SDK 도구 ∪ 오버레이 도구
- [ ] 성공/실패 토스트 표준화

### B-5. 수용 기준
- [ ] 드래그 시 Agent 노드 시각적 반응
- [ ] 드롭 시 툴 뱃지 즉시 추가 (중복 없음)
- [ ] Workflow Path-Only 보존

---

## 🗑️ Priority 4: Pricing 기능 제거 (무료 플랫폼 전환)

### Phase 1: Pricing UI 제거
- [ ] `/pricing` 라우트 및 관련 컴포넌트 삭제
- [ ] Header/Navigation에서 Pricing 링크 제거
- [ ] 모든 "Upgrade" 프롬프트 및 버튼 제거
- [ ] Dashboard에서 Plan 정보 섹션 제거

### Phase 2: Billing 로직 제거
- [ ] `/api/v1/billing/*`, `/api/v1/subscriptions/*` 엔드포인트 삭제
- [ ] `types/billing.ts` 및 관련 타입 제거
- [ ] `lib/billing/plans.ts`에서 paid plan 제거 (free만 유지)
- [ ] Firebase billing 컬렉션 사용 중단

### Phase 3: 무료 크레딧 시스템 전환
- [ ] `UserCredit` 타입 단순화
- [ ] Plan 기반 → 크레딧 기반 제한 로직 변경
- [ ] Usage Dashboard "Plan limits" → "Free usage limits"
- [ ] 제한 도달 시 친화적 메시지 (업그레이드 언급 제거)

### Phase 4: 설정 정리
- [ ] Stripe 관련 환경 변수 제거
- [ ] API 문서에서 billing 엔드포인트 제거
- [ ] 사용하지 않는 billing 타입 및 테스트 정리

---

## ✅ 성공 기준

### Agent Event Normalization
- [ ] Agent 노드 생성은 오직 `agent.created`
- [ ] `agent.execution_start`는 상태 전이만
- [ ] `tool.agent_execution_started` 완전 제거
- [ ] 예제 26 가드/검증 통과
- [ ] 하드코딩 문자열 없음 (상수만 사용)
- [ ] Fork/Join 다중 depth Path-Only 연결

### Fork/Join Path-Only
- [ ] `groupId`/`branchId`/`responseExecutionId` 제거
- [ ] WorkflowState 경량화 완료
- [ ] 이벤트 소유권 ESLint 룰 적용
- [ ] Continued Conversation 예제 27 통과

### Tools DnD
- [ ] 드래그앤드롭 동작 안정적
- [ ] 툴 뱃지 정확히 표시
- [ ] 중복/간섭 없음
- [ ] Path-Only 보존

### Pricing 제거
- [ ] UI에서 모든 pricing/billing 언급 제거
- [ ] API 엔드포인트 정리
- [ ] 무료 크레딧 시스템 동작
- [ ] Stripe 의존성 제거

---

## 📝 작업 진행 기록

**시작일**: 2025-10-16
**예상 완료**: 2025-10-30 (2주)

**주요 이슈**:
- Agent Event Normalization 85% 완료
- Fork/Join Path-Only 기초 완성, 정리 필요
- Tools DnD UI 작업 대기
- Pricing 제거는 독립적으로 진행 가능

**다음 단계**:
1. Agent Event Normalization 단계 3, 6.5, 6.6 완료
2. Fork/Join Path-Only 검증 스크립트 자동화
3. Tools DnD UI 구현 시작
4. Pricing 제거 (병렬 작업 가능)

