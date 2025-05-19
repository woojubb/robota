# @robota-sdk/openai

Robota SDK를 위한 OpenAI 통합 패키지입니다.

## 문서

전체 문서는 [https://robota.io](https://robota.io)를 참조하세요.

## 설치

```bash
npm install @robota-sdk/openai @robota-sdk/core openai
```

## 개요

`@robota-sdk/openai`는 Robota SDK를 위한 OpenAI 모델 통합을 제공합니다. 이 패키지를 통해 AI 에이전트 애플리케이션에서 함수 호출 기능이 있는 OpenAI의 GPT 모델을 사용할 수 있습니다.

## 기본 사용법

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// OpenAI 클라이언트 초기화
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// OpenAI 제공자 생성
const provider = new OpenAIProvider({
  model: 'gpt-4',
  client: openaiClient
});

// OpenAI 제공자로 Robota 인스턴스 생성
const robota = new Robota({
  provider,
  systemPrompt: '당신은 도움이 되는 AI 비서입니다.'
});

// 간단한 대화 실행
const response = await robota.run('인공지능에 대해 알려줄 수 있는 것이 있나요?');
console.log(response);
```

## 함수 호출

OpenAI 제공자는 함수 호출 기능을 지원합니다:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import { z } from 'zod';

// 도구와 함께 제공자 초기화
const provider = new OpenAIProvider({
  model: 'gpt-4',
  client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  tools: [
    {
      name: 'getWeather',
      description: '위치에 대한 날씨 정보 가져오기',
      parameters: z.object({
        location: z.string().describe('도시 이름'),
        unit: z.enum(['celsius', 'fahrenheit']).default('celsius')
      }),
      execute: async (params) => {
        // 날씨 조회 로직 구현
        return { temperature: 22, condition: 'Sunny' };
      }
    }
  ]
});

const robota = new Robota({ provider });
const response = await robota.run('서울의 날씨는 어떤가요?');
```

## 모델

다음을 포함한 모든 OpenAI 모델을 지원합니다:
- GPT-4
- GPT-3.5 Turbo
- 및 기타 호환 모델

## 라이선스

MIT 