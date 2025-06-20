# @robota-sdk/team - Multi-Agent Team Collaboration

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fteam.svg)](https://www.npmjs.com/package/@robota-sdk/team)

복잡한 작업을 위한 멀티 에이전트 팀워크 기능 - 동적 에이전트 조정 및 작업 위임

## 개요

`@robota-sdk/team`은 Robota SDK의 핵심 기능으로, 사용자의 복잡한 작업을 여러 전문 에이전트들이 협업하여 해결하는 시스템입니다. 팀 코디네이터가 작업을 분석하고 필요한 전문 에이전트들을 동적으로 생성하여 업무를 분산하고 결과를 취합합니다.

**핵심 특징**: AI가 사용자의 자연스러운 요청을 분석하여 자동으로 적절한 전문가 템플릿을 선택합니다. 사용자는 템플릿 이름을 알 필요가 없습니다.

## 설치

```bash
npm install @robota-sdk/team
```

## 주요 기능

### 🤝 **동적 에이전트 조정**
- 전담 태스크 코디네이터가 사용자 요청을 분석하고 전문 에이전트들에게 위임
- 작업별로 필요한 에이전트만 동적 생성
- 자동 리소스 정리 및 메모리 관리

### 🎯 **지능적 템플릿 선택**
- AI가 자동으로 작업 내용을 분석하여 적절한 전문가 템플릿 선택
- 사용자는 템플릿 이름을 몰라도 자연스러운 요청만으로 전문가 협업 가능
- 6개 기본 제공 템플릿: 태스크 코디네이터, 요약 전문가, 윤리 검토자, 창의적 아이디어 생성가, 빠른 실행자, 도메인 리서처

### ⚡ **통합된 delegateWork 도구**
- 모든 작업 위임을 위한 단일 도구 인터페이스
- 복잡한 작업 분해를 위한 재귀적 위임 지원

## 아키텍처

### 핵심 컴포넌트

- **TeamContainer**: 메인 조정 클래스
- **AgentFactory**: 적절한 프롬프트로 작업별 에이전트 생성
- **AgentTemplateManager**: 전문가 템플릿 관리 및 자동 선택
- **delegateWork Tool**: 범용 작업 위임 인터페이스

## 기본 사용법

```typescript
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

const openaiProvider = new OpenAIProvider({
  client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
});

const anthropicProvider = new AnthropicProvider({
  client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
});

// 간소화된 템플릿 기반 API
const team = createTeam({
  aiProviders: {
    openai: openaiProvider,
    anthropic: anthropicProvider
  },
  maxMembers: 5,
  maxTokenLimit: 50000,
  logger: console,
  debug: true
});

// AI가 자동으로 적절한 전문가들에게 위임
const result = await team.execute(
  'Create a comprehensive marketing strategy for our new SaaS product'
);
```

## 에이전트 템플릿 시스템

### 기본 제공 템플릿

- **Task Coordinator**: 복잡한 작업 분석과 전문가 위임을 담당하는 팀 리더 (OpenAI gpt-4o-mini, temp: 0.4)
- **Summarizer**: 문서 요약 및 핵심 포인트 추출 (OpenAI gpt-4o-mini, temp: 0.3)
- **Ethical Reviewer**: 윤리적 검토 및 컴플라이언스 평가 (Anthropic claude-3-5-sonnet-20241022, temp: 0.2)
- **Creative Ideator**: 창의적 사고 및 혁신적 아이디어 생성 (OpenAI gpt-4o-mini, temp: 0.8)
- **Fast Executor**: 신속하고 정확한 작업 실행 (OpenAI gpt-4o-mini, temp: 0.1)
- **Domain Researcher**: 도메인별 연구 및 분석 (Anthropic claude-3-5-sonnet-20241022, temp: 0.4)

### 템플릿 관리

```typescript
// 템플릿 매니저 접근
const templateManager = team.getTemplateManager();

// 커스텀 템플릿 추가
templateManager.addTemplate({
  name: "data_scientist",
  description: "Expert in data analysis, machine learning, and statistical modeling. Use for: analyzing datasets, building ML models, statistical analysis, data visualization, predictive analytics, A/B testing, data preprocessing, feature engineering.",
  llm_provider: "openai",
  model: "gpt-4",
  temperature: 0.3,
  system_prompt: "You are a data science expert...",
  tags: ["data", "ml", "statistics"],
  version: "1.0.0",
  createdAt: new Date()
});
```

## 고급 설정

### 커스텀 템플릿 매니저 및 리더 지정

```typescript
import { AgentTemplateManager } from '@robota-sdk/core';

// 커스텀 템플릿 매니저 생성
const templateManager = new AgentTemplateManager();
templateManager.addTemplate({ 
  name: "custom_coordinator", 
  description: "Custom task coordination specialist",
  llm_provider: "anthropic",
  model: "claude-3-5-sonnet-20241022",
  temperature: 0.3,
  system_prompt: "You are a specialized coordinator...",
  tags: ["coordination", "management"],
  version: "1.0.0",
  createdAt: new Date()
});

const team = createTeam({
  aiProviders: {
    openai: openaiProvider,
    anthropic: anthropicProvider
  },
  templateManager: templateManager,  // 커스텀 템플릿 매니저 주입
  leaderTemplate: "custom_coordinator",  // 커스텀 리더 지정
  maxMembers: 10,
  debug: true
});
```

## API 레퍼런스

### createTeam(options)

```typescript
interface TeamOptions {
  aiProviders: Record<string, AIProvider>;   // 필수: AI 프로바이더들
  maxMembers?: number;                       // 기본값: 5
  debug?: boolean;                           // 기본값: false
  maxTokenLimit?: number;                    // 기본값: 50000
  logger?: any;                              // 기본값: console
  templateManager?: AgentTemplateManager;    // 옵셔널: 커스텀 템플릿 매니저
  leaderTemplate?: string;                   // 옵셔널: 기본값 "task_coordinator"
}
```

### 주요 메서드

- `team.execute(userPrompt)`: 팀 협업으로 작업 처리
- `team.getTemplateManager()`: 템플릿 매니저 접근
- `team.getWorkflowHistory()`: 워크플로우 히스토리 조회
- `team.getStats()`: 팀 성능 통계 조회

## 구현 완료 사항

### ✅ Task Coordinator 템플릿 시스템
- **팀 리더 역할**: `task_coordinator` 템플릿이 기본 팀 리더로 동작
- **자동 템플릿 선택**: AI가 자연어 요청을 분석하여 적절한 전문가 템플릿 자동 선택
- **단순화된 API**: AI 프로바이더만 제공하면 템플릿이 모든 설정 관리
- **완전한 백워드 호환성**: 기존 코드 수정 없이 새 기능 사용 가능

### 주요 개선사항
- 템플릿 기반 설정으로 복잡한 구성 옵션 제거
- 각 템플릿이 최적화된 AI 프로바이더/모델/온도 자동 선택
- 6개 전문화된 기본 템플릿 제공
- 커스텀 템플릿 및 팀 리더 지정 지원

---

**핵심**: 사용자는 템플릿 이름을 몰라도 됩니다. 자연스러운 요청만 하면 AI가 자동으로 최적의 전문가들을 선택하여 협업합니다. 