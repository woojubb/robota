# Robota SDK Planning System Overview

Planning 시스템은 복잡한 다중 에이전트 작업 흐름을 체계적으로 관리하는 프레임워크입니다. 다양한 AI 플래닝 알고리즘을 통해 작업 특성에 맞는 최적의 해결책을 제공합니다.

## 🎯 핵심 설계 철학

Planning 시스템은 **"적절한 도구를 적절한 시점에"**라는 철학을 바탕으로 설계됩니다:

- **플래닝 기법별 특화**: 각 알고리즘의 고유 특성을 최대한 활용
- **점진적 복잡성**: 단순한 작업부터 복잡한 워크플로까지 점진적 확장
- **템플릿과 동적 생성의 조화**: 안정성과 유연성의 균형
- **확장 가능한 아키텍처**: 새로운 플래닝 알고리즘 무제한 추가 가능

## 🏗️ 아키텍처 개요

### Planning 시스템 구조
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

## 🎯 플래닝 기법별 특성

Planning 시스템은 다양한 AI 플래닝 알고리즘을 제공하여 작업 특성에 맞는 최적의 해결책을 제공합니다:

| 플래닝 기법 | 주요 특징 | 적용 상황 | 패키지명 |
|------------|----------|----------|----------|
| **CAMEL** | 역할 기반 협업 | 구조화된 팀 작업 | `@robota-sdk/planning-camel` |
| **ReAct** | 추론+행동 반복 | 탐색적 문제해결 | `@robota-sdk/planning-react` |
| **Reflection** | 품질 개선 중심 | 고품질 결과 필요 | `@robota-sdk/planning-reflection` |
| **Sequential** | 단계별 순차 처리 | 명확한 절차 작업 | `@robota-sdk/planning-sequential` |

## 📦 패키지 구조 및 Import 전략

### 독립 패키지 설계
각 플래너는 독립적인 패키지로 제공되어 필요한 기능만 선택적으로 사용할 수 있습니다:

```typescript
// 개별 플래너 사용
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { ReActPlanner } from '@robota-sdk/planning-react';

// 통합 플래닝 컨테이너
import { createPlanner } from '@robota-sdk/planning';

// 공통 타입 및 인터페이스
import { BasePlanner, PlanningContext } from '@robota-sdk/planning-core';
```

### 의존성 관리
- **@robota-sdk/planning-core**: 모든 플래너의 공통 기반
- **@robota-sdk/agents**: AgentFactory 및 에이전트 생성
- **개별 플래너 패키지**: 선택적 설치 가능

## 💡 간단한 사용 예제

```typescript
import { AgentFactory } from '@robota-sdk/agents';
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { createPlanner } from '@robota-sdk/planning';

// AgentFactory 설정
const agentFactory = new AgentFactory({
  aiProviders: { 'primary': primaryProvider },
  currentProvider: 'primary',
  commonTools: ['web_search', 'calculator', 'document_generator'],
  autoInjectCommonTools: true
});

// CAMEL Planner 설정
const camelPlanner = new CAMELPlanner(agentFactory);

// Planning Container 생성
const planner = createPlanner({
  planners: [camelPlanner],
  defaultStrategy: 'best-first'
});

// 실행
const result = await planner.execute("시장 조사 보고서 작성");
```

## 📚 관련 문서

### 코어 시스템
- [Planning Container](./planning-container.md) - 플래너 통합 관리
- [AgentFactory 확장 전략](./agentfactory-expansion.md) - 에이전트 생성 엔진

### 플래너별 상세 문서
- [CAMEL Planner](../planners/camel-planner.md) - 역할 기반 협업
- [ReAct Planner](../planners/react-planner.md) - 추론+행동 반복
- [Reflection Planner](../planners/reflection-planner.md) - 품질 개선 중심
- [Sequential Planner](../planners/sequential-planner.md) - 단계별 처리

### 도구 관리
- [도구 아키텍처](../tool-management/tool-architecture.md) - 도구 관리 전략
- [도구 구현](../tool-management/tool-implementation.md) - 구체적 구현 방법

### 구현 가이드
- [구현 로드맵](../implementation/implementation-roadmap.md) - 개발 계획
- [사용 예제](../implementation/usage-examples.md) - 실제 사용 사례

### 아키텍처
- [시스템 분석](../architecture/system-analysis.md) - 현재 시스템 분석
- [설계 패턴](../architecture/design-patterns.md) - 설계 원칙 및 패턴 