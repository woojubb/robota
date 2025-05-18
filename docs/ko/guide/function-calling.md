---
title: 함수 호출
description: Robota에서 함수 호출 사용하기
lang: ko-KR
---

# 함수 호출 (Function Calling)

함수 호출은 AI 모델이 사전 정의된 함수를 호출할 수 있게 하는 기능입니다. 이를 통해 AI는 외부 시스템과 상호작용하고, 데이터를 검색하거나 계산을 수행할 수 있습니다.

## 기본적인 함수 호출

Robota에서는 ToolProvider 인터페이스를 구현한 제공업체를 통해 함수 호출 기능을 사용합니다:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { createZodToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';
import OpenAI from 'openai';

// OpenAI 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// zod 스키마로 함수 정의
const getWeatherFunction = {
  name: 'getWeather',
  description: '특정 위치의 날씨 정보를 가져옵니다.',
  parameters: z.object({
    location: z.string().describe('날씨를 검색할 위치 (도시명)'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('온도 단위')
  }),
  execute: async (params: { location: string, unit: 'celsius' | 'fahrenheit' }) => {
    console.log(`${params.location}의 날씨를 ${params.unit} 단위로 검색 중...`);
    // 실제 구현에서는 날씨 API 호출
    return { 
      temperature: 25, 
      condition: '맑음', 
      humidity: 60,
      unit: params.unit
    };
  }
};

const calculateFunction = {
  name: 'calculate',
  description: '수학 표현식을 계산합니다.',
  parameters: z.object({
    expression: z.string().describe('계산할 수학 표현식 (예: 2 + 2)')
  }),
  execute: async (params: { expression: string }) => {
    console.log(`계산 중: ${params.expression}`);
    // 주의: eval은 보안상 위험할 수 있습니다. 실제 사용시 안전한 대안을 고려하세요.
    return { result: eval(params.expression) };
  }
};

// 함수 제공업체 생성
const toolProvider = createZodToolProvider(
  {
    functions: [getWeatherFunction, calculateFunction],
    model: 'gpt-4',
    client: openaiClient
  }
);

// Robota 인스턴스 생성
const robota = new Robota({
  provider: toolProvider,
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
});

// 실행
const result = await robota.run('서울의 날씨가 어떤지 알려주고, 25 + 15의 계산 결과도 보여줘.');
console.log(result);
```

## zod를 사용한 스키마 정의

보다 강력한 매개변수 검증을 위해 `zod` 라이브러리를 사용할 수 있습니다:

```typescript
import { z } from 'zod';
import { Robota } from '@robota-sdk/core';
import { createZodToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';

// zod 스키마를 사용한 함수 생성
const sendEmailFunction = {
  name: 'sendEmail',
  description: '지정된 수신자에게 이메일을 보냅니다',
  parameters: z.object({
    to: z.string().email('유효한 이메일 주소가 필요합니다'),
    subject: z.string().min(1, '제목은 비어있을 수 없습니다'),
    body: z.string(),
    cc: z.array(z.string().email()).optional(),
    bcc: z.array(z.string().email()).optional(),
    attachments: z.array(z.string().url()).optional()
  }),
  execute: async (params) => {
    console.log(`이메일 전송 중: ${params.subject}`);
    // 실제 이메일 전송 로직
    return { 
      status: 'sent',
      messageId: 'msg-' + Math.random().toString(36).substring(2, 9)
    };
  }
};

// OpenAI 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 함수 제공업체 생성
const toolProvider = createZodToolProvider(
  {
    functions: [sendEmailFunction],
    model: 'gpt-4',
    client: openaiClient
  }
);

const robota = new Robota({
  provider: toolProvider,
  systemPrompt: '당신은 이메일 전송을 도와주는 어시스턴트입니다.'
});

// 실행
const result = await robota.run('contact@example.com으로 회의 일정에 대한 이메일을 보내줘.');
console.log(result);
```

## 함수 호출 모드

Robota는 다양한 함수 호출 모드를 지원합니다:

### 자동 모드 (기본값)

AI가 필요에 따라 함수를 자동으로 호출합니다:

```typescript
// 개별 호출에서 설정
const result = await robota.run('내일 서울의 날씨가 어떤지 알려줘', {
  functionCallMode: 'auto' // 기본값이므로 생략 가능
});

// 전역 설정
robota.setFunctionCallMode('auto');
```

### 강제 모드

특정 함수를 강제로 호출하도록 지시합니다:

```typescript
// 개별 호출에서 설정
const result = await robota.run('내일 서울의 날씨가 어떤지 알려줘', {
  functionCallMode: 'force',
  forcedFunction: 'getWeather',
  forcedArguments: { location: '서울', unit: 'celsius' }
});

// 전역 설정 + 개별 호출에서 함수 지정
robota.setFunctionCallMode('force');
const result = await robota.run('아무 내용', {
  forcedFunction: 'getWeather',
  forcedArguments: { location: '서울' }
});
```

### 비활성화 모드

함수 호출을 완전히 비활성화합니다:

```typescript
// 개별 호출에서 설정
const result = await robota.run('안녕하세요!', {
  functionCallMode: 'disabled'
});

// 전역 설정
robota.setFunctionCallMode('disabled');
```

## 다양한 Provider 지원

Robota는 다양한 제공업체를 통해 함수 호출을 지원합니다:

### OpenAI Tool Provider

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIToolProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const provider = new OpenAIToolProvider({
  model: 'gpt-4-turbo',
  client: openai,
  tools: [
    {
      type: 'function',
      function: {
        name: 'getWeather',
        description: '특정 위치의 날씨 정보를 가져옵니다.',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: '날씨를 검색할 위치 (도시명)'
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
              description: '온도 단위'
            }
          },
          required: ['location']
        }
      }
    }
  ]
});

const robota = new Robota({ provider });
```

### MCP Tool Provider

```typescript
import { Robota } from '@robota-sdk/core';
import { McpToolProvider } from '@robota-sdk/provider-mcp';
import { Client } from '@modelcontextprotocol/sdk';

const mcpClient = new Client(transport);

const provider = new McpToolProvider({
  model: 'gpt-4',
  client: mcpClient
});

const robota = new Robota({ provider });
```

## 함수 호출 설정 관리

보안과 안전성을 위해 함수 호출에 전역 설정을 적용할 수 있습니다:

```typescript
import { Robota } from '@robota-sdk/core';

// 초기화 시 설정
const robota = new Robota({
  provider: toolProvider,
  functionCallConfig: {
    maxCalls: 5, // 최대 함수 호출 횟수
    timeout: 10000, // 함수 호출 타임아웃 (ms)
    allowedFunctions: ['getWeather', 'calculate'], // 허용된 함수 목록
    defaultMode: 'auto' // 기본 함수 호출 모드
  }
});

// 나중에 설정 변경
robota.configureFunctionCall({
  mode: 'auto',
  maxCalls: 10,
  timeout: 15000,
  allowedFunctions: ['getWeather', 'calculate', 'searchDatabase']
});
```

함수 호출 모드만 변경할 수도 있습니다:

```typescript
robota.setFunctionCallMode('auto'); // 'auto', 'disabled', 'force' 중 하나 선택
``` 