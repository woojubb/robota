# Google Provider

`@robota-sdk/google` 패키지는 Google AI (Gemini) API와의 통합을 제공합니다.

## 설치

```bash
npm install @robota-sdk/google @google/generative-ai
# 또는
pnpm add @robota-sdk/google @google/generative-ai
# 또는
yarn add @robota-sdk/google @google/generative-ai
```

## 기본 사용법

Google provider를 사용하려면 먼저 Google AI API 키가 필요합니다.

```typescript
import { Agent } from '@robota-sdk/core';
import { GoogleProvider } from '@robota-sdk/google';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Google AI 클라이언트 초기화
const googleClient = new GoogleGenerativeAI('YOUR_API_KEY');

// Google provider 생성
const googleProvider = new GoogleProvider({
    client: googleClient,
    model: 'gemini-1.5-flash', // 기본값
    temperature: 0.7,
    maxTokens: undefined
});

// Agent 생성
const agent = new Agent(googleProvider);

// 대화 시작
const response = await agent.chat('안녕하세요! 오늘 날씨는 어떤가요?');
console.log(response.content);
```

## Provider 옵션

`GoogleProvider`는 다음 옵션들을 지원합니다:

```typescript
interface GoogleProviderOptions {
    /** Google AI 클라이언트 인스턴스 (필수) */
    client: GoogleGenerativeAI;
    
    /** 사용할 모델 (기본값: 'gemini-1.5-flash') */
    model?: string;
    
    /** 온도 설정 (0-1, 기본값: 0.7) */
    temperature?: number;
    
    /** 최대 토큰 수 */
    maxTokens?: number;
}
```

## 지원되는 모델

Google provider는 다음 모델들을 지원합니다:

- `gemini-1.5-flash` (기본값)
- `gemini-1.5-pro`
- `gemini-1.0-pro`

## 스트리밍

Google provider는 스트리밍 응답을 지원합니다:

```typescript
const stream = agent.chatStream('긴 이야기를 들려주세요');

for await (const chunk of stream) {
    process.stdout.write(chunk.content);
}
```

## 시스템 메시지

Google provider는 시스템 메시지를 지원합니다:

```typescript
const agent = new Agent(googleProvider, {
    systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다. 항상 한국어로 답변해주세요.'
});

const response = await agent.chat('Hello, how are you?');
// 한국어로 응답됩니다.
```

## 환경 변수 설정

API 키를 환경 변수로 관리하는 것을 권장합니다:

```bash
# .env 파일
GOOGLE_AI_API_KEY=your_api_key_here
```

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
```

## 에러 처리

Google provider는 다양한 에러 상황을 적절히 처리합니다:

```typescript
try {
    const response = await agent.chat('안녕하세요');
    console.log(response.content);
} catch (error) {
    if (error.message.includes('API key')) {
        console.error('API 키를 확인해주세요');
    } else {
        console.error('요청 처리 중 오류:', error.message);
    }
}
```

## 제한사항

현재 Google provider의 제한사항:

- Function calling은 아직 지원되지 않습니다 (개발 예정)
- 사용량 정보 (토큰 수)는 아직 정확하게 반환되지 않습니다

## API 키 발급

Google AI API 키는 [Google AI Studio](https://aistudio.google.com/)에서 발급받을 수 있습니다.

1. Google AI Studio 방문
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. API 키 생성
4. 키를 안전한 곳에 저장

## 예제

### 기본 채팅봇

```typescript
import { Agent } from '@robota-sdk/core';
import { GoogleProvider } from '@robota-sdk/google';
import { GoogleGenerativeAI } from '@google/generative-ai';

const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
const provider = new GoogleProvider({ client: googleClient });
const agent = new Agent(provider);

async function chatBot() {
    const response = await agent.chat('AI에 대해 간단히 설명해주세요');
    console.log(response.content);
}

chatBot();
```

### 다중 턴 대화

```typescript
const agent = new Agent(provider);

// 첫 번째 메시지
await agent.chat('제 이름은 김철수입니다');

// 두 번째 메시지 (이전 컨텍스트 기억)
const response = await agent.chat('제 이름이 뭐였죠?');
console.log(response.content); // "김철수라고 하셨습니다"
``` 