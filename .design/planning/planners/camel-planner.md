# CAMEL Planner: 역할 기반 협업 플래닝

> 패키지: `@robota-sdk/planning-camel`  
> 이 문서는 [Planning System Overview](../core-system/planning-overview.md)의 핵심 플래너 중 하나인 CAMEL Planner에 대한 상세 설명입니다.

## 🎯 개요

CAMEL (Communicative Agents for Mind Exploration of Large Scale Language Model Society) Planner는 **역할 기반 협업**을 통해 복잡한 작업을 여러 전문가 에이전트가 분담하여 처리하는 플래닝 기법입니다. 체계적이고 전략적인 협업 시스템을 제공하는 Planning 시스템의 핵심 플래너입니다.

## 🏗️ 핵심 특징

### 1. 역할 기반 협업 구조
- **명확한 전문성**: 각 에이전트가 특정 역할 (연구자, 작성자, 검토자 등)
- **구조화된 워크플로우**: 예측 가능한 상호작용 패턴
- **안정적 협업**: 역할 분담이 명확해 일관된 결과 보장

### 2. 템플릿 직접 사용 전략
- **템플릿 기반 안정성**: AgentFactory의 빌트인 템플릿 완전 활용
- **전문가 에이전트**: 각 역할에 최적화된 템플릿 직접 매핑
- **검증된 성능**: 검증된 템플릿으로 예측 가능한 결과

### 3. 확장 가능한 협업 시스템
- **유연한 역할 확장**: 새로운 역할과 워크플로우 추가 가능
- **동적 역할 조정**: 작업 진행에 따른 역할 재할당
- **계획 수립 → 실행 → 결과 통합**의 체계적 프로세스

## 🎭 역할 기반 아키텍처

### 기본 역할 구조
```
🎯 CAMEL Planner
├── 🔬 Researcher (연구자)
│   ├── Domain Expert
│   ├── Data Collector
│   └── Fact Checker
├── ✍️ Writer (작성자)
│   ├── Content Creator
│   ├── Summarizer
│   └── Document Formatter
├── 👁️ Reviewer (검토자)
│   ├── Quality Checker
│   ├── Ethical Reviewer
│   └── Bias Detector
└── 🎪 Coordinator (조정자)
    ├── Task Distributor
    ├── Progress Tracker
    └── Result Integrator
```

### 역할별 템플릿 매핑
```typescript
// 기본 역할-템플릿 매핑
const roleTemplateMapping = {
  'researcher': ['domain_researcher', 'general'],
  'writer': ['summarizer', 'creative_ideator'],
  'reviewer': ['ethical_reviewer', 'general'],
  'coordinator': ['task_coordinator', 'general'],
  'executor': ['fast_executor', 'general']
};
```

## 🏗️ 아키텍처 설계

### 추상클래스 기반 설계
CAMEL 플래너는 Robota 프레임워크의 `BasePlanner` 추상클래스를 상속받아 구현됩니다.

```typescript
// 모든 플래너가 상속받는 공통 추상클래스
abstract class BasePlanner {
  protected config: PlannerConfiguration;
  protected toolRegistry: ToolRegistry;
  protected executionContext: ExecutionContext;
  protected logger: Logger;
  
  // 공통 라이프사이클 메서드
  abstract initialize(config: PlannerConfiguration): Promise<void>;
  abstract createPlan(task: TaskDefinition): Promise<ExecutionPlan>;
  abstract executePlan(plan: ExecutionPlan): Promise<ExecutionResult>;
  abstract cleanup(): Promise<void>;
  
  // 공통 상태 관리
  abstract getStatus(): PlannerStatus;
  abstract getMetrics(): PlannerMetrics;
  
  // 공통 도구 관리
  protected registerTool(tool: PlanningTool): void { /* 공통 구현 */ }
  protected getTool(toolId: string): PlanningTool | null { /* 공통 구현 */ }
  
  // 공통 로깅
  protected log(level: LogLevel, message: string, metadata?: any): void { /* 공통 구현 */ }
}

// CAMEL 플래너 구체적 구현
class CAMELPlanner extends BasePlanner {
  private roleManager: RoleManager;
  private collaborationEngine: CollaborationEngine;
  private workflowOrchestrator: WorkflowOrchestrator;
  
  async initialize(config: PlannerConfiguration): Promise<void> {
    // 상위 클래스 초기화
    await super.initialize(config);
    
    // CAMEL 특화 컴포넌트 초기화
    this.roleManager = new RoleManager(config.roles);
    this.collaborationEngine = new CollaborationEngine(config.collaboration);
    this.workflowOrchestrator = new WorkflowOrchestrator(config.workflow);
    
    // 협업 전용 도구 등록
    this.registerCollaborationTools();
    
    this.log(LogLevel.INFO, 'CAMEL Planner initialized', { 
      rolesCount: config.roles?.length || 0,
      toolsCount: this.toolRegistry.getToolCount()
    });
  }
  
  async createPlan(task: TaskDefinition): Promise<ExecutionPlan> {
    // 역할 기반 계획 생성
    const roleAssignments = await this.roleManager.assignRoles(task);
    const collaborationPlan = await this.collaborationEngine.createPlan(task, roleAssignments);
    const workflow = await this.workflowOrchestrator.generateWorkflow(collaborationPlan);
    
    return new CAMELExecutionPlan({
      taskId: task.id,
      roleAssignments,
      collaborationPlan,
      workflow,
      estimatedDuration: this.estimateExecutionTime(workflow)
    });
  }
  
  async executePlan(plan: ExecutionPlan): Promise<ExecutionResult> {
    const camelPlan = plan as CAMELExecutionPlan;
    
    // 워크플로우 실행
    const executionResult = await this.workflowOrchestrator.execute(camelPlan.workflow);
    
    // 협업 메트릭 수집
    const collaborationMetrics = await this.collaborationEngine.getMetrics();
    
    return {
      success: executionResult.success,
      result: executionResult.result,
      metrics: {
        ...executionResult.metrics,
        collaboration: collaborationMetrics
      },
      plannerType: 'CAMEL'
    };
  }
  
  // CAMEL 특화 메서드
  async defineRoles(roles: RoleDefinition[]): Promise<void> {
    await this.roleManager.defineRoles(roles);
  }
  
  async adjustRoles(adjustments: RoleAdjustment[]): Promise<void> {
    await this.roleManager.adjustRoles(adjustments);
  }
  
  private registerCollaborationTools(): void {
    // 협업 전용 도구들 등록
    this.registerTool(new CollaborationCoordinatorTool());
    this.registerTool(new RoleAssignmentTool());
    this.registerTool(new WorkflowVisualizationTool());
    this.registerTool(new ConflictResolutionTool());
  }
}
```

## 🔧 구현 및 사용법

### 1. 기본 설정 및 초기화

```typescript
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { AgentFactory } from '@robota-sdk/agents';

// AgentFactory 설정 (Provider 불가지론 준수)
const agentFactory = new AgentFactory({
  aiProviders: [primaryProvider],
  defaultModel: {
    provider: 'primary',
    model: 'gpt-4'
  },
  commonTools: ['web_search', 'calculator', 'file_manager'],
  autoInjectCommonTools: true
});

// CAMEL Planner 초기화
const camelPlanner = new CAMELPlanner();
await camelPlanner.initialize({
  agentFactory,
  maxAgents: 5,
  // 기존 Team과 동일한 템플릿 사용으로 호환성 보장
  availableTemplates: [
    'domain_researcher',
    'summarizer', 
    'ethical_reviewer',
    'creative_ideator',
    'fast_executor',
    'task_coordinator',
    'general'
  ],
  // 역할별 도구 매핑
  roleToolMapping: {
    'researcher': ['web_search', 'academic_database', 'citation_manager'],
    'writer': ['grammar_checker', 'style_guide', 'document_formatter'],
    'reviewer': ['fact_checker', 'quality_analyzer', 'plagiarism_checker'],
    'coordinator': ['project_tracker', 'communication_hub', 'progress_analyzer']
  },
  // 공통 도구 상속
  inheritCommonTools: true
});
```

### 2. 작업 계획 수립

```typescript
// CAMEL의 계획 수립 과정
class CAMELPlanner {
  async createPlan(task: string): Promise<CAMELExecutionPlan> {
    // 1. 작업 분석 및 역할 식별
    const taskAnalysis = await this.analyzeTask(task);
    const requiredRoles = this.identifyRequiredRoles(taskAnalysis);
    
    // 2. 역할별 에이전트 사양 생성
    const agentSpecs = requiredRoles.map(role => ({
      role,
      templateId: this.selectTemplateForRole(role),
      tools: this.getToolsForRole(role),
      responsibilities: this.defineResponsibilities(role, taskAnalysis)
    }));
    
    // 3. 협업 워크플로우 설계
    const workflow = this.designCollaborationWorkflow(agentSpecs, taskAnalysis);
    
    // 4. 커뮤니케이션 프로토콜 설정
    const communicationPlan = this.setupCommunicationProtocol(agentSpecs);
    
    return {
      taskId: this.generateTaskId(),
      agentSpecs,
      workflow,
      communicationPlan,
      estimatedDuration: this.estimateExecutionTime(workflow),
      qualityMetrics: this.defineQualityMetrics(taskAnalysis)
    };
  }
  
  private identifyRequiredRoles(analysis: TaskAnalysis): string[] {
    const roles = ['coordinator']; // 항상 조정자 포함
    
    if (analysis.requiresResearch) roles.push('researcher');
    if (analysis.requiresWriting) roles.push('writer');
    if (analysis.requiresReview) roles.push('reviewer');
    if (analysis.requiresExecution) roles.push('executor');
    
    return roles;
  }
}
```

### 3. 협업 실행

```typescript
// 역할 기반 협업 실행
async executePlan(plan: CAMELExecutionPlan): Promise<CAMELExecutionResult> {
  // 1. 역할별 에이전트 배치 생성 (AgentFactory 확장 기능 활용)
  const agents = await this.agentFactory.createBatch(plan.agentSpecs);
  
  // 2. 에이전트 역할 할당 및 초기화
  const roleAssignments = this.assignRoles(agents, plan.agentSpecs);
  
  // 3. 협업 워크플로우 실행
  const workflowResults = [];
  
  for (const step of plan.workflow.steps) {
    const stepResult = await this.executeWorkflowStep(step, roleAssignments);
    workflowResults.push(stepResult);
    
    // 단계별 결과를 다음 단계에 전달
    this.updateAgentContext(roleAssignments, stepResult);
  }
  
  // 4. 결과 통합 및 품질 검증
  const coordinator = roleAssignments.get('coordinator');
  const finalResult = await coordinator.integrateResults(workflowResults);
  
  // 5. 품질 메트릭 평가
  const qualityScore = await this.evaluateQuality(finalResult, plan.qualityMetrics);
  
  return {
    result: finalResult,
    qualityScore,
    executionTime: Date.now() - plan.startTime,
    agentContributions: this.getAgentContributions(roleAssignments),
    workflowTrace: workflowResults
  };
}
```

### 4. 고급 협업 패턴

```typescript
// 동적 역할 조정
class CAMELPlanner {
  async adaptiveRoleManagement(
    currentAgents: Map<string, AgentInterface>,
    taskProgress: TaskProgress
  ): Promise<RoleAdjustment[]> {
    const adjustments: RoleAdjustment[] = [];
    
    // 작업 진행 상황에 따른 역할 조정
    if (taskProgress.researchPhase && !currentAgents.has('researcher')) {
      // 연구자 역할 동적 추가
      const researcher = await this.agentFactory.createWithConditions({
        role: 'researcher',
        expertise: taskProgress.requiredExpertise,
        taskType: 'research',
        collaborationStyle: 'cooperative'
      });
      
      adjustments.push({
        action: 'add',
        role: 'researcher',
        agent: researcher,
        reason: 'Research phase requires specialized researcher'
      });
    }
    
    // 품질 요구사항 변경에 따른 검토자 강화
    if (taskProgress.qualityRequirement > 0.8 && !currentAgents.has('senior_reviewer')) {
      const seniorReviewer = await this.agentFactory.createFromTemplate('ethical_reviewer', {
        systemMessage: 'You are a senior quality reviewer with high standards...'
      });
      
      adjustments.push({
        action: 'upgrade',
        role: 'reviewer',
        agent: seniorReviewer,
        reason: 'High quality requirement needs senior reviewer'
      });
    }
    
    return adjustments;
  }
}
```

## 🔧 고급 설정 및 최적화

### 1. 커스텀 워크플로우 정의

```typescript
// 도메인별 특화 워크플로우
const customWorkflows = {
  'academic_research': {
    phases: ['literature_review', 'methodology_design', 'data_collection', 'analysis', 'writing'],
    roles: ['researcher', 'writer', 'reviewer'],
    qualityGates: ['peer_review', 'fact_checking', 'citation_verification']
  },
  
  'business_strategy': {
    phases: ['market_analysis', 'swot_analysis', 'strategy_formulation', 'implementation_planning'],
    roles: ['researcher', 'writer', 'reviewer', 'coordinator'],
    decisionPoints: ['go_no_go', 'resource_allocation', 'timeline_adjustment']
  },
  
  'creative_project': {
    phases: ['ideation', 'concept_development', 'prototype_creation', 'refinement'],
    roles: ['creative_ideator', 'writer', 'reviewer'],
    iterationCycles: 3
  }
};
```

### 2. 품질 메트릭 정의

```typescript
// CAMEL 특화 품질 메트릭
const qualityMetrics = {
  collaboration_effectiveness: {
    metric: 'agent_interaction_quality',
    threshold: 0.8,
    measurement: 'communication_coherence + role_clarity + task_completion'
  },
  
  role_specialization: {
    metric: 'expertise_utilization',
    threshold: 0.7,
    measurement: 'domain_knowledge_application + tool_usage_efficiency'
  },
  
  workflow_efficiency: {
    metric: 'process_optimization',
    threshold: 0.75,
    measurement: 'time_efficiency + resource_utilization + bottleneck_minimization'
  }
};
```

## 📊 성능 및 모니터링

### 실행 추적 및 분석

```typescript
// CAMEL 실행 분석
const executionAnalysis = {
  rolePerformance: {
    researcher: { efficiency: 0.85, quality: 0.9, collaboration: 0.8 },
    writer: { efficiency: 0.9, quality: 0.85, collaboration: 0.9 },
    reviewer: { efficiency: 0.8, quality: 0.95, collaboration: 0.85 },
    coordinator: { efficiency: 0.95, quality: 0.8, collaboration: 0.95 }
  },
  
  workflowEfficiency: {
    totalTime: 1800, // 30분
    planningTime: 300, // 5분
    executionTime: 1200, // 20분
    integrationTime: 300, // 5분
    bottlenecks: ['data_collection', 'quality_review']
  },
  
  qualityMetrics: {
    overall: 0.87,
    accuracy: 0.9,
    completeness: 0.85,
    coherence: 0.88,
    creativity: 0.82
  }
};
```

## 📚 관련 문서

### 코어 시스템
- [Planning System Overview](../core-system/planning-overview.md) - 전체 시스템 개요
- [Planning Container](../core-system/planning-container.md) - 플래너 통합 관리
- [AgentFactory 확장](../core-system/agentfactory-expansion.md) - 에이전트 생성 엔진

### 다른 플래너들
- [ReAct Planner](./react-planner.md) - 추론+행동 반복
- [Reflection Planner](./reflection-planner.md) - 품질 개선 중심
- [Sequential Planner](./sequential-planner.md) - 단계별 처리

### 도구 관리
- [도구 아키텍처](../tool-management/tool-architecture.md) - 도구 관리 전략
- [도구 구현](../tool-management/tool-implementation.md) - 구체적 구현 방법

### 구현 가이드
- [구현 로드맵](../implementation/implementation-roadmap.md) - 개발 계획
- [마이그레이션 가이드](../implementation/migration-guide.md) - Team → Planning 전환
- [사용 예제](../implementation/usage-examples.md) - 실제 사용 사례

### 아키텍처
- [시스템 분석](../architecture/system-analysis.md) - 현재 시스템 분석
- [설계 패턴](../architecture/design-patterns.md) - 설계 원칙 및 패턴

## 🎯 실제 사용 시나리오

### 시나리오 1: 연구 보고서 작성

```typescript
// 복잡한 연구 보고서 작성 프로젝트
const researchProject = await camelPlanner.execute(`
  "AI가 미래 교육에 미치는 영향"에 대한 종합 연구 보고서를 작성해주세요.
  
  요구사항:
  - 최신 연구 동향 조사
  - 국내외 사례 분석
  - 전문가 인터뷰 내용 포함
  - 정책 제언 및 실행 방안
  - 50페이지 이상 상세 보고서
`, {
  qualityRequirement: 'premium',
  deadline: '2주',
  targetAudience: '교육부 정책 담당자'
});

// 자동 역할 할당 결과:
// - domain_researcher: 최신 연구 동향 조사
// - summarizer: 사례 분석 및 요약
// - creative_ideator: 정책 제언 아이디어 생성
// - ethical_reviewer: 윤리적 관점 검토
// - task_coordinator: 전체 프로젝트 조정
```

### 시나리오 2: 비즈니스 전략 수립

```typescript
// 다각도 비즈니스 전략 분석
const strategyResult = await camelPlanner.execute(`
  스타트업을 위한 종합 비즈니스 전략을 수립해주세요.
  
  회사 정보:
  - AI 기반 헬스케어 서비스
  - 팀 규모: 15명
  - 시드 투자 완료
  - 목표: 시리즈 A 준비
`, {
  collaborationStyle: 'intensive', // 집중적 협업
  roles: ['researcher', 'writer', 'reviewer', 'coordinator'],
  customWorkflow: {
    phases: ['market_analysis', 'competitive_analysis', 'strategy_formulation', 'implementation_planning'],
    parallelExecution: true
  }
});
```

### 시나리오 3: 창의적 콘텐츠 제작

```typescript
// 창의적 협업 프로젝트
const creativeProject = await camelPlanner.execute(`
  브랜드 캠페인을 위한 창의적 콘텐츠를 기획하고 제작해주세요.
  
  브랜드: 친환경 화장품
  타겟: 20-30대 여성
  채널: 소셜미디어, 블로그
  목표: 브랜드 인지도 향상
`, {
  emphasizeCreativity: true,
  roles: ['creative_ideator', 'writer', 'reviewer'],
  collaborationPattern: 'brainstorming' // 브레인스토밍 중심
});
``` 