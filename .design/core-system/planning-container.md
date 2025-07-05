# Planning Container: 플래너 통합 관리 시스템

> 이 문서는 [Robota SDK Planning System Overview](./planning-overview.md)의 핵심 구성 요소인 PlannerContainer에 대한 상세 설명입니다.

## 🎯 개요

PlannerContainer는 여러 플래닝 기법을 통합하여 관리하고, 작업 특성에 따라 최적의 플래너를 선택하거나 조합하여 실행하는 중앙 관리 시스템입니다.

## 🏗️ 아키텍처

### 계층 구조
```
📦 PlannerContainer (통합 관리)
├── 🎯 Planner Selection Engine (플래너 선택)
├── 🔄 Execution Strategy Manager (실행 전략)
├── 📊 Session Management (세션 관리)
└── 🛠️ Resource Coordination (리소스 조정)
     ↓
📦 Individual Planners (개별 플래너들)
├── CAMELPlanner
├── ReActPlanner
├── ReflectionPlanner
└── SequentialPlanner
```

## 📋 핵심 기능

### 1. 플래너 등록 및 관리

```typescript
import { PlannerContainer } from '@robota-sdk/planning';
import { AgentFactory } from '@robota-sdk/agents';

// AgentFactory 주입
const agentFactory = new AgentFactory({
  aiProviders: { 'primary': primaryProvider },
  currentProvider: 'primary'
});

// PlannerContainer 생성
const container = new PlannerContainer(agentFactory, {
  maxConcurrentSessions: 5,
  defaultTimeout: 300000, // 5분
  enableSessionPersistence: true
});

// 플래너 등록
container.registerPlanner('camel', new CAMELPlanner(agentFactory));
container.registerPlanner('react', new ReActPlanner(agentFactory));
container.registerPlanner('reflection', new ReflectionPlanner(agentFactory));
container.registerPlanner('sequential', new SequentialPlanner(agentFactory));
```

### 2. 실행 전략

#### 2.1 Best-First 전략
```typescript
// 작업에 가장 적합한 플래너 자동 선택
const result = await container.executeBestFirst(task, {
  selectionCriteria: {
    taskComplexity: 'moderate',
    qualityRequirement: 'high',
    timeConstraint: 'flexible'
  }
});
```

#### 2.2 Sequential 전략
```typescript
// 여러 플래너를 순차적으로 실행
const result = await container.executeSequential(task, {
  plannerOrder: ['camel', 'reflection'],
  passResults: true, // 이전 결과를 다음 플래너에 전달
  stopOnSuccess: false // 모든 플래너 실행
});
```

#### 2.3 Parallel 전략
```typescript
// 여러 플래너를 병렬로 실행하고 결과 통합
const result = await container.executeParallel(task, {
  planners: ['camel', 'react', 'sequential'],
  aggregationStrategy: 'best-quality', // 'consensus', 'weighted-average'
  maxConcurrency: 3
});
```

#### 2.4 Fallback 전략
```typescript
// 실패 시 다음 플래너로 자동 전환
const result = await container.executeWithFallback(task, {
  plannerOrder: ['camel', 'react', 'sequential'],
  fallbackConditions: {
    onTimeout: true,
    onError: true,
    onLowQuality: true
  }
});
```

## 🧠 플래너 선택 엔진

### 1. 규칙 기반 선택

```typescript
// 작업 특성에 따른 플래너 선택 규칙
const selectionRules = {
  // 구조화된 협업이 필요한 경우
  structuredCollaboration: {
    condition: (task) => task.includes('팀') || task.includes('협업'),
    planner: 'camel',
    priority: 'high'
  },
  
  // 탐색적 문제해결이 필요한 경우
  exploratoryProblemSolving: {
    condition: (task) => task.includes('분석') || task.includes('조사'),
    planner: 'react',
    priority: 'high'
  },
  
  // 고품질 결과가 중요한 경우
  qualityFocused: {
    condition: (context) => context.qualityRequirement === 'premium',
    planner: 'reflection',
    priority: 'medium'
  },
  
  // 단순한 순차 작업인 경우
  sequentialTask: {
    condition: (task) => task.includes('단계') || task.includes('순서'),
    planner: 'sequential',
    priority: 'low'
  }
};
```

### 2. LLM 기반 지능형 선택

```typescript
// LLM을 활용한 플래너 선택
const intelligentSelection = async (task: string, context: PlanningContext) => {
  const analysisPrompt = `
    다음 작업을 분석하고 최적의 플래닝 전략을 선택하세요:
    
    작업: ${task}
    컨텍스트: ${JSON.stringify(context)}
    
    사용 가능한 플래너:
    - CAMEL: 역할 기반 협업, 구조화된 팀 작업에 적합
    - ReAct: 추론+행동 반복, 탐색적 문제해결에 적합
    - Reflection: 품질 개선 중심, 고품질 결과가 필요한 경우
    - Sequential: 단계별 처리, 명확한 절차가 있는 작업
    
    선택 기준:
    1. 작업의 복잡성
    2. 협업 필요성
    3. 품질 요구사항
    4. 시간 제약
    
    결과를 JSON 형태로 반환하세요.
  `;
  
  const selection = await this.metaLLM.analyze(analysisPrompt);
  return this.parseSelection(selection);
};
```

## 📊 세션 관리

### 1. 세션 생성 및 추적

```typescript
// 세션 메타데이터 타입 (Semantic naming 준수)
interface PlanningSessionMetadata {
  sessionId: string;
  taskDescription: string;
  selectedPlanner: string;
  startTime: Date;
  estimatedDuration: number;
  qualityRequirement: 'basic' | 'standard' | 'premium';
  resourceAllocation: PlanningResourceAllocation;
}

// 세션 생성
const session = await container.createSession({
  task: "복잡한 비즈니스 전략 수립",
  planner: 'camel',
  priority: 'high',
  timeout: 600000 // 10분
});

// 세션 상태 추적
const status = container.getSessionStatus(session.id);
console.log(`세션 ${session.id}: ${status.state} (진행률: ${status.progress}%)`);
```

### 2. 세션 상태 관리

```typescript
enum SessionState {
  PLANNING = 'planning',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

// 세션 상태 전환
const sessionManager = {
  async transitionState(sessionId: string, newState: SessionState) {
    const session = this.getSession(sessionId);
    const validTransitions = this.getValidTransitions(session.state);
    
    if (validTransitions.includes(newState)) {
      session.state = newState;
      session.lastUpdated = new Date();
      await this.persistSession(session);
      this.emitStateChange(sessionId, newState);
    }
  }
};
```

## 🛠️ 리소스 조정

### 1. 에이전트 풀 관리

```typescript
// AgentFactory 확장 기능 활용한 리소스 관리
class ResourceCoordinator {
  constructor(private agentFactory: AgentFactory) {}
  
  async allocateResources(
    plannerType: string, 
    sessionRequirements: PlanningSessionRequirements
  ): Promise<PlanningResourceAllocation> {
    // 플래너별 리소스 요구사항 분석
    const resourceNeeds = this.analyzeResourceNeeds(plannerType, sessionRequirements);
    
    // AgentFactory 리소스 상태 확인
    const availability = await this.agentFactory.checkResourceAvailability(resourceNeeds);
    
    if (!availability.sufficient) {
      throw new ResourceExhaustionError(
        `Insufficient resources for ${plannerType}: ${availability.reason}`
      );
    }
    
    // 리소스 예약
    const allocation = await this.agentFactory.reserveResources(resourceNeeds);
    
    return {
      sessionId: sessionRequirements.sessionId,
      allocatedMemory: allocation.memory,
      allocatedTokens: allocation.tokens,
      maxConcurrentAgents: allocation.concurrency,
      reservationId: allocation.id
    };
  }
}
```

### 2. 충돌 방지 및 최적화

```typescript
// 세션간 리소스 충돌 방지
const conflictResolver = {
  async resolveConflicts(
    sessions: PlanningSession[]
  ): Promise<PlanningResourceOptimization> {
    const conflicts = this.detectConflicts(sessions);
    const optimizations: ResourceOptimization[] = [];
    
    for (const conflict of conflicts) {
      // 우선순위 기반 리소스 재할당
      const resolution = await this.priorityBasedReallocation(conflict);
      optimizations.push(resolution);
    }
    
    return {
      resolvedConflicts: conflicts.length,
      optimizations,
      totalResourceSaved: this.calculateSavings(optimizations)
    };
  }
};
```

## 🔧 편의 함수

### createPlanner 함수

```typescript
// 간편한 PlannerContainer 생성
export function createPlanner(options: PlannerContainerOptions): PlannerContainer {
  const {
    agentFactory,
    planners = [],
    defaultStrategy = 'best-first',
    maxConcurrentSessions = 3,
    enableSessionPersistence = false,
    debug = false
  } = options;
  
  // AgentFactory 검증
  if (!agentFactory) {
    throw new ConfigurationError('AgentFactory is required');
  }
  
  // PlannerContainer 생성
  const container = new PlannerContainer(agentFactory, {
    maxConcurrentSessions,
    enableSessionPersistence,
    debug
  });
  
  // 플래너 등록
  planners.forEach(planner => {
    container.registerPlanner(planner.name, planner.instance);
  });
  
  return container;
}
```

## 🎯 실제 사용 예제

### 종합적인 Planning 시스템 구성

```typescript
import { createPlanner } from '@robota-sdk/planning';
import { AgentFactory } from '@robota-sdk/agents';

// 1. AgentFactory 설정
const agentFactory = new AgentFactory({
  aiProviders: { 'primary': primaryProvider },
  currentProvider: 'primary',
  commonTools: ['web_search', 'calculator', 'file_manager']
});

// 2. 플래너들 초기화
const planners = [
  { name: 'camel', instance: new CAMELPlanner(agentFactory) },
  { name: 'react', instance: new ReActPlanner(agentFactory) },
  { name: 'reflection', instance: new ReflectionPlanner(agentFactory) },
  { name: 'sequential', instance: new SequentialPlanner(agentFactory) }
];

// 3. Planning Container 생성
const planner = createPlanner({
  agentFactory,
  planners,
  defaultStrategy: 'best-first',
  maxConcurrentSessions: 5,
  debug: true
});

// 4. 다양한 실행 전략 활용
const results = await Promise.all([
  planner.execute("시장 조사 보고서 작성", 'best-first'),
  planner.execute("기술 문서 작성", 'sequential'),
  planner.execute("창의적 아이디어 생성", 'parallel')
]);
```

## 📚 관련 문서

### 코어 시스템
- [Planning System Overview](./planning-overview.md) - 전체 시스템 개요
- [AgentFactory 확장 전략](./agentfactory-expansion.md) - 에이전트 생성 엔진

### 플래너별 문서
- [CAMEL Planner](../planners/camel-planner.md) - 역할 기반 협업
- [ReAct Planner](../planners/react-planner.md) - 추론+행동 반복
- [Reflection Planner](../planners/reflection-planner.md) - 품질 개선 중심
- [Sequential Planner](../planners/sequential-planner.md) - 단계별 처리

### 구현 가이드
- [구현 로드맵](../implementation/implementation-roadmap.md) - 개발 계획
- [사용 예제](../implementation/usage-examples.md) - 실제 사용 사례 