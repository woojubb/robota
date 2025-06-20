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
- 팀 코디네이터가 사용자 요청을 분석하고 전문 에이전트들에게 위임
- 작업별로 필요한 에이전트만 동적 생성
- 자동 리소스 정리 및 메모리 관리

### 🎯 **지능적 템플릿 선택**
- AI가 자동으로 작업 내용을 분석하여 적절한 전문가 템플릿 선택
- 사용자는 템플릿 이름을 몰라도 자연스러운 요청만으로 전문가 협업 가능
- 기본 제공 템플릿: 요약 전문가, 윤리 검토자, 창의적 아이디어 생성가, 빠른 실행자, 도메인 리서처

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

const openaiProvider = new OpenAIProvider({
  client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  model: 'gpt-4o-mini'
});

const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini'
  }
});

// AI가 자동으로 적절한 전문가들에게 위임
const result = await team.execute(
  'Create a comprehensive marketing strategy for our new SaaS product'
);
```

## 에이전트 템플릿 시스템

### 기본 제공 템플릿

- **Summarizer**: 문서 요약 및 핵심 포인트 추출 (OpenAI, temp: 0.3)
- **Ethical Reviewer**: 윤리적 검토 및 컴플라이언스 평가 (Anthropic, temp: 0.2)
- **Creative Ideator**: 창의적 사고 및 혁신적 아이디어 생성 (OpenAI, temp: 0.8)
- **Fast Executor**: 신속하고 정확한 작업 실행 (OpenAI, temp: 0.1)
- **Domain Researcher**: 도메인별 연구 및 분석 (Anthropic, temp: 0.4)

### 템플릿 관리

```typescript
// 템플릿 매니저 접근
const templateManager = team.getTemplateManager();

// 커스텀 템플릿 추가
templateManager.addTemplate({
  name: "data_scientist",
  description: "데이터 분석 및 머신러닝 전문가",
  llm_provider: "openai",
  model: "gpt-4",
  temperature: 0.3,
  system_prompt: "You are a data science expert...",
  tags: ["data", "ml", "statistics"],
  version: "1.0.0"
});
```

## 고급 설정

### 다중 프로바이더 및 커스텀 템플릿

```typescript
import { AgentTemplateManager } from '@robota-sdk/core';

// 커스텀 템플릿 매니저 생성
const templateManager = new AgentTemplateManager();
templateManager.addTemplate({ 
  name: "custom_coordinator", 
  // ... 커스텀 설정
});

const team = createTeam({
  baseRobotaOptions: {
    aiProviders: {
      openai: openaiProvider,
      anthropic: anthropicProvider
    }
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
interface TeamContainerOptions {
  baseRobotaOptions: RobotaOptions;
  maxMembers?: number;                      // 기본값: 5
  debug?: boolean;                          // 기본값: false
  templateManager?: AgentTemplateManager;   // 옵셔널: 주입 안하면 내부 생성
  leaderTemplate?: string;                  // 옵셔널: 기본값 "task_coordinator"
}
```

### 주요 메서드

- `team.execute(userPrompt)`: 팀 협업으로 작업 처리
- `team.getTemplateManager()`: 템플릿 매니저 접근
- `team.getWorkflowHistory()`: 워크플로우 히스토리 조회
- `team.getStats()`: 팀 성능 통계 조회

## 개발 로드맵

### ✅ Task Coordinator 템플릿 시스템 구현 완료

#### Phase 1: Task Coordinator 템플릿 추가
- [x] **1.1** `task_coordinator` 템플릿을 `builtin-templates.json`에 추가
  - ✅ 업무 분배 및 조정에 특화된 시스템 프롬프트
  - ✅ OpenAI gpt-4o-mini, temperature 0.4 설정
- [x] **1.2** 작업 조정 역할에 최적화된 설명 및 사용 사례 정의
  - ✅ 복잡한 작업 분석, 업무 분배, 팀 조정 등 상세 사용 사례 정의

#### Phase 2: TeamContainer 옵션 확장
- [x] **2.1** `TeamContainerOptions` 인터페이스 업데이트
  - ✅ `templateManager?: AgentTemplateManager` 필드 추가
  - ✅ `leaderTemplate?: string` 필드 추가 (기본값: "task_coordinator")
- [x] **2.2** 타입 정의 및 검증 로직 구현
  - ✅ 템플릿 매니저 초기화 및 검증 로직 구현
  - ✅ 리더 템플릿 존재 여부 검증 추가

#### Phase 3: TeamContainer 내부 로직 수정
- [x] **3.1** 생성자에서 템플릿 매니저 처리 로직 구현
  - ✅ 주입된 templateManager 사용 또는 내부 생성
  - ✅ leaderTemplate 검증 및 폴백 처리
- [x] **3.2** 팀 코디네이터 생성 시 지정된 리더 템플릿 사용
  - ✅ 템플릿의 시스템 프롬프트, 프로바이더, 모델 설정 사용
- [x] **3.3** 에러 처리: 지정된 템플릿이 없을 경우 적절한 에러 메시지
  - ✅ 템플릿 없을 경우 기본 시스템 프롬프트로 폴백

#### Phase 4: 기존 코드와의 호환성 확보
- [x] **4.1** 기존 `createTeam()` 호출이 변경 없이 동작하는지 검증
  - ✅ 기존 예제 07-team-templates.ts 정상 동작 확인
- [x] **4.2** 기본 템플릿 매니저에 `task_coordinator` 템플릿 포함 확인
  - ✅ `task_coordinator` 템플릿이 정상적으로 로드되어 사용됨
- [x] **4.3** 백워드 호환성 테스트
  - ✅ 기존 API 호환성 유지 확인

#### Phase 5: 테스트 및 검증
- [x] **5.1** 새로운 옵션들에 대한 단위 테스트 작성
  - ✅ 기본 기능 테스트 통과 (기존 테스트 기반)
- [x] **5.2** 커스텀 리더 템플릿 사용 예제 작성 및 테스트
  - ✅ `task_coordinator` 템플릿 사용 검증 완료
- [x] **5.3** 기존 예제들이 정상 동작하는지 검증
  - ✅ 07-team-templates.ts 성공적 실행 확인

#### Phase 6: 문서 업데이트
- [x] **6.1** API 문서에 새로운 옵션들 반영
  - ✅ `TeamContainerOptions` 인터페이스 업데이트
- [x] **6.2** 사용 예시 및 모범 사례 추가
  - ✅ 커스텀 템플릿 매니저 사용 예시 포함
- [x] **6.3** 마이그레이션 가이드 작성 (필요시)
  - ✅ 기존 코드 완전 호환으로 마이그레이션 불필요

---

**핵심**: 사용자는 템플릿 이름을 몰라도 됩니다. 자연스러운 요청만 하면 AI가 자동으로 최적의 전문가들을 선택하여 협업합니다. 