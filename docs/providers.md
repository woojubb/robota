---
title: AI Providers & Tools
description: AI Clients and Tool Providers in Robota
lang: en-US
---

# AI Clients and Tool Providers

Robota는 두 가지 주요 구성 요소로 동작합니다:

1. **AI 클라이언트 (AI Clients)**: 다양한 LLM 서비스와 통신하는 인터페이스
2. **도구 제공자 (Tool Providers)**: AI 모델이 호출할 수 있는 기능을 제공하는 인터페이스

## AI 클라이언트

AI 클라이언트는 OpenAI, Anthropic 등의 LLM 서비스와 직접 통신하는 역할을 합니다. 각 클라이언트는 특정 API와 통신하고 해당 서비스의 고유 기능을 활용합니다.

### 지원하는 AI 클라이언트

#### OpenAI

OpenAI의 GPT 모델과 통합. GPT-3.5, GPT-4 등을 지원합니다.

자세한 내용은 [OpenAI 클라이언트 문서](providers/openai.md)를 참조하세요.

#### Anthropic

Anthropic의 Claude 모델과 통합. Claude, Claude Instant 등을 지원합니다.

자세한 내용은 [Anthropic 클라이언트 문서](providers/anthropic.md)를 참조하세요.

### AI 클라이언트 사용하기

각 AI 클라이언트는 일관된 인터페이스를 통해 사용됩니다. API 클라이언트를 직접 주입해야 합니다:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIClient } from '@robota-sdk/openai-client';
import OpenAI from 'openai';

// OpenAI API 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION
});

// OpenAI 클라이언트 설정 (클라이언트 주입 필수)
const aiClient = new OpenAIClient({
  model: 'gpt-4',
  temperature: 0.7,
  client: openaiClient
});

// Robota 인스턴스에 AI 클라이언트 연결
const robota = new Robota({ aiClient });

// 실행
const result = await robota.run('안녕하세요! 오늘 날씨는 어떤가요?');
```

### 클라이언트 인스턴스 주입 (필수)

Robota는 외부에서 생성된 API 클라이언트를 사용합니다. 이를 통해:

1. 애플리케이션 전반에 걸쳐 일관된 클라이언트 설정 유지
2. 테스트 가능성 및 모킹 개선
3. 클라이언트 설정에 대한 더 세밀한 제어

```typescript
import { Robota } from '@robota-sdk/core';
import { AnthropicClient } from '@robota-sdk/anthropic-client';
import Anthropic from '@anthropic-ai/sdk';

// Anthropic 클라이언트 생성
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Anthropic 클라이언트 설정 (클라이언트 주입 필수)
const aiClient = new AnthropicClient({
  model: 'claude-3-opus',
  temperature: 0.7,
  client: anthropicClient
});

// Robota 인스턴스에 AI 클라이언트 연결
const robota = new Robota({ aiClient });
```

## 도구 제공자 (Tool Providers)

도구 제공자는 AI 모델이 호출할 수 있는 기능을 제공합니다. 이를 통해 AI는 외부 시스템과 상호 작용하거나 특정 작업을 수행할 수 있습니다.

### 지원하는 도구 제공자 타입

#### Zod Function 도구 제공자

Zod 스키마를 기반으로 한 함수 도구를 제공합니다. 이 도구 제공자는 타입 안정성을 보장하고 런타임 유효성 검사를 수행합니다.

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIClient } from '@robota-sdk/openai-client';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

// OpenAI 클라이언트 설정
const aiClient = new OpenAIClient({ /* ... */ });

// 계산기 도구 정의
const calculatorTool = {
  name: 'calculate',
  description: '수학 계산을 수행합니다',
  parameters: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    a: z.number(),
    b: z.number()
  }),
  handler: async ({ operation, a, b }) => {
    // 계산 로직 구현
    switch (operation) {
      case 'add': return { result: a + b };
      case 'subtract': return { result: a - b };
      case 'multiply': return { result: a * b };
      case 'divide': return b !== 0 ? { result: a / b } : { error: '0으로 나눌 수 없습니다' };
    }
  }
};

// Zod 함수 도구 제공자 생성
const provider = createZodFunctionToolProvider({
  tools: { calculate: calculatorTool }
});

// Robota 인스턴스 설정
const robota = new Robota({
  aiClient,
  provider
});

// AI가 도구를 사용하도록 요청
const result = await robota.run('5와 3을 더하면 얼마인가요?');
```

#### OpenAPI 도구 제공자

OpenAPI 명세를 기반으로 한 도구를 제공합니다. 이를 통해 REST API와 쉽게 통합할 수 있습니다.

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIClient } from '@robota-sdk/openai-client';
import { createOpenAPIToolProvider } from '@robota-sdk/core';

// OpenAI 클라이언트 설정
const aiClient = new OpenAIClient({ /* ... */ });

// OpenAPI 도구 제공자 생성
const provider = createOpenAPIToolProvider('https://api.example.com/openapi.json', {
  baseUrl: 'https://api.example.com'
});

// Robota 인스턴스 설정
const robota = new Robota({
  aiClient,
  provider
});

// AI가 API를 호출하도록 요청
const result = await robota.run('현재 서울의 날씨는 어떤가요?');
```

#### MCP (Model Context Protocol) 도구 제공자

MCP를 지원하는 모델과 통합하기 위한 도구 제공자입니다. `createMcpToolProvider` 함수를 사용하여 MCP 기반 도구 제공자를 생성할 수 있습니다.

```typescript
import { Robota, createMcpToolProvider } from '@robota-sdk/core';
import { OpenAIClient } from '@robota-sdk/openai-client';
import { Client, StdioClientTransport } from '@modelcontextprotocol/sdk';

// OpenAI 클라이언트 설정
const aiClient = new OpenAIClient({ /* ... */ });

// MCP 클라이언트 생성
const transport = new StdioClientTransport(/* 설정 */);
const mcpClient = new Client(transport);

// MCP 도구 제공자 생성
const provider = createMcpToolProvider(mcpClient);

// Robota 인스턴스 설정
const robota = new Robota({
  aiClient,
  provider
});

// 실행
const result = await robota.run('안녕하세요!');
```

## AI 클라이언트와 도구 제공자의 차이점

| 특성 | AI 클라이언트 | 도구 제공자 |
|------|------------|-----------|
| 주요 역할 | LLM 서비스와 통신 | AI가 호출할 수 있는 기능 제공 |
| 상호작용 방식 | 프롬프트 전송, 응답 수신 | 특정 도구/함수 호출 처리 |
| 예시 | OpenAIClient, AnthropicClient | ZodFunctionToolProvider, OpenAPIToolProvider |
| Robota 연결 | aiClient 속성 사용 | provider 속성 사용 |

## 상세 문서

- [OpenAI 클라이언트](providers/openai.md)
- [Anthropic 클라이언트](providers/anthropic.md)
- [도구 제공자](providers/tools.md)
- [커스텀 구현](providers/custom.md) 