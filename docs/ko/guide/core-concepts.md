---
title: 핵심 개념
description: Robota 라이브러리의 핵심 개념
lang: ko-KR
---

# 핵심 개념

Robota 라이브러리는 다음과 같은 핵심 개념을 기반으로 합니다.

## 주요 구성 요소

### 1. Robota 클래스

전체 라이브러리의 진입점입니다. AI 에이전트를 초기화하고 실행할 수 있는 인터페이스를 제공합니다.

```typescript
const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: openaiClient
  }),
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.',
  // 추가 설정
});
```

시스템 메시지를 여러 개 설정할 수도 있습니다:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: openaiClient
  }),
  systemMessages: [
    { role: 'system', content: '당신은 날씨에 대한 전문가입니다.' },
    { role: 'system', content: '항상 정확한 정보를 제공하려고 노력하세요.' }
  ]
});
```

### 2. 제공업체 (Providers)

다양한 AI 서비스를 사용할 수 있도록 하는 추상화 계층입니다. 각 제공업체는 특정 LLM API(OpenAI, Anthropic 등)와 통신하는 방법을 제공합니다.

```typescript
import OpenAI from 'openai';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { AnthropicProvider } from '@robota-sdk/provider-anthropic';

// OpenAI 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// OpenAI 제공업체
const openaiProvider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4'
});

// Anthropic 제공업체
const anthropicProvider = new AnthropicProvider({
  client: anthropicClient,
  model: 'claude-3-opus'
});
```

### 3. 함수 호출 (Function Calling)

AI 모델이 특정 함수를 호출할 수 있도록 합니다. 이를 통해 외부 API 호출, 데이터베이스 조회, 파일 시스템 액세스 등의 작업을 수행할 수 있습니다.

```typescript
import { Robota } from '@robota-sdk/core';

// 함수 정의
const functions = {
  searchDatabase: async (query: string) => {
    // 데이터베이스 검색 로직
    return { results: ['결과1', '결과2'] };
  }
};

// 함수 등록
robota.registerFunctions(functions);

// 함수 호출 모드 설정
robota.setFunctionCallMode('auto'); // 'auto', 'disabled', 'force' 중 선택
```

### 4. 도구 (Tools)

도구는 함수 호출의 확장된 개념으로, 더 복잡하고 구조화된 기능을 제공합니다. 각 도구는 메타데이터, 파라미터 검증, 실행 로직을 포함합니다.

```typescript
import { Tool } from '@robota-sdk/tools';
import { z } from 'zod';

const calculator = new Tool({
  name: 'calculator',
  description: '수학 계산을 수행합니다',
  parameters: z.object({
    expression: z.string().describe('계산할 수식')
  }),
  execute: async ({ expression }) => {
    return { result: eval(expression) };
  }
});

robota.registerTools([calculator]);
```

### 5. 에이전트 (Agents)

에이전트는 목표를 달성하기 위해 도구를 사용하고 추론하는 AI 시스템입니다. Robota는 다양한 에이전트 패턴을 구현할 수 있습니다.

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

const researchAgent = new Robota({
  name: '리서치 에이전트',
  description: '웹에서 정보를 검색하고 요약하는 에이전트',
  tools: [webSearch, summarize],
  provider: openaiProvider
});
```

### 6. 메모리 (Memory)

대화 기록을 저장하고 관리하는 시스템으로, 에이전트가 이전 상호작용을 기억하고 참조할 수 있게 합니다.

```typescript
import { Robota } from '@robota-sdk/core';
import { ConversationMemory } from '@robota-sdk/memory';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

const memory = new ConversationMemory();
const robota = new Robota({
  provider: openaiProvider,
  memory
});
```

### 7. 모델 컨텍스트 프로토콜 (Model Context Protocol)

특정 모델과 통신하기 위한 표준화된 방법을 제공하는 프로토콜입니다. 다양한 모델 제공업체 간의 호환성을 보장합니다.

### 8. OpenAPI 통합

Swagger/OpenAPI 스펙에서 자동으로 도구와 함수를 생성하는 기능을 제공합니다.

```typescript
import { OpenAPIToolkit } from '@robota-sdk/openapi';

const apiTools = await OpenAPIToolkit.fromURL('https://api.example.com/openapi.json');
robota.registerTools(apiTools);
```

## 라이브러리 아키텍처

Robota는 다음과 같은 계층 구조로 설계되었습니다:

1. **코어 계층**: 기본 클래스와 인터페이스
2. **제공업체 계층**: 다양한 LLM API 통합
3. **도구 계층**: 함수 및 도구 추상화
4. **에이전트 계층**: 추론 및 계획 패턴 
5. **유틸리티 계층**: 도우미 함수 및 공통 기능

이 구조는 모듈성과 확장성을 극대화하여 다양한 AI 에이전트 시나리오를 지원합니다. 