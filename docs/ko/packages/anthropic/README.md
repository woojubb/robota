# @robota-sdk/anthropic

Robota SDK를 위한 Anthropic Claude 통합 패키지입니다.

## 문서

전체 문서는 [https://robota.io](https://robota.io)를 참조하세요.

## 설치

```bash
npm install @robota-sdk/anthropic @robota-sdk/core @anthropic-ai/sdk
```

## 개요

`@robota-sdk/anthropic`는 Robota SDK를 위한 Anthropic의 Claude 모델 통합을 제공합니다. 이 패키지를 통해 AI 에이전트 구축을 위한 Robota 프레임워크 내에서 Claude 모델을 사용할 수 있습니다.

## 기본 사용법

```typescript
import { Robota } from '@robota-sdk/core';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import Anthropic from '@anthropic-ai/sdk';

// Anthropic 클라이언트 초기화
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Anthropic 제공자 생성
const provider = new AnthropicProvider({
  model: 'claude-3-opus-20240229',
  client: anthropicClient
});

// Anthropic 제공자로 Robota 인스턴스 생성
const robota = new Robota({
  provider,
  systemPrompt: '당신은 Claude, 도움이 되는 AI 비서입니다.'
});

// 간단한 대화 실행
const response = await robota.run('AI 비서의 이점에 대해 알려주세요');
console.log(response);
```

## 함수 호출

Anthropic 제공자는 Claude의 도구 사용 기능을 지원합니다:

```typescript
import { Robota } from '@robota-sdk/core';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

// 도구와 함께 제공자 초기화
const provider = new AnthropicProvider({
  model: 'claude-3-opus-20240229',
  client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  tools: [
    {
      name: 'calculate',
      description: '수학적 계산 수행',
      parameters: z.object({
        expression: z.string().describe('평가할 수학적 표현식')
      }),
      execute: async (params) => {
        // 계산 로직 구현
        return { result: eval(params.expression) };
      }
    }
  ]
});

const robota = new Robota({ provider });
const response = await robota.run('15 * 27 + 42를 계산해주세요');
```

## 지원되는 모델

다음을 포함한 모든 Claude 모델과 작동합니다:
- Claude 3 Opus
- Claude 3 Sonnet
- Claude 3 Haiku
- 그리고 향후 출시될 Claude 모델들

## 라이선스

MIT 