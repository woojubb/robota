# Planning 시스템 사용 예제

> 이 문서는 Robota SDK Planning 시스템의 다양한 실제 사용 시나리오와 예제 코드를 제공합니다.

## 🚀 기본 사용법

### 1. 간단한 Planning 시작하기

```typescript
import { createPlanner } from '@robota-sdk/planning';
import { AgentFactory } from '@robota-sdk/agents';
import { CAMELPlanner } from '@robota-sdk/planning-camel';

// 기본 설정
const agentFactory = new AgentFactory({
  aiProviders: [primaryProvider],
  defaultModel: {
    provider: 'primary',
    model: 'gpt-4'
  }
});

// CAMEL 플래너 생성
const camelPlanner = new CAMELPlanner(agentFactory);

// Planning Container 설정
const planner = createPlanner({
  agentFactory,
  planners: [{ name: 'camel', instance: camelPlanner }],
  defaultStrategy: 'best-first'
});

// 간단한 작업 실행
const result = await planner.execute("시장 조사 보고서를 작성해주세요");
console.log('결과:', result);
```

### 2. 다중 플래너 설정

```typescript
import { ReActPlanner } from '@robota-sdk/planning-react';
import { ReflectionPlanner } from '@robota-sdk/planning-reflection';
import { SequentialPlanner } from '@robota-sdk/planning-sequential';

// 여러 플래너 초기화
const planners = [
  { name: 'camel', instance: new CAMELPlanner(agentFactory) },
  { name: 'react', instance: new ReActPlanner(agentFactory) },
  { name: 'reflection', instance: new ReflectionPlanner(agentFactory) },
  { name: 'sequential', instance: new SequentialPlanner(agentFactory) }
];

// 통합 Planning Container
const multiPlanner = createPlanner({
  agentFactory,
  planners,
  defaultStrategy: 'best-first',
  maxConcurrentSessions: 5
});

// 작업별 최적 플래너 자동 선택
const results = await Promise.all([
  multiPlanner.execute("팀 협업이 필요한 복잡한 연구"),      // CAMEL 선택됨
  multiPlanner.execute("동적 문제 해결이 필요한 디버깅"),     // ReAct 선택됨
  multiPlanner.execute("고품질 콘텐츠 작성"),               // Reflection 선택됨
  multiPlanner.execute("체계적인 프로젝트 관리")            // Sequential 선택됨
]);
```

## 📊 플래너별 상세 사용 예제

### CAMEL Planner - 역할 기반 협업

```typescript
// 학술 논문 작성 프로젝트
const academicProject = await camelPlanner.execute(`
  "AI 윤리와 사회적 영향"에 대한 학술 논문을 작성해주세요.
  
  요구사항:
  - 최신 연구 동향 포함
  - 30페이지 이상 상세 분석
  - IEEE 포맷 준수
  - 50개 이상 참고문헌
`, {
  maxAgents: 4,
  qualityRequirement: 'academic',
  rolePreferences: ['researcher', 'writer', 'reviewer', 'coordinator'],
  collaborationStyle: 'structured'
});

// 자동 역할 할당 결과:
console.log('역할 할당:', academicProject.roleAssignments);
// {
//   researcher: ['최신 연구 조사', '선행 연구 분석'],
//   writer: ['논문 초안 작성', '구조화'],
//   reviewer: ['품질 검토', '형식 확인'],
//   coordinator: ['전체 진행 관리', '일정 조정']
// }
```

### ReAct Planner - 탐색적 문제해결

```typescript
// 복잡한 기술 문제 해결
const technicalDebugging = await reactPlanner.execute(`
  우리 서비스에서 특정 조건에서만 발생하는 메모리 누수 문제가 있습니다.
  
  증상:
  - 특정 API 호출 후 메모리 사용량 증가
  - GC가 실행되어도 메모리 해제 안됨
  - 24시간 후 서비스 다운
  
  환경:
  - Node.js 18
  - Express.js 서버
  - MongoDB 연결
  - Redis 캐시
  
  원인을 찾고 해결 방안을 제시해주세요.
`, {
  maxIterations: 20,
  enableMetacognition: true,
  toolCategories: ['debugging', 'monitoring', 'analysis']
});

// ReAct 실행 추적 결과:
console.log('추론 과정:', technicalDebugging.reasoningTrace);
// [
//   { step: 1, thought: "메모리 사용 패턴 분석이 필요", action: "monitor_memory", observation: "..." },
//   { step: 2, thought: "API별 메모리 증가 확인", action: "trace_api_calls", observation: "..." },
//   ...
// ]
```

### Reflection Planner - 품질 개선

```typescript
// 고품질 마케팅 콘텐츠 제작
const marketingContent = await reflectionPlanner.execute(`
  프리미엄 친환경 화장품 브랜드를 위한 마케팅 캠페인을 기획해주세요.
  
  브랜드 정보:
  - 타겟: 25-40세 환경 의식적 여성
  - 포지셔닝: 럭셔리 + 지속가능성
  - 채널: 인스타그램, 유튜브, 블로그
  
  목표:
  - 브랜드 인지도 30% 향상
  - 구매 전환율 15% 개선
  - 고객 참여도 2배 증가
`, {
  maxReflectionCycles: 5,
  qualityThreshold: 0.9,
  qualityDimensions: ['creativity', 'persuasiveness', 'authenticity', 'market_fit'],
  improvementStrategy: 'comprehensive'
});

// 품질 개선 과정:
console.log('개선 과정:', marketingContent.improvementHistory);
// [
//   { cycle: 1, issues: ['창의성 부족', '타겟 명확화 필요'], improvements: ['...'] },
//   { cycle: 2, issues: ['메시지 일관성'], improvements: ['...'] },
//   ...
// ]
```

### Sequential Planner - 체계적 프로젝트 관리

```typescript
// 대규모 소프트웨어 개발 프로젝트
const softwareProject = await sequentialPlanner.execute(`
  새로운 전자상거래 플랫폼을 개발해주세요.
  
  요구사항:
  - 사용자 관리 시스템
  - 상품 카탈로그 관리
  - 주문 및 결제 시스템
  - 관리자 대시보드
  - 모바일 앱 지원
  
  제약사항:
  - 개발 기간: 6개월
  - 팀 규모: 8명
  - 예산: 5억원
  - 기술 스택: React, Node.js, MongoDB
`, {
  maxSteps: 25,
  enableParallelExecution: true,
  qualityGates: ['design_review', 'code_review', 'testing', 'deployment'],
  dependencyManagement: { autoResolve: true }
});

// 단계별 실행 계획:
console.log('실행 계획:', softwareProject.executionPlan);
// [
//   { step: 1, name: '요구사항 분석', duration: 2, dependencies: [] },
//   { step: 2, name: '시스템 설계', duration: 3, dependencies: [1] },
//   { step: 3, name: 'DB 스키마 설계', duration: 1, dependencies: [2] },
//   ...
// ]
```

## 🛠️ 고급 설정 예제

### 1. 사용자 정의 도구 통합

```typescript
// 사용자 정의 도구 구현
class CustomAnalyticsTool implements PlanningToolInterface {
  async execute(input: ToolInput): Promise<ToolOutput> {
    // 사용자 정의 분석 로직
    return { result: 'analytics data' };
  }
}

// 도구 팩토리 등록
class CustomAnalyticsFactory implements ToolFactory {
  getToolInfo(): ToolInfo {
    return {
      toolId: 'custom_analytics',
      name: 'Custom Analytics Tool',
      category: ToolCategory.SPECIALIZED
    };
  }
  
  async createTool(): Promise<PlanningToolInterface> {
    return new CustomAnalyticsTool();
  }
}

// AgentFactory에 사용자 정의 도구 추가
agentFactory.registerTool(new CustomAnalyticsFactory());

// 플래너에서 사용자 정의 도구 활용
const analyticsProject = await reactPlanner.execute(
  "사용자 행동 데이터를 분석해주세요",
  { preferredTools: ['custom_analytics', 'web_search'] }
);
```

### 2. 동적 플래너 선택 전략

```typescript
// 사용자 정의 플래너 선택 전략
class SmartPlannerSelector implements PlannerSelectionStrategy {
  selectPlanner(task: TaskDefinition, planners: BasePlanner[]): BasePlanner {
    // AI 기반 플래너 선택 로직
    const taskAnalysis = this.analyzeTask(task);
    
    if (taskAnalysis.requiresCollaboration) return this.findCAMELPlanner(planners);
    if (taskAnalysis.requiresExploration) return this.findReActPlanner(planners);
    if (taskAnalysis.requiresQuality) return this.findReflectionPlanner(planners);
    if (taskAnalysis.requiresStructure) return this.findSequentialPlanner(planners);
    
    return planners[0]; // 기본값
  }
}

// 스마트 선택 전략 적용
const smartPlanner = createPlanner({
  agentFactory,
  planners,
  selectionStrategy: new SmartPlannerSelector(),
  adaptiveLearning: true
});
```

### 3. 성능 모니터링 및 최적화

```typescript
// 성능 메트릭 수집기
class PlanningMetricsCollector {
  private metrics: Map<string, PlanningMetrics> = new Map();
  
  collectExecutionMetrics(
    plannerId: string, 
    executionTime: number, 
    result: ExecutionResult
  ): void {
    const metrics = this.metrics.get(plannerId) || new PlanningMetrics();
    
    metrics.addExecution({
      executionTime,
      success: result.success,
      qualityScore: result.qualityScore,
      resourceUsage: result.resourceUsage
    });
    
    this.metrics.set(plannerId, metrics);
  }
  
  getOptimizationRecommendations(): OptimizationRecommendation[] {
    return Array.from(this.metrics.entries()).map(([plannerId, metrics]) => ({
      plannerId,
      recommendations: this.analyzeMetrics(metrics)
    }));
  }
}

// 메트릭 수집기 통합
const planner = createPlanner({
  agentFactory,
  planners,
  metricsCollector: new PlanningMetricsCollector(),
  autoOptimization: true
});
```

## 📈 실제 사용 시나리오

### 시나리오 1: 스타트업 비즈니스 계획 수립

```typescript
const businessPlan = await multiPlanner.execute(`
  AI 기반 헬스케어 스타트업의 종합 비즈니스 계획을 수립해주세요.
  
  회사 정보:
  - 서비스: AI 진단 보조 도구
  - 팀 규모: 12명 (개발 8명, 비즈니스 4명)
  - 현재 단계: MVP 완성, 베타 테스트 중
  - 목표: 시리즈 A 투자 유치 (100억원)
  
  필요 항목:
  1. 시장 분석 및 경쟁사 조사
  2. 비즈니스 모델 수립
  3. 재무 계획 및 투자 전략
  4. 마케팅 및 영업 전략
  5. 기술 로드맵
  6. 위험 분석 및 대응 방안
`, {
  strategy: 'hybrid', // 여러 플래너 조합 사용
  qualityRequirement: 'investor-grade',
  timeline: '2주'
});

// 결과: 150페이지 종합 비즈니스 계획서
console.log('비즈니스 계획 완료:', businessPlan.sections);
```

### 시나리오 2: 대학 연구 프로젝트

```typescript
const researchProject = await sequentialPlanner.execute(`
  "메타버스 환경에서의 사용자 경험 최적화" 연구 프로젝트를 수행해주세요.
  
  연구 목표:
  - 메타버스 UX 요소 분석
  - 사용자 행동 패턴 연구
  - 최적화 알고리즘 개발
  - 실증 실험 설계 및 수행
  
  제약사항:
  - 연구 기간: 1년
  - 예산: 3억원
  - 연구진: 교수 1명, 박사과정 2명, 석사과정 4명
  - 목표: SCIE 논문 3편 이상 게재
`, {
  researchMethodology: 'empirical',
  ethicsReview: true,
  peerReviewProcess: true
});

// 연구 단계별 계획:
// 1. 문헌 조사 (2개월)
// 2. 연구 설계 (1개월)
// 3. 실험 환경 구축 (2개월)
// 4. 데이터 수집 (4개월)
// 5. 분석 및 논문 작성 (3개월)
```

### 시나리오 3: 기업 디지털 전환 컨설팅

```typescript
const digitalTransformation = await camelPlanner.execute(`
  제조업체의 디지털 전환 컨설팅 프로젝트를 수행해주세요.
  
  고객 정보:
  - 업종: 자동차 부품 제조
  - 규모: 직원 500명, 연매출 1,000억원
  - 현재 상태: 전통적 제조 방식, IT 인프라 노후화
  - 목표: 스마트 팩토리 구축, 생산성 30% 향상
  
  컨설팅 범위:
  1. 현재 시스템 진단
  2. 디지털 전환 로드맵 수립
  3. 기술 도입 계획
  4. 인력 재교육 프로그램
  5. ROI 분석 및 투자 계획
  6. 구현 지원
`, {
  teamComposition: {
    'IT컨설턴트': 2,
    '제조전문가': 1,
    '프로젝트매니저': 1
  },
  projectDuration: '6개월',
  deliverables: ['진단보고서', '로드맵', '구현계획서', 'ROI분석']
});
```

## 🔄 마이그레이션 예제

### Team → Planning 마이그레이션

```typescript
// 기존 Team 코드
import { createTeam } from '@robota-sdk/team';

const oldTeam = createTeam({
  maxAgents: 3,
  roles: ['researcher', 'writer', 'reviewer'],
  workflow: 'collaborative'
});

const oldResult = await oldTeam.execute("보고서 작성");

// Planning 시스템으로 마이그레이션
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { TeamMigrationAdapter } from '@robota-sdk/planning-camel/adapters';

// 1단계: 호환성 어댑터 사용
const migrationAdapter = new TeamMigrationAdapter();
const migratedConfig = migrationAdapter.convertTeamConfig({
  maxAgents: 3,
  roles: ['researcher', 'writer', 'reviewer'],
  workflow: 'collaborative'
});

const camelPlanner = new CAMELPlanner(agentFactory, migratedConfig);
const newResult = await camelPlanner.execute("보고서 작성");

// 2단계: 네이티브 Planning API 활용
const nativePlanner = new CAMELPlanner(agentFactory, {
  maxAgents: 3,
  roleBasedWorkflow: {
    researcher: { priority: 1, tools: ['web_search', 'academic_db'] },
    writer: { priority: 2, tools: ['grammar_checker', 'style_guide'] },
    reviewer: { priority: 3, tools: ['fact_checker', 'quality_analyzer'] }
  },
  collaborationStrategy: 'structured'
});

const enhancedResult = await nativePlanner.execute("고품질 보고서 작성");
```

## 🎯 성능 최적화 예제

### 1. 리소스 풀링 및 캐싱

```typescript
// 고성능 Planning 시스템 구성
const optimizedPlanner = createPlanner({
  agentFactory: new AgentFactory({
    aiProviders: [primaryProvider],
    defaultModel: {
      provider: 'primary',
      model: 'gpt-4'
    },
    // 에이전트 풀링 활성화
    resourcePooling: {
      enabled: true,
      maxPoolSize: 10,
      idleTimeout: 300000 // 5분
    },
    
    // 결과 캐싱 활성화
    resultCaching: {
      enabled: true,
      maxCacheSize: 1000,
      ttl: 3600000 // 1시간
    }
  }),
  
  planners,
  
  // 계획 캐싱 활성화
  planCaching: {
    enabled: true,
    strategy: 'semantic-hash'
  },
  
  // 병렬 실행 최적화
  parallelExecution: {
    maxConcurrency: 5,
    loadBalancing: true
  }
});

// 대용량 작업 배치 처리
const batchResults = await Promise.all(
  largeTasks.map(task => optimizedPlanner.execute(task))
);
```

### 2. 메모리 및 성능 모니터링

```typescript
// 성능 모니터링 시스템
class PerformanceMonitor {
  private metrics: PerformanceMetrics = new PerformanceMetrics();
  
  async monitorExecution<T>(
    operation: () => Promise<T>
  ): Promise<T & { performance: ExecutionMetrics }> {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    
    try {
      const result = await operation();
      const endTime = Date.now();
      const endMemory = process.memoryUsage();
      
      const performance = {
        executionTime: endTime - startTime,
        memoryUsage: {
          heapUsed: endMemory.heapUsed - startMemory.heapUsed,
          external: endMemory.external - startMemory.external
        },
        cpuUsage: process.cpuUsage()
      };
      
      this.metrics.record(performance);
      
      return { ...result, performance };
    } catch (error) {
      this.metrics.recordError(error);
      throw error;
    }
  }
}

// 모니터링 적용
const monitor = new PerformanceMonitor();
const monitoredResult = await monitor.monitorExecution(
  () => planner.execute("복잡한 작업")
);

console.log('성능 메트릭:', monitoredResult.performance);
```

## 🔧 문제 해결 예제

### 일반적인 문제와 해결 방법

#### 1. 메모리 부족 오류
```typescript
// 문제: 대용량 작업 시 메모리 부족
// 해결: 스트리밍 처리 및 메모리 관리

const memoryEfficientPlanner = createPlanner({
  agentFactory: new AgentFactory({
    aiProviders: [primaryProvider],
    defaultModel: {
      provider: 'primary',
      model: 'gpt-4'
    },
    memoryManagement: {
      maxMemoryUsage: '2GB',
      garbageCollectionInterval: 60000,
      streamingMode: true
    }
  }),
  planners,
  resourceLimits: {
    maxMemoryPerTask: '500MB',
    maxExecutionTime: 300000 // 5분
  }
});
```

#### 2. 응답 시간 지연
```typescript
// 문제: 플래너 실행 시간이 너무 오래 걸림
// 해결: 타임아웃 및 조기 종료 설정

const timeOptimizedExecution = await planner.execute(task, {
  timeout: 180000, // 3분 타임아웃
  earlyTermination: {
    enabled: true,
    qualityThreshold: 0.8,
    progressCheckInterval: 30000
  },
  fallbackStrategy: 'simple-sequential'
});
```

#### 3. 플래너 선택 오류
```typescript
// 문제: 잘못된 플래너가 선택됨
// 해결: 명시적 플래너 지정 및 검증

const explicitPlannerExecution = await planner.execute(task, {
  forcePlanner: 'camel', // 명시적 플래너 지정
  validation: {
    preExecution: true,
    postExecution: true,
    qualityGates: ['planning', 'execution', 'results']
  }
});
```

## 📚 관련 문서

### 코어 시스템
- [Planning System Overview](../core-system/planning-overview.md) - 전체 시스템 개요
- [Planning Container](../core-system/planning-container.md) - 플래너 통합 관리
- [AgentFactory 확장](../core-system/agentfactory-expansion.md) - 에이전트 생성 엔진

### 플래너별 가이드
- [CAMEL Planner](../planners/camel-planner.md) - 역할 기반 협업
- [ReAct Planner](../planners/react-planner.md) - 추론+행동 반복
- [Reflection Planner](../planners/reflection-planner.md) - 품질 개선 중심
- [Sequential Planner](../planners/sequential-planner.md) - 단계별 처리

### 도구 관리
- [도구 아키텍처](../tool-management/tool-architecture.md) - 도구 관리 전략
- [도구 구현](../tool-management/tool-implementation.md) - 구체적 구현 방법

### 구현 가이드
- [구현 로드맵](./implementation-roadmap.md) - 개발 계획
- [마이그레이션 가이드](./migration-guide.md) - Team → Planning 전환

이 예제들을 통해 Planning 시스템의 다양한 활용 방법을 익히고, 실제 프로젝트에 적용할 수 있습니다. 추가 질문이나 특정 시나리오에 대한 도움이 필요하시면 언제든지 문의해 주세요. 