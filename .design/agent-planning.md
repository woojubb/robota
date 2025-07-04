# Robota SDK 기반 Agentic AI 플래닝 설계 문서 (업데이트됨)

## 개요

이 문서는 Robota SDK를 기반으로 한 Agentic AI 시스템에서 플래너(Planner)들을 어떻게 설계하고 조합할 것인지를 설명한다. 시스템은 다양한 플래닝 전략을 개별 패키지로 분리하여 설계하고, 이를 하나의 컨테이너에서 조합해 실행 가능한 구조를 목표로 한다.

**핵심 개념**: 플래닝 시스템은 AI 에이전트들을 제어하고 조합하여 복잡한 작업을 수행하는 상위 관리 시스템이다.

**현재 상황 분석**: 
- `@robota-sdk/team` 패키지는 CAMEL 기법의 초기 구현체로 개발됨
- 템플릿 기반 태스크 델리게이션으로 구현된 단순화된 CAMEL 패턴
- 7개 빌트인 템플릿 보유 (general, summarizer, ethical_reviewer, creative_ideator, fast_executor, task_coordinator, domain_researcher)
- **Planning 시스템 완성 후 Team 패키지는 deprecated 예정**
- AgentFactory를 통한 동적 에이전트 생성 시스템 완성
- BasePlugin 시스템으로 통합된 타입 안전한 아키텍처

---

## 현재 시스템 분석 결과

### ✅ 완성된 부분
1. **BaseAgent 아키텍처**: 완전한 타입 안전 시스템 구축됨
2. **AgentFactory**: 동적 에이전트 생성 및 템플릿 시스템 완성
3. **Team 시스템**: CAMEL 기법의 초기 구현체 (단순화된 버전)
4. **플러그인 시스템**: BasePlugin 기반 통합 플러그인 아키텍처
5. **타입 시스템**: Zero any/unknown 정책 달성
6. **템플릿 생태계**: 7개 빌트인 템플릿 및 확장 가능한 구조

### 🔄 마이그레이션 요소
1. **Team → CAMELPlanner**: 기존 Team 로직을 CAMELPlanner로 발전
2. **템플릿 시스템**: Planning 시스템에 통합
3. **사용자 마이그레이션**: Team 사용자를 Planning으로 순차 이전
4. **Deprecation 계획**: Planning 시스템 안정화 후 Team 패키지 단계적 제거

---

## Team과 Planning의 관계 (마이그레이션 관점)

| 측면 | Team (현재, 곧 deprecated) | Planning (새로운 표준) |
|------|-------------|------------------|
| **본질** | CAMEL 기법의 초기 구현체 | 종합적 플래닝 알고리즘 플랫폼 |
| **실행 방식** | 템플릿 기반 즉시 델리게이션 | 전략별 플래너 선택 → 계획 수립 → 실행 |
| **에이전트 사용** | 7개 빌트인 템플릿 전문가 | 플래너별 최적화된 에이전트 |
| **적용 분야** | 일반적인 작업 분배 | 다양한 플래닝 전략 (CAMEL, ReAct, Reflection 등) |
| **확장성** | 제한적 (템플릿 추가만 가능) | 무제한 (새로운 플래너 알고리즘 추가) |
| **미래** | Deprecated 예정 | 장기 지원 및 발전 |

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

// 기존 Team의 로직을 발전시킨 CAMELPlanner
const camelPlanner = new CAMELPlanner({
    aiProviders: { 
        openai: openaiProvider, 
        anthropic: anthropicProvider 
    },
    maxAgents: 5,
    strategy: 'parallel',
    // 기존 Team의 템플릿들을 활용
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

### 시나리오 4: Team에서 Planning으로 마이그레이션

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
import { CAMELPlanner } from '@robota-sdk/planning';

// 기존 Team의 로직을 발전시킨 CAMELPlanner 사용
const camelPlanner = new CAMELPlanner({
    aiProviders: { openai: openaiProvider },
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

### 시나리오 5: 플래너 조합 및 폴백 전략

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
```

---

## Planning 시스템의 장점

### 1. **통합된 플래닝 플랫폼**
- 기존 Team의 CAMEL 기능을 포함한 종합적 플래닝
- 다양한 플래닝 알고리즘을 하나의 인터페이스로 사용

### 2. **향상된 전략적 접근**
- 작업별 최적 플래너 자동 선택
- 실패 시 자동 폴백 및 대안 실행
- 플래너 조합을 통한 복합적 문제 해결

### 3. **확장성과 미래 보장**
- 새로운 플래너 알고리즘 쉽게 추가
- 도메인별 특화 플래너 개발 가능
- 장기 지원 및 지속적 발전

### 4. **향상된 모니터링**
- 실시간 플래닝 과정 추적
- 플래너별 성능 분석 및 최적화
- 세션 기반 상세 분석

### 5. **마이그레이션 지원**
- 기존 Team 사용자의 점진적 전환 지원
- 하위 호환성 보장
- 기존 템플릿 시스템 완전 활용

---

## Team에서 Planning으로의 마이그레이션 계획

### Phase 1: Planning 시스템 구축
- CAMELPlanner에 기존 Team 로직 완전 이관
- 기존 7개 템플릿 완전 호환
- 성능 및 기능 개선

### Phase 2: 마이그레이션 지원
- Team → Planning 마이그레이션 가이드 제공
- 호환성 레이어 제공 (필요시)
- 사용자 피드백 수집 및 개선

### Phase 3: Team 패키지 Deprecation
- Team 패키지에 deprecation 경고 추가
- Planning 시스템 안정화 확인
- 문서에서 Team 사용법 제거

### Phase 4: Team 패키지 제거
- 충분한 마이그레이션 기간 후 Team 패키지 제거
- Planning이 유일한 다중 에이전트 솔루션으로 정착

이러한 Planning 시스템은 기존 Team의 모든 기능을 포함하면서도 훨씬 강력하고 확장 가능한 플래닝 플랫폼을 제공할 것입니다.
