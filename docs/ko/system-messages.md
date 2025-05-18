# 시스템 메시지와 함수 호출 모드

이 문서에서는 Robota에서 시스템 메시지를 관리하고 함수 호출 모드를 제어하는 방법에 대해 설명합니다.

## 시스템 메시지 관리

Robota는 시스템 메시지를 다양한 방식으로 관리할 수 있는 기능을 제공합니다. 시스템 메시지는 AI 모델에게 특정 역할이나 행동 지침을 제공하는 데 사용됩니다.

### 단일 시스템 프롬프트

가장 간단한 방법은 단일 시스템 프롬프트를 사용하는 것입니다:

```typescript
// 초기화 시 설정
const robota = new Robota({
  provider: openaiProvider,
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
});

// 나중에 변경
robota.setSystemPrompt('당신은 날씨 정보를 제공하는 AI 비서입니다.');
```

### 여러 시스템 메시지

더 복잡한 지시사항을 위해 여러 시스템 메시지를 설정할 수 있습니다:

```typescript
// 초기화 시 설정
const robota = new Robota({
  provider: openaiProvider,
  systemMessages: [
    { role: 'system', content: '당신은 날씨에 대한 전문가입니다.' },
    { role: 'system', content: '항상 정확한 정보를 제공하려고 노력하세요.' },
    { role: 'system', content: '사용자가 어디에 있는지 물어보는 것이 좋습니다.' }
  ]
});

// 나중에 설정
robota.setSystemMessages([
  { role: 'system', content: '당신은 전문 요리사입니다.' },
  { role: 'system', content: '사용자에게 요리 레시피를 가르쳐 주세요.' }
]);
```

### 시스템 메시지 추가

기존 시스템 메시지에 새 메시지를 추가할 수도 있습니다:

```typescript
// 단일 시스템 프롬프트로 시작
const robota = new Robota({
  provider: openaiProvider,
  systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다.'
});

// 추가 시스템 메시지 추가
robota.addSystemMessage('사용자에게 항상 공손하게 대응하세요.');
robota.addSystemMessage('가능하면 간결하게 답변하세요.');
```

## 함수 호출 모드

Robota는 세 가지 함수 호출 모드를 지원합니다: `auto`, `disabled`, `force`. 이 모드는 AI 모델이 함수를 호출하는 방식을 제어합니다.

### 자동 모드 (기본값)

`auto` 모드에서 AI는 대화 맥락에 따라 필요할 때 함수를 자동으로 호출합니다:

```typescript
// 전역 설정
robota.setFunctionCallMode('auto');

// 또는 개별 호출에서 설정
const result = await robota.run('서울의 날씨가 어때?', {
  functionCallMode: 'auto' // 기본값이므로 생략 가능
});
```

### 비활성화 모드

`disabled` 모드에서는 함수 호출이 완전히 비활성화됩니다:

```typescript
// 전역 설정
robota.setFunctionCallMode('disabled');

// 또는 개별 호출에서 설정
const result = await robota.run('서울의 날씨가 어때?', {
  functionCallMode: 'disabled'
});
```

### 강제 모드

`force` 모드에서는 AI에게 특정 함수를 강제로 호출하도록 지시합니다:

```typescript
// 전역 설정
robota.setFunctionCallMode('force');

// 개별 호출에서 함수와 인자 지정
const result = await robota.run('서울의 날씨가 어때?', {
  functionCallMode: 'force',
  forcedFunction: 'getWeather',
  forcedArguments: { location: '서울' }
});
```

## 함수 호출 설정 관리

전역 함수 호출 설정을 관리할 수도 있습니다:

```typescript
// 초기화 시 설정
const robota = new Robota({
  provider: openaiProvider,
  functionCallConfig: {
    defaultMode: 'auto', // 기본 모드
    maxCalls: 5, // 최대 함수 호출 횟수
    timeout: 10000, // 함수 호출 타임아웃 (ms)
    allowedFunctions: ['getWeather'] // 허용된 함수 목록
  }
});

// 나중에 설정 변경
robota.configureFunctionCall({
  mode: 'auto',
  maxCalls: 10,
  timeout: 15000,
  allowedFunctions: ['getWeather', 'searchDatabase']
});
```

## 전체 예제

다음은 시스템 메시지와 함수 호출 모드를 함께 사용하는 전체 예제입니다:

```typescript
import { Robota, OpenAIProvider, createFunction } from 'robota';
import OpenAI from 'openai';
import { z } from 'zod';

// OpenAI 클라이언트 생성
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 함수 정의
const getWeather = createFunction({
  name: 'getWeather',
  description: '특정 위치의 현재 날씨 정보를 가져옵니다',
  parameters: z.object({
    location: z.string().describe('날씨를 확인할 도시 이름 (예: 서울, 부산)'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().describe('온도 단위')
  }),
  execute: async (params) => {
    console.log(`날씨 검색: ${params.location}`);
    
    // 실제 API 호출 대신 가상 데이터 반환
    return {
      location: params.location,
      temperature: 23,
      condition: '맑음',
      humidity: 60,
      unit: params.unit || 'celsius'
    };
  }
});

// Robota 인스턴스 생성
const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client
  }),
  systemMessages: [
    { role: 'system', content: '당신은 날씨에 대한 전문가입니다.' },
    { role: 'system', content: '항상 정확한 정보를 제공하려고 노력하세요.' }
  ],
  functionCallConfig: {
    defaultMode: 'auto',
    allowedFunctions: ['getWeather']
  }
});

// 함수 등록
robota.registerFunctions({ getWeather });

// 실행
const result = await robota.run('서울의 날씨가 어때?');
console.log(result);
``` 