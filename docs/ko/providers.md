---
title: AI 제공자
description: Robota의 다양한 AI 제공자
lang: ko-KR
---

# AI 제공자 (Providers)

Robota는 다양한 AI 제공자를 지원하여 여러 LLM 서비스를 활용할 수 있게 합니다. 각 제공자는 특정 API와 통신하고 해당 서비스의 고유한 기능을 활용할 수 있도록 설계되었습니다.

## 지원되는 제공자

### 현재 구현됨

#### OpenAI

OpenAI의 GPT 모델과 통합하기 위한 제공자입니다. GPT-3.5, GPT-4 등 다양한 모델을 지원합니다.

자세한 내용은 [OpenAI 제공자 문서](providers/openai.md)를 참조하세요.

#### Anthropic

Anthropic의 Claude 모델과 통합하기 위한 제공자입니다. Claude, Claude Instant 등의 모델을 지원합니다.

자세한 내용은 [Anthropic 제공자 문서](providers/anthropic.md)를 참조하세요.

### 프로토콜 제공자

특정 프로토콜을 기반으로 한 제공자도 지원합니다:

#### MCP (Model Context Protocol)

Model Context Protocol을 지원하는 모델과 통합하기 위한 제공자입니다. `createMcpToolProvider` 함수를 통해 MCP 기반 툴 제공자를 생성할 수 있습니다.

자세한 내용은 [모델 컨텍스트 프로토콜](protocols/model-context-protocol.md)을 참조하세요.

### 커스텀 제공자

자체 AI 서비스나 지원되지 않는 서비스를 통합하기 위한 커스텀 제공자를 직접 구현할 수 있습니다.

자세한 내용은 [커스텀 제공자 가이드](providers/custom.md)를 참조하세요.

## 제공자 사용하기

각 제공자는 일관된 인터페이스를 통해 사용됩니다. API 클라이언트를 직접 주입해야 합니다:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import OpenAI from 'openai';

// OpenAI 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION
});

// OpenAI 제공자 설정 (클라이언트 인스턴스 주입은 필수)
const provider = new OpenAIProvider({
  model: 'gpt-4',
  temperature: 0.7,
  client: openaiClient
});

// Robota 인스턴스에 제공자 연결
const robota = new Robota({ provider });

// 실행
const result = await robota.run('안녕하세요! 오늘 날씨가 어때요?');
```

### 클라이언트 인스턴스 주입 (필수)

Robota는 외부에서 생성된 API 클라이언트를 사용합니다. 이를 통해:

1. 애플리케이션 전체에서 일관된 클라이언트 설정 유지
2. 테스트 및 모킹 용이성 향상
3. 클라이언트 설정에 대한 더 세밀한 제어 가능

```typescript
import { Robota } from '@robota-sdk/core';
import { AnthropicProvider } from '@robota-sdk/provider-anthropic';
import Anthropic from '@anthropic-ai/sdk';

// Anthropic 클라이언트 생성
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Anthropic 제공자 설정 (클라이언트 주입은 필수)
const provider = new AnthropicProvider({
  model: 'claude-3-opus',
  temperature: 0.7,
  client: anthropicClient
});

// Robota 인스턴스에 제공자 연결
const robota = new Robota({ provider });
```

### MCP 클라이언트 사용하기

Model Context Protocol을 지원하는 모델을 사용하려면:

```typescript
import { Robota, createMcpToolProvider } from '@robota-sdk/core';
import { Client, StdioClientTransport } from '@modelcontextprotocol/sdk';

// MCP 클라이언트 생성
const transport = new StdioClientTransport(/* 설정 */);
const mcpClient = new Client(transport);

// MCP 제공자 초기화
const provider = createMcpToolProvider(mcpClient, {
  model: 'model-name',
  temperature: 0.7
});

// Robota 인스턴스에 제공자 연결
const robota = new Robota({ provider });

// 실행
const result = await robota.run('안녕하세요!');
```

## 여러 제공자 사용하기

여러 제공자를 동시에 사용하여 다양한 AI 모델의 장점을 활용할 수 있습니다:

```typescript
import { Robota, ProviderRouter } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { AnthropicProvider } from '@robota-sdk/provider-anthropic';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// 여러 제공자 설정
const openaiProvider = new OpenAIProvider({
  model: 'gpt-4',
  client: openaiClient
});

const anthropicProvider = new AnthropicProvider({
  model: 'claude-3-opus',
  client: anthropicClient
});

// 라우터를 통해 여러 제공자 사용
const router = new ProviderRouter({
  defaultProvider: openaiProvider,
  providers: {
    openai: openaiProvider,
    anthropic: anthropicProvider
  },
  routingStrategy: (message, context) => {
    // 메시지 내용에 따라 적절한 제공자 선택
    if (message.includes('창의적') || message.includes('creative')) {
      return 'anthropic';
    }
    return 'openai'; // 기본값
  }
});

// 라우터를 제공자로 사용
const robota = new Robota({ provider: router });

// 각 질문은 적절한 제공자로 라우팅됨
const creativeResult = await robota.run('창의적인 시를 써줘');  // Anthropic으로 라우팅
const factualResult = await robota.run('파이의 값은 얼마인가요?');  // OpenAI로 라우팅
```

## 제공자 구성 옵션

각 제공자는 서비스별 고유 구성 옵션을 지원합니다. 공통적으로 지원되는 기본 옵션은 다음과 같습니다:

```typescript
interface ProviderOptions {
  model: string;       // 사용할 모델 이름
  temperature?: number; // 응답의 무작위성/창의성 (0~1)
  maxTokens?: number;   // 최대 생성 토큰 수
  stopSequences?: string[]; // 생성 중지 시퀀스
  streamMode?: boolean; // 스트리밍 모드 활성화 여부
  functionCallMode?: 'auto' | 'disabled' | 'force'; // 함수 호출 모드
  forcedFunction?: string; // 강제 실행할 함수 이름 (functionCallMode가 'force'인 경우)
  forcedArguments?: Record<string, any>; // 강제 함수 인자 (functionCallMode가 'force'인 경우)
}
```

## 자세한 제공자별 문서

- [OpenAI 제공자](providers/openai.md)
- [Anthropic 제공자](providers/anthropic.md)
- [커스텀 제공자 만들기](providers/custom.md) 