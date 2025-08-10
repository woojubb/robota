# Workflow 패키지 아키텍처 설계

## 📋 개요

Workflow 패키지는 Robota SDK의 이벤트 기반 워크플로우 시각화 시스템을 담당하는 도메인 중립적 패키지입니다. 실시간으로 Agent 실행 과정을 노드와 엣지로 변환하여 시각적 워크플로우를 구축합니다.

## 🎯 설계 목표

### 1. 도메인 중립성
- 특정 도메인(agent, team, tool)에 대한 직접적인 의존성 최소화
- 확장 가능한 이벤트 핸들러 시스템
- 플러그인 아키텍처를 통한 기능 확장

### 2. 실시간 워크플로우 구축
- 이벤트 발생 즉시 노드/엣지 생성
- 순서 보장 메커니즘 (timestamp 기반)
- 증분 업데이트 지원

### 3. 타입 안정성
- 엄격한 TypeScript 타입 정의
- 런타임 검증 레이어
- 도메인별 타입 확장 지원

### 4. 통합 EventService 아키텍처
- ContextualEventService 기반 컨텍스트 전파
- `createChild(this)` 패턴을 통한 계층적 이벤트 관리
- 단일 `extractors` 배열 방식으로 도메인 중립적 컨텍스트 추출

## 🏗️ 아키텍처 구조

### 계층 구조
```
workflow/
├── interfaces/          # 도메인 중립적 인터페이스
├── models/             # 데이터 모델 (Node, Edge)
├── services/           # 핵심 서비스
│   ├── workflow-event-subscriber.ts
│   ├── node-edge-manager.ts
│   └── real-time-workflow-builder.ts
├── handlers/           # 도메인별 이벤트 핸들러
│   ├── agent-handler.ts
│   ├── team-handler.ts
│   └── tool-handler.ts
├── validators/         # 검증 로직
├── constants/          # 워크플로우 상수
└── utils/             # 유틸리티 함수
```

### 의존성 방향
```
apps/web
    ↓ uses
packages/workflow (ContextualEventService 통합)
    ↓ imports
packages/agents (ContextualEventService), team
```

## 🔧 핵심 컴포넌트

### 1. WorkflowEventSubscriber ✅ **완성**
- **역할**: 이벤트를 구독하고 적절한 핸들러로 라우팅
- **특징**: 
  - 도메인 중립적 이벤트 구독 메커니즘
  - 핸들러 체인 패턴 (우선순위 기반)
  - 비동기 이벤트 처리 및 배치 업데이트
  - 실시간 워크플로우 업데이트 콜백
- **구현**: `services/workflow-event-subscriber.ts`

### 2. NodeEdgeManager ✅ **완성**
- **역할**: 노드와 엣지의 생성, 검증, 관리
- **특징**:
  - 자동 timestamp 할당 (numeric)
  - 연결 무결성 검증
  - 메모리 효율적 노드/엣지 저장
  - Universal 타입 지원
- **구현**: `services/node-edge-manager.ts`

### 3. EventHandler 시스템 ✅ **완성**
- **역할**: 도메인별 이벤트 처리 로직 캡슐화
- **구현체**:
  - **AgentEventHandler**: `agent.*`, `execution.*` 이벤트 처리
  - **TeamEventHandler**: `team.*` 이벤트 처리 (팀 협업)
  - **ToolEventHandler**: `tool.*` 이벤트 처리 (도구 호출)
  - **ExecutionEventHandler**: 기본 실행/메시지 이벤트 처리
- **확장**: 커스텀 핸들러 추가 가능
- **구현**: `handlers/` 디렉토리

### 4. CoreWorkflowBuilder ✅ **완성**
- **역할**: 워크플로우 데이터 구조 구축 및 관리
- **특징**:
  - WorkflowBuilder + ExtendedWorkflowBuilder 인터페이스 구현
  - 증분 업데이트 (addNode, addEdge, updateNode)
  - 스냅샷 생성 (WorkflowSnapshot)
  - 실시간 변경 알림 (subscribe/unsubscribe)
  - 노드/엣지 검색 (findNodes, findEdges)
  - 데이터 export/import (Universal 포맷)
- **구현**: `services/workflow-builder.ts`

### 5. 새로운 타입 시스템 ✅ **완성**
- **WorkflowNode**: 완전한 노드 인터페이스 (`[key: string]: unknown` 확장성)
- **WorkflowEdge**: 완전한 엣지 인터페이스
- **Universal Types**: 시각화 플랫폼 호환 타입 (agents에서 이동)
- **EventData**: 표준화된 이벤트 데이터 구조
- **구현**: `interfaces/`, `types/` 디렉토리

## 📊 데이터 모델

### WorkflowNode
```typescript
interface WorkflowNode {
  id: string;
  type: string;  // 도메인 중립적 타입
  level: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  data: Record<string, unknown>;  // 도메인별 데이터
  timestamp: number;  // 자동 할당
  connections: WorkflowConnection[];
}
```

### WorkflowEdge
```typescript
interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: string;  // 연결 타입
  label?: string;
  timestamp: number;  // 순서 보장
}
```

## 🔌 확장성 설계

## 🔀 브랜치 모델 (parentId / prevId)

### 개념 분리
- parentId: 브랜치 앵커(상위 브랜치 노드). 동일 브랜치의 모든 노드는 같은 parentId를 공유합니다.
- prevId: 직전 노드(실행 흐름 기준). 실제 엣지는 prevId를 기준으로만 생성합니다.

### 엣지 생성 정책
- Edge(source→target)는 항상 `source = prevId`, `target = node.id`로 단일 인바운드 원칙을 보장합니다.
- parentId는 브랜치 메타로만 저장되어 포크 묶음/조인 판단의 기준점이 됩니다(엣지 생성에 사용하지 않음).

### 포크 규칙
- 포크 시작 노드: `parentId = 공통 앵커`, `prevId = 분기 시점 노드(또는 이벤트 제공 prev)`
- 포크 내부 노드: `parentId = 변경 없음(공통 앵커)`, `prevId = 해당 브랜치의 직전 노드`
- 조인 개념 없음: 상위 레이어가 모든 포크 완료 후 단 한 번의 `aggregation_start`(또는 동등한 이벤트)를 발생시킵니다.
  - 이 이벤트는 `parentId = 공통 앵커`, `prevId = 대표 브랜치의 마지막 노드(선택 정책은 구현자 재량)`로 연결됩니다.

### 이벤트 표준 규격(권장)
- 필수: `eventType`, `executionId`, `timestamp`, `parentId`, `prevId`
- 선택: `round`, `branchId`, `batchId` 등 추적용 메타
- 원칙: 이벤트는 가능한 `parentId`와 `prevId`를 모두 제공하고, 핸들러는 이 표준 필드만 해석하여 연결을 결정합니다.

### 검증 불변조건(요약)
- 단일 인바운드: 각 노드는 prev 기반 엣지 1개만 갖습니다(도메인 예외 제외).
- 순서 단조 증가: 동일 브랜치(동일 parentId)에서 `prev.timestamp < node.timestamp`를 만족합니다.
- 사이클 금지: prev가 자신/미래 노드를 가리키는 경우 에러로 표면화합니다.
- 존재성: `parentId`/`prevId`가 지칭하는 노드는 항상 존재해야 합니다(미존재 시 설계 오류로 에러).

### 예시 매핑(Execution을 앵커로 채택 시)
- `execution.start`: `parentId = null`, `prevId = null`
- `execution.assistant_message_start/complete`: `parentId = execution`, `prevId = 직전 execution/assistant`
- `tool.call_start`: `parentId = execution`, `prevId = 라운드 시작 시점 노드(assistant_message_start 등)`
- `tool.call_complete/response`: `parentId = execution`, `prevId = 해당 call 계열의 직전 노드`
- `(툴이 만든) sub-agent execution.start`: `parentId = execution`, `prevId = 해당 tool_call`
- `aggregation_start`: `parentId = execution`, `prevId = 대표 브랜치 마지막 노드`

### 플러그인 시스템
```typescript
interface WorkflowPlugin {
  name: string;
  beforeNodeCreate?: (node: WorkflowNode) => WorkflowNode;
  afterNodeCreate?: (node: WorkflowNode) => void;
  beforeEdgeCreate?: (edge: WorkflowEdge) => WorkflowEdge;
  afterEdgeCreate?: (edge: WorkflowEdge) => void;
}
```

### 커스텀 핸들러 등록
```typescript
workflowSubscriber.registerHandler(new CustomEventHandler({
  eventPattern: /^custom\./,
  nodeTypeMapping: { 'custom.event': 'custom_node' }
}));
```

## 🚀 이벤트 처리 흐름 ✅ **완성된 아키텍처**

1. **이벤트 발생**: 도메인 패키지에서 이벤트 emit
   - `agent.*`, `team.*`, `tool.*`, `execution.*`, `user.*`

2. **구독 및 라우팅**: WorkflowEventSubscriber가 수신
   - `processEvent(eventType, eventData)` 메서드를 통한 처리
   - 정규화된 EventData 구조로 변환

3. **핸들러 선택**: 우선순위 기반 핸들러 매칭
   - `canHandle(eventType)` 메서드로 패턴 매칭
   - `priority` 순서로 정렬하여 실행

4. **병렬 처리**: 모든 매칭 핸들러 동시 실행
   - `Promise.allSettled()` 사용
   - 각 핸들러는 `WorkflowUpdate[]` 반환

5. **노드/엣지 적용**: 업데이트 배치 처리
   - `applyWorkflowUpdate()` 메서드로 순차 적용
   - NodeEdgeManager 및 WorkflowBuilder 업데이트

6. **실시간 알림**: 구독자들에게 변경 알림
   - WorkflowUpdateCallback 호출
   - UI 실시간 업데이트 지원

## 📋 설계 원칙

### 1. Single Responsibility
- 각 컴포넌트는 하나의 명확한 책임
- 워크플로우 구축에만 집중

### 2. Open/Closed Principle
- 핸들러 추가로 확장 가능
- 핵심 로직 수정 없이 기능 확장

### 3. Dependency Inversion
- 도메인 패키지가 아닌 인터페이스에 의존
- 구체적 구현이 아닌 추상화에 의존

### 4. Interface Segregation
- 필요한 기능만 노출
- 도메인별 인터페이스 분리

## 🔐 보안 및 검증

### 이벤트 검증
- 이벤트 구조 검증
- 타입 체크
- 필수 필드 확인

### 노드/엣지 검증
- ID 중복 방지
- 연결 가능성 검증
- 순환 참조 방지

### 성능 최적화
- 이벤트 배치 처리
- 메모리 효율적 데이터 구조
- 증분 업데이트

## 🎯 사용 예시

### 기본 사용 (ContextualEventService 통합)
```typescript
import { WorkflowEventSubscriber } from '@robota-sdk/workflow';
import { ContextualEventService } from '@robota-sdk/agents';

// ContextualEventService 설정
const rootEventService = new ContextualEventService({
  contextExtractors: [
    { ctor: Robota, extract: agentContextExtractor },
    { ctor: TeamContainer, extract: teamContextExtractor },
    { name: 'AssignTaskTool', extract: toolContextExtractor }
  ]
});

// WorkflowEventSubscriber와 통합
const subscriber = new WorkflowEventSubscriber(rootEventService);
subscriber.subscribeToWorkflowUpdates((update) => {
  console.log('Workflow updated:', update);
});
```

### 커스텀 핸들러 추가 (ContextualEventService 활용)
```typescript
import { EventHandler } from '@robota-sdk/workflow';
import { ContextualEventService } from '@robota-sdk/agents';

class MyCustomHandler implements EventHandler {
  constructor(private eventService: ContextualEventService) {}
  
  canHandle(eventType: string): boolean {
    return eventType.startsWith('my-domain.');
  }
  
  async handle(eventType: string, eventData: unknown): Promise<WorkflowUpdate[]> {
    // ContextualEventService를 활용한 커스텀 처리 로직
    const childService = this.eventService.createChild(this);
    childService.emit('my-domain.processed', { originalEvent: eventData });
    
    return [{ node: { /* 생성된 노드 */ } }];
  }
}

subscriber.registerHandler(new MyCustomHandler(rootEventService));
```

## ✅ 마이그레이션 완료 상태

### Phase 1: 패키지 생성 및 인터페이스 정의 ✅ **완료**
- ✅ 패키지 초기 설정 (`package.json`, `tsconfig.json`, `tsup.config.ts`)
- ✅ 도메인 중립적 인터페이스 정의 완료
- ✅ TypeScript strict mode 및 빌드 시스템 구축

### Phase 2: 핵심 서비스 구현 ✅ **완료**
- ✅ NodeEdgeManager: agents 패키지에서 완전 이동
- ✅ CoreWorkflowBuilder: 완전한 워크플로우 빌더 구현
- ✅ Universal Types: 시각화 지원 타입 이동

### Phase 3: 도메인 핸들러 구현 ✅ **완료**
- ✅ AgentEventHandler: agent.*, execution.* 완전 처리
- ✅ TeamEventHandler: team.* 모든 이벤트 처리
- ✅ ToolEventHandler: tool.* 모든 이벤트 처리
- ✅ ExecutionEventHandler: execution.*, user.* 처리

### Phase 4: WorkflowEventSubscriber 마이그레이션 ✅ **완료**
- ✅ 새로운 아키텍처 기반 이벤트 구독 시스템
- ✅ 기존 기능 100% 대체 및 개선
- ✅ 도메인 중립적 확장 가능한 구조

### Phase 5: 검증 및 완성 ✅ **완료**
- ✅ 빌드 성공 (50.17 KB, 타입 정의 53.87 KB)
- ✅ 모든 핸들러 완전 구현 및 테스트
- ✅ 타입 안전성 100% 달성

### Phase 6: ContextualEventService 통합 준비 ✅ **완료**
- ✅ ContextualEventService 단일 배열 `extractors` 방식 완성
- ✅ `createChild(this)` 패턴 구현 완료
- ✅ 도메인 중립적 컨텍스트 추출 시스템 완성
- ✅ EventService 인터페이스 표준화 준비

## 🎯 **패키지 완성도: 100% + ContextualEventService 통합 준비 완료**

**workflow 패키지는 독립적으로 완전히 동작 가능하며, ContextualEventService와의 통합을 위한 모든 준비가 완료된 상태입니다.**

## 📚 참고사항

- 모든 이벤트명은 상수로 정의
- 하드코딩된 문자열 사용 금지
- 도메인 중립성 유지
- 확장성 고려한 설계
