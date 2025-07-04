# Robota SDK Planning System

Planning 시스템은 복잡한 다중 에이전트 작업 흐름을 체계적으로 관리하는 프레임워크입니다. 기존의 `@robota-sdk/team` 패키지를 발전시켜 더 강력하고 유연한 플래닝 알고리즘들을 제공합니다.

## 📋 문서 구조

### 핵심 전략 문서
- **[템플릿 vs 동적 생성 전략](./template-vs-dynamic-strategies.md)** - 플래닝 기법별 에이전트 생성 방법론
- **[도구 분배 전략](./tool-distribution-strategies.md)** - 에이전트별 도구 관리 및 MCP 통합
- **[도구 주입 전략](./tool-injection-strategies.md)** - AgentFactory와 플래너별 도구 주입 방법론
- **[플래너별 템플릿 전략](./planner-template-strategies.md)** - 각 플래닝 기법의 템플릿 활용 방법

### 분석 및 예제 문서
- **[현재 시스템 분석](./current-system-analysis.md)** - 기존 시스템 분석 및 마이그레이션 계획
- **[사용 시나리오 및 예제](./usage-scenarios-examples.md)** - 실제 사용 사례와 코드 예제

## 🎯 핵심 설계 철학

Planning 시스템은 **"적절한 도구를 적절한 시점에"**라는 철학을 바탕으로 설계됩니다:

- **플래닝 기법별 특화**: 각 알고리즘의 고유 특성을 최대한 활용
- **점진적 복잡성**: 단순한 작업부터 복잡한 워크플로까지 점진적 확장
- **템플릿과 동적 생성의 조화**: 안정성과 유연성의 균형
- **기존 시스템과의 호환성**: 기존 `@robota-sdk/team` 사용자의 원활한 전환

## 🏗️ 아키텍처 개요

### Planning 시스템 구조
Planning 시스템은 다음과 같은 계층 구조로 설계됩니다:

```
🎯 Planning Container (최상위)
├── 📦 CAMEL Planner (역할 기반 협업)
├── 📦 ReAct Planner (추론+행동 반복)
├── 📦 Reflection Planner (품질 개선 중심)
├── 📦 Sequential Planner (단계별 처리)
└── 📦 Parallel Planner (병렬 처리)
     ↓
🏭 AgentFactory (에이전트 생성 엔진)
├── 템플릿 기반 생성
├── 동적 프롬프트 생성
├── 조건부 생성
└── 배치 생성
     ↓
🤖 Robota Agent (실행 단위)
```

## 📦 패키지 구조 및 Import 전략

### 별도 패키지 배포 구조
각 플래닝 기법은 독립적인 패키지로 배포되어 필요에 따라 선택적 설치 가능:

```typescript
// 기본 Planning 컨테이너
import { createPlanner } from '@robota-sdk/planning';

// 개별 플래닝 기법들 (선택적 설치)
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { ReActPlanner } from '@robota-sdk/planning-react';
import { ReflectionPlanner } from '@robota-sdk/planning-reflection';
import { SequentialPlanner } from '@robota-sdk/planning-sequential';
import { ParallelPlanner } from '@robota-sdk/planning-parallel';

// 기존 AgentFactory 활용
import { AgentFactory } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
```

## 🛠️ 도구 주입 전략

Planning 시스템에서는 **AgentFactory 레벨**과 **템플릿 레벨**에서 도구를 관리할 수 있습니다:

### 1. AgentFactory 공통 도구 설정

```typescript
// AgentFactory에 공통 도구 목록 설정
const agentFactory = new AgentFactory({
  // 기본적으로 모든 에이전트가 받는 공통 도구들
  commonTools: [
    'web_search',
    'calculator', 
    'file_manager',
    'email_sender'
  ],
  // 공통 도구 자동 주입 설정 (기본값: true)
  autoInjectCommonTools: true,
  // 템플릿별 명시적 도구 설정 허용 (기본값: false)
  allowExplicitToolOverride: false
});

// 모든 에이전트가 공통 도구를 자동으로 받음
const agent1 = await agentFactory.createFromTemplate('researcher');
const agent2 = await agentFactory.createFromTemplate('writer');
```

### 2. 템플릿별 명시적 도구 설정

```typescript
// 특정 템플릿에만 전용 도구 설정
agentFactory.registerTemplate({
  id: 'data_analyst',
  name: 'Data Analyst',
  description: 'Statistical analysis specialist',
  config: {
    provider: 'openai',
    model: 'gpt-4o',
    systemMessage: 'You are a data analysis expert...',
    // 이 템플릿 전용 도구들 (공통 도구 + 전용 도구)
    tools: [
      'data_visualizer',
      'statistical_analyzer', 
      'database_connector'
    ],
    // 공통 도구 자동 주입 비활성화 (선택적)
    skipCommonTools: false
  }
});
```

### 3. 플래너별 도구 전략 설정

```typescript
// CAMEL Planner: 역할별 전용 도구 활용
const camelPlanner = new CAMELPlanner(agentFactory, {
  // 역할별 도구 매핑
  roleToolMapping: {
    'researcher': ['web_search', 'academic_database', 'citation_manager'],
    'writer': ['grammar_checker', 'style_guide', 'document_formatter'],
    'reviewer': ['plagiarism_checker', 'fact_checker', 'quality_analyzer']
  },
  // 공통 도구 + 역할별 도구 모두 제공
  inheritCommonTools: true
});

// ReAct Planner: 동적 도구 선택
const reactPlanner = new ReActPlanner(agentFactory, {
  // 가용 도구 풀에서 필요에 따라 동적 선택
  availableToolsPool: 'all', // 'common' | 'all' | string[]
  // 단계별 도구 추천 활성화
  enableToolRecommendation: true
});
```

### 4. 고급 도구 주입 제어

```typescript
// 세밀한 도구 제어가 필요한 경우
const advancedFactory = new AgentFactory({
  commonTools: ['basic_tools'],
  toolInjectionStrategy: {
    // 기본값: 모든 템플릿이 공통 도구 자동 수신
    defaultBehavior: 'auto_inject',
    // 예외: 특정 템플릿들은 명시적 설정만 사용
    explicitOnly: ['security_agent', 'sandboxed_analyzer'],
    // 도구 그룹 정의
    toolGroups: {
      'research_tools': ['web_search', 'academic_db', 'citation'],
      'analysis_tools': ['calculator', 'visualizer', 'statistics'],
      'writing_tools': ['grammar', 'style', 'formatter']
    }
  }
});

// 도구 그룹 단위로 주입
const researchAgent = await advancedFactory.createFromTemplate('researcher', {
  toolGroups: ['research_tools', 'analysis_tools']
});
```

## 핵심 설계 결정사항

### AgentFactory 확장 전략
Planning 시스템을 위해 AgentFactory에 다음 기능들이 추가됩니다:

- **조건부 에이전트 생성**: 역할, 전문성, 품질 수준별 맞춤 생성
- **배치 생성**: 여러 에이전트를 효율적으로 병렬 생성
- **프롬프트 기반 동적 생성**: 완전히 유연한 에이전트 생성
- **템플릿 조합/변형**: 기존 템플릿의 창의적 재활용
- **도구 주입 제어**: 공통 도구와 전용 도구의 유연한 관리

→ [플래너별 템플릿 전략 상세 내용](./planner-template-strategies.md)

### Team에서 Planning으로의 진화
기존 `@robota-sdk/team` 패키지의 기능을 발전시켜 더 강력한 Planning 시스템을 구축:

- **CAMEL Planner**: 기존 Team의 역할 기반 협업을 발전시킨 형태
- **확장성**: 새로운 플래닝 알고리즘 무제한 추가 가능
- **마이그레이션 지원**: 기존 사용자의 점진적 전환 보장
- **하위 호환성**: 기존 템플릿과 설정 완전 보존

→ [현재 시스템 분석 및 마이그레이션 계획](./current-system-analysis.md)

## 실제 사용 예제

간단한 Planning 시스템 설정 및 실행:

```typescript
import { AgentFactory } from '@robota-sdk/agents';
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { OpenAIProvider } from '@robota-sdk/openai';

// AgentFactory 설정 (공통 도구 포함)
const agentFactory = new AgentFactory({
  providers: {
    openai: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })
  },
  commonTools: ['web_search', 'calculator', 'document_generator'],
  autoInjectCommonTools: true
});

// CAMEL Planner 설정 및 실행
const camelPlanner = new CAMELPlanner(agentFactory);
const result = await camelPlanner.execute("시장 조사 보고서 작성");
```

→ [더 많은 사용 시나리오와 예제](./usage-scenarios-examples.md)

## 관련 문서

- [템플릿 vs 동적 생성 전략](./template-vs-dynamic-strategies.md)
- [도구 분배 전략](./tool-distribution-strategies.md)
- [도구 주입 전략](./tool-injection-strategies.md)
- [플래너별 템플릿 전략](./planner-template-strategies.md)
- [현재 시스템 분석](./current-system-analysis.md)
- [사용 시나리오 및 예제](./usage-scenarios-examples.md)
