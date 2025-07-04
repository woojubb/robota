# 실제 사용 시나리오와 코드 예제

> 이 문서는 [Robota SDK 기반 Agentic AI 플래닝 설계 문서](./agent-planning.md)의 일부입니다.

## 시나리오 1: 소프트웨어 개발 프로젝트 관리

**상황**: 웹 애플리케이션 개발을 위한 복잡한 프로젝트를 단계별로 계획하고 실행

```typescript
import { createPlanner } from '@robota-sdk/planning';
import { SequentialPlanner, CAMELPlanner } from '@robota-sdk/planning';
import { AgentFactory } from '@robota-sdk/agents';

// Provider 불가지론적 설정 (런타임에 주입)
const agentFactory = new AgentFactory({
  aiProviders: {
    'primary': primaryAIProvider,
    'secondary': secondaryAIProvider
  },
  currentProvider: 'primary'
});

// 플래너들 초기화 (AgentFactory 확장 기능 활용)
const sequentialPlanner = new SequentialPlanner(agentFactory, {
    maxSteps: 10,
    strategy: 'sequential'
});

// 기존 Team의 로직을 발전시킨 CAMELPlanner
const camelPlanner = new CAMELPlanner(agentFactory, {
    maxAgents: 5,
    strategy: 'parallel',
    // CAMEL은 템플릿을 직접 사용
    templateStrategy: 'use-directly',
    availableTemplates: [
        'general', 'summarizer', 'ethical_reviewer', 
        'creative_ideator', 'fast_executor', 'task_coordinator', 
        'domain_researcher'
    ]
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

## 시나리오 2: 연구 보고서 작성

**상황**: 여러 단계의 연구 과정을 거쳐 종합적인 보고서 작성

```typescript
import { createPlanner } from '@robota-sdk/planning';
import { ReActPlanner } from '@robota-sdk/planning-react';
import { ReflectionPlanner } from '@robota-sdk/planning-reflection';

// 연구 특화 플래너들 설정
const reactPlanner = new ReActPlanner({
    aiProviders: { openai: openaiProvider },
    maxSteps: 15,
    toolsEnabled: true, // 웹 검색, 데이터 분석 도구 활성화
    // ReAct는 템플릿을 참고만 하고 동적 생성
    templateStrategy: 'reference-only',
    templatePool: ['domain_researcher', 'creative_ideator'], // 참고용
});

const reflectionPlanner = new ReflectionPlanner({
    aiProviders: { anthropic: anthropicProvider },
    reflectionCycles: 3,
    qualityThreshold: 0.8,
    // Reflection은 하이브리드 방식
    templateStrategy: 'hybrid',
    baseTemplates: ['general', 'summarizer'], // 기본 베이스
    dynamicEnhancement: true // 상황별 개선
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

## 시나리오 3: 비즈니스 전략 수립

**상황**: 여러 관점에서 비즈니스 전략을 동시에 분석하고 통합

```typescript
import { createPlanner } from '@robota-sdk/planning';
import { ParallelPlanner } from '@robota-sdk/planning-parallel';
import { SynthesisPlanner } from '@robota-sdk/planning-synthesis';

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

## 시나리오 4: Team에서 Planning으로 마이그레이션

**상황**: 기존 Team 사용자가 Planning 시스템으로 점진적 마이그레이션

```typescript
// 기존 Team 코드 (deprecated 예정)
import { createTeam } from '@robota-sdk/team';

const team = createTeam({
    aiProviders: { openai: openaiProvider },
    maxMembers: 3,
    debug: true
});

// 기존 방식
const legacyResult = await team.execute("시장 조사 보고서를 작성해줘");

// ↓ 마이그레이션 ↓

// 새로운 Planning 코드 (권장)
import { createPlanner } from '@robota-sdk/planning';
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { AgentFactory } from '@robota-sdk/agents';

// Provider 불가지론적 AgentFactory 설정
const agentFactory = new AgentFactory({
    aiProviders: { 'primary': primaryProvider },
    currentProvider: 'primary'
});

// 기존 Team의 로직을 발전시킨 CAMELPlanner 사용
const camelPlanner = new CAMELPlanner(agentFactory, {
    maxAgents: 3,
    // 기존 Team과 동일한 템플릿 사용으로 호환성 보장
    templates: ['domain_researcher', 'summarizer', 'general'],
    debug: true
});

const planner = createPlanner({
    planners: [camelPlanner],
    defaultStrategy: 'best-first'
});

// 동일한 결과, 향상된 기능
const modernResult = await planner.execute("시장 조사 보고서를 작성해줘");

console.log('마이그레이션 완료 - 동일한 기능, 더 나은 성능:', modernResult);
```

## 시나리오 5: 플래너 조합 및 폴백 전략

**상황**: 여러 플래너를 조합하고 실패 시 대안 실행

```typescript
import { createPlanner } from '@robota-sdk/planning';

// 여러 플래너 등록 (Team 기능을 포함한 포괄적 전략)
const comprehensivePlanner = createPlanner({
    planners: [
        new CAMELPlanner(),      // 1순위: 기존 Team 로직 발전형
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

## 시나리오 6: 실시간 모니터링 및 분석

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
```

## 추가 플래너 예제들

### HierarchicalPlanner 예제
```typescript
class HierarchicalPlanner {
    constructor(private agentFactory: AgentFactory) {}
    
    async createHierarchy(task: string): Promise<AgentInterface[]> {
        // 계층구조: 매니저 → 팀리더 → 실행자
        const manager = await this.agentFactory.createWithConditions({
            role: 'project_manager',
            qualityLevel: 'premium',
            collaborationStyle: 'leadership'
        });
        
        const teamLeaders = await this.agentFactory.createBatch([
            { role: 'tech_lead', conditions: { expertise: ['technical'] } },
            { role: 'design_lead', conditions: { expertise: ['design'] } }
        ]);
        
        return [manager, ...teamLeaders];
    }
}
```

### SwarmPlanner 예제
```typescript
class SwarmPlanner {
    constructor(private agentFactory: AgentFactory) {}
    
    async createSwarm(size: number, specialization: string): Promise<AgentInterface[]> {
        // 같은 특화 역할을 가진 에이전트 떼 생성
        const swarmSpecs = Array(size).fill(null).map((_, i) => ({
            role: `${specialization}_agent_${i}`,
            conditions: { 
                expertise: [specialization],
                collaborationStyle: 'cooperative'
            }
        }));
        
        return this.agentFactory.createBatch(swarmSpecs);
    }
}
```

---

**관련 문서:**
- [메인 플래닝 설계](./agent-planning.md)
- [AgentFactory 확장 전략](./agentfactory-expansion-strategy.md)
- [템플릿 vs 동적 생성 전략](./template-vs-dynamic-strategies.md)
- [도구 분배 전략](./tool-distribution-strategies.md)
- [도구 주입 전략](./tool-injection-strategies.md)
- [현재 시스템 분석](./current-system-analysis.md) 