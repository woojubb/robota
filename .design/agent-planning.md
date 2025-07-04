# Robota SDK 기반 Agentic AI 플래닝 설계 문서 (업데이트됨)

## 개요

이 문서는 Robota SDK를 기반으로 한 Agentic AI 시스템에서 플래너(Planner)들을 어떻게 설계하고 조합할 것인지를 설명한다. 시스템은 다양한 플래닝 전략을 개별 패키지로 분리하여 설계하고, 이를 하나의 컨테이너에서 조합해 실행 가능한 구조를 목표로 한다.

**핵심 개념**: 플래닝 시스템은 `@robota-sdk/team`과 같은 레벨의 상위 관리 시스템으로, 여러 Robota 에이전트 인스턴스들을 제어하고 조합하여 복잡한 작업을 수행한다.

**현재 상황 분석**: 
- `@robota-sdk/team` 패키지가 템플릿 기반 태스크 델리게이션으로 구현됨
- CAMEL 유사 구조이지만 더 단순한 코디네이터-전문가 모델
- 7개 빌트인 템플릿 보유 (general, summarizer, ethical_reviewer, creative_ideator, fast_executor, task_coordinator, domain_researcher)
- AgentFactory를 통한 동적 에이전트 생성 시스템 완성
- BasePlugin 시스템으로 통합된 타입 안전한 아키텍처

---

## 현재 시스템 분석 결과

### ✅ 완성된 부분
1. **BaseAgent 아키텍처**: 완전한 타입 안전 시스템 구축됨
2. **AgentFactory**: 동적 에이전트 생성 및 템플릿 시스템 완성
3. **Team 시스템**: 템플릿 기반 태스크 델리게이션 구현 (CAMEL 유사)
4. **플러그인 시스템**: BasePlugin 기반 통합 플러그인 아키텍처
5. **타입 시스템**: Zero any/unknown 정책 달성
6. **템플릿 생태계**: 7개 빌트인 템플릿 및 확장 가능한 구조

### 🔄 수정 필요한 설계 요소
1. **PlannerContainer 설계**: Team과의 차별화 명확화 필요
2. **BasePlanner**: 기존 BaseAgent와의 관계 재정의
3. **타입 시스템**: 현재 ConfigValue 제약 조건에 맞춘 수정
4. **플래너 전략**: Team의 델리게이션과 Planning의 전략 구분

---

## 핵심 구성 요소 (수정됨)

### 1. **BasePlanner (수정된 추상 플래너 클래스)**

현재 BaseAgent 패턴을 따르는 플래너 기본 클래스:

```typescript
// packages/planning/src/abstracts/base-planner.ts
import type { ConfigValue } from '@robota-sdk/agents';
import type { Robota, AgentConfig } from '@robota-sdk/agents';

export interface PlannerConfig extends Record<string, ConfigValue> {
    name?: string;
    maxSteps?: number;
    timeout?: number;
    retryCount?: number;
    maxAgents?: number;
    strategy?: 'sequential' | 'parallel' | 'adaptive';
}

export interface PlanContext extends Record<string, ConfigValue> {
    sessionId?: string;
    userId?: string;
    maxDuration?: number;
    priority?: 'low' | 'medium' | 'high';
    agentPool?: Map<string, Robota>;
}

export abstract class BasePlanner<
    TConfig extends PlannerConfig = PlannerConfig,
    TContext extends PlanContext = PlanContext,
    TPlan = PlanStep[]
> {
    protected config?: TConfig;
    protected isInitialized = false;
    protected planHistory: TPlan[] = [];
    protected managedAgents: Map<string, Robota> = new Map();
    protected agentCounter = 0;

    /**
     * Initialize the planner
     */
    protected abstract initialize(): Promise<void>;

    /**
     * Get planner name for identification
     */
    abstract name(): string;

    /**
     * Create execution plan from input
     */
    abstract plan(input: PlanInput, context?: TContext): Promise<TPlan>;

    /**
     * Execute a plan with agent coordination
     */
    abstract execute(plan: TPlan, context?: TContext): Promise<PlanResult>;

    /**
     * Configure the planner
     */
    async configure(config: TConfig): Promise<void> {
        this.config = config;
        await this.ensureInitialized();
    }

    /**
     * Create a new agent using AgentFactory pattern
     */
    protected async createAgent(config: Partial<AgentConfig>, agentId?: string): Promise<string> {
        const id = agentId || `agent_${++this.agentCounter}`;
        
        // 기존 AgentFactory 패턴 활용
        const agent = new Robota({
            name: id,
            model: 'gpt-4o-mini',
            provider: 'openai',
            ...config
        });
        
        this.managedAgents.set(id, agent);
        return id;
    }

    /**
     * Get managed agent by ID
     */
    protected getAgent(agentId: string): Robota {
        const agent = this.managedAgents.get(agentId);
        if (!agent) {
            throw new Error(`Agent not found: ${agentId}`);
        }
        return agent;
    }

    /**
     * Ensure planner is initialized
     */
    protected async ensureInitialized(): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
            this.isInitialized = true;
        }
    }

    /**
     * Cleanup resources
     */
    async dispose(): Promise<void> {
        this.planHistory = [];
        
        // Dispose all managed agents
        for (const agent of this.managedAgents.values()) {
            if ('dispose' in agent && typeof agent.dispose === 'function') {
                await agent.dispose();
            }
        }
        
        this.managedAgents.clear();
        this.isInitialized = false;
    }
}
```

### 2. **PlannerContainer (Team과 차별화된 설계)**

```typescript
// packages/planning/src/planner-container.ts
import { Logger, createLogger } from '@robota-sdk/agents';
import { BasePlanner } from './abstracts/base-planner';

export interface PlannerContainerOptions {
    /** Registered planners to use */
    planners: BasePlanner[];
    /** Maximum number of concurrent planning sessions */
    maxConcurrentSessions?: number;
    /** Default execution strategy when multiple planners are used */
    defaultStrategy?: 'sequential' | 'parallel' | 'best-first' | 'fallback';
    /** Enable debug logging */
    debug?: boolean;
    /** Custom logger */
    logger?: {
        info: (message: string) => void;
        warn: (message: string) => void;
        error: (message: string) => void;
        debug: (message: string) => void;
    };
}

export class PlannerContainer {
    private registeredPlanners: Map<string, BasePlanner>;
    private activeSessions: Map<string, PlanningSession>;
    private logger: Logger;
    private options: Required<Omit<PlannerContainerOptions, 'logger'>> & { logger?: PlannerContainerOptions['logger'] };
    private initialized = false;

    constructor(options: PlannerContainerOptions) {
        this.registeredPlanners = new Map();
        this.activeSessions = new Map();
        this.logger = createLogger('PlannerContainer');
        this.options = {
            planners: options.planners,
            maxConcurrentSessions: options.maxConcurrentSessions || 5,
            defaultStrategy: options.defaultStrategy || 'best-first',
            debug: options.debug || false,
            logger: options.logger
        };

        // Register provided planners
        for (const planner of options.planners) {
            this.registeredPlanners.set(planner.name(), planner);
        }

        if (this.options.logger) {
            this.logger = this.options.logger as any;
        }
    }

    /**
     * Execute planning task - main difference from Team
     * Team: Delegates to specialists based on task analysis
     * Planning: Uses strategic planning algorithms for complex workflows
     */
    async execute(
        input: string,
        strategy?: 'sequential' | 'parallel' | 'best-first' | 'fallback',
        plannerNames?: string[]
    ): Promise<string> {
        const sessionId = `session_${Date.now()}`;
        const executionStrategy = strategy || this.options.defaultStrategy;
        const plannersToUse = plannerNames || Array.from(this.registeredPlanners.keys());

        const session: PlanningSession = {
            id: sessionId,
            input,
            strategy: executionStrategy,
            planners: plannersToUse,
            startTime: Date.now(),
            status: 'planning'
        };

        this.activeSessions.set(sessionId, session);

        try {
            let result: string;

            switch (executionStrategy) {
                case 'best-first':
                    result = await this.executeBestFirst(plannersToUse, input, session);
                    break;
                case 'parallel':
                    result = await this.executeParallel(plannersToUse, input, session);
                    break;
                case 'fallback':
                    result = await this.executeWithFallback(plannersToUse, input, session);
                    break;
                default:
                    result = await this.executeSequential(plannersToUse, input, session);
            }

            session.status = 'completed';
            session.result = result;
            return result;
        } catch (error) {
            session.status = 'failed';
            session.error = error instanceof Error ? error.message : String(error);
            throw error;
        } finally {
            this.activeSessions.delete(sessionId);
        }
    }

    /**
     * Best-first execution - select most suitable planner
     */
    private async executeBestFirst(plannerNames: string[], input: string, session: PlanningSession): Promise<string> {
        // LLM-based planner selection logic
        const selectedPlanner = await this.selectBestPlanner(plannerNames, input);
        const planner = this.getPlanner(selectedPlanner);
        
        const planInput: PlanInput = {
            userInput: input,
            context: { sessionId: session.id },
            metadata: { strategy: 'best-first' }
        };

        const plan = await planner.plan(planInput);
        const result = await planner.execute(plan);
        
        return result.output;
    }

    /**
     * Select best planner using LLM analysis
     */
    private async selectBestPlanner(plannerNames: string[], input: string): Promise<string> {
        // Implementation: Use a classifier agent to select the most suitable planner
        // For now, return first planner as fallback
        return plannerNames[0] || 'default';
    }

    // ... other execution strategies
}

interface PlanningSession {
    id: string;
    input: string;
    strategy: string;
    planners: string[];
    startTime: number;
    status: 'planning' | 'executing' | 'completed' | 'failed';
    result?: string;
    error?: string;
}
```

### 3. **편의 함수 (Team 패턴 따름)**

```typescript
// packages/planning/src/create-planner.ts
import { PlannerContainer, PlannerContainerOptions } from './planner-container';

/**
 * Create a new planner container
 */
export function createPlanner(options: PlannerContainerOptions): PlannerContainer {
    const container = new PlannerContainer(options);
    return container;
}
```

---

## 수정된 타입 정의 (현재 시스템 호환)

```typescript
// packages/planning/src/interfaces/plan.ts
import type { ConfigValue } from '@robota-sdk/agents';

export interface PlanInput {
    userInput: string;
    context?: Record<string, ConfigValue>;
    metadata?: Record<string, ConfigValue>;
}

export interface PlanStep {
    id: string;
    type: 'action' | 'decision' | 'reflection' | 'synthesis' | 'delegation';
    description: string;
    agentId?: string;
    parameters?: Record<string, ConfigValue>;
    dependencies?: string[];
    metadata?: Record<string, ConfigValue>;
}

export interface PlanResult {
    stepId?: string;
    agentId?: string;
    success: boolean;
    output: string;
    duration?: number;
    tokensUsed?: number;
    metadata?: Record<string, ConfigValue>;
    error?: string;
}
```

---

## 수정된 Team vs Planning 비교

| 측면 | Team (현재) | Planning (새로운) |
|------|-------------|------------------|
| **목적** | 템플릿 기반 작업 델리게이션 | 전략적 플래닝 알고리즘 |
| **실행 방식** | 즉시 분석 → 템플릿 선택 → 델리게이션 | 계획 수립 → 전략 적용 → 순차/병렬 실행 |
| **에이전트 사용** | 템플릿 기반 전문가 (7개 빌트인) | 플래너별 커스텀 에이전트 |
| **적용 분야** | 일반적인 작업 분배, 전문가 협업 | 복잡한 워크플로우, 알고리즘적 문제 해결 |
| **학습 곡선** | 낮음 (자동 템플릿 선택) | 중간 (플래너 전략 이해 필요) |
| **확장성** | 템플릿 추가 | 플래너 전략 추가 |

---

## 실제 사용 시나리오와 코드 예제

### 시나리오 1: 소프트웨어 개발 프로젝트 관리

**상황**: 웹 애플리케이션 개발을 위한 복잡한 프로젝트를 단계별로 계획하고 실행

```typescript
import { createPlanner } from '@robota-sdk/planning';
import { SequentialPlanner, CAMELPlanner } from '@robota-sdk/planning';
import { OpenAIProvider, AnthropicProvider } from '@robota-sdk/openai';

// AI 제공자 설정
const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const anthropicProvider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

// 플래너들 초기화
const sequentialPlanner = new SequentialPlanner({
    aiProviders: { openai: openaiProvider },
    maxSteps: 10,
    strategy: 'sequential'
});

const camelPlanner = new CAMELPlanner({
    aiProviders: { 
        openai: openaiProvider, 
        anthropic: anthropicProvider 
    },
    maxAgents: 5,
    strategy: 'parallel'
});

// 플래닝 컨테이너 생성
const planner = createPlanner({
    planners: [sequentialPlanner, camelPlanner],
    defaultStrategy: 'best-first',
    debug: true
});

// 복잡한 프로젝트 실행
const projectResult = await planner.execute(`
    React와 Node.js를 사용해서 전자상거래 웹사이트를 개발해줘.
    요구사항:
    - 사용자 인증 시스템
    - 상품 카탈로그 관리
    - 장바구니 및 결제 시스템
    - 주문 관리 대시보드
    - 반응형 디자인
    - API 문서화
`, 'best-first');

console.log('프로젝트 계획 및 실행 결과:', projectResult);
```

### 시나리오 2: 연구 보고서 작성

**상황**: 여러 단계의 연구 과정을 거쳐 종합적인 보고서 작성

```typescript
import { createPlanner } from '@robota-sdk/planning';
import { ReActPlanner, ReflectionPlanner } from '@robota-sdk/planning';

// 연구 특화 플래너들 설정
const reactPlanner = new ReActPlanner({
    aiProviders: { openai: openaiProvider },
    maxSteps: 15,
    toolsEnabled: true, // 웹 검색, 데이터 분석 도구 활성화
});

const reflectionPlanner = new ReflectionPlanner({
    aiProviders: { anthropic: anthropicProvider },
    reflectionCycles: 3,
    qualityThreshold: 0.8
});

const researchPlanner = createPlanner({
    planners: [reactPlanner, reflectionPlanner],
    defaultStrategy: 'sequential', // 연구 → 검토 → 개선
    maxConcurrentSessions: 2
});

// 연구 보고서 작성 실행
const researchResult = await researchPlanner.execute(`
    "인공지능이 미래 직업 시장에 미치는 영향"에 대한 포괄적인 연구 보고서를 작성해줘.
    
    포함되어야 할 내용:
    1. 현재 AI 기술 동향 분석
    2. 직업별 영향도 평가
    3. 새로 생성될 직업 분야 예측
    4. 교육 및 정책 제언
    5. 국가별 대응 전략 비교
`, 'sequential');

console.log('연구 보고서:', researchResult);
```

### 시나리오 3: 비즈니스 전략 수립

**상황**: 여러 관점에서 비즈니스 전략을 동시에 분석하고 통합

```typescript
import { createPlanner } from '@robota-sdk/planning';
import { ParallelPlanner, SynthesisPlanner } from '@robota-sdk/planning';

// 비즈니스 분석용 플래너들
const parallelPlanner = new ParallelPlanner({
    aiProviders: { 
        openai: openaiProvider,
        anthropic: anthropicProvider
    },
    maxParallelTasks: 4,
    taskDistribution: 'balanced'
});

const synthesisPlanner = new SynthesisPlanner({
    aiProviders: { anthropic: anthropicProvider },
    synthesisMethod: 'comprehensive',
    conflictResolution: 'weighted-consensus'
});

const businessPlanner = createPlanner({
    planners: [parallelPlanner, synthesisPlanner],
    defaultStrategy: 'parallel',
    debug: true
});

// 비즈니스 전략 수립 실행
const strategyResult = await businessPlanner.execute(`
    스타트업을 위한 종합적인 비즈니스 전략을 수립해줘.
    
    회사 정보:
    - AI 기반 헬스케어 서비스
    - 팀 규모: 15명
    - 시드 투자 완료 (30억원)
    - 목표: 시리즈 A 준비
    
    분석 영역:
    1. 시장 분석 및 경쟁사 연구
    2. 제품 로드맵 및 기술 전략
    3. 마케팅 및 고객 확보 전략
    4. 재무 계획 및 투자 전략
    5. 조직 확장 및 인재 채용 계획
`, 'parallel');

console.log('비즈니스 전략:', strategyResult);
```

### 시나리오 4: Team과 Planning 함께 사용

**상황**: 즉시 작업과 복잡한 플래닝이 혼재된 프로젝트

```typescript
import { createTeam } from '@robota-sdk/team';
import { createPlanner } from '@robota-sdk/planning';

// Team: 즉시 작업 처리용
const team = createTeam({
    aiProviders: { openai: openaiProvider },
    maxMembers: 3,
    debug: true
});

// Planning: 복잡한 전략 수립용
const strategicPlanner = createPlanner({
    planners: [new CAMELPlanner(), new SequentialPlanner()],
    defaultStrategy: 'best-first'
});

// 하이브리드 워크플로우
async function hybridWorkflow(request: string) {
    // 1. 먼저 Team으로 요청 분석
    const analysis = await team.execute(`
        다음 요청을 분석해서 즉시 처리 가능한 부분과 
        복잡한 계획이 필요한 부분으로 나누어줘:
        "${request}"
    `);
    
    console.log('요청 분석 결과:', analysis);
    
    // 2. 복잡한 부분은 Planning으로 처리
    if (analysis.includes('복잡한 계획 필요')) {
        const strategicPlan = await strategicPlanner.execute(
            `다음 복잡한 요청에 대한 단계별 실행 계획을 수립해줘: ${request}`,
            'best-first'
        );
        
        console.log('전략적 계획:', strategicPlan);
        return strategicPlan;
    }
    
    // 3. 간단한 부분은 Team으로 즉시 처리
    const immediateResult = await team.execute(request);
    return immediateResult;
}

// 사용 예시
const result = await hybridWorkflow(`
    AI 스타트업의 글로벌 확장 전략을 수립하고,
    동시에 내일 투자자 미팅을 위한 피치덱도 준비해줘.
`);
```

### 시나리오 5: 플래너 조합 및 폴백 전략

**상황**: 여러 플래너를 조합하고 실패 시 대안 실행

```typescript
import { createPlanner } from '@robota-sdk/planning';

// 여러 플래너 등록
const comprehensivePlanner = createPlanner({
    planners: [
        new CAMELPlanner(),      // 1순위: 다중 에이전트 협업
        new ReActPlanner(),      // 2순위: 도구 기반 추론
        new SequentialPlanner()  // 3순위: 기본 순차 처리
    ],
    defaultStrategy: 'fallback', // 실패 시 다음 플래너로
    maxConcurrentSessions: 3
});

// 폴백 전략으로 실행
const robustResult = await comprehensivePlanner.execute(`
    복잡한 M&A 거래의 실사(Due Diligence) 프로세스를 설계하고
    각 단계별 체크리스트와 일정을 수립해줘.
    
    대상 회사: SaaS 기업 (ARR 100억원)
    인수 예상 금액: 500억원
    완료 목표: 3개월
`, 'fallback');

console.log('M&A 실사 프로세스:', robustResult);
```

### 시나리오 6: 실시간 모니터링 및 분석

**상황**: 플래닝 과정을 실시간으로 모니터링하고 성능 분석

```typescript
import { createPlanner } from '@robota-sdk/planning';

const analyticsPlanner = createPlanner({
    planners: [new CAMELPlanner(), new ReActPlanner()],
    debug: true,
    logger: {
        info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
        warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
        error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
        debug: (msg) => console.debug(`[DEBUG] ${new Date().toISOString()} - ${msg}`)
    }
});

// 실행 전 세션 모니터링 설정
const sessionId = `session_${Date.now()}`;

// 모니터링과 함께 실행
console.log('플래닝 세션 시작:', sessionId);

const monitoredResult = await analyticsPlanner.execute(`
    온라인 교육 플랫폼의 사용자 참여도를 높이기 위한 
    종합적인 개선 방안을 제시해줘.
    
    현재 상황:
    - 월간 활성 사용자: 50,000명
    - 평균 세션 시간: 12분
    - 수료율: 23%
    - 고객 만족도: 3.2/5.0
    
    목표:
    - 수료율 50% 달성
    - 세션 시간 20분 증가
    - 만족도 4.0 이상
`, 'best-first');

console.log('플래닝 세션 완료:', sessionId);
console.log('결과:', monitoredResult);

// 세션 분석 (가상의 API)
// const sessionAnalytics = await analyticsPlanner.getSessionAnalytics(sessionId);
// console.log('성능 분석:', sessionAnalytics);
```

---

## 실제 사용에서의 장점

### 1. **복잡성 관리**
- Team: 단순한 작업 분배
- Planning: 다단계 복잡한 워크플로우 처리

### 2. **전략적 접근**
- 다양한 플래닝 알고리즘을 상황에 맞게 선택
- 실패 시 자동 폴백 및 대안 실행

### 3. **확장성**
- 새로운 플래너 쉽게 추가
- 도메인별 특화 플래너 개발 가능

### 4. **모니터링**
- 실시간 플래닝 과정 추적
- 성능 분석 및 최적화

### 5. **유연성**
- Team과 Planning 동시 사용
- 상황에 따른 하이브리드 접근

이러한 Planning 시스템은 기존 Team의 즉시성을 보완하면서, 복잡한 프로젝트와 전략적 사고가 필요한 작업에서 강력한 성능을 발휘할 것입니다.
