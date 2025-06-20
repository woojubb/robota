# @robota-sdk/team - Multi-Agent Team Collaboration

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fteam.svg)](https://www.npmjs.com/package/@robota-sdk/team)

복잡한 작업을 위한 멀티 에이전트 팀워크 기능 - 동적 에이전트 조정 및 작업 위임

## 개요

`@robota-sdk/team`은 Robota SDK의 핵심 기능으로, 사용자의 복잡한 작업을 여러 전문 에이전트들이 협업하여 해결하는 시스템입니다. 팀 코디네이터가 작업을 분석하고 필요한 전문 에이전트들을 동적으로 생성하여 업무를 분산하고 결과를 취합합니다.

## 목차

- [설치](#설치)
- [주요 기능](#주요-기능)
- [아키텍처](#아키텍처)
- [기본 사용법](#기본-사용법)
- [에이전트 템플릿 시스템](#에이전트-템플릿-시스템)
- [고급 설정](#고급-설정)
- [워크플로우 분석](#워크플로우-분석)
- [실제 사용 예시](#실제-사용-예시)
- [API 레퍼런스](#api-레퍼런스)
- [성능 최적화](#성능-최적화)
- [개발 체크리스트](#개발-체크리스트)

## 설치

```bash
npm install @robota-sdk/team
```

## 주요 기능

### 🤝 **동적 에이전트 조정**
- 팀 코디네이터가 사용자 요청을 분석하고 전문 에이전트들에게 위임
- 작업별로 필요한 에이전트만 동적 생성
- 자동 리소스 정리 및 메모리 관리

### ⚡ **통합된 delegateWork 도구**
- 모든 작업 위임을 위한 단일 도구 인터페이스
- 특별한 에이전트 타입 없음 - 모든 에이전트가 동일한 Robota 인스턴스 사용
- 복잡한 작업 분해를 위한 재귀적 위임 지원

### 🎯 **작업별 맞춤 에이전트 생성**
- AgentFactory가 적절한 시스템 프롬프트로 에이전트 생성
- 작업 요구사항에 따른 도구 선택
- 프롬프트 엔지니어링을 통한 역할 기반 전문화

### 📊 **팀 분석 및 모니터링**
- 에이전트 생성 및 작업 완료에 대한 실시간 통계
- 실행 시간 추적 및 토큰 사용량 모니터링
- 상세한 팀 조정 로그를 위한 디버그 모드

### 📈 **워크플로우 히스토리 및 시각화**
- 완전한 실행 과정 기록 보존
- 에이전트 간 관계 및 작업 흐름 시각화
- 성능 분석 및 디버깅 지원

## 아키텍처

### 2계층 구조

```
Team Coordinator (팀 코디네이터)
├── 사용자 요청 접수
├── delegateWork로 임시 팀 리더 생성
└── 조정된 결과 반환

Temporary Agents (임시 에이전트들)
├── 팀 리더가 작업 분석 및 분해
├── delegateWork로 전문 에이전트들 생성
└── 작업 완료 후 모든 에이전트 자동 정리
```

### 핵심 컴포넌트

- **TeamContainer**: 메인 조정 클래스
- **AgentFactory**: 적절한 프롬프트로 작업별 에이전트 생성
- **delegateWork Tool**: 범용 작업 위임 인터페이스
- **Workflow History**: 실행 과정 추적 및 분석

## 기본 사용법

### 간단한 팀 생성

```typescript
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// OpenAI 클라이언트 및 프로바이더 설정
const openaiClient = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

const openaiProvider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4o-mini'
});

// 팀 생성
const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 16000,
    systemPrompt: 'You are a team coordinator that manages collaborative work.',
    logger: console
  },
  maxMembers: 5,
  debug: false
});

// 복잡한 작업을 팀 협업으로 처리
const result = await team.execute(
  'Create a comprehensive marketing strategy for our new SaaS product'
);

console.log(result);
```

### 작업 유형별 처리 방식

#### 1. 간단한 작업 (직접 처리)
```typescript
// 간단한 질문 - 팀 코디네이터가 직접 처리
const simpleResult = await team.execute(
  'What are the main differences between React and Vue.js? Please provide 3 key points briefly.'
);
```

#### 2. 복잡한 작업 (팀 협업)
```typescript
// 복잡한 작업 - 자동으로 전문가들에게 위임
const complexResult = await team.execute(
  'Create a cafe business plan. It must include both: 1) Market analysis, 2) Menu composition. Please write each section separately.'
);
```

## 작동 방식

### 1. 사용자 요청 처리
```typescript
// 사용자가 요청 생성
const result = await team.execute('Analyze the smartphone market and create a report');

// 팀 코디네이터가 결정: 직접 처리 vs 위임
// 복잡한 작업의 경우 delegateWork 도구 사용
```

### 2. 동적 작업 위임
```typescript
// 팀 코디네이터가 분석 작업 위임
delegateWork({
  jobDescription: '프롬프트를 분석해서 업무를 분배하고 member들에게 업무를 분배하세요',
  context: 'User wants smartphone market analysis and report',
  requiredTools: ['analysis', 'delegation']
});

// 임시 팀 리더 생성, 분석 후 세부 작업들 위임:
// 1. 시장 조사 전문가
// 2. 데이터 분석가
// 3. 보고서 작성자
```

### 3. 자동 조정
```typescript
// 각 에이전트가 작업 완료 후 결과 반환
// 팀 리더가 모든 결과 종합
// 사용자에게 최종 응답 반환
// 모든 임시 에이전트 자동 정리
```

## 고급 설정

### 커스텀 팀 설정

```typescript
import { TeamContainer } from '@robota-sdk/team';
import { OpenAIProvider, AnthropicProvider } from '@robota-sdk/core';

const team = new TeamContainer({
  baseRobotaOptions: {
    aiProviders: {
      openai: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4'
      }),
      anthropic: new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: 'claude-3-5-sonnet-20241022'
      })
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    maxTokenLimit: 100000,
    temperature: 0.7
  },
  maxMembers: 10,
  debug: true
});
```

### 커스텀 에이전트 팩토리

```typescript
import { AgentFactory } from '@robota-sdk/team';

const agentFactory = new AgentFactory({
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7
}, true); // debug mode

const team = new TeamContainer({
  baseRobotaOptions: {
    aiProviders: { anthropic: anthropicProvider },
    currentProvider: 'anthropic',
    currentModel: 'claude-3-5-sonnet-20241022'
  },
  maxMembers: 10,
  debug: true
});
```

## 워크플로우 분석

### 기본 워크플로우 데이터 조회

```typescript
// 기본 데이터 조회 (TeamContainer에서 제공)
const workflowHistory = team.getWorkflowHistory();

if (workflowHistory) {
  console.log(`Execution ID: ${workflowHistory.executionId}`);
  console.log(`Total agents: ${workflowHistory.agentConversations.length}`);
  console.log(`Duration: ${workflowHistory.endTime - workflowHistory.startTime}ms`);
}
```

### 워크플로우 시각화

```typescript
import { 
  generateWorkflowFlowchart, 
  generateAgentRelationshipDiagram 
} from '@robota-sdk/team';

const workflowHistory = team.getWorkflowHistory();

if (workflowHistory) {
  // 에이전트 관계 다이어그램
  console.log('🔗 Agent Relationship Diagram:');
  console.log(generateAgentRelationshipDiagram(workflowHistory));
  
  // 상세 워크플로우 플로우차트  
  console.log('📊 Workflow Flowchart:');
  console.log(generateWorkflowFlowchart(workflowHistory));
}
```

### 워크플로우 데이터 내보내기

```typescript
import { 
  workflowHistoryToJSON, 
  workflowHistoryToCSV,
  extractPerformanceMetrics 
} from '@robota-sdk/team';

const workflowHistory = team.getWorkflowHistory();

if (workflowHistory) {
  // JSON 형태로 내보내기
  const jsonData = workflowHistoryToJSON(workflowHistory);
  console.log('JSON Export:', jsonData);
  
  // CSV 형태로 내보내기
  const csvData = workflowHistoryToCSV(workflowHistory);
  console.log('CSV Export:', csvData);
  
  // 성능 메트릭 추출
  const metrics = extractPerformanceMetrics(workflowHistory);
  console.log('Performance Metrics:', metrics);
}
```

### 워크플로우 데이터 구조

```typescript
interface WorkflowHistory {
  executionId: string;
  userRequest: string;
  finalResult: string;
  startTime: Date;
  endTime?: Date;
  success?: boolean;
  error?: string;
  agentConversations: AgentConversationData[];
  agentTree: AgentTreeNode[];
}

interface AgentConversationData {
  agentId: string;
  taskDescription?: string;
  parentAgentId?: string;
  messages: UniversalMessage[];
  createdAt: Date;
  childAgentIds: string[];
}

interface AgentTreeNode {
  agentId: string;
  taskDescription?: string;
  messageCount: number;
  children: AgentTreeNode[];
}
```

## 실제 사용 예시

### 1. 비즈니스 계획서 작성

```typescript
import { createTeam, generateWorkflowFlowchart } from '@robota-sdk/team';

const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    systemPrompt: 'You are a team coordinator that manages collaborative work.',
    logger: console
  },
  maxMembers: 5
});

// 복잡한 비즈니스 분석 요청
const result = await team.execute(`
  Create a comprehensive cafe business plan. 
  It must include both: 
  1) Market analysis with target demographics and competition
  2) Menu composition with diverse offerings
  Please write each section separately.
`);

console.log('📋 Result:', result);

// 워크플로우 분석
const workflowHistory = team.getWorkflowHistory();
if (workflowHistory) {
  console.log('\n📊 Workflow Analysis:');
  console.log(generateWorkflowFlowchart(workflowHistory));
}
```

### 2. 소프트웨어 개발 프로젝트

```typescript
const devTeam = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    systemPrompt: 'You are a software development team coordinator.',
    logger: console
  },
  maxMembers: 4
});

const result = await devTeam.execute(`
  Create a React todo application with the following requirements:
  1) Component-based architecture
  2) State management
  3) Local storage persistence
  4) Responsive design
  Provide complete implementation.
`);

// 자동으로 다음과 같은 전문가들 생성:
// - 시스템 아키텍트 (전체 설계)
// - 프론트엔드 개발자 (React 컴포넌트)
// - 상태 관리 전문가 (상태 로직)
// - UI/UX 전문가 (반응형 디자인)
```

### 3. 시장 조사 및 분석

```typescript
const researchTeam = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    systemPrompt: 'You are a research team coordinator.',
    logger: console
  },
  maxMembers: 3
});

const result = await researchTeam.execute(`
  Research the smartphone market trends for 2024 and create a detailed analysis report.
  Include competitor analysis, market size, and growth projections.
`);

// 자동으로 다음과 같은 전문가들 생성:
// - 시장 조사원 (웹 검색, 데이터 수집)
// - 데이터 분석가 (통계 분석, 시각화)
// - 기술 작성자 (보고서 작성, 포맷팅)
```

### 4. 한국어 팀 협업 예시

```typescript
import { createTeam, generateWorkflowFlowchart } from '@robota-sdk/team';

const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    systemPrompt: '당신은 협업 작업을 관리하는 팀 코디네이터입니다.',
    logger: console
  },
  maxMembers: 5,
  debug: false
});

// 간단한 작업
const simpleResult = await team.execute(
  'React와 Vue.js의 주요 차이점 3가지를 간단히 알려주세요.'
);

// 복잡한 작업
const complexResult = await team.execute(
  '카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 1) 시장 분석, 2) 메뉴 구성. 각각을 별도로 작성해주세요.'
);

// 워크플로우 분석
const workflowHistory = team.getWorkflowHistory();
if (workflowHistory) {
  console.log('\n📊 워크플로우 분석:');
  console.log(generateWorkflowFlowchart(workflowHistory));
}
```

### 5. 실행 결과 시각화 예시

```
📊 Team Workflow Summary
══════════════════════════════════════════════════

🚀 Execution Overview
   📋 Request: Create a cafe business plan. It must include both: 1) Market analysis, 2) Menu composition...
   ⏱️  Duration: 42.2s | Status: ✅ Success

🔗 Task Distribution & Agent Performance

└─ 👤 User Request
   └─ 📝 Create a cafe business plan. It must include both: 1) Market analysis, 2) Menu composition...

   └─ 🤖 Team Coordination & Delegation
      👑 Coordinator: 6 messages

      ├─ 🎯 agent-1750429775184-lu1m1y8i6 (3 msgs)
      │     └─ "Conduct market analysis for cafe business including target demographics..."
      │
      └─ 🎯 agent-1750429788121-qxbt2nibo (3 msgs)
           └─ "Create comprehensive menu composition for cafe with diverse offerings..."

📈 Summary
   🤖 Agents: 3 total (👑 1 coordinator, 🎯 2 task agents)
   💬 Messages: 12 total

🎯 Result Preview
   ## 1) Market Analysis
   ### Target Demographics
   - Young Professionals (Ages 25-35): Quality coffee and comfortable workspace...
   ... (34 more lines)
```

## 팀 성능 통계

### 기본 통계 조회

```typescript
// 팀 성능 메트릭 조회
const stats = team.getStats();
console.log(`Agents created: ${stats.totalAgentsCreated}`);
console.log(`Tasks completed: ${stats.tasksCompleted}`);
console.log(`Average execution time: ${stats.totalExecutionTime / stats.tasksCompleted}ms`);

// 통계 초기화
team.resetStats();
```

### 다중 팀 통계 비교

```typescript
// 두 개의 독립적인 팀으로 다른 작업 처리
const team1Stats = team1.getStats();
const team2Stats = team2.getStats();

console.log(`
Example 1 Results:
• Tasks completed: ${team1Stats.tasksCompleted}
• Total agents created: ${team1Stats.totalAgentsCreated}
• Execution time: ${team1Stats.totalExecutionTime}ms

Example 2 Results:
• Tasks completed: ${team2Stats.tasksCompleted}
• Total agents created: ${team2Stats.totalAgentsCreated}
• Execution time: ${team2Stats.totalExecutionTime}ms

Overall Summary:
• Total tasks completed: ${team1Stats.tasksCompleted + team2Stats.tasksCompleted}
• Total agents created: ${team1Stats.totalAgentsCreated + team2Stats.totalAgentsCreated}
• Total execution time: ${team1Stats.totalExecutionTime + team2Stats.totalExecutionTime}ms
`);
```

## API 레퍼런스

### createTeam(options)

팀 인스턴스를 생성합니다.

**Parameters:**
- `options: TeamContainerOptions` - 팀 설정 옵션

**Returns:**
- `TeamContainer` - 팀 인스턴스

```typescript
interface TeamContainerOptions {
  baseRobotaOptions: RobotaOptions;
  maxMembers?: number;               // 기본값: 5
  debug?: boolean;                   // 기본값: false
}
```

### team.execute(userPrompt)

사용자 요청을 팀에서 협업으로 처리합니다.

**Parameters:**
- `userPrompt: string` - 사용자 요청

**Returns:**
- `Promise<string>` - 최종 결과

### team.getWorkflowHistory()

마지막 실행의 워크플로우 히스토리를 조회합니다.

**Returns:**
- `WorkflowHistory | null` - 워크플로우 데이터

### team.getStats()

팀 성능 통계를 조회합니다.

**Returns:**
- `TeamStats` - 통계 정보

```typescript
interface TeamStats {
  totalAgentsCreated: number;
  tasksCompleted: number;
  totalExecutionTime: number;
  averageAgentsPerTask: number;
}
```

### team.resetStats()

팀 성능 통계를 초기화합니다.

### delegateWork(params)

작업을 전문 에이전트에게 위임합니다. (내부적으로 사용)

**Parameters:**
- `params: DelegateWorkParams` - 위임 매개변수

```typescript
interface DelegateWorkParams {
  jobDescription: string;     // 작업 설명
  context?: string;          // 추가 컨텍스트
  requiredTools?: string[];  // 필요한 도구들
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}
```

## 워크플로우 유틸리티 함수

### generateWorkflowFlowchart(workflowHistory)

워크플로우의 상세한 플로우차트를 생성합니다.

**Parameters:**
- `workflowHistory: WorkflowHistory` - 워크플로우 데이터

**Returns:**
- `string` - 텍스트 기반 플로우차트

### generateAgentRelationshipDiagram(workflowHistory)

에이전트 간 관계를 보여주는 다이어그램을 생성합니다.

**Parameters:**
- `workflowHistory: WorkflowHistory` - 워크플로우 데이터

**Returns:**
- `string` - 텍스트 기반 관계 다이어그램

### workflowHistoryToJSON(workflowHistory)

워크플로우 데이터를 JSON 형태로 변환합니다.

**Parameters:**
- `workflowHistory: WorkflowHistory` - 워크플로우 데이터

**Returns:**
- `string` - JSON 문자열

### workflowHistoryToCSV(workflowHistory)

워크플로우 데이터를 CSV 형태로 변환합니다.

**Parameters:**
- `workflowHistory: WorkflowHistory` - 워크플로우 데이터

**Returns:**
- `string` - CSV 문자열

### extractPerformanceMetrics(workflowHistory)

워크플로우의 성능 메트릭을 추출합니다.

**Parameters:**
- `workflowHistory: WorkflowHistory` - 워크플로우 데이터

**Returns:**
- `PerformanceMetrics` - 성능 분석 데이터

### getAgentConversation(workflowHistory, agentId)

특정 에이전트의 대화 내역을 조회합니다.

**Parameters:**
- `workflowHistory: WorkflowHistory` - 워크플로우 데이터
- `agentId: string` - 에이전트 ID

**Returns:**
- `AgentConversationData | null` - 에이전트 대화 데이터

### getAllMessagesChronologically(workflowHistory)

모든 메시지를 시간순으로 정렬하여 조회합니다.

**Parameters:**
- `workflowHistory: WorkflowHistory` - 워크플로우 데이터

**Returns:**
- `ChronologicalMessage[]` - 시간순 메시지 배열

## 성능 최적화

### 1. 리소스 관리
- **동적 에이전트 생성**: 필요한 에이전트만 생성하여 메모리 효율성 확보
- **자동 정리**: 작업 완료 후 즉시 에이전트 정리
- **토큰 제한 관리**: maxTokenLimit 설정으로 과도한 토큰 사용 방지

```typescript
const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    maxTokenLimit: 50000,  // 전체 대화 토큰 제한
    maxTokens: 16000       // 단일 응답 토큰 제한
  },
  maxMembers: 3,           // 동시 에이전트 수 제한
  debug: false
});
```

### 2. 오류 처리
- **개별 에이전트 실패 복구**: 단일 에이전트 실패가 전체 팀에 영향 미치지 않음
- **타임아웃 처리**: 무한 대기 방지
- **graceful degradation**: 일부 작업 실패시에도 가능한 결과 제공

### 3. 디버깅 지원
- **상세 로그**: debug 모드에서 모든 에이전트 상호작용 추적
- **워크플로우 시각화**: 복잡한 협업 과정 이해
- **성능 메트릭**: 병목 지점 식별

```typescript
const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    logger: console  // 상세 로그 출력
  },
  maxMembers: 5,
  debug: true        // 디버그 모드 활성화
});
```

## 시스템 프롬프트 최적화

### 팀 코디네이터 프롬프트 원칙

팀 코디네이터는 다음 원칙을 따라 작업을 분배합니다:

- **중복 없는 분배**: 각 세부 작업이 겹치지 않도록 분배
- **팀장의 종합 역할**: 개별 분석은 위임하되, 최종 비교 및 종합은 직접 수행
- **완전한 작업 범위**: 사용자 요청의 모든 부분을 빠짐없이 처리
- **독립적인 지시사항**: 각 에이전트가 컨텍스트 없이도 이해할 수 있는 명확한 작업 설명

### 전문 에이전트 프롬프트 구성

각 전문 에이전트는 다음과 같이 구성됩니다:

- **역할 기반 시스템 프롬프트**: 작업에 특화된 전문가 역할
- **명확한 작업 지시**: 팀 코디네이터로부터 받은 구체적인 작업 설명
- **필요한 도구 접근**: 작업 수행에 필요한 도구들만 선별적으로 제공

## 주요 장점

### ✅ **단순성**
- 모든 조정을 위한 단일 `delegateWork` 도구
- 복잡한 에이전트 계층이나 특별한 설정 불필요
- 다른 프롬프트를 가진 표준 Robota 인스턴스

### ✅ **유연성**
- 실제 작업 필요에 따른 동적 에이전트 생성
- 작업별 맞춤형 도구 및 능력 할당
- 다양한 AI 프로바이더 및 모델 지원

### ✅ **효율성**
- 필요한 에이전트만 생성하여 리소스 최적화
- 작업 완료 후 자동 정리로 메모리 효율성
- 지능적인 작업 분배로 중복 작업 방지

### ✅ **확장성**
- 새로운 도구 및 프로바이더 쉽게 추가
- 커스텀 에이전트 타입 지원
- 다양한 협업 패턴 구현 가능

### ✅ **투명성**
- 완전한 워크플로우 히스토리 제공
- 에이전트 간 관계 시각화
- 성능 분석 및 최적화 지원

## 사용 사례별 예시

### 콘텐츠 제작 팀

```typescript
const contentTeam = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    systemPrompt: 'You are a content creation team coordinator.',
    logger: console
  },
  maxMembers: 4
});

const result = await contentTeam.execute(`
  Create a comprehensive blog post about "The Future of AI in Healthcare".
  Include research, writing, SEO optimization, and social media snippets.
`);

// 자동 생성 에이전트:
// - 리서처 (최신 AI 헬스케어 트렌드 조사)
// - 작가 (매력적인 블로그 포스트 작성)
// - SEO 전문가 (검색 엔진 최적화)
// - 소셜 미디어 전문가 (SNS 컨텐츠 생성)
```

### 데이터 분석 팀

```typescript
const analyticsTeam = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    systemPrompt: 'You are a data analytics team coordinator.',
    logger: console
  },
  maxMembers: 3
});

const result = await analyticsTeam.execute(`
  Analyze our Q3 sales data and provide insights on customer behavior,
  seasonal trends, and recommendations for Q4 strategy.
`);

// 자동 생성 에이전트:
// - 데이터 분석가 (통계 분석 및 패턴 식별)
// - 트렌드 전문가 (계절성 및 시장 트렌드 분석)
// - 전략 컨설턴트 (권장사항 및 액션 플랜 수립)
```

## 문제 해결

### 일반적인 문제들

#### 1. "No workflow history available" 오류
```typescript
// 원인: 팀이 아직 작업을 완료하지 않음
// 해결: execute() 완료 후 getWorkflowHistory() 호출
const result = await team.execute(prompt);
const history = team.getWorkflowHistory(); // 이제 사용 가능
```

#### 2. 과도한 토큰 사용
```typescript
// 해결: 토큰 제한 설정
const team = createTeam({
  baseRobotaOptions: {
    maxTokenLimit: 30000,  // 전체 대화 제한
    maxTokens: 8000        // 단일 응답 제한
  }
});
```

#### 3. 에이전트 수 제한 초과
```typescript
// 해결: maxMembers 조정
const team = createTeam({
  maxMembers: 3,  // 동시 에이전트 수 제한
  debug: true     // 디버그 모드로 모니터링
});
```

## 업데이트 및 마이그레이션

### v1.0.0에서 v2.0.0으로

```typescript
// v1.0.0 (구버전)
const team = new Team({
  teamLeader: { provider: 'openai', model: 'gpt-4' },
  memberDefaults: { provider: 'openai', model: 'gpt-4' }
});

// v2.0.0 (현재)
const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4'
  }
});
```

## 라이센스

MIT

## 기여하기

기여를 환영합니다! 자세한 내용은 [CONTRIBUTING.md](../../CONTRIBUTING.md)를 참조하세요.

## 지원

- 📖 [전체 문서](https://robota.io)
- 🐛 [이슈 리포트](https://github.com/robota-ai/robota/issues)
- 💬 [Discord 커뮤니티](https://discord.gg/robota)
- 📧 [이메일 지원](mailto:support@robota.io)

---

`@robota-sdk/team`을 사용하여 복잡한 작업을 효율적인 멀티 에이전트 협업으로 해결하세요! 🚀

## 에이전트 템플릿 시스템

### 📋 **사전 정의된 에이전트 템플릿**

에이전트 템플릿 시스템을 통해 자주 사용되는 전문가 역할들을 미리 정의하고 `delegateWork`에서 쉽게 활용할 수 있습니다. 각 템플릿은 특정 역할에 최적화된 LLM 프로바이더, 모델, 시스템 프롬프트를 포함합니다.

### 템플릿 구조

```typescript
interface AgentTemplate {
  name: string;           // 템플릿 식별자 (예: "summarizer")
  description: string;    // 템플릿 역할 설명
  llm_provider: string;   // LLM 프로바이더 (openai, anthropic, google 등)
  model: string;          // 모델명 (gpt-4, claude-3-5-sonnet 등)
  temperature: number;    // 창의성 설정 (0.0-1.0)
  system_prompt: string;  // 역할별 전문화된 시스템 프롬프트
  tags: string[];        // 분류용 태그들
}
```

### 기본 제공 템플릿

#### 1. **Summarizer** (요약 전문가)
```json
{
  "name": "summarizer",
  "description": "전문적인 요약 및 핵심 포인트 추출을 담당하는 전문가",
  "llm_provider": "openai",
  "model": "gpt-4o-mini",
  "temperature": 0.3,
  "system_prompt": "You are an expert summarization specialist...",
  "tags": ["analysis", "summarization", "extraction"]
}
```

#### 2. **Ethical Reviewer** (윤리적 검토자)
```json
{
  "name": "ethical_reviewer",
  "description": "콘텐츠의 윤리적, 법적 측면을 검토하는 전문가",
  "llm_provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "temperature": 0.2,
  "system_prompt": "You are an ethical review specialist...",
  "tags": ["ethics", "review", "compliance"]
}
```

#### 3. **Creative Ideator** (아이디어 생성기)
```json
{
  "name": "creative_ideator",
  "description": "창의적 아이디어 발굴 및 브레인스토밍 전문가",
  "llm_provider": "openai",
  "model": "gpt-4",
  "temperature": 0.8,
  "system_prompt": "You are a creative ideation expert...",
  "tags": ["creativity", "brainstorming", "innovation"]
}
```

#### 4. **Fast Executor** (빠른 실행자)
```json
{
  "name": "fast_executor",
  "description": "간단한 작업을 빠르고 정확하게 처리하는 전문가",
  "llm_provider": "openai",
  "model": "gpt-4o-mini",
  "temperature": 0.1,
  "system_prompt": "You are a fast and accurate task executor...",
  "tags": ["execution", "speed", "accuracy"]
}
```

#### 5. **Domain Researcher** (분야별 리서처)
```json
{
  "name": "domain_researcher",
  "description": "특정 도메인에 대한 심층 연구 및 분석을 수행하는 전문가",
  "llm_provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "temperature": 0.4,
  "system_prompt": "You are a domain research specialist...",
  "tags": ["research", "analysis", "domain-expertise"]
}
```

### 템플릿 사용법

#### 기본 사용 (기존 방식 유지)
```typescript
// 기존 방식: 동적 에이전트 생성
const result = await team.execute(`
  시장 분석 보고서를 작성해주세요.
`);
// delegateWork가 자동으로 적절한 에이전트 생성
```

#### 템플릿 지정 사용
```typescript
// 새로운 방식: 특정 템플릿 지정
const result = await team.execute(`
  다음 문서를 요약해주세요. [템플릿: summarizer]
  
  [긴 문서 내용...]
`);

// 또는 delegateWork 호출시 직접 지정
delegateWork({
  jobDescription: "이 기술 문서의 핵심 내용을 요약해주세요",
  context: "개발팀 회의용 요약본 필요",
  agentTemplate: "summarizer"
});
```

#### 다중 템플릿 활용
```typescript
const result = await team.execute(`
  새로운 마케팅 캠페인을 기획해주세요.
  1. 창의적 아이디어 발굴 [템플릿: creative_ideator]
  2. 윤리적 검토 [템플릿: ethical_reviewer]
  3. 실행 계획 수립 [템플릿: fast_executor]
`);
```

### 커스텀 템플릿 추가

```typescript
// 팀 생성시 커스텀 템플릿 추가
const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini'
  },
  agentTemplates: [
    {
      name: "financial_analyst",
      description: "재무 분석 및 투자 전략 전문가",
      llm_provider: "openai",
      model: "gpt-4",
      temperature: 0.2,
      system_prompt: `You are a senior financial analyst with expertise in...`,
      tags: ["finance", "analysis", "investment"]
    },
    {
      name: "content_writer",
      description: "블로그 및 마케팅 콘텐츠 작성 전문가",
      llm_provider: "anthropic", 
      model: "claude-3-5-sonnet-20241022",
      temperature: 0.7,
      system_prompt: `You are an expert content writer specializing in...`,
      tags: ["writing", "content", "marketing"]
    }
  ]
});
```

### 템플릿 관리 API

```typescript
// 템플릿 목록 조회
const templates = team.getAvailableTemplates();
console.log('Available templates:', templates.map(t => t.name));

// 특정 템플릿 조회
const summarizerTemplate = team.getTemplate('summarizer');
console.log('Summarizer:', summarizerTemplate.description);

// 템플릿 추가
team.addTemplate({
  name: "data_scientist",
  description: "데이터 분석 및 머신러닝 전문가",
  llm_provider: "openai",
  model: "gpt-4",
  temperature: 0.3,
  system_prompt: "You are a data science expert...",
  tags: ["data", "ml", "statistics"]
});

// 템플릿 삭제
team.removeTemplate('data_scientist');
```

## 개발 체크리스트

다음은 에이전트 템플릿 시스템 구현을 위한 개발 체크리스트입니다:

### ✅ Phase 1: 기본 구조 설계
- [ ] **1.1** `AgentTemplate` 인터페이스 정의 (`packages/team/src/types.ts`)
- [ ] **1.2** `AgentTemplateManager` 클래스 생성 (`packages/team/src/agent-template-manager.ts`)
- [ ] **1.3** 기본 5개 템플릿 JSON 정의 (`packages/team/src/templates/`)
- [ ] **1.4** 템플릿 검증 스키마 추가 (Zod)

### ✅ Phase 2: 템플릿 관리 기능
- [ ] **2.1** 템플릿 로드/저장 기능 구현
- [ ] **2.2** 템플릿 검색 및 필터링 기능
- [ ] **2.3** 커스텀 템플릿 추가/삭제 API
- [ ] **2.4** 템플릿 직렬화/역직렬화 지원

### ✅ Phase 3: AgentFactory 확장
- [ ] **3.1** `AgentFactory`에 템플릿 지원 추가
- [ ] **3.2** 템플릿 기반 에이전트 생성 메서드
- [ ] **3.3** 다중 프로바이더 지원 구현
- [ ] **3.4** 템플릿 시스템 프롬프트 생성 로직

### ✅ Phase 4: delegateWork 확장
- [ ] **4.1** `DelegateWorkParams`에 `agentTemplate` 필드 추가
- [ ] **4.2** 팀 시스템 프롬프트에 템플릿 설명 추가
- [ ] **4.3** 템플릿 선택 로직 구현
- [ ] **4.4** 백워드 호환성 보장 (기존 방식 유지)

### ✅ Phase 5: TeamContainer 통합
- [ ] **5.1** `TeamContainer`에 템플릿 매니저 통합
- [ ] **5.2** 템플릿 관리 API 추가 (`getAvailableTemplates`, `addTemplate` 등)
- [ ] **5.3** 템플릿 기반 delegateWork 처리
- [ ] **5.4** 템플릿 사용 통계 추가

### ✅ Phase 6: 문서 및 테스트
- [ ] **6.1** API 문서 업데이트
- [ ] **6.2** 사용 예시 추가
- [ ] **6.3** 단위 테스트 작성
- [ ] **6.4** 통합 테스트 작성

### ✅ Phase 7: 고급 기능
- [ ] **7.1** 템플릿 성능 메트릭 수집
- [ ] **7.2** 템플릿 추천 시스템
- [ ] **7.3** 동적 템플릿 조정 기능
- [ ] **7.4** 템플릿 버전 관리

---

`@robota-sdk/team`을 사용하여 복잡한 작업을 효율적인 멀티 에이전트 협업으로 해결하세요! 🚀 