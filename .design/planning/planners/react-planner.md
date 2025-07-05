# ReAct Planner: 추론+행동 반복 플래닝

> 패키지: `@robota-sdk/planning-react`  
> 이 문서는 [Planning System Overview](../core-system/planning-overview.md)의 핵심 플래너 중 하나인 ReAct Planner에 대한 상세 설명입니다.

## 🎯 개요

ReAct (Reasoning + Acting) Planner는 **추론(Reasoning)과 행동(Acting)을 반복적으로 수행**하여 복잡한 문제를 탐색적으로 해결하는 플래닝 기법입니다. 사전에 정의된 계획보다는 상황에 따라 동적으로 판단하고 행동하며, 도구를 적극적으로 활용하는 것이 특징입니다.

## 🏗️ 핵심 특징

### 1. Thought-Action-Observation 사이클
- **Thought**: 현재 상황을 분석하고 다음 행동을 추론
- **Action**: 추론에 기반하여 구체적인 행동 실행 (도구 사용, 정보 수집 등)
- **Observation**: 행동 결과를 관찰하고 다음 추론에 반영

### 2. 완전 동적 생성 전략
- **상황적 판단**: 매 순간 "지금 뭘 해야 할까?" 스스로 결정
- **도구 기반 행동**: 필요에 따라 다른 도구/API 선택
- **탐색적 문제해결**: 미리 정의할 수 없는 창발적 해결책

### 3. 도구 중심 접근
- **동적 도구 선택**: 상황에 맞는 최적 도구 실시간 선택
- **도구 조합**: 여러 도구를 연계하여 복합적 문제 해결
- **학습적 도구 사용**: 도구 사용 패턴을 학습하여 효율성 향상

## 🔄 ReAct 사이클 아키텍처

### 기본 실행 흐름
```
🎯 ReAct Planner
├── 🤔 Thought Phase (추론 단계)
│   ├── 현재 상황 분석
│   ├── 목표와 현재 상태 비교
│   ├── 다음 행동 계획 수립
│   └── 도구 필요성 판단
├── ⚡ Action Phase (행동 단계)
│   ├── 도구 선택 및 실행
│   ├── 정보 수집
│   ├── 데이터 처리
│   └── 중간 결과 생성
├── 👁️ Observation Phase (관찰 단계)
│   ├── 행동 결과 분석
│   ├── 목표 달성도 평가
│   ├── 다음 사이클 준비
│   └── 종료 조건 검사
└── 🔁 Cycle Repeat (사이클 반복)
```

## 🔧 구현 및 사용법

### 1. 기본 설정 및 초기화

```typescript
import { ReActPlanner } from '@robota-sdk/planning-react';
import { AgentFactory } from '@robota-sdk/agents';

// AgentFactory 설정 (Provider 불가지론 준수)
const agentFactory = new AgentFactory({
  aiProviders: { 'primary': primaryProvider },
  currentProvider: 'primary',
  // ReAct는 다양한 도구가 핵심
  commonTools: ['web_search', 'calculator', 'file_system', 'api_caller'],
  autoInjectCommonTools: true,
  toolInjectionStrategy: {
    toolGroups: {
      'exploration': ['web_search', 'data_scraper', 'api_explorer'],
      'analysis': ['statistical_analyzer', 'pattern_detector', 'correlation_finder'],
      'processing': ['text_processor', 'data_transformer', 'format_converter'],
      'validation': ['fact_checker', 'source_validator', 'quality_analyzer']
    }
  }
});

// ReAct Planner 초기화
const reactPlanner = new ReActPlanner(agentFactory, {
  maxSteps: 15, // 최대 추론-행동 사이클 수
  maxThinkingTime: 30000, // 추론 단계 최대 시간 (30초)
  maxActionTime: 60000, // 행동 단계 최대 시간 (1분)
  
  // 가용 도구 풀 정의
  availableToolsPool: {
    core: ['web_search', 'calculator', 'text_processor'],
    exploration: ['data_scraper', 'api_explorer', 'pattern_detector'],
    analysis: ['statistical_analyzer', 'trend_analyzer', 'correlation_finder'],
    communication: ['email_sender', 'report_generator', 'visualization_tool']
  },
  
  // 동적 도구 선택 전략
  toolSelectionStrategy: {
    initial: 'core', // 초기에는 핵심 도구만
    allowDynamicExpansion: true, // 필요시 도구 확장
    llmToolSelection: true, // LLM이 도구 선택
    enableToolRecommendation: true // 도구 추천 시스템
  },
  
  // 종료 조건
  terminationConditions: {
    goalAchieved: true, // 목표 달성시 종료
    maxStepsReached: true, // 최대 단계 도달시 종료
    noProgress: { threshold: 3 }, // 3회 연속 진전 없으면 종료
    timeoutReached: true // 타임아웃시 종료
  }
});
```

## 🏗️ 아키텍처 설계

### 추상클래스 기반 설계
ReAct 플래너는 Robota 프레임워크의 `BasePlanner` 추상클래스를 상속받아 구현됩니다.

```typescript
// ReAct 플래너 구체적 구현
class ReActPlanner extends BasePlanner {
  private reasoningEngine: ReasoningEngine;
  private actionExecutor: ActionExecutor;
  private observationProcessor: ObservationProcessor;
  private toolGenerator: DynamicToolGenerator;
  private metacognitionSystem: MetacognitionSystem;
  
  async initialize(config: PlannerConfiguration): Promise<void> {
    // 상위 클래스 초기화
    await super.initialize(config);
    
    // ReAct 특화 컴포넌트 초기화
    this.reasoningEngine = new ReasoningEngine({
      maxIterations: config.maxIterations || 10,
      contextWindow: config.contextWindow || 8000,
      parallelThoughts: config.parallelThoughts || 3
    });
    
    this.actionExecutor = new ActionExecutor(config.actionConfig);
    this.observationProcessor = new ObservationProcessor(config.observationConfig);
    this.toolGenerator = new DynamicToolGenerator(config.toolGeneration);
    this.metacognitionSystem = new MetacognitionSystem(config.metacognition);
    
    // 추론+행동 전용 도구 등록
    this.registerReasoningTools();
    
    this.log(LogLevel.INFO, 'ReAct Planner initialized', { 
      maxIterations: config.maxIterations,
      toolsCount: this.toolRegistry.getToolCount()
    });
  }
  
  async createPlan(task: TaskDefinition): Promise<ExecutionPlan> {
    // 초기 추론 수행
    const initialThought = await this.reasoningEngine.initialReasoning(task);
    
    // 동적 계획 생성 (완전 동적 전략)
    const dynamicPlan = await this.generateDynamicPlan(task, initialThought);
    
    return new ReActExecutionPlan({
      taskId: task.id,
      initialThought,
      dynamicPlan,
      maxIterations: this.reasoningEngine.maxIterations,
      adaptiveStrategy: true
    });
  }
  
  async executePlan(plan: ExecutionPlan): Promise<ExecutionResult> {
    const reactPlan = plan as ReActExecutionPlan;
    let currentThought = reactPlan.initialThought;
    let iteration = 0;
    const executionTrace = [];
    
    while (iteration < reactPlan.maxIterations && !this.isTaskComplete(currentThought)) {
      // Thought: 현재 상황 분석 및 다음 행동 결정
      const thought = await this.reasoningEngine.think(currentThought);
      
      // Action: 결정된 행동 실행
      const action = await this.actionExecutor.execute(thought.plannedAction);
      
      // Observation: 행동 결과 관찰 및 분석
      const observation = await this.observationProcessor.process(action.result);
      
      // 실행 추적
      executionTrace.push({ thought, action, observation });
      
      // 다음 반복을 위한 컨텍스트 업데이트
      currentThought = await this.reasoningEngine.updateContext(thought, observation);
      
      // 메타인지 시스템을 통한 전략 조정
      await this.metacognitionSystem.adjustStrategy(executionTrace);
      
      iteration++;
    }
    
    // 최종 결과 생성
    const finalResult = await this.reasoningEngine.generateFinalResult(executionTrace);
    
    return {
      success: this.isTaskComplete(currentThought),
      result: finalResult,
      metrics: {
        iterations: iteration,
        executionTrace,
        reasoningMetrics: this.reasoningEngine.getMetrics()
      },
      plannerType: 'ReAct'
    };
  }
  
  // ReAct 특화 메서드
  async generateDynamicTool(requirement: ToolRequirement): Promise<DynamicTool> {
    return await this.toolGenerator.generateTool(requirement);
  }
  
  async optimizeReasoningStrategy(metrics: ReasoningMetrics): Promise<void> {
    await this.reasoningEngine.optimizeStrategy(metrics);
  }
  
  private registerReasoningTools(): void {
    // 추론+행동 전용 도구들 등록
    this.registerTool(new ThoughtAnalyzerTool());
    this.registerTool(new ActionSelectorTool());
    this.registerTool(new ObservationProcessorTool());
    this.registerTool(new DynamicToolGeneratorTool());
  }
}
```

### 2. ReAct 사이클 구현

```typescript
// ReAct 추론-행동-관찰 사이클 (상세 구현)
class ReActExecutionEngine {
  async execute(task: string): Promise<ReActExecutionResult> {
    let currentState = this.initializeState(task);
    const executionTrace: ReActStep[] = [];
    
    for (let step = 0; step < this.maxSteps; step++) {
      // Thought Phase: 현재 상황 추론
      const thought = await this.thinkingPhase(currentState, executionTrace);
      
      if (thought.shouldTerminate) {
        break;
      }
      
      // Action Phase: 추론 기반 행동 실행
      const action = await this.actionPhase(thought, currentState);
      
      // Observation Phase: 행동 결과 관찰
      const observation = await this.observationPhase(action, currentState);
      
      // 사이클 결과 기록
      const stepResult: ReActStep = {
        stepNumber: step + 1,
        thought: thought.reasoning,
        action: action.description,
        actionResult: action.result,
        observation: observation.analysis,
        newState: observation.updatedState,
        toolsUsed: action.toolsUsed,
        confidence: observation.confidence
      };
      
      executionTrace.push(stepResult);
      currentState = observation.updatedState;
      
      // 목표 달성 검사
      if (this.checkGoalAchievement(currentState, task)) {
        break;
      }
    }
    
    return this.synthesizeResults(executionTrace, currentState);
  }
  
  private async thinkingPhase(
    currentState: ReActState, 
    history: ReActStep[]
  ): Promise<ThoughtResult> {
    // 동적 에이전트 생성 (상황별 최적화)
    const thinkerAgent = await this.agentFactory.createFromPrompt(`
      You are an AI agent using ReAct methodology for problem-solving.
      
      Current task: ${currentState.originalTask}
      Current progress: ${currentState.progressSummary}
      Available tools: ${currentState.availableTools.join(', ')}
      Previous steps: ${history.length}
      
      Analyze the current situation and decide what to do next.
      Consider:
      1. What information do you still need?
      2. What tools would be most helpful?
      3. What is the logical next step?
      4. Are you close to achieving the goal?
      
      Think step by step and provide your reasoning.
    `, {
      taskType: 'analysis',
      timeConstraint: this.maxThinkingTime / 1000,
      qualityRequirement: 0.8
    });
    
    const reasoning = await thinkerAgent.process(`
      Analyze the current situation and plan the next action:
      
      Current State: ${JSON.stringify(currentState, null, 2)}
      Execution History: ${JSON.stringify(history.slice(-3), null, 2)}
      
      Provide your analysis in this format:
      1. Current situation assessment
      2. What we've learned so far
      3. What we still need to find out
      4. Recommended next action
      5. Expected outcome
      6. Should we terminate? (yes/no with reason)
    `);
    
    return this.parseThoughtResult(reasoning);
  }
  
  private async actionPhase(
    thought: ThoughtResult, 
    state: ReActState
  ): Promise<ActionResult> {
    // 추론 결과에 기반한 행동 실행
    const actionAgent = await this.agentFactory.createWithConditions({
      role: 'executor',
      taskType: thought.recommendedActionType,
      toolRequirements: thought.requiredTools,
      qualityLevel: 'standard'
    });
    
    // 필요한 도구들을 동적으로 할당
    const selectedTools = await this.selectToolsForAction(thought);
    await this.assignToolsToAgent(actionAgent, selectedTools);
    
    // 행동 실행
    const actionResult = await actionAgent.process(thought.actionPlan);
    
    return {
      description: thought.actionPlan,
      result: actionResult,
      toolsUsed: selectedTools,
      executionTime: Date.now() - thought.startTime,
      success: this.evaluateActionSuccess(actionResult, thought.expectedOutcome)
    };
  }
  
  private async observationPhase(
    action: ActionResult, 
    state: ReActState
  ): Promise<ObservationResult> {
    // 행동 결과 분석 및 상태 업데이트
    const observerAgent = await this.agentFactory.createFromPrompt(`
      You are an observer analyzing the results of an action in a ReAct cycle.
      
      Original task: ${state.originalTask}
      Action taken: ${action.description}
      Action result: ${action.result}
      
      Analyze what we learned and how this advances our goal.
      Update the current state of progress.
    `, {
      taskType: 'analysis',
      qualityRequirement: 0.9
    });
    
    const analysis = await observerAgent.process(`
      Analyze this action result:
      
      Action: ${action.description}
      Result: ${action.result}
      Success: ${action.success}
      Tools Used: ${action.toolsUsed.join(', ')}
      
      Provide analysis in this format:
      1. What did we learn from this action?
      2. How does this advance our goal?
      3. What new information do we have?
      4. What should we focus on next?
      5. Confidence level (0-1) in current progress
      6. Updated progress summary
    `);
    
    return this.parseObservationResult(analysis, state);
  }
}
```

### 3. 동적 도구 선택 시스템

```typescript
// 상황별 최적 도구 선택
class ToolSelectionEngine {
  async selectToolsForAction(thought: ThoughtResult): Promise<string[]> {
    const baseTools = ['text_processor']; // 기본 도구
    
    // 추론 결과에 따른 도구 선택
    if (thought.needsWebSearch) {
      baseTools.push('web_search', 'data_scraper');
    }
    
    if (thought.needsCalculation) {
      baseTools.push('calculator', 'statistical_analyzer');
    }
    
    if (thought.needsDataAnalysis) {
      baseTools.push('pattern_detector', 'correlation_finder', 'trend_analyzer');
    }
    
    if (thought.needsCommunication) {
      baseTools.push('email_sender', 'report_generator');
    }
    
    // LLM 기반 추가 도구 추천
    const recommendedTools = await this.llmBasedToolRecommendation(thought);
    
    return [...new Set([...baseTools, ...recommendedTools])];
  }
  
  private async llmBasedToolRecommendation(thought: ThoughtResult): Promise<string[]> {
    const toolRecommenderAgent = await this.agentFactory.createFromPrompt(`
      You are a tool recommendation specialist.
      Given a planned action, recommend the most suitable tools.
      
      Available tools: ${this.getAllAvailableTools().join(', ')}
      Planned action: ${thought.actionPlan}
      Expected outcome: ${thought.expectedOutcome}
      
      Recommend 2-5 tools that would be most helpful for this action.
    `);
    
    const recommendation = await toolRecommenderAgent.process(
      `Recommend tools for: ${thought.actionPlan}`
    );
    
    return this.parseToolRecommendation(recommendation);
  }
}
```

### 4. 적응적 학습 시스템

```typescript
// ReAct 패턴 학습 및 최적화
class ReActLearningSystem {
  private actionPatterns: Map<string, ActionPattern> = new Map();
  private toolEffectiveness: Map<string, ToolMetrics> = new Map();
  
  async learnFromExecution(trace: ReActStep[]): Promise<LearningInsights> {
    // 성공적인 행동 패턴 학습
    const successfulPatterns = trace
      .filter(step => step.confidence > 0.7)
      .map(step => ({
        situation: step.thought,
        action: step.action,
        tools: step.toolsUsed,
        outcome: step.observation
      }));
    
    // 도구 효과성 분석
    const toolUsage = this.analyzeToolUsage(trace);
    
    // 패턴 저장 및 업데이트
    successfulPatterns.forEach(pattern => {
      this.updateActionPattern(pattern);
    });
    
    toolUsage.forEach((metrics, tool) => {
      this.updateToolMetrics(tool, metrics);
    });
    
    return {
      newPatterns: successfulPatterns.length,
      updatedTools: toolUsage.size,
      recommendations: this.generateRecommendations()
    };
  }
  
  async suggestOptimizations(
    currentThought: ThoughtResult
  ): Promise<OptimizationSuggestions> {
    // 유사한 상황에서의 성공 패턴 검색
    const similarPatterns = this.findSimilarPatterns(currentThought);
    
    // 도구 효과성 기반 추천
    const toolRecommendations = this.recommendToolsBasedOnHistory(currentThought);
    
    return {
      suggestedActions: similarPatterns.map(p => p.action),
      recommendedTools: toolRecommendations,
      confidenceBoost: this.calculateConfidenceBoost(similarPatterns)
    };
  }
}
```

## 🎯 실제 사용 시나리오

### 시나리오 1: 복잡한 데이터 분석

```typescript
// 탐색적 데이터 분석 프로젝트
const analysisResult = await reactPlanner.execute(`
  온라인 쇼핑몰의 매출 데이터를 분석해서 다음을 찾아주세요:
  
  1. 매출 감소의 주요 원인
  2. 고객 행동 패턴의 변화
  3. 개선 방안 제안
  
  데이터 소스:
  - 매출 데이터 (CSV 파일)
  - 고객 행동 로그 (JSON)
  - 외부 시장 데이터 (API)
`);

// ReAct 실행 과정 예시:
// Step 1: Thought - "먼저 데이터 구조를 파악해야겠다"
//         Action - CSV 파일 로드 및 스키마 분석
//         Observation - "매출 데이터는 일별/제품별로 구성됨"

// Step 2: Thought - "매출 감소 시점을 찾아보자"
//         Action - 시계열 분석 및 트렌드 감지
//         Observation - "3월부터 급격한 감소 시작"

// Step 3: Thought - "3월에 무슨 일이 있었는지 외부 데이터 확인"
//         Action - 외부 시장 API 호출
//         Observation - "경쟁사 프로모션 시작 시점과 일치"
```

### 시나리오 2: 실시간 문제 해결

```typescript
// 실시간 시스템 문제 진단
const diagnosticResult = await reactPlanner.execute(`
  웹 서비스에서 응답 속도가 급격히 느려졌습니다.
  원인을 찾고 해결 방안을 제시해주세요.
  
  증상:
  - API 응답시간 10배 증가
  - 사용자 불만 급증
  - 서버 리소스 사용률 정상
`);

// ReAct 실행 과정:
// Step 1: Thought - "시스템 메트릭부터 확인해보자"
//         Action - 모니터링 API 호출
//         Observation - "CPU/메모리는 정상, 네트워크 지연 발견"

// Step 2: Thought - "네트워크 경로를 추적해보자"
//         Action - traceroute 및 ping 테스트
//         Observation - "특정 ISP 구간에서 패킷 손실"

// Step 3: Thought - "DNS 문제일 수도 있다"
//         Action - DNS 조회 시간 측정
//         Observation - "DNS 응답 시간 정상"
```

### 시나리오 3: 창의적 연구 프로젝트

```typescript
// 새로운 기술 트렌드 탐색
const researchResult = await reactPlanner.execute(`
  "메타버스와 AI의 융합"이라는 주제로 혁신적인 비즈니스 아이디어를 
  연구하고 구체적인 사업 계획을 수립해주세요.
  
  목표:
  - 기존에 없던 새로운 접근법 발견
  - 기술적 실현 가능성 검증
  - 시장성 분석
  - 구체적 실행 계획
`);

// ReAct의 창발적 문제해결:
// - 예상치 못한 연결고리 발견
// - 다양한 정보원 탐색
// - 가설 수립 → 검증 → 수정 반복
// - 창의적 아이디어 도출
```

## 🔧 고급 기능 및 최적화

### 1. 메타인지 시스템

```typescript
// ReAct의 자기 성찰 및 개선
class MetaCognitionSystem {
  async reflectOnPerformance(trace: ReActStep[]): Promise<MetaInsights> {
    // 실행 과정 자체를 분석
    const metaAgent = await this.agentFactory.createFromPrompt(`
      You are a meta-cognitive analyzer examining a ReAct execution trace.
      Analyze the thinking patterns, decision quality, and overall effectiveness.
    `);
    
    const metaAnalysis = await metaAgent.process(`
      Analyze this ReAct execution:
      
      Steps taken: ${trace.length}
      Success rate: ${this.calculateSuccessRate(trace)}
      Tool usage patterns: ${this.analyzeToolPatterns(trace)}
      
      Questions to consider:
      1. Were the reasoning steps logical and well-connected?
      2. Could any steps have been skipped or combined?
      3. Were the right tools chosen at the right times?
      4. What patterns of thinking led to the best results?
      5. How can future executions be improved?
    `);
    
    return this.parseMetaInsights(metaAnalysis);
  }
  
  async adaptStrategy(insights: MetaInsights): Promise<StrategyAdjustment> {
    // 메타 분석 결과를 바탕으로 전략 조정
    return {
      adjustedMaxSteps: this.optimizeStepCount(insights),
      improvedToolSelection: this.enhanceToolStrategy(insights),
      refinedTerminationConditions: this.optimizeTermination(insights),
      updatedPromptTemplates: this.improvePrompts(insights)
    };
  }
}
```

### 2. 병렬 추론 시스템

```typescript
// 복잡한 문제를 위한 병렬 ReAct
class ParallelReActSystem {
  async executeParallelReAct(
    task: string, 
    parallelBranches: number = 3
  ): Promise<ParallelReActResult> {
    // 여러 ReAct 에이전트가 동시에 다른 접근법으로 문제 해결
    const branches = await Promise.all(
      Array(parallelBranches).fill(null).map(async (_, index) => {
        const branchAgent = await this.agentFactory.createWithConditions({
          role: `react_explorer_${index}`,
          taskType: 'exploration',
          collaborationStyle: 'independent',
          creativityLevel: 0.7 + (index * 0.1) // 각 브랜치마다 다른 창의성 수준
        });
        
        return this.executeBranch(branchAgent, task, index);
      })
    );
    
    // 브랜치 결과 통합 및 최적해 선택
    return this.synthesizeBranches(branches);
  }
  
  private async executeBranch(
    agent: AgentInterface, 
    task: string, 
    branchId: number
  ): Promise<ReActBranch> {
    // 각 브랜치는 독립적인 ReAct 사이클 실행
    const branchResult = await this.runIndependentReAct(agent, task, {
      explorationBias: branchId * 0.2, // 브랜치별 탐색 편향
      riskTolerance: 0.5 + (branchId * 0.1),
      toolPreference: this.getBranchToolPreference(branchId)
    });
    
    return {
      branchId,
      result: branchResult,
      uniqueInsights: this.extractUniqueInsights(branchResult),
      confidence: this.calculateBranchConfidence(branchResult)
    };
  }
}
```

## 📊 성능 메트릭 및 모니터링

### ReAct 특화 메트릭

```typescript
// ReAct 실행 성능 분석
const reactMetrics = {
  executionEfficiency: {
    averageStepsToGoal: 8.5,
    stepSuccessRate: 0.78,
    toolSelectionAccuracy: 0.85,
    reasoningCoherence: 0.82
  },
  
  adaptiveCapabilities: {
    problemRecoveryRate: 0.73, // 막다른 길에서 회복 능력
    goalAdjustmentFlexibility: 0.88, // 목표 조정 유연성
    toolLearningSpeed: 0.65, // 새로운 도구 학습 속도
    patternRecognition: 0.79 // 유사 패턴 인식 능력
  },
  
  explorationQuality: {
    informationDiscoveryRate: 0.71, // 새로운 정보 발견율
    hypothesisValidationAccuracy: 0.84, // 가설 검증 정확도
    creativeSolutionGeneration: 0.67, // 창의적 해결책 생성
    unexpectedConnectionFinding: 0.58 // 예상치 못한 연결 발견
  }
};
```

## 📚 관련 문서

### 코어 시스템
- [Planning System Overview](../core-system/planning-overview.md) - 전체 시스템 개요
- [Planning Container](../core-system/planning-container.md) - 플래너 통합 관리
- [AgentFactory 확장](../core-system/agentfactory-expansion.md) - 에이전트 생성 엔진

### 다른 플래너들
- [CAMEL Planner](./camel-planner.md) - 역할 기반 협업
- [Reflection Planner](./reflection-planner.md) - 품질 개선 중심
- [Sequential Planner](./sequential-planner.md) - 단계별 처리

### 도구 관리
- [도구 아키텍처](../tool-management/tool-architecture.md) - 도구 관리 전략
- [도구 구현](../tool-management/tool-implementation.md) - 구체적 구현 방법

### 구현 가이드
- [구현 로드맵](../implementation/implementation-roadmap.md) - 개발 계획
- [사용 예제](../implementation/usage-examples.md) - 실제 사용 사례

### 아키텍처
- [시스템 분석](../architecture/system-analysis.md) - 현재 시스템 분석
- [설계 패턴](../architecture/design-patterns.md) - 설계 원칙 및 패턴 