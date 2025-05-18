# 커스텀 제공자 만들기

자체 AI 서비스나 지원되지 않는 서비스를 통합하려면 커스텀 제공자를 만들 수 있습니다. Robota는
유연한 추상화 계층을 제공하여 다양한 AI 모델과 서비스를 쉽게 통합할 수 있게 합니다.

## 기본 구현 방법

커스텀 제공자를 만들기 위해서는 `BaseProvider` 클래스를 확장하고 필요한 메서드를 구현해야 합니다.

```typescript
import { BaseProvider, ProviderResponse, ProviderOptions, ModelContext } from 'robota';

interface CustomProviderOptions extends ProviderOptions {
  model: string;
  client: any; // 커스텀 API 클라이언트 타입
  // 추가 옵션
}

export class CustomProvider extends BaseProvider {
  private client: any;
  
  constructor(options: CustomProviderOptions) {
    super(options);
    
    if (!options.client) {
      throw new Error('클라이언트 인스턴스가 필요합니다.');
    }
    
    this.client = options.client;
  }

  async generateCompletion(
    context: ModelContext, 
    options?: Partial<ProviderOptions>
  ): Promise<ProviderResponse> {
    // 컨텍스트와 메시지를 API가 이해할 수 있는 형식으로 변환
    const messages = this.formatMessages(context.messages);
    
    // API 호출 구현
    const response = await this.client.generateCompletion({
      messages,
      model: options?.model || this.options.model,
      temperature: options?.temperature || this.options.temperature,
      // 추가 파라미터
    });
    
    // API 응답을 표준 형식으로 변환
    return {
      content: response.text,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0
      }
    };
  }

  async generateCompletionStream(
    context: ModelContext, 
    options?: Partial<ProviderOptions>
  ): Promise<ProviderResponseStream> {
    // 스트리밍 API 호출 구현
    const stream = await this.client.generateCompletionStream({
      messages: this.formatMessages(context.messages),
      model: options?.model || this.options.model,
      // 추가 파라미터
    });
    
    // 스트림 처리 및 변환
    return this.processStream(stream);
  }
  
  // 도우미 메서드: 메시지 형식 변환
  private formatMessages(messages: any[]) {
    // Robota 메시지 형식을 API 형식으로 변환
    return messages.map(msg => {
      // 변환 로직
      return {
        role: msg.role,
        content: msg.content
        // 추가 변환
      };
    });
  }
  
  // 도우미 메서드: 스트림 처리
  private async *processStream(apiStream: any): AsyncGenerator<ProviderResponse> {
    for await (const chunk of apiStream) {
      yield {
        content: chunk.text || '',
        // 추가 데이터
      };
    }
  }

  // 함수 호출 스키마 변환 (옵션)
  transformFunctionSchemas(functions: any[]): any {
    // 함수 스키마를 API가 이해할 수 있는 형식으로 변환
    return functions.map(fn => {
      // 변환 로직
      return {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters
        // 추가 변환
      };
    });
  }

  // 기능 지원 여부 확인
  supportsFeature(feature: string): boolean {
    switch (feature) {
      case 'function-calling':
        return true; // 함수 호출 지원 여부
      case 'streaming':
        return true; // 스트리밍 지원 여부
      default:
        return false;
    }
  }
}
```

## 사용 예시

커스텀 제공자를 만든 후 Robota에서 사용하는 방법:

```typescript
import { Robota } from 'robota';
import { CustomProvider } from './custom-provider';
import { CustomClient } from 'custom-client-library';

// 커스텀 클라이언트 생성
const client = new CustomClient({
  apiKey: process.env.CUSTOM_API_KEY,
  // 추가 설정
});

// 커스텀 제공자 초기화
const provider = new CustomProvider({
  model: 'custom-model-v1',
  temperature: 0.7,
  client: client
});

// Robota 인스턴스에 제공자 연결
const robota = new Robota({ provider });

// 실행
const result = await robota.run('안녕하세요! 커스텀 모델을 테스트합니다.');
console.log(result);
```

## 추가 고려사항

### 1. 에러 처리

견고한 에러 처리를 구현하여 API 오류를 적절히 처리해야 합니다:

```typescript
async generateCompletion(context, options) {
  try {
    // API 호출...
  } catch (error) {
    if (error.statusCode === 429) {
      throw new Error('API 속도 제한에 도달했습니다. 잠시 후 다시 시도하세요.');
    } else if (error.statusCode === 401) {
      throw new Error('인증에 실패했습니다. API 키를 확인하세요.');
    } else {
      throw new Error(`API 호출 중 오류 발생: ${error.message}`);
    }
  }
}
```

### 2. 함수 호출 지원

함수 호출을 지원하려면 적절한 변환 로직을 구현해야 합니다:

```typescript
// API가 함수 호출을 지원하는 경우 
async generateCompletion(context, options) {
  // ... 메시지 준비 등의 코드
  
  // 함수 스키마 추가
  if (context.functions && context.functions.length > 0) {
    apiRequest.functions = this.transformFunctionSchemas(context.functions);
    apiRequest.function_call = options?.functionCallMode || this.options.functionCallMode;
  }
  
  // API 호출 및 응답
  // ...
  
  // 함수 호출 처리
  if (apiResponse.function_call) {
    return {
      content: apiResponse.content,
      functionCall: {
        name: apiResponse.function_call.name,
        arguments: JSON.parse(apiResponse.function_call.arguments)
      },
      // ... 기타 응답 필드
    };
  }
  
  return { content: apiResponse.content };
}
```

### 3. 스트리밍 응답 처리

스트리밍 응답을 처리하는 방법은 API마다 다를 수 있습니다:

```typescript
private async *processStream(apiStream) {
  let aggregatedContent = '';
  
  try {
    for await (const chunk of apiStream) {
      const content = chunk.text || chunk.choices?.[0]?.delta?.content || '';
      aggregatedContent += content;
      
      yield {
        content,
        aggregatedContent,
        // 추가 메타데이터
      };
    }
  } catch (error) {
    throw new Error(`스트리밍 처리 중 오류 발생: ${error.message}`);
  }
}
```

## 테스트 및 디버깅

커스텀 제공자를 테스트하고 디버깅하기 위한 조언:

1. **단위 테스트**: 주요 메서드에 대한 단위 테스트를 작성하세요.
2. **목(Mock) 사용**: API 호출을 시뮬레이션하는 목 객체를 사용하여 테스트하세요.
3. **점진적 개발**: 기본 기능부터 시작하여 점진적으로 고급 기능을 추가하세요.
4. **로깅**: 개발 중에는 상세한 로깅을 활성화하여 문제를 파악하세요.

## 모범 사례

1. **타입 안전성**: TypeScript 타입을 최대한 활용하여 타입 안전성을 보장하세요.
2. **에러 처리**: 모든 가능한 오류 상황을 처리하세요.
3. **설정 유효성 검사**: 생성자에서 모든 필수 옵션의 유효성을 검사하세요.
4. **문서화**: 코드에 JSDoc 주석을 추가하여 문서화하세요.
5. **캐싱 고려**: 적절한 경우 API 응답을 캐싱하여 비용을 절감하세요. 