# 도구 관리 아키텍처: Planning 시스템의 도구 전략

> 이 문서는 [Planning System Overview](../core-system/planning-overview.md)의 도구 관리 전략에 대한 상세 설명입니다.

## 🎯 개요

Planning 시스템에서 도구 관리는 **각 플래너의 특성에 맞는 최적의 도구를 적절한 시점에 제공**하는 핵심 기능입니다. 3계층 도구 관리 시스템을 통해 효율적이고 유연한 도구 할당을 실현합니다.

## 🏗️ 3계층 도구 관리 아키텍처

### 전체 아키텍처 개요
```
🎯 Planning Container
├── 🏭 AgentFactory (Layer 1: 공통 도구)
│   ├── 범용 도구 풀 관리
│   ├── 기본 도구 자동 주입
│   └── 도구 충돌 해결
├── 📦 Individual Planners (Layer 2: 플래너별 도구)
│   ├── CAMEL: 협업 중심 도구
│   ├── ReAct: 탐색 중심 도구
│   ├── Reflection: 품질 중심 도구
│   └── Sequential: 프로젝트 관리 도구
└── 🤖 Agent Instances (Layer 3: 상황별 도구)
    ├── 동적 도구 할당
    ├── 작업 맞춤형 도구
    └── 실시간 도구 추가/제거
```

## 📋 Layer 1: AgentFactory 공통 도구 관리

### 범용 도구 풀 설계
```typescript
// AgentFactory의 공통 도구 관리
class AgentFactory {
  private commonToolsPool = {
    // 기본 범용 도구
    core: [
      'text_processor',
      'web_search',
      'calculator',
      'file_manager'
    ],
    
    // 협업 지원 도구
    collaboration: [
      'communication_hub',
      'progress_tracker',
      'task_coordinator'
    ],
    
    // 품질 관리 도구
    quality: [
      'grammar_checker',
      'fact_checker',
      'quality_validator'
    ],
    
    // 분석 도구
    analysis: [
      'data_analyzer',
      'pattern_detector',
      'trend_analyzer'
    ]
  };
  
  async createWithCommonTools(config: AgentCreationConfig): Promise<AgentInterface> {
    // 기본 도구 자동 주입
    const baseTools = this.selectBaseTools(config.taskType);
    
    // 도구 충돌 검사 및 해결
    const resolvedTools = await this.resolveToolConflicts(baseTools, config.requestedTools);
    
    // 에이전트 생성 및 도구 할당
    const agent = await this.createAgent(config);
    await this.assignTools(agent, resolvedTools);
    
    return agent;
  }
  
  private selectBaseTools(taskType: string): string[] {
    const baseSelection = [...this.commonToolsPool.core];
    
    // 작업 타입별 기본 도구 추가
    switch (taskType) {
      case 'collaboration':
        baseSelection.push(...this.commonToolsPool.collaboration);
        break;
      case 'analysis':
        baseSelection.push(...this.commonToolsPool.analysis);
        break;
      case 'quality_control':
        baseSelection.push(...this.commonToolsPool.quality);
        break;
    }
    
    return baseSelection;
  }
}
```

### 도구 충돌 해결 시스템
```typescript
// 도구 간 충돌 해결 엔진
class ToolConflictResolver {
  async resolveConflicts(
    requestedTools: string[],
    existingTools: string[]
  ): Promise<ToolResolutionResult> {
    const conflicts = this.detectConflicts(requestedTools, existingTools);
    
    if (conflicts.length === 0) {
      return { resolved: [...existingTools, ...requestedTools], conflicts: [] };
    }
    
    // 충돌 해결 전략 적용
    const resolutionStrategy = await this.selectResolutionStrategy(conflicts);
    const resolvedTools = await this.applyResolution(conflicts, resolutionStrategy);
    
    return {
      resolved: resolvedTools,
      conflicts: conflicts,
      resolutionApplied: resolutionStrategy
    };
  }
  
  private detectConflicts(requested: string[], existing: string[]): ToolConflict[] {
    const conflicts: ToolConflict[] = [];
    
    // 기능 중복 검사
    const functionalConflicts = this.checkFunctionalOverlap(requested, existing);
    conflicts.push(...functionalConflicts);
    
    // 리소스 경합 검사
    const resourceConflicts = this.checkResourceCompetition(requested, existing);
    conflicts.push(...resourceConflicts);
    
    // 버전 호환성 검사
    const versionConflicts = this.checkVersionCompatibility(requested, existing);
    conflicts.push(...versionConflicts);
    
    return conflicts;
  }
}
```

## 📦 Layer 2: 플래너별 특화 도구 전략

### CAMEL Planner: 협업 중심 도구
```typescript
// CAMEL의 역할 기반 도구 매핑
class CAMELToolStrategy {
  private roleToolMapping = {
    researcher: {
      primary: ['web_search', 'academic_database', 'citation_manager'],
      secondary: ['data_scraper', 'fact_checker', 'source_validator'],
      optional: ['translation_tool', 'summarizer']
    },
    
    writer: {
      primary: ['grammar_checker', 'style_guide', 'document_formatter'],
      secondary: ['plagiarism_checker', 'readability_analyzer'],
      optional: ['creative_enhancer', 'template_engine']
    },
    
    reviewer: {
      primary: ['quality_checker', 'bias_detector', 'consistency_validator'],
      secondary: ['fact_checker', 'logic_analyzer'],
      optional: ['peer_review_simulator', 'feedback_aggregator']
    },
    
    coordinator: {
      primary: ['project_tracker', 'communication_hub', 'progress_analyzer'],
      secondary: ['resource_manager', 'bottleneck_detector'],
      optional: ['reporting_tool', 'dashboard_generator']
    }
  };
  
  async allocateToolsForRole(role: string, context: CollaborationContext): Promise<string[]> {
    const roleTools = this.roleToolMapping[role];
    if (!roleTools) {
      throw new Error(`Unknown role: ${role}`);
    }
    
    // 필수 도구 할당
    const allocatedTools = [...roleTools.primary];
    
    // 상황별 보조 도구 추가
    if (context.complexityLevel > 0.7) {
      allocatedTools.push(...roleTools.secondary);
    }
    
    // 선택적 도구 조건부 추가
    if (context.qualityRequirement > 0.8) {
      allocatedTools.push(...roleTools.optional);
    }
    
    return this.deduplicateTools(allocatedTools);
  }
}
```

### ReAct Planner: 탐색 중심 도구
```typescript
// ReAct의 동적 도구 선택 전략
class ReActToolStrategy {
  private explorationToolGroups = {
    'information_gathering': [
      'web_search', 'data_scraper', 'api_explorer', 'database_query'
    ],
    'analysis_tools': [
      'statistical_analyzer', 'pattern_detector', 'correlation_finder', 'trend_analyzer'
    ],
    'processing_tools': [
      'text_processor', 'data_transformer', 'format_converter', 'aggregator'
    ],
    'validation_tools': [
      'fact_checker', 'source_validator', 'quality_analyzer', 'consistency_checker'
    ]
  };
  
  async selectToolsForThought(thought: ThoughtResult): Promise<string[]> {
    const selectedTools: string[] = [];
    
    // 추론 내용 분석하여 필요 도구 그룹 식별
    const requiredGroups = await this.analyzeToolRequirements(thought);
    
    // 각 그룹에서 최적 도구 선택
    for (const group of requiredGroups) {
      const groupTools = this.explorationToolGroups[group];
      const optimalTool = await this.selectOptimalToolFromGroup(groupTools, thought);
      selectedTools.push(optimalTool);
    }
    
    // 동적 도구 추천 시스템 활용
    const recommendedTools = await this.getRecommendedTools(thought, selectedTools);
    selectedTools.push(...recommendedTools);
    
    return this.optimizeToolSelection(selectedTools);
  }
  
  private async analyzeToolRequirements(thought: ThoughtResult): Promise<string[]> {
    const requiredGroups: string[] = [];
    
    // 키워드 기반 분석
    if (this.containsSearchKeywords(thought.reasoning)) {
      requiredGroups.push('information_gathering');
    }
    
    if (this.containsAnalysisKeywords(thought.reasoning)) {
      requiredGroups.push('analysis_tools');
    }
    
    if (this.containsProcessingKeywords(thought.reasoning)) {
      requiredGroups.push('processing_tools');
    }
    
    // LLM 기반 고급 분석
    const advancedAnalysis = await this.llmBasedToolRequirementAnalysis(thought);
    requiredGroups.push(...advancedAnalysis);
    
    return [...new Set(requiredGroups)];
  }
}
```

### Reflection Planner: 품질 중심 도구
```typescript
// Reflection의 품질 평가 도구 전략
class ReflectionToolStrategy {
  private qualityAssessmentTools = {
    accuracy: {
      tools: ['fact_checker', 'source_validator', 'citation_checker'],
      weights: { 'fact_checker': 0.5, 'source_validator': 0.3, 'citation_checker': 0.2 }
    },
    
    completeness: {
      tools: ['completeness_checker', 'coverage_analyzer', 'gap_detector'],
      weights: { 'completeness_checker': 0.4, 'coverage_analyzer': 0.4, 'gap_detector': 0.2 }
    },
    
    clarity: {
      tools: ['readability_analyzer', 'grammar_checker', 'style_analyzer'],
      weights: { 'readability_analyzer': 0.4, 'grammar_checker': 0.3, 'style_analyzer': 0.3 }
    },
    
    coherence: {
      tools: ['coherence_checker', 'logic_analyzer', 'flow_validator'],
      weights: { 'coherence_checker': 0.5, 'logic_analyzer': 0.3, 'flow_validator': 0.2 }
    }
  };
  
  async selectQualityTools(
    targetMetrics: string[],
    qualityThreshold: number
  ): Promise<QualityToolAllocation> {
    const allocation: QualityToolAllocation = {
      primary: [],
      secondary: [],
      weights: new Map()
    };
    
    // 목표 메트릭별 도구 할당
    for (const metric of targetMetrics) {
      const metricTools = this.qualityAssessmentTools[metric];
      if (!metricTools) continue;
      
      // 품질 임계값에 따른 도구 선택
      if (qualityThreshold > 0.8) {
        // 높은 품질 요구: 모든 도구 사용
        allocation.primary.push(...metricTools.tools);
        metricTools.tools.forEach(tool => {
          allocation.weights.set(tool, metricTools.weights[tool]);
        });
      } else {
        // 표준 품질: 주요 도구만 사용
        const primaryTool = this.selectPrimaryTool(metricTools);
        allocation.primary.push(primaryTool);
        allocation.weights.set(primaryTool, 1.0);
      }
    }
    
    return this.optimizeQualityToolAllocation(allocation);
  }
}
```

### Sequential Planner: 프로젝트 관리 도구
```typescript
// Sequential의 단계별 도구 관리 전략
class SequentialToolStrategy {
  private phaseToolMapping = {
    planning: {
      tools: ['task_decomposer', 'dependency_analyzer', 'timeline_planner', 'resource_estimator'],
      priority: 'high'
    },
    
    execution: {
      tools: ['step_executor', 'progress_monitor', 'validation_checker', 'bottleneck_detector'],
      priority: 'critical'
    },
    
    monitoring: {
      tools: ['progress_tracker', 'quality_gate', 'performance_analyzer', 'alert_system'],
      priority: 'medium'
    },
    
    reporting: {
      tools: ['progress_reporter', 'quality_assessor', 'completion_validator', 'analytics_generator'],
      priority: 'low'
    }
  };
  
  async allocateToolsForPhase(
    phase: string,
    stepContext: StepExecutionContext
  ): Promise<PhaseToolAllocation> {
    const phaseMapping = this.phaseToolMapping[phase];
    if (!phaseMapping) {
      throw new Error(`Unknown phase: ${phase}`);
    }
    
    // 기본 도구 할당
    const allocatedTools = [...phaseMapping.tools];
    
    // 단계 복잡도에 따른 추가 도구
    if (stepContext.complexity > 0.7) {
      const additionalTools = await this.selectAdditionalTools(phase, stepContext);
      allocatedTools.push(...additionalTools);
    }
    
    // 병렬 처리 지원 도구
    if (stepContext.allowParallel) {
      const parallelTools = ['parallel_coordinator', 'resource_balancer', 'sync_manager'];
      allocatedTools.push(...parallelTools);
    }
    
    return {
      phase,
      tools: this.deduplicateTools(allocatedTools),
      priority: phaseMapping.priority,
      allocation: this.calculateToolAllocation(allocatedTools, stepContext)
    };
  }
}
```

## 🤖 Layer 3: 에이전트별 동적 도구 할당

### 실시간 도구 할당 시스템
```typescript
// 에이전트별 동적 도구 관리
class DynamicToolAllocationSystem {
  async allocateToolsForAgent(
    agent: AgentInterface,
    context: ExecutionContext
  ): Promise<ToolAllocationResult> {
    // 현재 작업 분석
    const taskAnalysis = await this.analyzeCurrentTask(context);
    
    // 기존 도구 평가
    const currentTools = agent.getAvailableTools();
    const toolEffectiveness = await this.evaluateToolEffectiveness(currentTools, taskAnalysis);
    
    // 도구 재할당 필요성 판단
    const reallocationNeeded = await this.assessReallocationNeed(toolEffectiveness, taskAnalysis);
    
    if (reallocationNeeded.required) {
      // 새로운 도구 할당 수행
      const newAllocation = await this.performReallocation(agent, reallocationNeeded, taskAnalysis);
      return newAllocation;
    }
    
    return { status: 'no_change', currentTools };
  }
  
  private async performReallocation(
    agent: AgentInterface,
    need: ReallocationNeed,
    analysis: TaskAnalysis
  ): Promise<ToolAllocationResult> {
    // 불필요한 도구 제거
    if (need.toolsToRemove.length > 0) {
      await this.removeTools(agent, need.toolsToRemove);
    }
    
    // 새로운 도구 추가
    if (need.toolsToAdd.length > 0) {
      await this.addTools(agent, need.toolsToAdd);
    }
    
    // 도구 우선순위 조정
    if (need.priorityAdjustments.length > 0) {
      await this.adjustToolPriorities(agent, need.priorityAdjustments);
    }
    
    return {
      status: 'reallocated',
      removedTools: need.toolsToRemove,
      addedTools: need.toolsToAdd,
      adjustedPriorities: need.priorityAdjustments,
      newConfiguration: agent.getToolConfiguration()
    };
  }
}
```

### 적응적 도구 학습 시스템
```typescript
// 도구 사용 패턴 학습 및 최적화
class AdaptiveToolLearningSystem {
  private toolUsageHistory: Map<string, ToolUsageMetrics> = new Map();
  
  async learnFromToolUsage(
    agentId: string,
    toolUsageLog: ToolUsageLog[]
  ): Promise<LearningInsights> {
    // 도구 사용 패턴 분석
    const usagePatterns = this.analyzeUsagePatterns(toolUsageLog);
    
    // 효과성 메트릭 계산
    const effectivenessMetrics = this.calculateToolEffectiveness(toolUsageLog);
    
    // 최적화 기회 식별
    const optimizationOpportunities = await this.identifyOptimizations(
      usagePatterns,
      effectivenessMetrics
    );
    
    // 학습 결과 저장
    this.updateLearningModel(agentId, usagePatterns, effectivenessMetrics);
    
    return {
      patterns: usagePatterns,
      effectiveness: effectivenessMetrics,
      optimizations: optimizationOpportunities,
      recommendations: this.generateRecommendations(optimizationOpportunities)
    };
  }
  
  async recommendToolsForTask(
    taskType: string,
    context: TaskContext
  ): Promise<ToolRecommendation[]> {
    // 유사한 작업에서의 성공 패턴 검색
    const similarTasks = this.findSimilarTasks(taskType, context);
    const successfulPatterns = this.extractSuccessfulPatterns(similarTasks);
    
    // 도구 효과성 기반 추천
    const effectivenessBasedRecommendations = this.getEffectivenessBasedRecommendations(
      taskType,
      context
    );
    
    // 추천 결과 통합 및 순위 매기기
    const combinedRecommendations = this.combineRecommendations(
      successfulPatterns,
      effectivenessBasedRecommendations
    );
    
    return this.rankRecommendations(combinedRecommendations);
  }
}
```

## 🔄 하이브리드 도구 분배 전략

### 중앙집중 vs 분산 관리
```typescript
// 하이브리드 도구 분배 관리자
class HybridToolDistributionManager {
  async distributeTools(
    plannerType: string,
    agents: AgentInterface[],
    context: DistributionContext
  ): Promise<DistributionResult> {
    // 플래너 특성에 따른 분배 전략 선택
    const strategy = this.selectDistributionStrategy(plannerType, context);
    
    switch (strategy) {
      case 'centralized':
        return await this.centralizedDistribution(agents, context);
      
      case 'distributed':
        return await this.distributedDistribution(agents, context);
      
      case 'hybrid':
        return await this.hybridDistribution(agents, context);
      
      default:
        throw new Error(`Unknown distribution strategy: ${strategy}`);
    }
  }
  
  private async centralizedDistribution(
    agents: AgentInterface[],
    context: DistributionContext
  ): Promise<DistributionResult> {
    // 중앙에서 모든 도구 할당 결정
    const globalOptimization = await this.optimizeGlobalToolAllocation(agents, context);
    
    // 각 에이전트에 최적화된 도구 세트 할당
    const allocations = new Map<string, string[]>();
    
    for (const agent of agents) {
      const optimalTools = globalOptimization.getOptimalToolsForAgent(agent.getId());
      await this.assignTools(agent, optimalTools);
      allocations.set(agent.getId(), optimalTools);
    }
    
    return {
      strategy: 'centralized',
      allocations,
      globalEfficiency: globalOptimization.efficiency,
      resourceUtilization: globalOptimization.resourceUtilization
    };
  }
  
  private async distributedDistribution(
    agents: AgentInterface[],
    context: DistributionContext
  ): Promise<DistributionResult> {
    // 각 에이전트가 독립적으로 도구 선택
    const allocations = new Map<string, string[]>();
    
    for (const agent of agents) {
      const autonomousSelection = await this.autonomousToolSelection(agent, context);
      await this.assignTools(agent, autonomousSelection.tools);
      allocations.set(agent.getId(), autonomousSelection.tools);
    }
    
    // 분산 조정 메커니즘 적용
    const coordinationResult = await this.applyDistributedCoordination(allocations, context);
    
    return {
      strategy: 'distributed',
      allocations: coordinationResult.adjustedAllocations,
      autonomy: coordinationResult.autonomyLevel,
      coordination: coordinationResult.coordinationEffectiveness
    };
  }
  
  private async hybridDistribution(
    agents: AgentInterface[],
    context: DistributionContext
  ): Promise<DistributionResult> {
    // 핵심 도구는 중앙에서 관리, 전문 도구는 분산 관리
    const coreTools = await this.identifyCoreTools(context);
    const centralizedAllocation = await this.allocateCoreTools(agents, coreTools);
    
    // 전문 도구는 에이전트별 자율 선택
    const specializedAllocations = new Map<string, string[]>();
    
    for (const agent of agents) {
      const specializedTools = await this.selectSpecializedTools(agent, context);
      specializedAllocations.set(agent.getId(), specializedTools);
    }
    
    // 중앙집중 + 분산 결과 통합
    const hybridAllocations = this.mergeAllocations(centralizedAllocation, specializedAllocations);
    
    return {
      strategy: 'hybrid',
      allocations: hybridAllocations,
      centralizedTools: coreTools,
      distributedTools: this.extractDistributedTools(specializedAllocations),
      balance: this.calculateHybridBalance(centralizedAllocation, specializedAllocations)
    };
  }
}
```

## 📊 도구 성능 모니터링 및 최적화

### 도구 효과성 메트릭
```typescript
// 도구 성능 모니터링 시스템
const toolPerformanceMetrics = {
  utilization: {
    averageUsageRate: 0.73, // 평균 사용률
    peakUsageTime: '14:00-16:00', // 피크 사용 시간
    idleTime: 0.27, // 유휴 시간 비율
    resourceEfficiency: 0.85 // 리소스 효율성
  },
  
  effectiveness: {
    taskCompletionRate: 0.89, // 작업 완료율
    qualityImprovementScore: 0.76, // 품질 개선 점수
    timeReductionFactor: 0.34, // 시간 단축 비율
    errorReductionRate: 0.68 // 오류 감소율
  },
  
  adaptability: {
    learningSpeed: 0.62, // 학습 속도
    adaptationAccuracy: 0.79, // 적응 정확도
    flexibilityScore: 0.71, // 유연성 점수
    contextSensitivity: 0.84 // 상황 인식 능력
  },
  
  collaboration: {
    toolInteroperability: 0.91, // 도구 간 상호 운용성
    conflictResolutionRate: 0.87, // 충돌 해결률
    resourceSharingEfficiency: 0.78, // 리소스 공유 효율성
    coordinationQuality: 0.82 // 조정 품질
  }
};
```

## 📚 관련 문서

### 코어 시스템
- [Planning System Overview](../core-system/planning-overview.md) - 전체 시스템 개요
- [Planning Container](../core-system/planning-container.md) - 플래너 통합 관리
- [AgentFactory 확장](../core-system/agentfactory-expansion.md) - 에이전트 생성 엔진

### 플래너별 전략
- [CAMEL Planner](../planners/camel-planner.md) - 역할 기반 협업
- [ReAct Planner](../planners/react-planner.md) - 추론+행동 반복
- [Reflection Planner](../planners/reflection-planner.md) - 품질 개선 중심
- [Sequential Planner](../planners/sequential-planner.md) - 단계별 처리

### 도구 관리
- [도구 구현](./tool-implementation.md) - 구체적 구현 방법

### 구현 가이드
- [구현 로드맵](../implementation/implementation-roadmap.md) - 개발 계획
- [사용 예제](../implementation/usage-examples.md) - 실제 사용 사례

### 아키텍처
- [시스템 분석](../architecture/system-analysis.md) - 현재 시스템 분석
- [설계 패턴](../architecture/design-patterns.md) - 설계 원칙 및 패턴 