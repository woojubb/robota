# Anthropic 제공자

Anthropic의 Claude 모델과 통합하기 위한 제공자입니다. Claude, Claude Instant 등의 다양한 모델을 지원합니다.

## 특징

- Claude 모델 지원 (claude-3-opus, claude-3-sonnet 등)
- 함수 호출(Tool Use) 기능 지원
- 스트리밍 응답 지원
- 높은 품질의 추론 및 안전 메커니즘

## 설치

```bash
npm install @robota-sdk/anthropic
```

## 사용법

### 기본 사용

```typescript
import { Robota, AnthropicProvider } from 'robota';
import Anthropic from '@anthropic-ai/sdk';

// Anthropic 클라이언트 생성
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Anthropic 제공자 초기화
const provider = new AnthropicProvider({
  model: 'claude-3-opus',
  temperature: 0.7,
  client: anthropicClient
});

// Robota 인스턴스에 제공자 연결
const robota = new Robota({ provider });

// 실행
const result = await robota.run('안녕하세요! 오늘 날씨가 어때요?');
console.log(result);
```

### 함수 호출 사용

```typescript
import { Robota, AnthropicProvider } from 'robota';
import Anthropic from '@anthropic-ai/sdk';

// Anthropic 클라이언트 생성
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Anthropic 제공자 초기화
const provider = new AnthropicProvider({
  model: 'claude-3-opus',
  client: anthropicClient
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
import { Robota, AnthropicProvider } from 'robota';
import Anthropic from '@anthropic-ai/sdk';

// Anthropic 클라이언트 생성
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Anthropic 제공자 초기화
const provider = new AnthropicProvider({
  model: 'claude-3-opus',
  client: anthropicClient
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

Anthropic 제공자는 다음과 같은 옵션을 지원합니다:

```typescript
interface AnthropicProviderOptions extends ProviderOptions {
  // 필수 옵션
  model: string;       // 사용할 모델 이름 (예: 'claude-3-opus')
  client: Anthropic;   // Anthropic 클라이언트 인스턴스

  // 선택적 옵션
  temperature?: number;  // 응답의 무작위성/창의성 (0~1)
  maxTokens?: number;    // 최대 생성 토큰 수
  stopSequences?: string[]; // 생성 중지 시퀀스
  topP?: number;         // 상위 확률 샘플링 (0~1)
  topK?: number;         // 상위 K개 토큰 샘플링
}
```

## 모델 선택 가이드

| 모델 | 특징 | 추천 사용 사례 |
|------|------|----------------|
| claude-3-opus | 최고 성능, 복잡한 추론 | 고품질 콘텐츠 생성, 복잡한 문제 해결 |
| claude-3-sonnet | 균형 잡힌 성능과 속도 | 일반적인 대화, 중간 복잡도 작업 |
| claude-3-haiku | 빠른 속도, 경제적 | 간단한 작업, 대용량 처리 필요 시 |

## 주의사항

- Anthropic API 키는 항상 환경 변수나 안전한 시크릿 관리 시스템을 통해 관리하세요.
- Claude 모델은 OpenAI와 다른 함수 호출 메커니즘(Tool Use)을 사용합니다. Robota는 이러한 차이를 추상화하지만, 특정 기능 사용 시 모델별 제한사항이 있을 수 있습니다.
- 콘텐츠 안전 필터링이 다른 모델보다 엄격할 수 있습니다. 