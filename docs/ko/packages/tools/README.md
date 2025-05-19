# @robota-sdk/tools

Robota SDK를 위한 도구 및 유틸리티 패키지입니다.

## 문서

전체 문서는 [https://robota.io](https://robota.io)를 참조하세요.

## 설치

```bash
npm install @robota-sdk/tools @robota-sdk/core
```

## 개요

`@robota-sdk/tools`는 Robota SDK로 AI 에이전트를 구축하는 데 유용한 도구와 유틸리티 모음을 제공합니다. 이 패키지에는 함수 도구, 포맷터, 유효성 검사기 및 복잡한 AI 에이전트를 생성하는 과정을 간소화하는 기타 유틸리티가 포함되어 있습니다.

## 함수 도구

AI 에이전트용 함수 도구 생성 및 관리:

```typescript
import { Robota } from '@robota-sdk/core';
import { createZodFunctionToolProvider, type ZodFunctionTool } from '@robota-sdk/tools';
import { z } from 'zod';

// Zod 스키마로 함수 도구 정의
const toolSchemas = {
  add: {
    name: 'add',
    description: '두 숫자를 더하고 결과를 반환',
    parameters: z.object({
      a: z.number().describe('첫 번째 숫자'),
      b: z.number().describe('두 번째 숫자')
    }),
    handler: async (params) => {
      const { a, b } = params as { a: number; b: number };
      return { result: a + b };
    }
  },
  
  getWeather: {
    name: 'getWeather',
    description: '위치의 날씨 정보 가져오기',
    parameters: z.object({
      location: z.string().describe('도시 이름'),
      unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius')
    }),
    handler: async (params) => {
      // 날씨 조회 로직 구현
      return { temperature: 22, condition: 'Sunny' };
    }
  }
};

// 함수 도구 제공자 생성
const provider = createZodFunctionToolProvider({
  model: 'function-model',
  tools: toolSchemas
});

// Robota와 함께 사용
const robota = new Robota({ provider });
const response = await robota.run('5 + 7은 얼마인가요?');
```

## 유틸리티

### 스키마 유효성 검사

함수 매개변수의 유효성을 검사하고 타입 안전성 보장:

```typescript
import { validateSchema } from '@robota-sdk/tools';
import { z } from 'zod';

const schema = z.object({
  name: z.string(),
  age: z.number().min(0)
});

// 스키마에 대한 데이터 유효성 검사
const result = validateSchema(schema, { name: 'John', age: 30 });
if (result.success) {
  // 유효성이 검사된 데이터 사용
  console.log(result.data.name);
} else {
  // 유효성 검사 오류 처리
  console.error(result.error);
}
```

## 기능

- Zod 기반 함수 도구 생성
- 타입 안전 함수 호출
- 표준화된 오류 처리
- 매개변수 유효성 검사
- 커스텀 도구 제공자

## 라이선스

MIT 