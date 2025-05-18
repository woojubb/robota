# Robota 예제 가이드

Robota 라이브러리에서 제공하는 다양한 예제들을 통해 사용 방법을 배워보세요. 이 문서에서는 각 예제의 주요 기능과 실행 방법을 설명합니다.

## 시작하기 전에

예제를 실행하기 전에 다음 준비 과정을 거쳐야 합니다:

1. 필요한 의존성 설치:

```bash
pnpm install
```

2. 환경 변수 설정:

`.env` 파일을 프로젝트 루트에 생성하고 필요한 API 키를 설정하세요:

```
OPENAI_API_KEY=your_openai_api_key_here
WEATHER_API_KEY=your_weather_api_key_here  # 옵션: 날씨 예제에 사용
```

## 예제 실행 방법

예제를 실행하는 방법은 다음과 같습니다:

```bash
# 모든 예제 실행
pnpm run example:all

# 기본 예제만 실행
pnpm run example:basic

# 함수 호출 예제만 실행
pnpm run example:function-calling

# 도구 사용 예제만 실행
pnpm run example:tools

# 에이전트 예제만 실행
pnpm run example:agents

# 시스템 메시지 예제만 실행
pnpm run example:system-messages
```

직접 apps/examples 디렉토리에서 실행하려면:

```bash
# apps/examples 디렉토리로 이동
cd apps/examples

# TypeScript 직접 실행 (tsx 사용)
pnpm run start:basic
pnpm run start:function-calling
# 기타 예제들...

# 또는 lint 검사 실행
pnpm run lint
pnpm run lint:fix
```

## 예제 카테고리

Robota 예제는 다음 카테고리로 구분됩니다:

### 1. 기본 예제

기본 예제는 Robota의 가장 기본적인 기능을 보여줍니다.

- **[simple-conversation.ts](../apps/examples/basic/simple-conversation.ts)**: 간단한 대화 및 스트리밍 응답 사용법
  - 기본적인 Robota 설정 방법
  - 간단한 대화형 메시지 처리
  - 스트리밍 응답 처리
  
코드 예시:
```typescript
// Robota 인스턴스 생성
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: openaiClient
  }),
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다. 간결하고 유용한 응답을 제공하세요.'
});

// 간단한 대화 실행
const response = await robota.run('안녕하세요! 타입스크립트에 대해 알려주세요.');
```

### 2. 함수 호출 예제

함수 호출 예제는 Robota에서 외부 함수를 호출하는 방법을 보여줍니다.

- **[weather-calculator.ts](../apps/examples/function-calling/weather-calculator.ts)**: 날씨 정보 조회 및 계산기 기능
  - 함수 정의 및 등록 방법
  - 자동 함수 호출 모드 사용법
  - 강제 함수 호출 모드 사용법
  
코드 예시:
```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

// 함수 정의
const functions = {
  getWeather: async (location: string, unit: 'celsius' | 'fahrenheit' = 'celsius') => {
    console.log(`${location}의 날씨를 ${unit} 단위로 검색 중...`);
    return {
      temperature: unit === 'celsius' ? 22 : 71.6,
      condition: '맑음',
      humidity: 65,
      unit
    };
  },
  // 기타 함수들...
};

// 함수 등록
robota.registerFunctions(functions);

// 자동 함수 호출 모드로 실행
const response = await robota.run('서울의 현재 날씨가 어떤지 알려주고, 온도를 화씨로 변환해줘.');
```

### 3. 도구 사용 예제

도구 사용 예제는 Robota에서 Zod를 사용한 도구 정의 및 사용 방법을 보여줍니다.

- **[tool-examples.ts](../apps/examples/tools/tool-examples.ts)**: Zod를 사용한 도구 정의 및 사용
  - 도구 스키마 정의
  - 도구 등록 및 실행
  - 여러 도구 조합 사용
  
코드 예시:
```typescript
import { Robota } from '@robota-sdk/core';
import { Tool } from '@robota-sdk/tools';
import { z } from 'zod';

// 도구 생성
const weatherTool = new Tool({
  name: 'getWeather',
  description: '특정 위치의 현재 날씨 정보를 가져옵니다',
  parameters: z.object({
    location: z.string().describe('날씨를 확인할 도시 이름'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().describe('온도 단위')
  }),
  execute: async ({ location, unit = 'celsius' }) => {
    console.log(`${location}의 날씨를 ${unit} 단위로 조회 중...`);
    // 결과 반환
    return { temperature: 22, condition: '맑음', humidity: 65, unit };
  }
});

// 도구 등록
robota.registerTools([weatherTool, calculatorTool, emailTool, searchTool]);
```

### 4. 에이전트 예제

에이전트 예제는 Robota를 사용한 복잡한 에이전트 구현 방법을 보여줍니다.

- **[research-agent.ts](../apps/examples/agents/research-agent.ts)**: 검색, 요약, 번역 기능을 갖춘 리서치 에이전트
  - 에이전트 구성 방법
  - 여러 도구를 결합한 복잡한 작업 처리
  - 다단계 작업 흐름 구현
  
코드 예시:
```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { Tool } from '@robota-sdk/tools';

// 에이전트 생성
const researchAgent = new Robota({
  name: '리서치 에이전트',
  description: '정보를 검색하고, 요약하고, 번역하는 에이전트',
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: openaiClient
  }),
  tools: [searchTool, summarizeTool, translateTool],
  systemPrompt: `당신은 리서치 에이전트입니다.
사용자의 질문에 대해 다음과 같은 단계로 정보를 수집하고 제공하세요:
1. 사용자의 질문을 분석하고 적절한 검색어를 결정합니다.
2. 검색 도구를 사용하여 웹에서 정보를 검색합니다.
3. 검색 결과를 요약 도구를 사용하여 간결하게 요약합니다.
4. 필요한 경우 번역 도구를 사용하여 다른 언어로 번역합니다.
5. 수집한 정보를 바탕으로 종합적인 응답을 제공합니다.`
});

// 에이전트 실행
const result = await researchAgent.run('인공지능의 역사와 발전 과정에 대해 알아보고 싶습니다.');
```

### 5. 시스템 메시지 예제

- **[system-messages.ts](../apps/examples/system-messages/system-messages.ts)**: 다양한 시스템 메시지 템플릿 활용 예제
  - 다양한 시스템 메시지 유형
  - 메시지 템플릿 사용법
  - 컨텍스트 조정

## 클라이언트 어댑터 사용하기

클라이언트 어댑터는 다양한 AI 클라이언트와 통합할 수 있는 유연한 방법을 제공합니다. MCP 클라이언트, OpenAPI 스키마, 사용자 정의 함수 등 다양한 소스로부터 Provider 구현체를 생성할 수 있습니다.

### MCP 클라이언트 어댑터

```typescript
import { createMcpToolProvider, Robota } from 'robota';
import { Client, StdioClientTransport } from '@modelcontextprotocol/sdk';

// MCP 클라이언트 생성
const transport = new StdioClientTransport(/* 설정 */);
const mcpClient = new Client(transport);

// MCP 클라이언트 어댑터를 Provider로 생성
const provider = createMcpToolProvider(mcpClient, {
  model: 'gpt-4'
});

// Robota 인스턴스 생성 (provider 직접 사용)
const robota = new Robota({
  provider,
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
});

// 실행
const response = await robota.run('안녕하세요!');
console.log(response);
```

### OpenAPI 스키마 어댑터

```typescript
import { createOpenAPIToolProvider, Robota } from 'robota';

// OpenAPI 스키마 어댑터를 Provider로 생성
const provider = createOpenAPIToolProvider({
  schema: 'https://api.example.com/openapi.json',
  baseURL: 'https://api.example.com',
  headers: {
    'Authorization': `Bearer ${process.env.API_KEY}`
  },
  model: 'model-name'
});

// Robota 인스턴스 생성 (provider 직접 사용)
const robota = new Robota({
  provider,
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
});

// 실행
const response = await robota.run('안녕하세요!');
console.log(response);
```

### 함수 기반 어댑터

```typescript
import { createFunctionToolProvider, Robota } from 'robota';

// 함수 기반 어댑터를 Provider로 생성
const provider = createFunctionToolProvider({
  chat: async (options) => {
    console.log('채팅 요청:', options);
    // 외부 API 호출 또는 자체 구현 로직
    return {
      content: `입력 메시지: ${options.messages[options.messages.length - 1].content}에 대한 응답입니다.`,
      // 필요한 경우 함수 호출 정보 추가
      function_call: options.functions?.length > 0 ? {
        name: options.functions[0].name,
        arguments: '{}'
      } : undefined
    };
  },
  stream: async function* (options) {
    // 스트리밍 구현 (선택적)
    const chunks = ['안녕하세요', '저는', '커스텀', '어댑터입니다'];
    for (const chunk of chunks) {
      yield { content: chunk };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  },
  model: 'custom-model'
});

// Robota 인스턴스 생성 (provider 직접 사용)
const robota = new Robota({
  provider,
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
});

// 실행
const response = await robota.run('안녕하세요!');
console.log(response);

// 스트리밍 실행
const stream = await robota.runStream('안녕하세요!');
for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

### 여러 어댑터 전환하기

```typescript
import { createMcpToolProvider, createFunctionToolProvider, Robota } from 'robota';
import { Client } from '@modelcontextprotocol/sdk';

// 두 가지 어댑터 생성
const mcpProvider = createMcpToolProvider(new Client(transport), {
  model: 'gpt-4'
});

const fallbackProvider = createFunctionToolProvider({
  chat: async (options) => {
    return { content: '폴백 응답입니다.' };
  },
  model: 'fallback-model'
});

// Robota 인스턴스 생성 (기본 제공자 사용)
const robota = new Robota({
  provider: mcpProvider,
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
});

try {
  // 기본 어댑터로 실행
  const response = await robota.run('안녕하세요!');
  console.log(response);
} catch (error) {
  // 오류 발생 시 폴백 어댑터로 전환
  console.error('기본 어댑터 오류:', error);
  
  // 폴백 어댑터로 변경
  robota.provider = fallbackProvider;
  
  // 폴백 어댑터로 재시도
  const fallbackResponse = await robota.run('안녕하세요!');
  console.log('폴백 응답:', fallbackResponse);
}
```

## 예제 확장하기

이 예제들은 Robota 라이브러리의 기본 기능을 보여주는 간단한 데모입니다. 다음과 같은 방식으로 예제를 확장할 수 있습니다:

1. **실제 API 통합**: 가상 데이터 대신 실제 외부 API와 통합해보세요.
2. **더 복잡한 도구 추가**: 파일 시스템 액세스, 데이터베이스 연결 등 다양한 도구를 구현해보세요.
3. **고급 에이전트 패턴 구현**: ReAct, 다중 에이전트 협업 등 고급 패턴을 구현해보세요.
4. **UI 추가**: 웹 인터페이스나 CLI를 통해 상호작용할 수 있는 시스템을 구현해보세요.

## 문제 해결

예제 실행 중 문제가 발생한다면:

1. 모든 필요한 의존성이 설치되었는지 확인하세요.
2. API 키가 올바르게 설정되었는지 확인하세요.
3. 최신 버전의 Node.js를 사용 중인지 확인하세요. (v18 이상 권장)
4. Provider 클래스의 인터페이스가 ModelContextProtocol을 올바르게 구현하는지 확인하세요.

추가 도움이 필요하면 [GitHub Issues](https://github.com/woojubb/robota/issues)에 문의하세요. 