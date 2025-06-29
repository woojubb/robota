# Robota SDK 기반 Agentic AI 플래닝 설계 문서

## 개요

이 문서는 Robota SDK를 기반으로 한 Agentic AI 시스템에서 플래너(Planner)들을 어떻게 설계하고 조합할 것인지를 설명한다. 시스템은 다양한 플래닝 전략을 개별 패키지로 분리하여 설계하고, 이를 하나의 컨테이너에서 조합해 실행 가능한 구조를 목표로 한다.

**핵심 개념**: 플래닝 시스템은 `@robota-sdk/team`과 같은 레벨의 상위 관리 시스템으로, 여러 Robota 에이전트 인스턴스들을 제어하고 조합하여 복잡한 작업을 수행한다.

**현재 상황**: `@robota-sdk/team` 패키지가 CAMEL 기법과 유사하게 구현되어 있으며, 이를 체계적인 플래닝 아키텍처로 발전시킬 예정이다.

---

## 핵심 구성 요소

### 1. **BasePlanner (추상 플래너 클래스)**

각 플래닝 전략을 구현하는 기본 클래스:

```typescript
// packages/planning/src/abstracts/base-planner.ts
import type { ConfigValue } from '@robota-sdk/agents';
import type { Robota } from '@robota-sdk/agents';

export abstract class BasePlanner<
    TConfig extends Record<string, ConfigValue> = PlannerConfig,
    TContext extends Record<string, ConfigValue> = PlanContext,
    TPlan = PlanStep[]
> {
    protected config?: TConfig;
    protected isInitialized = false;
    protected planHistory: TPlan[] = [];
    protected agents: Map<string, Robota> = new Map();

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
     * Execute a single plan step with agent coordination
     */
    abstract executeStep(step: PlanStep, context?: TContext): Promise<PlanResult>;

    /**
     * Finalize multiple plan results (optional override)
     */
    async finalize(results: PlanResult[], context?: TContext): Promise<PlanResult> {
        return results[results.length - 1];
    }

    /**
     * Configure the planner
     */
    async configure(config: TConfig): Promise<void> {
        this.config = config;
        await this.ensureInitialized();
    }

    /**
     * Register an agent for this planner to use
     */
    registerAgent(agentId: string, agent: Robota): void {
        this.agents.set(agentId, agent);
    }

    /**
     * Get registered agent by ID
     */
    protected getAgent(agentId: string): Robota {
        const agent = this.agents.get(agentId);
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
        this.agents.clear();
        this.isInitialized = false;
    }
}
```

### 2. **PlannerContainer**

Team과 동일한 레벨에서 플래너들을 관리하고 Robota 에이전트들을 조정하는 컨테이너:

```typescript
// packages/planning/src/planner-container.ts
import { Logger, createLogger, Robota, AgentConfig } from '@robota-sdk/agents';
import { BasePlanner } from './abstracts/base-planner';

export interface PlannerContainerOptions {
    /** Base configuration for creating agents */
    baseAgentConfig: Partial<AgentConfig>;
    /** Maximum number of concurrent planners */
    maxConcurrentPlanners?: number;
    /** Maximum number of agents to create */
    maxAgents?: number;
    /** Default execution strategy */
    defaultStrategy?: 'sequential' | 'parallel' | 'fallback';
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
    private managedAgents: Map<string, Robota>;
    private activePlanners: Set<string>;
    private logger: Logger;
    private options: Required<Omit<PlannerContainerOptions, 'logger'>> & { logger?: PlannerContainerOptions['logger'] };
    private initialized = false;
    private agentCounter = 0;

    constructor(options: PlannerContainerOptions) {
        this.registeredPlanners = new Map();
        this.managedAgents = new Map();
        this.activePlanners = new Set();
        this.logger = createLogger('PlannerContainer');
        this.options = {
            baseAgentConfig: options.baseAgentConfig,
            maxConcurrentPlanners: options.maxConcurrentPlanners || 10,
            maxAgents: options.maxAgents || 50,
            defaultStrategy: options.defaultStrategy || 'sequential',
            debug: options.debug || false,
            logger: options.logger
        };

        if (this.options.logger) {
            // Use custom logger if provided
            this.logger = this.options.logger as any;
        }
    }

    /**
     * Initialize the container
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        this.logger.debug('Initializing PlannerContainer');
        this.initialized = true;
    }

    /**
     * Register a planner
     */
    registerPlanner(planner: BasePlanner): void {
        const name = planner.name();
        this.registeredPlanners.set(name, planner);
        this.logger.debug(`Planner registered: ${name}`);
    }

    /**
     * Create and register a new agent
     */
    async createAgent(config?: Partial<AgentConfig>): Promise<string> {
        if (this.managedAgents.size >= this.options.maxAgents) {
            throw new Error(`Maximum agents limit reached: ${this.options.maxAgents}`);
        }

        const agentId = `agent_${++this.agentCounter}`;
        const fullConfig: AgentConfig = {
            ...this.options.baseAgentConfig,
            ...config,
            name: config?.name || agentId
        } as AgentConfig;

        const agent = new Robota(fullConfig);
        this.managedAgents.set(agentId, agent);

        this.logger.debug(`Agent created: ${agentId}`);
        return agentId;
    }

    /**
     * Execute a planning task
     */
    async execute(
        input: string,
        plannerNames?: string[],
        strategy?: 'sequential' | 'parallel' | 'fallback'
    ): Promise<string> {
        await this.initialize();

        const planInput: PlanInput = {
            userInput: input,
            context: {},
            metadata: { executionId: `exec_${Date.now()}` }
        };

        const planners = plannerNames || Array.from(this.registeredPlanners.keys());
        const executionStrategy = strategy || this.options.defaultStrategy;

        // Assign agents to planners
        await this.assignAgentsToPlanners(planners);

        let results: PlanResult[];

        switch (executionStrategy) {
            case 'parallel':
                results = await this.runParallel(planners, planInput);
                break;
            case 'fallback':
                const result = await this.runWithFallback(planners, planInput);
                results = [result];
                break;
            default:
                results = await this.runSequential(planners, planInput);
        }

        return this.synthesizeResults(results);
    }

    /**
     * Execute planners sequentially
     */
    private async runSequential(plannerNames: string[], input: PlanInput): Promise<PlanResult[]> {
        const results: PlanResult[] = [];
        
        for (const name of plannerNames) {
            const planner = this.getPlanner(name);
            const plan = await planner.plan(input);
            
            for (const step of plan) {
                const result = await planner.executeStep(step);
                results.push(result);
            }
        }
        
        return results;
    }

    /**
     * Execute planners in parallel
     */
    private async runParallel(plannerNames: string[], input: PlanInput): Promise<PlanResult[]> {
        const promises = plannerNames.map(async (name) => {
            const planner = this.getPlanner(name);
            const plan = await planner.plan(input);
            
            const stepResults: PlanResult[] = [];
            for (const step of plan) {
                const result = await planner.executeStep(step);
                stepResults.push(result);
            }
            return stepResults;
        });

        const allResults = await Promise.all(promises);
        return allResults.flat();
    }

    /**
     * Execute planners with fallback strategy
     */
    private async runWithFallback(plannerNames: string[], input: PlanInput): Promise<PlanResult> {
        for (const name of plannerNames) {
            try {
                const planner = this.getPlanner(name);
                const plan = await planner.plan(input);
                
                const results: PlanResult[] = [];
                for (const step of plan) {
                    const result = await planner.executeStep(step);
                    results.push(result);
                }
                
                return await planner.finalize(results);
            } catch (error) {
                this.logger.warn(`Planner ${name} failed, trying next:`, error);
                continue;
            }
        }
        
        throw new Error('All planners failed');
    }

    /**
     * Assign agents to planners for execution
     */
    private async assignAgentsToPlanners(plannerNames: string[]): Promise<void> {
        for (const plannerName of plannerNames) {
            const planner = this.getPlanner(plannerName);
            
            // Assign available agents to this planner
            for (const [agentId, agent] of this.managedAgents) {
                planner.registerAgent(agentId, agent);
            }
        }
    }

    /**
     * Synthesize multiple results into final response
     */
    private synthesizeResults(results: PlanResult[]): string {
        return results.map(r => r.output).join('\n\n');
    }

    /**
     * Get planner by name
     */
    private getPlanner(name: string): BasePlanner {
        const planner = this.registeredPlanners.get(name);
        if (!planner) {
            throw new Error(`Planner not found: ${name}`);
        }
        return planner;
    }

    /**
     * Get container statistics
     */
    getStats() {
        return {
            plannersRegistered: this.registeredPlanners.size,
            agentsManaged: this.managedAgents.size,
            activePlanners: this.activePlanners.size,
            maxAgents: this.options.maxAgents,
            maxPlanners: this.options.maxConcurrentPlanners
        };
    }

    /**
     * Cleanup all resources
     */
    async dispose(): Promise<void> {
        // Dispose all planners
        for (const planner of this.registeredPlanners.values()) {
            await planner.dispose();
        }

        // Dispose all agents
        for (const agent of this.managedAgents.values()) {
            if ('dispose' in agent && typeof agent.dispose === 'function') {
                await agent.dispose();
            }
        }

        this.registeredPlanners.clear();
        this.managedAgents.clear();
        this.activePlanners.clear();
    }
}
```

### 3. **편의 함수 (createPlanner)**

Team 패키지의 `createTeam` 함수와 유사한 편의 함수:

```typescript
// packages/planning/src/create-planner.ts
import { PlannerContainer, PlannerContainerOptions } from './planner-container';

/**
 * Create a new planner container (convenience function similar to createTeam)
 */
export function createPlanner(options: PlannerContainerOptions): PlannerContainer {
    const container = new PlannerContainer(options);
    return container;
}
```

### 4. **플래너 전략 패키지들**

현재 및 계획된 패키지 구조:
- `@robota-sdk/planning` - 코어 플래닝 시스템 (PlannerContainer, BasePlanner)
- `@robota-sdk/planner-react` - ReAct 전략
- `@robota-sdk/planner-camel` - 현재 team 기능을 발전시킨 CAMEL 구현체
- `@robota-sdk/planner-reflection` - Reflection 전략
- `@robota-sdk/planner-plan-execute` - Plan-and-Execute 전략

---

## 주요 플래닝 기법 목록

| 기법명                             | 설명                                                 | 특징                   | 패키지명 (계획)               |
| ------------------------------- | -------------------------------------------------- | -------------------- | ------------------------ |
| **ReAct** (Reason + Act)        | Thought → Action → Observation 순으로 사고 및 실행을 번갈아 수행 | 유연하고 도구 기반 추론에 강함    | `@robota-sdk/planner-react` |
| **Plan-and-Execute**            | 전체 계획 수립 후 순차적으로 실행                                | 구조화 쉬우며 장기 계획에 적합    | `@robota-sdk/planner-plan-execute` |
| **Reflection**                  | 결과에 대한 평가 및 자기 피드백을 통해 수정                          | 오류 자가 수정 루프에 효과적     | `@robota-sdk/planner-reflection` |
| **Chain of Thought (CoT)**      | 추론 과정을 단계별로 명시적으로 표현                               | 수학적/논리적 문제에 유리       | `@robota-sdk/planner-cot` |
| **Tool-augmented (MRKL)**       | 외부 도구 호출을 포함한 실행 전략                                | 정확도 향상 및 모듈 기반 처리 가능 | `@robota-sdk/planner-mrkl` |
| **Hierarchical Planning (HTN)** | 목표를 하위 목표로 분해하여 재귀적으로 계획                           | 복잡한 시나리오 처리에 적합      | `@robota-sdk/planner-htn` |
| **AutoGPT 스타일**                 | 목표 기반 반복 루프 실행 (계획 + 실행 + 리플렉션)                    | 장기적인 자율 실행에 유리       | `@robota-sdk/planner-autogpt` |
| **CAMEL** ⭐                     | 역할 기반 다중 에이전트 커뮤니케이션 구조                            | 멀티 에이전트 협업 처리 가능     | `@robota-sdk/planner-camel` |
| **Toolformer**                  | 도구 사용 여부를 LLM이 학습 및 결정                             | 도구 호출 조건 최적화         | `@robota-sdk/planner-toolformer` |
| **MetaGPT**                     | 소프트웨어 팀의 역할을 시뮬레이션하여 구조적 작업 분할                     | 코딩, 설계, 분업형 태스크에 강함  | `@robota-sdk/planner-metagpt` |

⭐ **현재 우선순위**: CAMEL 패키지 구현 (기존 team 라이브러리 재구성)

---

## 타입 정의

```typescript
// packages/planning/src/interfaces/plan.ts
export interface PlanInput {
    userInput: string;
    context?: Record<string, ConfigValue>;
    metadata?: Record<string, ConfigValue>;
}

export interface PlanStep {
    id: string;
    type: 'action' | 'decision' | 'reflection' | 'synthesis';
    description: string;
    agentId?: string;  // Which agent should execute this step
    parameters?: Record<string, ConfigValue>;
    dependencies?: string[];
    metadata?: Record<string, ConfigValue>;
}

export interface PlanResult {
    stepId: string;
    agentId?: string;  // Which agent executed this step
    success: boolean;
    output: string;
    duration?: number;
    tokensUsed?: number;
    metadata?: Record<string, ConfigValue>;
    error?: string;
}

export interface PlannerConfig extends Record<string, ConfigValue> {
    name?: string;
    maxSteps?: number;
    timeout?: number;
    retryCount?: number;
    maxAgents?: number;
}

export interface PlanContext extends Record<string, ConfigValue> {
    sessionId?: string;
    userId?: string;
    maxDuration?: number;
    priority?: 'low' | 'medium' | 'high';
}
```

---

## 플래너 조합 실행 예시

1. 사용자 입력: "웹사이트 리디자인 프로젝트를 진행해줘"
2. PlannerContainer가 등록된 플래너들에게 작업 분배
3. 각 플래너가 필요한 에이전트들을 생성/활용하여 계획 수립 및 실행
4. 최종 결과를 종합하여 사용자에게 반환

```typescript
// 사용 예시 - Team과 동일한 레벨의 상위 시스템
import { createPlanner } from '@robota-sdk/planning';
import { CAMELPlanner } from '@robota-sdk/planner-camel';
import { ReActPlanner } from '@robota-sdk/planner-react';
import { ReflectionPlanner } from '@robota-sdk/planner-reflection';
import { OpenAIProvider } from '@robota-sdk/openai';

const planner = createPlanner({
    baseAgentConfig: {
        aiProviders: { openai: new OpenAIProvider({ apiKey: 'sk-...' }) },
        currentProvider: 'openai',
        currentModel: 'gpt-4'
    },
    maxAgents: 10,
    maxConcurrentPlanners: 3,
    debug: true
});

// 플래너들 등록
planner.registerPlanner(new CAMELPlanner());
planner.registerPlanner(new ReActPlanner());
planner.registerPlanner(new ReflectionPlanner());

// 복잡한 작업 실행
const response = await planner.execute(
    "웹사이트 리디자인 프로젝트를 진행해줘",
    ['camel', 'react', 'reflection'],
    'sequential'
);
```

---

## 현재 Team 라이브러리 분석

### 기존 구조와의 관계
- **동등한 레벨**: PlannerContainer는 TeamContainer와 같은 레벨의 상위 관리 시스템
- **에이전트 관리**: 둘 다 Robota 인스턴스들을 생성하고 관리
- **작업 분배**: TeamContainer는 역할 기반, PlannerContainer는 플래닝 전략 기반

### CAMEL 패턴 관점에서의 분석
- ✅ **역할 기반 에이전트**: 이미 구현됨
- ✅ **태스크 할당**: assignTask 메서드로 구현됨
- ✅ **결과 수집**: AssignTaskResult로 구현됨
- 🔄 **개선 필요**: 플래닝 프로토콜과의 통합

### 아키텍처 레벨 비교
```
상위 레벨 (에이전트 조정):
├── TeamContainer (역할 기반 팀 협업)
├── PlannerContainer (플래닝 전략 기반 작업 분해) ← NEW
└── [기타 상위 관리 시스템들]

하위 레벨 (개별 에이전트):
└── Robota (개별 AI 에이전트)
    ├── AIProviders (AI 제공자 관리)
    ├── Tools (도구 관리)
    ├── Plugins (플러그인 관리)
    └── ConversationHistory (대화 기록 관리)
```

---

## 작업 계획 및 체크리스트

### Phase 1: 플래닝 코어 시스템 구축
- [ ] `packages/planning` 패키지 생성
  - [ ] `src/abstracts/base-planner.ts` - BasePlanner 클래스 (에이전트 관리 기능 포함)
  - [ ] `src/interfaces/plan.ts` - PlanInput, PlanStep, PlanResult 타입 정의
  - [ ] `src/planner-container.ts` - PlannerContainer 클래스 (Team과 동일 레벨)
  - [ ] `src/create-planner.ts` - createPlanner 편의 함수
  - [ ] `src/index.ts` - 패키지 exports
- [ ] Planning 패키지 TypeScript 설정 및 빌드 구성 (기존 패키지와 동일한 구조)
- [ ] Planning 패키지 테스트 작성 (TeamContainer 패턴 참조)
- [ ] Documentation 작성

### Phase 2: CAMEL 플래너 구현 (기존 Team 리팩토링)
- [ ] `packages/planner-camel` 패키지 생성
- [ ] 기존 `packages/team` 코드 분석 및 마이그레이션 계획 수립
- [ ] CAMEL 플래너 구현
  - [ ] `src/camel-planner.ts` - BasePlanner 상속 (다중 에이전트 조정)
  - [ ] `src/role-based-coordination.ts` - 역할 기반 에이전트 조정
  - [ ] `src/communication-protocol.ts` - 에이전트 간 커뮤니케이션
  - [ ] `src/task-delegation.ts` - 태스크 분해 및 위임
- [ ] 기존 TeamContainer와의 기능 비교 및 호환성 확인
- [ ] CAMEL 플래너 테스트 작성

### Phase 3: 기존 Team 패키지와의 관계 정리
- [ ] `packages/team`과 `packages/planning`의 역할 명확화
  - [ ] Team: 역할 기반 협업 (현재 기능 유지)
  - [ ] Planning: 플래닝 전략 기반 작업 분해 (새로운 기능)
- [ ] 사용자가 두 시스템을 함께 사용할 수 있는 가이드 작성
- [ ] 기존 Team 사용자들을 위한 마이그레이션 가이드 (선택사항)

### Phase 4: 추가 플래너 구현 (선택사항)
- [ ] `packages/planner-react` - ReAct 전략 구현
- [ ] `packages/planner-reflection` - Reflection 전략 구현
- [ ] `packages/planner-plan-execute` - Plan-and-Execute 전략 구현
- [ ] 플래너 조합 예제 작성

### Phase 5: 고급 기능 및 최적화
- [ ] PlannerSelector - LLM 기반 플래너 자동 선택
- [ ] PlannerComposition - 복합 실행 전략 (병렬, 조건분기, fallback)
- [ ] 에이전트 풀 관리 - 동적 에이전트 생성/해제
- [ ] 플래닝 히스토리 추적 및 분석
- [ ] 성능 최적화 및 메모리 관리

### Phase 6: 문서화 및 예제
- [ ] 전체 플래닝 시스템 가이드 작성
- [ ] Team vs Planning 시스템 비교 가이드
- [ ] 각 플래너별 사용법 문서
- [ ] 실제 사용 시나리오별 예제 코드
- [ ] 플래너 개발자를 위한 가이드
- [ ] API 레퍼런스 업데이트

---

## 플래너 선택 전략

### A. 사전 고정 방식
```typescript
await planner.execute(input, ['camel', 'reflection'], 'sequential');
```

### B. 자동 선택 (전체 플래너 사용)
```typescript
await planner.execute(input); // 등록된 모든 플래너 사용
```

### C. 전략별 실행
```typescript
// 병렬 실행
await planner.execute(input, ['camel', 'react'], 'parallel');

// 폴백 실행
await planner.execute(input, ['camel', 'react', 'reflection'], 'fallback');
```

---

## 구조적 장점

* ✅ **전략 독립성 보장**: 각 플래너는 독립적인 패키지
* ✅ **Team과 동등한 레벨**: 상위 관리 시스템으로 명확한 역할 분리
* ✅ **에이전트 조정 능력**: 여러 Robota 인스턴스를 조정하여 복잡한 작업 수행
* ✅ **외부 개발자 참여**: 플래너 생태계 확장 가능
* ✅ **실행 플로우 유연성**: 다양한 조합 전략 지원
* ✅ **디버깅 및 재현**: 각 플래닝 단계 추적 가능
* ✅ **확장성**: 새로운 플래닝 기법 쉽게 추가
* ✅ **아키텍처 일관성**: 기존 Team 패키지의 패턴과 일치

---

## 기존 아키텍처 규칙 준수 사항

### 1. 상위 관리 시스템 설계
- ✅ **PlannerContainer**: TeamContainer와 동일한 레벨의 에이전트 조정 시스템
- ✅ **에이전트 생성**: 필요에 따라 Robota 인스턴스 동적 생성
- ✅ **리소스 관리**: 에이전트 생명주기 관리 및 정리

### 2. 컨테이너 패턴 준수
- ✅ **초기화**: initialize() 패턴
- ✅ **등록/관리**: register* 메서드 패턴
- ✅ **실행**: execute() 메인 실행 메서드

### 3. 타입 안전성
- ✅ **제네릭 활용**: BasePlanner<TConfig, TContext, TPlan>
- ✅ **ConfigValue 준수**: 모든 설정값은 ConfigValue 타입

### 4. 로깅 및 에러 처리
- ✅ **Logger 재사용**: createLogger('PlannerContainer') 패턴
- ✅ **옵션 기반**: 커스텀 로거 지원

### 5. 편의 함수 제공
- ✅ **createPlanner**: createTeam과 동일한 패턴의 편의 함수

---

## 예상 도전과제 및 해결방안

### 1. Team vs Planning 역할 구분
**문제**: 사용자가 언제 Team을 쓰고 언제 Planning을 써야 하는지 혼란
**해결**: 명확한 사용 사례 구분 및 가이드 문서 제공
- **Team**: 역할 기반 협업 (예: 개발팀 시뮬레이션)
- **Planning**: 복잡한 작업의 체계적 분해 및 실행

### 2. 에이전트 리소스 관리
**문제**: 여러 플래너가 에이전트를 동시에 사용할 때 리소스 충돌
**해결**: 에이전트 풀 관리 및 동적 할당 시스템

### 3. 플래너 간 협조
**문제**: 서로 다른 플래너가 함께 실행될 때 조정 필요
**해결**: PlanContext를 통한 상태 공유 및 의존성 관리

### 4. 성능 최적화
**문제**: 다중 에이전트 및 플래너 실행 시 성능 이슈
**해결**: 병렬 실행, 에이전트 재사용, 캐싱 등의 최적화

---

## 다음 단계

1. **즉시 시작**: Phase 1 (플래닝 코어 시스템) 구축
2. **우선순위**: CAMEL 플래너 구현을 통한 기존 team 기능과의 차별화
3. **장기 목표**: Team과 Planning이 상호 보완하는 생태계 구축

이 설계를 통해 Robota SDK는 개별 에이전트(Robota), 역할 기반 팀(Team), 플래닝 전략(Planning)의 3단계 계층 구조를 갖게 되어 단순한 대화부터 복잡한 프로젝트 관리까지 모든 레벨의 AI 작업을 체계적으로 처리할 수 있는 종합적인 Agentic AI 플랫폼으로 발전할 것이다.
