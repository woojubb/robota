# OpenAI 제공자

OpenAI의 GPT 모델과 통합하기 위한 제공자입니다. GPT-3.5, GPT-4 등 다양한 모델을 지원합니다.

## 특징

- GPT 모델 지원 (gpt-3.5-turbo, gpt-4, gpt-4-turbo 등)
- 함수 호출(Function Calling) 기능 지원
- 스트리밍 응답 지원
- 다양한 모델 파라미터 제어 (temperature, top_p 등)

## 설치

```bash
npm install @robota-sdk/openai
```

## 사용법

### 기본 사용

```typescript
import { Robota, OpenAIProvider } from 'robota';
import OpenAI from 'openai';

// OpenAI 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION // 선택 사항
});

// OpenAI 제공자 초기화
const provider = new OpenAIProvider({
  model: 'gpt-4',
  temperature: 0.7,
  client: openaiClient
});

// Robota 인스턴스에 제공자 연결
const robota = new Robota({ provider });

// 실행
const result = await robota.run('안녕하세요! 오늘 날씨가 어때요?');
console.log(result);
```

### 함수 호출 사용

```typescript
import { Robota, OpenAIProvider } from 'robota';
import OpenAI from 'openai';

// OpenAI 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// OpenAI 제공자 초기화
const provider = new OpenAIProvider({
  model: 'gpt-4',
  client: openaiClient
});

// Robota 인스턴스 생성
const robota = new Robota({ provider });

// 함수 등록
robota.registerFunctions({
  getWeather: async (location: string) => {
    // 날씨 정보 조회 로직
    return { temperature: 22, condition: '맑음', location };
  }
});

// 실행
const result = await robota.run('서울의 날씨가 어때요?');
console.log(result);
```

### 스트리밍 응답 처리

```typescript
import { Robota, OpenAIProvider } from 'robota';
import OpenAI from 'openai';

// OpenAI 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// OpenAI 제공자 초기화
const provider = new OpenAIProvider({
  model: 'gpt-4',
  client: openaiClient
});

// Robota 인스턴스 생성
const robota = new Robota({ provider });

// 스트리밍 응답 처리
const stream = await robota.stream('긴 이야기를 해주세요.');

for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

## 제공자 옵션

OpenAI 제공자는 다음과 같은 옵션을 지원합니다:

```typescript
interface OpenAIProviderOptions extends ProviderOptions {
  // 필수 옵션
  model: string;       // 사용할 모델 이름 (예: 'gpt-4')
  client: OpenAI;      // OpenAI 클라이언트 인스턴스

  // 선택적 옵션
  temperature?: number;  // 응답의 무작위성/창의성 (0~1)
  maxTokens?: number;    // 최대 생성 토큰 수
  stopSequences?: string[]; // 생성 중지 시퀀스
  topP?: number;         // 상위 확률 샘플링 (0~1)
  presencePenalty?: number; // 주제 반복 억제 (-2.0~2.0)
  frequencyPenalty?: number; // 단어 반복 억제 (-2.0~2.0)
  responseFormat?: {      // 응답 형식 지정
    type: 'text' | 'json_object'
  };
  user?: string;         // 사용자 식별자
}
```

## 모델 선택 가이드

| 모델 | 특징 | 추천 사용 사례 |
|------|------|----------------|
| gpt-3.5-turbo | 빠르고 경제적 | 단순한 대화, 기본 정보 처리 |
| gpt-4 | 더 정확하고 추론 능력 우수 | 복잡한 문제 해결, 코드 작성 |
| gpt-4-turbo | 최신 데이터와 향상된 기능 | 최신 정보가 필요한 작업 |
| gpt-4-vision | 이미지 이해 능력 | 시각적 콘텐츠 분석 |

## 주의사항

- OpenAI API 키는 항상 환경 변수나 안전한 시크릿 관리 시스템을 통해 관리하세요.
- 비용 관리를 위해 `maxTokens` 옵션을 적절히 설정하는 것이 좋습니다.
- 스트리밍 모드에서는 일부 기능(예: 토큰 사용량 추적)이 제한될 수 있습니다. 