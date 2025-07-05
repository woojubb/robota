# Reflection Planner: 품질 개선 중심 플래닝

> 패키지: `@robota-sdk/planning-reflection`  
> 이 문서는 [Planning System Overview](../core-system/planning-overview.md)의 핵심 플래너 중 하나인 Reflection Planner에 대한 상세 설명입니다.

## 🎯 개요

Reflection Planner는 **자기 성찰과 반복적 개선**을 통해 높은 품질의 결과물을 생성하는 플래닝 기법입니다. 첫 번째 시도에서 완벽한 결과를 얻기보다는, 지속적인 검토와 개선을 통해 점진적으로 품질을 향상시키는 것이 특징입니다.

## 🏗️ 핵심 특징

### 1. 자기 성찰 기반 개선
- **자기 평가**: 자신의 작업 결과를 객관적으로 평가
- **약점 식별**: 부족한 부분과 개선 포인트 발견
- **전략 조정**: 발견된 문제점을 바탕으로 접근법 수정

### 2. 반복적 정제 프로세스
- **Draft → Review → Refine**: 초안 작성 → 검토 → 개선의 반복
- **다각도 검토**: 다양한 관점에서 결과물 검토
- **점진적 향상**: 각 반복마다 품질 개선

### 3. 품질 중심 접근
- **높은 품질 기준**: 일반적인 결과보다 우수한 품질 추구
- **철저한 검증**: 다중 검증 단계를 통한 정확성 확보
- **완성도 중심**: 시간이 걸리더라도 완성도 있는 결과 추구

## 🔄 Reflection 사이클 아키텍처

### 기본 실행 흐름
```
🎯 Reflection Planner
├── 📝 Generation Phase (생성 단계)
│   ├── 초기 아이디어 생성
│   ├── 기본 구조 설계
│   ├── 초안 작성
│   └── 기본 요구사항 충족 확인
├── 🔍 Reflection Phase (성찰 단계)
│   ├── 자기 평가 수행
│   ├── 약점 및 개선점 식별
│   ├── 품질 기준 대비 평가
│   └── 개선 전략 수립
├── ✨ Refinement Phase (개선 단계)
│   ├── 식별된 문제점 수정
│   ├── 품질 향상 작업
│   ├── 추가 정보 보완
│   └── 구조 및 내용 개선
└── 🔁 Iteration Cycle (반복 사이클)
    ├── 품질 목표 달성 검사
    ├── 추가 개선 필요성 판단
    └── 다음 반복 또는 완료 결정
```

## 🔧 구현 및 사용법

### 1. 기본 설정 및 초기화

```typescript
import { ReflectionPlanner } from '@robota-sdk/planning-reflection';
import { AgentFactory } from '@robota-sdk/agents';

// AgentFactory 설정 (Provider 불가지론 준수)
const agentFactory = new AgentFactory({
  aiProviders: [primaryProvider],
  defaultModel: {
    provider: 'primary',
    model: 'gpt-4'
  },
  // Reflection은 품질 검증 도구가 중요
  commonTools: ['quality_checker', 'fact_validator', 'style_analyzer', 'grammar_checker'],
  autoInjectCommonTools: true,
  toolInjectionStrategy: {
    toolGroups: {
      'quality_assurance': ['grammar_checker', 'style_analyzer', 'coherence_checker'],
      'validation': ['fact_checker', 'source_validator', 'citation_checker'],
      'improvement': ['content_enhancer', 'structure_optimizer', 'clarity_improver'],
      'analysis': ['readability_analyzer', 'completeness_checker', 'bias_detector']
    }
  }
});

// Reflection Planner 초기화
const reflectionPlanner = new ReflectionPlanner(agentFactory, {
  maxIterations: 5, // 최대 반복 개선 횟수
  qualityThreshold: 0.85, // 목표 품질 점수 (0-1)
  minIterations: 2, // 최소 반복 횟수 (품질 보장)
  
  // 품질 평가 기준
  qualityMetrics: {
    accuracy: { weight: 0.3, threshold: 0.9 },
    completeness: { weight: 0.25, threshold: 0.8 },
    clarity: { weight: 0.2, threshold: 0.85 },
    coherence: { weight: 0.15, threshold: 0.8 },
    originality: { weight: 0.1, threshold: 0.7 }
  },
  
  // 개선 전략
  improvementStrategies: {
    contentEnhancement: true, // 내용 개선
    structureOptimization: true, // 구조 최적화
    styleRefinement: true, // 스타일 개선
    factualCorrection: true, // 사실 확인 및 수정
    clarityImprovement: true // 명확성 향상
  },
  
  // 반복 종료 조건
  terminationConditions: {
    qualityThresholdMet: true, // 품질 기준 달성
    maxIterationsReached: true, // 최대 반복 도달
    noSignificantImprovement: { threshold: 0.02, consecutiveCount: 2 }, // 개선 정체
    diminishingReturns: { threshold: 0.01 } // 수익 감소
  }
});
```

### 2. Reflection 사이클 구현

```typescript
// Reflection 생성-성찰-개선 사이클
class ReflectionPlanner {
  async execute(task: string): Promise<ReflectionExecutionResult> {
    let currentDraft = await this.initialGeneration(task);
    const iterationHistory: ReflectionIteration[] = [];
    
    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      // Reflection Phase: 현재 결과 자기 평가
      const reflection = await this.reflectionPhase(currentDraft, task, iterationHistory);
      
      // 품질 기준 달성 검사
      if (this.shouldTerminate(reflection, iteration)) {
        break;
      }
      
      // Refinement Phase: 개선 작업 수행
      const refinedDraft = await this.refinementPhase(currentDraft, reflection);
      
      // 반복 결과 기록
      const iterationResult: ReflectionIteration = {
        iterationNumber: iteration + 1,
        originalDraft: currentDraft,
        reflection: reflection.analysis,
        improvementPlan: reflection.improvementPlan,
        refinedDraft: refinedDraft,
        qualityScores: reflection.qualityScores,
        improvementAreas: reflection.improvementAreas
      };
      
      iterationHistory.push(iterationResult);
      currentDraft = refinedDraft;
    }
    
    return this.synthesizeResults(currentDraft, iterationHistory);
  }
  
  private async initialGeneration(task: string): Promise<string> {
    // 초기 결과물 생성 (완벽하지 않아도 됨)
    const generatorAgent = await this.agentFactory.createFromPrompt(`
      You are an AI assistant creating an initial draft response.
      Focus on covering all the basic requirements, but don't worry about perfection.
      This is the first draft that will be improved through reflection.
      
      Task: ${task}
      
      Create a comprehensive initial response that addresses all aspects of the task.
      Prioritize completeness over perfection.
    `, {
      taskType: 'generation',
      qualityRequirement: 0.6, // 초기 생성은 낮은 품질 기준
      creativityLevel: 0.7
    });
    
    return await generatorAgent.process(task);
  }
  
  private async reflectionPhase(
    currentDraft: string, 
    originalTask: string, 
    history: ReflectionIteration[]
  ): Promise<ReflectionResult> {
    // 자기 성찰 및 평가 수행
    const reflectorAgent = await this.agentFactory.createFromPrompt(`
      You are a critical evaluator performing self-reflection on work quality.
      
      Original task: ${originalTask}
      Current draft: ${currentDraft}
      Previous iterations: ${history.length}
      
      Analyze the current draft thoroughly and identify areas for improvement.
      Be honest about weaknesses and specific about what needs to be enhanced.
    `, {
      taskType: 'analysis',
      qualityRequirement: 0.9, // 평가는 높은 품질 기준
      criticalThinking: true
    });
    
    // 품질 평가 도구 할당
    await this.assignQualityTools(reflectorAgent);
    
    const reflectionAnalysis = await reflectorAgent.process(`
      Perform a comprehensive evaluation of this draft:
      
      ${currentDraft}
      
      Evaluate based on these criteria:
      1. Accuracy: Are all facts correct and well-supported?
      2. Completeness: Are all aspects of the task addressed?
      3. Clarity: Is the content clear and easy to understand?
      4. Coherence: Is the structure logical and well-organized?
      5. Originality: Does it provide unique insights or perspectives?
      
      For each criterion:
      - Give a score (0-1)
      - Identify specific weaknesses
      - Suggest concrete improvements
      
      Also identify the top 3 priority areas for improvement.
    `);
    
    return this.parseReflectionResult(reflectionAnalysis);
  }
  
  private async refinementPhase(
    currentDraft: string, 
    reflection: ReflectionResult
  ): Promise<string> {
    // 성찰 결과 기반 개선 작업
    const refinerAgent = await this.agentFactory.createFromPrompt(`
      You are an expert editor focused on improving content quality.
      
      Current draft: ${currentDraft}
      Identified issues: ${reflection.improvementAreas.join(', ')}
      Improvement plan: ${reflection.improvementPlan}
      
      Refine the draft to address all identified issues while maintaining the core content.
      Focus on the highest priority improvements first.
    `, {
      taskType: 'refinement',
      qualityRequirement: 0.85,
      focusAreas: reflection.improvementAreas
    });
    
    // 개선 도구 할당
    await this.assignImprovementTools(refinerAgent, reflection.improvementAreas);
    
    const refinedDraft = await refinerAgent.process(`
      Improve this draft based on the reflection analysis:
      
      Original: ${currentDraft}
      
      Priority improvements:
      ${reflection.improvementPlan}
      
      Specific areas to address:
      ${reflection.improvementAreas.map((area, index) => `${index + 1}. ${area}`).join('\n')}
      
      Provide the improved version while maintaining the original intent and core message.
    `);
    
    return refinedDraft;
  }
}
```

### 3. 다각도 품질 평가 시스템

```typescript
// 종합적 품질 평가 엔진
class QualityAssessmentEngine {
  async comprehensiveEvaluation(
    content: string, 
    task: string
  ): Promise<QualityAssessment> {
    // 병렬로 다양한 관점에서 평가
    const evaluations = await Promise.all([
      this.evaluateAccuracy(content, task),
      this.evaluateCompleteness(content, task),
      this.evaluateClarity(content),
      this.evaluateCoherence(content),
      this.evaluateOriginality(content, task)
    ]);
    
    return this.synthesizeEvaluations(evaluations);
  }
  
  private async evaluateAccuracy(content: string, task: string): Promise<AccuracyScore> {
    const accuracyAgent = await this.agentFactory.createFromPrompt(`
      You are a fact-checking specialist evaluating content accuracy.
      Focus on identifying factual errors, unsupported claims, and misleading information.
    `);
    
    await this.assignTools(accuracyAgent, ['fact_checker', 'source_validator', 'citation_checker']);
    
    const analysis = await accuracyAgent.process(`
      Evaluate the factual accuracy of this content:
      
      ${content}
      
      Check for:
      1. Factual errors or inaccuracies
      2. Unsupported claims
      3. Outdated information
      4. Misleading statements
      5. Missing citations for claims
      
      Provide a score (0-1) and list specific issues found.
    `);
    
    return this.parseAccuracyScore(analysis);
  }
  
  private async evaluateCompleteness(content: string, task: string): Promise<CompletenessScore> {
    const completenessAgent = await this.agentFactory.createFromPrompt(`
      You are a completeness evaluator checking if all task requirements are met.
      Compare the content against the original task requirements.
    `);
    
    const analysis = await completenessAgent.process(`
      Evaluate how completely this content addresses the task:
      
      Original task: ${task}
      Content: ${content}
      
      Check if all aspects of the task are covered:
      1. Are all questions answered?
      2. Are all requirements met?
      3. Are there any missing elements?
      4. Is the scope appropriate?
      
      Provide a score (0-1) and identify any gaps.
    `);
    
    return this.parseCompletenessScore(analysis);
  }
  
  private async evaluateClarity(content: string): Promise<ClarityScore> {
    const clarityAgent = await this.agentFactory.createFromPrompt(`
      You are a clarity and readability expert evaluating content comprehensibility.
      Focus on how easy it is to understand and follow the content.
    `);
    
    await this.assignTools(clarityAgent, ['readability_analyzer', 'grammar_checker', 'style_analyzer']);
    
    const analysis = await clarityAgent.process(`
      Evaluate the clarity and readability of this content:
      
      ${content}
      
      Consider:
      1. Sentence structure and length
      2. Vocabulary appropriateness
      3. Logical flow of ideas
      4. Use of examples and explanations
      5. Overall comprehensibility
      
      Provide a score (0-1) and suggest specific clarity improvements.
    `);
    
    return this.parseClarityScore(analysis);
  }
}
```

### 4. 적응적 개선 전략

```typescript
// 상황별 최적 개선 전략 선택
class AdaptiveImprovementStrategy {
  async selectImprovementStrategy(
    reflection: ReflectionResult,
    iterationHistory: ReflectionIteration[]
  ): Promise<ImprovementStrategy> {
    // 이전 반복에서의 개선 패턴 분석
    const improvementPatterns = this.analyzeImprovementPatterns(iterationHistory);
    
    // 현재 약점 분석
    const weaknessAnalysis = this.analyzeWeaknesses(reflection);
    
    // 가장 효과적인 개선 전략 선택
    const strategy = this.selectOptimalStrategy(improvementPatterns, weaknessAnalysis);
    
    return strategy;
  }
  
  private analyzeImprovementPatterns(history: ReflectionIteration[]): ImprovementPatterns {
    const patterns = {
      mostEffectiveAreas: new Map<string, number>(),
      diminishingReturns: new Map<string, number>(),
      consistentIssues: new Set<string>()
    };
    
    // 각 반복에서의 개선 효과 분석
    history.forEach((iteration, index) => {
      if (index > 0) {
        const previousIteration = history[index - 1];
        const improvement = this.calculateImprovement(
          previousIteration.qualityScores,
          iteration.qualityScores
        );
        
        // 개선 효과가 높은 영역 식별
        Object.entries(improvement).forEach(([area, score]) => {
          const current = patterns.mostEffectiveAreas.get(area) || 0;
          patterns.mostEffectiveAreas.set(area, current + score);
        });
      }
    });
    
    return patterns;
  }
  
  private async executeTargetedImprovement(
    content: string,
    targetArea: string,
    strategy: ImprovementStrategy
  ): Promise<string> {
    // 특정 영역에 집중한 개선 작업
    const specialistAgent = await this.agentFactory.createWithConditions({
      role: `${targetArea}_specialist`,
      taskType: 'improvement',
      expertise: targetArea,
      qualityLevel: 'premium'
    });
    
    const targetedTools = this.getToolsForArea(targetArea);
    await this.assignTools(specialistAgent, targetedTools);
    
    const improvedContent = await specialistAgent.process(`
      Improve this content specifically for ${targetArea}:
      
      ${content}
      
      Strategy: ${strategy.description}
      Focus areas: ${strategy.focusAreas.join(', ')}
      
      Apply targeted improvements while maintaining overall quality.
    `);
    
    return improvedContent;
  }
}
```

## 🎯 실제 사용 시나리오

### 시나리오 1: 학술 논문 작성

```typescript
// 고품질 학술 논문 작성
const academicPaper = await reflectionPlanner.execute(`
  "AI 윤리 가이드라인의 실무 적용 방안"에 대한 학술 논문을 작성해주세요.
  
  요구사항:
  - 8,000-10,000자 분량
  - 최신 연구 동향 반영
  - 실제 사례 분석 포함
  - 구체적 실행 방안 제시
  - 학술적 엄밀성 확보
`);

// Reflection 개선 과정:
// Iteration 1: 초기 논문 구조 및 내용 생성
// Reflection 1: "인용이 부족하고 사례 분석이 표면적"
// Refinement 1: 참고문헌 추가, 사례 분석 심화

// Iteration 2: 개선된 버전 검토
// Reflection 2: "논리적 연결성 부족, 결론 부분 약함"
// Refinement 2: 단락 간 연결 강화, 결론 부분 확장

// Iteration 3: 최종 품질 검증
// Reflection 3: "전반적 품질 향상, 미세 조정 필요"
// Refinement 3: 문체 통일, 표현 정제
```

### 시나리오 2: 비즈니스 제안서 작성

```typescript
// 고품질 비즈니스 제안서
const businessProposal = await reflectionPlanner.execute(`
  신규 AI 서비스 런칭을 위한 투자 제안서를 작성해주세요.
  
  서비스 개요:
  - AI 기반 개인화 학습 플랫폼
  - 타겟: 직장인 재교육 시장
  - 투자 규모: 50억원
  - 기대 수익률: 연 30%
  
  제안서 요구사항:
  - 시장 분석 및 경쟁 분석
  - 비즈니스 모델 및 수익 구조
  - 기술적 차별화 포인트
  - 재무 계획 및 투자 회수 계획
  - 리스크 분석 및 대응 방안
`);

// Reflection 품질 개선:
// - 시장 데이터 정확성 검증
// - 재무 모델 논리성 강화
// - 경쟁사 분석 심화
// - 리스크 시나리오 구체화
```

### 시나리오 3: 창의적 콘텐츠 제작

```typescript
// 고품질 창의적 콘텐츠
const creativeContent = await reflectionPlanner.execute(`
  브랜드 스토리텔링을 위한 창의적 콘텐츠를 제작해주세요.
  
  브랜드: 지속가능한 패션 브랜드
  메시지: "진정한 아름다움은 지속가능성에서 나온다"
  형식: 블로그 포스트 시리즈 (3편)
  톤앤매너: 감성적이면서도 정보적
  
  목표:
  - 브랜드 가치 전달
  - 고객 감정 연결
  - 행동 변화 유도
  - 바이럴 가능성 확보
`);

// Reflection 창의성 개선:
// - 스토리텔링 구조 강화
// - 감정적 연결 포인트 확대
// - 시각적 요소 제안 추가
// - 독창성 및 차별화 요소 강화
```

## 🔧 고급 기능 및 최적화

### 1. 메타 리플렉션 시스템

```typescript
// 성찰 과정 자체를 성찰하는 메타 시스템
class MetaReflectionSystem {
  async reflectOnReflectionProcess(
    iterationHistory: ReflectionIteration[]
  ): Promise<MetaReflectionInsights> {
    // 성찰 과정의 효과성 분석
    const metaReflector = await this.agentFactory.createFromPrompt(`
      You are a meta-cognitive analyst examining the reflection process itself.
      Analyze how well the reflection and refinement process worked.
    `);
    
    const processAnalysis = await metaReflector.process(`
      Analyze this reflection process:
      
      Total iterations: ${iterationHistory.length}
      Quality progression: ${this.getQualityProgression(iterationHistory)}
      Improvement areas: ${this.getImprovementAreas(iterationHistory)}
      
      Evaluate:
      1. Was the reflection process effective?
      2. Were the right issues identified?
      3. Were the improvements successful?
      4. What patterns emerge in the reflection process?
      5. How can the reflection process itself be improved?
    `);
    
    return this.parseMetaReflectionInsights(processAnalysis);
  }
  
  async optimizeReflectionStrategy(
    insights: MetaReflectionInsights
  ): Promise<OptimizedReflectionStrategy> {
    // 메타 분석 결과를 바탕으로 성찰 전략 최적화
    return {
      adjustedQualityMetrics: this.optimizeQualityMetrics(insights),
      improvedReflectionPrompts: this.enhanceReflectionPrompts(insights),
      refinedTerminationCriteria: this.optimizeTerminationCriteria(insights),
      adaptiveIterationStrategy: this.createAdaptiveStrategy(insights)
    };
  }
}
```

### 2. 협업적 리플렉션

```typescript
// 다중 관점 협업 성찰 시스템
class CollaborativeReflectionSystem {
  async multiPerspectiveReflection(
    content: string,
    task: string
  ): Promise<CollaborativeReflectionResult> {
    // 다양한 전문가 관점에서 동시 성찰
    const perspectives = ['technical', 'creative', 'business', 'user_experience', 'ethical'];
    
    const reflections = await Promise.all(
      perspectives.map(async (perspective) => {
        const expertAgent = await this.agentFactory.createWithConditions({
          role: `${perspective}_expert`,
          taskType: 'evaluation',
          expertise: perspective,
          criticalThinking: true
        });
        
        return this.getPerspectiveReflection(expertAgent, content, task, perspective);
      })
    );
    
    // 다양한 관점의 성찰 결과 통합
    return this.synthesizeCollaborativeReflections(reflections);
  }
  
  private async getPerspectiveReflection(
    agent: AgentInterface,
    content: string,
    task: string,
    perspective: string
  ): Promise<PerspectiveReflection> {
    const reflection = await agent.process(`
      Evaluate this content from a ${perspective} perspective:
      
      Task: ${task}
      Content: ${content}
      
      Focus on ${perspective}-specific aspects:
      ${this.getPerspectiveGuidelines(perspective)}
      
      Provide specific feedback and improvement suggestions.
    `);
    
    return {
      perspective,
      analysis: reflection,
      priority: this.calculatePerspectivePriority(perspective, task),
      suggestions: this.extractSuggestions(reflection)
    };
  }
}
```

## 📊 성능 메트릭 및 모니터링

### Reflection 특화 메트릭

```typescript
// Reflection 품질 개선 분석
const reflectionMetrics = {
  qualityProgression: {
    averageInitialQuality: 0.62,
    averageFinalQuality: 0.87,
    averageImprovement: 0.25,
    improvementConsistency: 0.91
  },
  
  iterationEfficiency: {
    averageIterationsToTarget: 3.2,
    iterationSuccessRate: 0.84,
    diminishingReturnsThreshold: 4,
    optimalIterationCount: 3
  },
  
  reflectionAccuracy: {
    issueIdentificationRate: 0.78, // 실제 문제 식별 정확도
    improvementPredictionAccuracy: 0.72, // 개선 효과 예측 정확도
    falsePositiveRate: 0.15, // 잘못된 문제 식별률
    missedIssueRate: 0.22 // 놓친 문제 비율
  },
  
  refinementEffectiveness: {
    targetedImprovementSuccess: 0.81, // 목표 개선 성공률
    overallQualityEnhancement: 0.76, // 전반적 품질 향상
    consistencyMaintenance: 0.88, // 일관성 유지
    originalIntentPreservation: 0.93 // 원래 의도 보존
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
- [ReAct Planner](./react-planner.md) - 추론+행동 반복
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