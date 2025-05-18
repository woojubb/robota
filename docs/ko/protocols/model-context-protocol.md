# 모델 컨텍스트 프로토콜 (Model Context Protocol)

모델 컨텍스트 프로토콜(MCP)은 다양한 AI 모델과 일관된 방식으로 통신하기 위한 Robota의 표준화된 방법입니다. 이 프로토콜을 통해 서로 다른 AI 제공업체 간의 호환성을 보장하고, 모델 간 전환을 쉽게 할 수 있습니다.

## 프로토콜 개요

MCP는 다음 요소로 구성됩니다:

1. **메시지 형식** - 사용자와 AI 간의 대화를 구조화하는 방법
2. **함수 스키마** - 함수와 도구의 정의를 표현하는 방법
3. **컨텍스트 관리** - 대화 컨텍스트와 상태를 관리하는 방법
4. **응답 형식** - AI의 응답을 구조화하는 방법

## 메시지 형식

MCP에서 메시지는 다음과 같은 구조를 가집니다:

```typescript
interface Message {
  role: 'user' | 'assistant' | 'system' | 'function';
  content: string;
  name?: string;  // function 호출인 경우 함수 이름
  functionCall?: {
    name: string;
    arguments: Record<string, any>;
  };
  functionResult?: any;
}
```

예시:

```typescript
// 사용자 메시지
const userMessage: Message = {
  role: 'user',
  content: '서울의 날씨가 어때?'
};

// 시스템 메시지
const systemMessage: Message = {
  role: 'system',
  content: '당신은 도움이 되는 AI 비서입니다.'
};

// 함수 호출을 포함한 어시스턴트 메시지
const assistantMessage: Message = {
  role: 'assistant',
  content: '서울의 날씨를 확인해보겠습니다.',
  functionCall: {
    name: 'getWeather',
    arguments: { location: '서울' }
  }
};

// 함수 결과 메시지
const functionMessage: Message = {
  role: 'function',
  name: 'getWeather',
  content: JSON.stringify({ temperature: 25, condition: '맑음' })
};
```

## 함수 스키마

MCP는 함수를 JSON 스키마 형식으로 정의합니다:

```typescript
interface FunctionSchema {
  name: string;
  description?: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: any[];
      default?: any;
      // 추가 JSON 스키마 속성
    }>;
    required?: string[];
  };
}
```

예시:

```typescript
const weatherFunctionSchema: FunctionSchema = {
  name: 'getWeather',
  description: '특정 위치의 현재 날씨 정보를 가져옵니다',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: '날씨를 확인할 도시 이름 (예: 서울, 부산)'
      },
      unit: {
        type: 'string',
        description: '온도 단위',
        enum: ['celsius', 'fahrenheit'],
        default: 'celsius'
      }
    },
    required: ['location']
  }
};
```

## 컨텍스트 관리

MCP에서 컨텍스트는 대화의 상태를 나타내며, 다음 요소를 포함합니다:

```typescript
interface Context {
  messages: Message[];            // 지금까지의 대화 기록
  functions?: FunctionSchema[];   // 사용 가능한 함수 목록
  systemPrompt?: string;          // 단일 시스템 프롬프트
  systemMessages?: Message[];     // 여러 시스템 메시지
  metadata?: Record<string, any>; // 추가 메타데이터
}
```

### 시스템 메시지 관리

Robota는 단일 시스템 프롬프트와 여러 시스템 메시지를 모두 지원합니다:

```typescript
// 단일 시스템 프롬프트 설정
robota.setSystemPrompt('당신은 도움이 되는 AI 어시스턴트입니다.');

// 여러 시스템 메시지 설정
robota.setSystemMessages([
  { role: 'system', content: '당신은 전문 데이터 분석가입니다.' },
  { role: 'system', content: '사용자가 데이터 분석 관련 질문을 할 때마다 단계별로 설명해주세요.' }
]);

// 기존 시스템 메시지에 추가
robota.addSystemMessage('항상 정확한 정보를 제공하려고 노력하세요.');
```

Robota 인스턴스 생성 시 시스템 메시지를 설정할 수도 있습니다:

```typescript
// 단일 시스템 프롬프트로 초기화
const robota1 = new Robota({
  provider: provider,
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
});

// 여러 시스템 메시지로 초기화
const robota2 = new Robota({
  provider: provider,
  systemMessages: [
    { role: 'system', content: '당신은 전문 데이터 분석가입니다.' },
    { role: 'system', content: '사용자가 데이터 분석 관련 질문을 할 때마다 단계별로 설명해주세요.' }
  ]
});
```

## 응답 형식

모델의 응답은 다음과 같은 구조로 표준화됩니다:

```typescript
interface ModelResponse {
  content?: string;               // 텍스트 응답
  functionCall?: {                // 함수 호출 (있는 경우)
    name: string;
    arguments: Record<string, any>;
  };
  usage?: {                       // 토큰 사용량 정보
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, any>; // 추가 메타데이터
}
```

## 제공업체 간 프로토콜 변환

Robota는 각 AI 제공업체의 고유한 API 형식과 MCP 간의 변환을 자동으로 처리합니다. 예를 들어, OpenAI와 Anthropic은 서로 다른 메시지 형식을 사용하지만, Robota는 이를 MCP로 표준화합니다.

```typescript
// OpenAI a형식에서 MCP로 변환
function openaiToMCP(openaiResponse) {
  return {
    content: openaiResponse.choices[0].message.content,
    functionCall: openaiResponse.choices[0].message.function_call
      ? {
          name: openaiResponse.choices[0].message.function_call.name,
          arguments: JSON.parse(openaiResponse.choices[0].message.function_call.arguments)
        }
      : undefined,
    usage: {
      promptTokens: openaiResponse.usage.prompt_tokens,
      completionTokens: openaiResponse.usage.completion_tokens,
      totalTokens: openaiResponse.usage.total_tokens
    }
  };
}

// MCP에서 Anthropic 형식으로 변환
function mcpToAnthropic(mcpContext) {
  return {
    messages: mcpContext.messages.map(message => {
      if (message.role === 'user') {
        return { role: 'human', content: message.content };
      } else if (message.role === 'assistant') {
        return { role: 'assistant', content: message.content };
      }
      // 기타 변환 로직
    }),
    system: mcpContext.systemPrompt
  };
}
```

## 커스텀 모델 통합하기

새로운 AI 모델을 Robota에 통합하려면 해당 모델의 API와 MCP 간의 변환 로직을 구현해야 합니다:

```typescript
import { BaseProvider, ModelContextProtocol } from 'robota';

class CustomModelProvider extends BaseProvider implements ModelContextProtocol {
  // MCP 컨텍스트를 모델 고유 형식으로 변환
  convertContextToModelFormat(context) {
    // 변환 로직 구현
    return customFormat;
  }

  // 모델 응답을 MCP 형식으로 변환
  convertModelResponseToMCP(modelResponse) {
    // 변환 로직 구현
    return mcpResponse;
  }
  
  // 기타 필요한 메서드 구현
}
```

## MCP의 이점

1. **제공업체 독립성** - 애플리케이션 코드를 변경하지 않고 다른 AI 모델로 전환 가능
2. **표준화된 인터페이스** - 일관된 방식으로 모든 AI 모델과 상호작용
3. **확장성** - 새로운 모델과 제공업체를 쉽게 통합
4. **이식성** - 다양한 환경에서 동일한 코드를 재사용 