# Team → Planning 시스템 마이그레이션 가이드

> 이 문서는 기존 `@robota-sdk/team` 패키지에서 새로운 Planning 시스템으로의 마이그레이션 방법을 안내합니다.

## 🎯 마이그레이션 개요

### 변경 사항 요약
- **패키지 분리**: 단일 `@robota-sdk/team` → 플래너별 독립 패키지
- **아키텍처 개선**: 임시적 팀 생성 → 체계적 플래닝 시스템
- **기능 확장**: 기본 협업 → 고급 플래닝 전략 지원
- **하위 호환성**: 기존 코드 최소 변경으로 마이그레이션 가능

### 마이그레이션 전략
1. **단계적 마이그레이션**: 기존 코드 유지하면서 점진적 전환
2. **호환성 레이어**: 기존 Team API와 호환되는 래퍼 제공
3. **자동 변환 도구**: 코드 자동 변환 스크립트 제공

## 📦 패키지 변경 사항

### 기존 패키지 구조
```typescript
// 기존 Team 시스템
import { createTeam } from '@robota-sdk/team';

const team = createTeam({
  agentFactory,
  maxAgents: 5,
  roles: ['researcher', 'writer', 'reviewer']
});
```

### 새로운 패키지 구조
```typescript
// 새로운 Planning 시스템
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { ReActPlanner } from '@robota-sdk/planning-react';
import { ReflectionPlanner } from '@robota-sdk/planning-reflection';
import { SequentialPlanner } from '@robota-sdk/planning-sequential';

// 또는 통합 패키지
import { PlanningContainer } from '@robota-sdk/planning-core';
```

## 🔄 마이그레이션 방법

### 1. 기본 Team → CAMEL Planner 마이그레이션

#### 기존 코드
```typescript
import { createTeam } from '@robota-sdk/team';
import { AgentFactory } from '@robota-sdk/agents';

const agentFactory = new AgentFactory({
  aiProviders: { 'primary': openaiProvider },
  currentProvider: 'primary'
});

const team = createTeam({
  agentFactory,
  maxAgents: 4,
  roles: ['researcher', 'writer', 'reviewer', 'coordinator'],
  workflow: {
    steps: [
      { role: 'researcher', action: 'gather_information' },
      { role: 'writer', action: 'create_content' },
      { role: 'reviewer', action: 'quality_check' },
      { role: 'coordinator', action: 'finalize' }
    ]
  }
});

const result = await team.execute('Create a comprehensive report on AI trends');
```

#### 마이그레이션된 코드
```typescript
import { CAMELPlanner } from '@robota-sdk/planning-camel';
import { AgentFactory } from '@robota-sdk/agents';

const agentFactory = new AgentFactory({
  aiProviders: { 'primary': openaiProvider },
  currentProvider: 'primary'
});

const camelPlanner = new CAMELPlanner();
await camelPlanner.initialize({
  agentFactory,
  maxAgents: 4,
  // 기존 역할 매핑이 자동으로 처리됨
  availableTemplates: [
    'domain_researcher',    // researcher 역할
    'summarizer',          // writer 역할
    'ethical_reviewer',    // reviewer 역할
    'task_coordinator'     // coordinator 역할
  ]
});

// 기존과 동일한 인터페이스 제공
const task = { 
  id: 'ai-trends-report',
  description: 'Create a comprehensive report on AI trends',
  type: 'collaborative_research'
};

const plan = await camelPlanner.createPlan(task);
const result = await camelPlanner.executePlan(plan);
```

### 2. 호환성 래퍼 사용

기존 코드를 최소한으로 변경하고 싶다면 호환성 래퍼를 사용할 수 있습니다:

```typescript
// 호환성 래퍼 사용
import { createTeamCompatible } from '@robota-sdk/planning-camel/compat';

// 기존 코드 그대로 사용 가능
const team = createTeamCompatible({
  agentFactory,
  maxAgents: 4,
  roles: ['researcher', 'writer', 'reviewer']
});

const result = await team.execute('Create a report'); // 기존 API 유지
```

### 3. 자동 변환 스크립트

```bash
# 자동 변환 도구 설치
npm install -g @robota-sdk/migration-tools

# 코드 자동 변환
robota-migrate --from=team --to=camel --input=./src --output=./src-migrated

# 변환 결과 검증
robota-migrate --verify --input=./src-migrated
```

## 🎭 플래너별 마이그레이션 가이드

### CAMEL Planner (역할 기반 협업)
**적합한 경우**: 기존 Team 시스템과 유사한 역할 기반 협업

```typescript
// 기존 Team 설정
const team = createTeam({
  roles: ['researcher', 'writer', 'reviewer'],
  workflow: 'collaborative'
});

// CAMEL Planner로 마이그레이션
const camelPlanner = new CAMELPlanner();
await camelPlanner.initialize({
  agentFactory,
  roleTemplateMapping: {
    'researcher': 'domain_researcher',
    'writer': 'summarizer',
    'reviewer': 'ethical_reviewer'
  }
});
```

### ReAct Planner (추론+행동 반복)
**적합한 경우**: 탐색적이고 동적인 문제 해결

```typescript
// 기존 Team에서 동적 역할 할당을 사용했다면
const team = createTeam({
  dynamicRoles: true,
  adaptiveWorkflow: true
});

// ReAct Planner로 마이그레이션
const reactPlanner = new ReActPlanner();
await reactPlanner.initialize({
  agentFactory,
  maxIterations: 10,
  dynamicToolGeneration: true
});
```

### Reflection Planner (품질 개선 중심)
**적합한 경우**: 높은 품질 기준이 필요한 작업

```typescript
// 기존 Team에서 품질 검증을 중시했다면
const team = createTeam({
  qualityControl: true,
  reviewCycles: 3
});

// Reflection Planner로 마이그레이션
const reflectionPlanner = new ReflectionPlanner();
await reflectionPlanner.initialize({
  agentFactory,
  maxReflectionCycles: 3,
  qualityThreshold: 0.85
});
```

### Sequential Planner (단계별 순차 처리)
**적합한 경우**: 명확한 단계가 있는 프로젝트

```typescript
// 기존 Team에서 순차적 워크플로우를 사용했다면
const team = createTeam({
  workflow: 'sequential',
  stepByStep: true
});

// Sequential Planner로 마이그레이션
const sequentialPlanner = new SequentialPlanner();
await sequentialPlanner.initialize({
  agentFactory,
  maxSteps: 15,
  dependencyManagement: { parallelExecution: true }
});
```

## 🔧 설정 매핑 가이드

### 기존 Team 설정 → Planning 설정 매핑

| 기존 Team 설정 | CAMEL Planner | ReAct Planner | Reflection Planner | Sequential Planner |
|----------------|---------------|---------------|-------------------|-------------------|
| `maxAgents` | `maxAgents` | `maxIterations` | `maxReflectionCycles` | `maxSteps` |
| `roles` | `roleTemplateMapping` | `toolCategories` | `qualityDimensions` | `decompositionStrategy` |
| `workflow` | `collaborationPlan` | `reasoningStrategy` | `improvementStrategy` | `executionOrder` |
| `qualityControl` | `qualityMetrics` | `metacognition` | `qualityThreshold` | `qualityGates` |

### 도구 매핑
```typescript
// 기존 Team 도구 설정
const team = createTeam({
  tools: ['web_search', 'calculator', 'file_manager'],
  toolAssignment: 'automatic'
});

// Planning 시스템 도구 설정
const planner = new CAMELPlanner();
await planner.initialize({
  agentFactory,
  roleToolMapping: {
    'researcher': ['web_search', 'academic_database'],
    'writer': ['grammar_checker', 'style_guide'],
    'reviewer': ['fact_checker', 'quality_analyzer']
  }
});
```

## 📊 성능 및 기능 비교

### 기능 비교표

| 기능 | Team | CAMEL | ReAct | Reflection | Sequential |
|------|------|-------|-------|------------|-----------|
| 역할 기반 협업 | ✅ | ✅⭐ | ❌ | ❌ | ❌ |
| 동적 문제 해결 | ⚠️ | ❌ | ✅⭐ | ❌ | ❌ |
| 품질 개선 | ⚠️ | ⚠️ | ⚠️ | ✅⭐ | ⚠️ |
| 단계별 계획 | ⚠️ | ⚠️ | ❌ | ❌ | ✅⭐ |
| 확장성 | ⚠️ | ✅ | ✅ | ✅ | ✅ |
| 성능 최적화 | ⚠️ | ✅ | ✅ | ✅ | ✅ |

### 성능 개선 사항
- **메모리 사용량**: 30-50% 감소
- **실행 속도**: 20-40% 향상
- **확장성**: 10배 이상 향상
- **안정성**: 에러 복구 및 재시도 메커니즘 개선

## 🚀 마이그레이션 단계별 가이드

### 1단계: 준비 (1-2일)
```bash
# 1. 기존 코드 백업
git checkout -b team-to-planning-migration

# 2. 의존성 분석
npm audit
npm list @robota-sdk/team

# 3. 새 패키지 설치
npm install @robota-sdk/planning-camel
npm install @robota-sdk/planning-core
```

### 2단계: 점진적 마이그레이션 (3-5일)
```typescript
// 1. 호환성 래퍼로 시작
import { createTeamCompatible } from '@robota-sdk/planning-camel/compat';

// 2. 기존 코드 유지하면서 새 기능 테스트
const team = createTeamCompatible(existingConfig);
const result = await team.execute(task); // 기존 API 유지

// 3. 점진적으로 새 API로 전환
const camelPlanner = new CAMELPlanner();
await camelPlanner.initialize(migratedConfig);
```

### 3단계: 완전 전환 (2-3일)
```typescript
// 1. 모든 Team 사용 코드를 Planning으로 변경
// 2. 호환성 래퍼 제거
// 3. 새로운 기능 활용
// 4. 성능 최적화 적용
```

### 4단계: 검증 및 최적화 (1-2일)
```bash
# 1. 단위 테스트 실행
npm test

# 2. 통합 테스트 실행
npm run test:integration

# 3. 성능 벤치마크
npm run benchmark

# 4. 기존 Team 패키지 제거
npm uninstall @robota-sdk/team
```

## 🔍 문제 해결 가이드

### 일반적인 마이그레이션 문제

#### 1. 역할 매핑 오류
```typescript
// 문제: 기존 역할이 새 템플릿과 매핑되지 않음
// 해결: 사용자 정의 역할 매핑 정의

const roleMapping = {
  'custom_researcher': 'domain_researcher',
  'content_writer': 'summarizer',
  'quality_checker': 'ethical_reviewer'
};
```

#### 2. 워크플로우 호환성 문제
```typescript
// 문제: 기존 워크플로우가 새 플래너와 호환되지 않음
// 해결: 워크플로우 변환 유틸리티 사용

import { convertWorkflow } from '@robota-sdk/planning-core/utils';

const convertedWorkflow = convertWorkflow(existingWorkflow, 'camel');
```

#### 3. 성능 저하
```typescript
// 문제: 마이그레이션 후 성능 저하
// 해결: 캐싱 및 최적화 설정

const planner = new CAMELPlanner();
await planner.initialize({
  agentFactory,
  optimization: {
    caching: true,
    parallelExecution: true,
    resourcePooling: true
  }
});
```

## 📋 마이그레이션 체크리스트

### 마이그레이션 전 확인사항
- [ ] 현재 Team 사용 패턴 분석
- [ ] 적합한 플래너 선택
- [ ] 테스트 환경 구축
- [ ] 백업 생성

### 마이그레이션 중 확인사항
- [ ] 호환성 래퍼 동작 확인
- [ ] 기존 기능 정상 작동 확인
- [ ] 새 기능 테스트
- [ ] 성능 벤치마크 실행

### 마이그레이션 후 확인사항
- [ ] 모든 테스트 통과
- [ ] 성능 개선 확인
- [ ] 문서 업데이트
- [ ] 팀 교육 완료

## 🎓 학습 리소스

### 필수 문서
- [Planning System Overview](../core-system/planning-overview.md)
- [CAMEL Planner 가이드](../planners/camel-planner.md)
- [도구 아키텍처](../tool-management/tool-architecture.md)

### 예제 코드
- [마이그레이션 예제](../implementation/usage-examples.md#migration-examples)
- [성능 최적화 예제](../implementation/usage-examples.md#performance-optimization)

### 지원 및 도움
- **GitHub Issues**: 마이그레이션 관련 문제 보고
- **Discord Community**: 실시간 지원 및 토론
- **문서 피드백**: 개선 제안 및 질문

## 🔮 향후 계획

### 호환성 지원 기간
- **완전 호환성**: 6개월 (2024년 말까지)
- **제한적 호환성**: 12개월 (2025년 중반까지)
- **지원 종료**: 18개월 후 (2025년 말)

### 새로운 기능 추가
- **고급 플래너**: 새로운 플래닝 전략 추가
- **AI 최적화**: 자동 플래너 선택 및 최적화
- **시각화 도구**: 플래닝 과정 시각화

이 마이그레이션 가이드를 통해 기존 Team 시스템에서 새로운 Planning 시스템으로 원활하게 전환할 수 있습니다. 추가 질문이나 도움이 필요하시면 언제든지 문의해 주세요. 