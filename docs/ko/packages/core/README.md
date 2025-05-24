# @robota-sdk/core

Robota SDK의 코어 패키지 - AI 에이전트를 쉽게 구축하기 위한 TypeScript 라이브러리입니다.

## 문서

전체 문서는 [https://robota.io](https://robota.io)를 참조하세요.

## 설치

```bash
npm install @robota-sdk/core
```

## 개요

`@robota-sdk/core`는 Robota SDK로 AI 에이전트를 구축하기 위한 기반을 제공합니다. 여기에는 에이전트 생성, 대화 관리 및 다양한 AI 제공자와의 통합을 위한 핵심 기능이 포함되어 있습니다.

## 기본 사용법

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// 새 Robota 인스턴스 생성
const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: new OpenAI({ apiKey: 'your-api-key' })
  }),
  systemPrompt: '당신은 도움이 되는 AI 비서입니다.'
});

// 간단한 대화 실행
const response = await robota.run('TypeScript에 대해 알려주세요');
console.log(response);

// 응답 스트리밍
const stream = await robota.runStream('AI 에이전트에 대해 설명해주세요');
for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

## 기능

- 제공자에 구애받지 않는 아키텍처
- 다양한 AI 모델 및 제공자 지원
- 스트리밍 응답
- 구조화된 함수 호출
- 타입 안전 API

## 라이선스

MIT 