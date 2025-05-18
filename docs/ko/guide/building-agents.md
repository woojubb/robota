---
title: 에이전트 구축하기
description: Robota로 AI 에이전트 구축하기
lang: ko-KR
---

# 에이전트 구축하기

에이전트는 Robota 라이브러리의 핵심 기능 중 하나로, AI 모델이 특정 목표를 달성하기 위해 추론하고 도구를 사용하도록 합니다. 이 문서에서는 Robota를 사용하여 강력한 AI 에이전트를 구축하는 방법을 설명합니다.

## 기본 에이전트 생성

가장 기본적인 에이전트는 다음과 같이 생성할 수 있습니다:

```typescript
import { Robota, RobotaTeam } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import OpenAI from 'openai';

// OpenAI 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 기본 제공자 설정
const provider = new OpenAIProvider({
  model: 'gpt-4-turbo',
  client: openaiClient
});

// 에이전트 생성
const agent = new Robota({
  name: '도우미 에이전트',
  description: '사용자의 질문에 답변하는 도우미 에이전트',
  provider: provider,
  systemPrompt: '당신은 유용한 AI 도우미입니다. 사용자의 질문에 정확하고 간결하게 답변하세요.'
});

// 에이전트 실행
const result = await agent.run('타입스크립트와 자바스크립트의 주요 차이점은 무엇인가요?');
console.log(result);
```

## 도구를 사용하는 에이전트

에이전트에 도구를 추가하여 외부 시스템과 상호작용할 수 있습니다:

```typescript
import { Robota, RobotaTeam } from '@robota-sdk/core';
import { Tool } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { z } from 'zod';
import OpenAI from 'openai';

// OpenAI 클라이언트 생성
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 날씨 검색 도구 생성
const weatherTool = new Tool({
  name: 'getWeather',
  description: '특정 위치의 현재 날씨 정보를 가져옵니다',
  parameters: z.object({
    location: z.string().describe('날씨를 확인할 도시 이름'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().describe('온도 단위')
  }),
  execute: async ({ location, unit = 'celsius' }) => {
    console.log(`${location}의 날씨를 ${unit} 단위로 조회 중...`);
    // 실제 구현에서는 여기서 날씨 API를 호출
    return { 
      temperature: 22, 
      condition: '맑음', 
      humidity: 65,
      unit
    };
  }
});

// 시간 조회 도구 생성
const timeTool = new Tool({
  name: 'getCurrentTime',
  description: '특정 타임존의 현재 시간을 가져옵니다',
  parameters: z.object({
    timezone: z.string().default('Asia/Seoul').describe('타임존 (예: "Asia/Seoul", "America/New_York")')
  }),
  execute: async ({ timezone }) => {
    console.log(`${timezone}의 현재 시간을 조회 중...`);
    return {
      time: new Date().toLocaleString('ko-KR', { timeZone: timezone }),
      timezone
    };
  }
});

// 에이전트 생성
const agent = new Robota({
  name: '정보 도우미',
  description: '날씨와 시간 정보를 제공하는 도우미 에이전트',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: openaiClient
  }),
  tools: [weatherTool, timeTool],
  systemPrompt: `당신은 정보를 제공하는 도우미 에이전트입니다. 
도구를 사용하여 날씨와 시간 정보를 정확하게 제공하세요.
사용자가 정보를 요청할 때는 항상 최신 데이터를 조회해야 합니다.`
});

// 에이전트 실행
const result = await agent.run('서울의 현재 날씨와 뉴욕의 현재 시간을 알려줘.');
console.log(result);
```

## 메모리를 가진 에이전트

대화 기록을 저장하고 이전 대화를 참조할 수 있는 메모리 기능:

```typescript
import { Robota, RobotaTeam } from '@robota-sdk/core';
import { ConversationMemory } from '@robota-sdk/memory';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import OpenAI from 'openai';

// 메모리 생성
const memory = new ConversationMemory({
  maxMessages: 10 // 최대 저장 메시지 수
});

// 에이전트 생성
const agent = new Robota({
  name: '대화형 에이전트',
  description: '대화를 기억하고 참조할 수 있는 에이전트',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }),
  memory,
  systemPrompt: `당신은 친절한 대화형 에이전트입니다.
이전 대화를 기억하고 참조하여 자연스러운 대화를 이어나가세요.
사용자의 선호도와 관심사를 기억하고 맞춤형 응답을 제공하세요.`
});

// 대화 진행
await agent.run('안녕하세요! 제 이름은 김철수입니다.');
await agent.run('저는 프로그래밍과 음악을 좋아해요.');
const result = await agent.run('제 이름이 뭐였지?');
console.log(result); // "김철수님이 맞습니다. 프로그래밍과 음악에 관심이 있으시다고 하셨어요."
```

## 계획을 세우는 에이전트

복잡한 작업을 단계별로 계획하고 실행하는 에이전트:

```typescript
import { Robota, PlanningRobota } from '@robota-sdk/core';
import { Tool } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { z } from 'zod';
import OpenAI from 'openai';

// 도구 정의 (검색, 요약, 번역 도구 예시)
const searchTool = new Tool({
  name: 'searchWeb',
  description: '웹에서 정보를 검색합니다',
  parameters: z.object({
    query: z.string().describe('검색어')
  }),
  execute: async ({ query }) => {
    console.log(`검색 중: ${query}`);
    // 검색 로직 구현
    return { results: [`${query}에 대한 검색 결과 1`, `${query}에 대한 검색 결과 2`] };
  }
});

const summarizeTool = new Tool({
  name: 'summarizeText',
  description: '긴 텍스트를 요약합니다',
  parameters: z.object({
    text: z.string().describe('요약할 텍스트')
  }),
  execute: async ({ text }) => {
    console.log(`텍스트 요약 중...`);
    // 요약 로직 구현
    return { summary: `${text.substring(0, 50)}... (요약됨)` };
  }
});

const translateTool = new Tool({
  name: 'translateText',
  description: '텍스트를 다른 언어로 번역합니다',
  parameters: z.object({
    text: z.string().describe('번역할 텍스트'),
    targetLanguage: z.string().describe('목표 언어 (예: "ko", "en", "ja")')
  }),
  execute: async ({ text, targetLanguage }) => {
    console.log(`번역 중: ${targetLanguage}`);
    // 번역 로직 구현
    return { translatedText: `${text} (${targetLanguage}로 번역됨)` };
  }
});

// 계획형 에이전트 생성
const planningAgent = new PlanningRobota({
  name: '리서치 에이전트',
  description: '정보를 검색하고, 요약하고, 번역하는 에이전트',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }),
  tools: [searchTool, summarizeTool, translateTool],
  systemPrompt: `당신은 정보 리서치 에이전트입니다.
다음과 같은 단계로 사용자의 리서치 요청을 처리하세요:
1. 적절한 검색어로 정보를 검색합니다.
2. 검색 결과를 요약합니다.
3. 필요한 경우 요약을 번역합니다.
모든 단계와 판단 과정을 명확하게 설명하세요.`
});

// 계획형 에이전트 실행
const result = await planningAgent.run('인공지능의 역사에 대해 조사하고 요약해서 한국어로 번역해줘');
console.log(result);
```

## 협업 에이전트

여러 에이전트가 협력하여 복잡한 작업을 수행:

```typescript
import { Robota, RobotaTeam } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import OpenAI from 'openai';

// OpenAI 클라이언트
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 리서처 에이전트
const researcherAgent = new Robota({
  name: '리서처',
  description: '정보를 검색하고 수집하는 에이전트',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: openaiClient
  }),
  systemPrompt: '당신은 정보 수집 전문가입니다. 주제에 관한 사실과 데이터를 수집하세요.'
});

// 작가 에이전트
const writerAgent = new Robota({
  name: '작가',
  description: '수집된 정보를 바탕으로 글을 작성하는 에이전트',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: openaiClient
  }),
  systemPrompt: '당신은 글쓰기 전문가입니다. 제공된 정보를 바탕으로 명확하고 매력적인 텍스트를 작성하세요.'
});

// 편집자 에이전트
const editorAgent = new Robota({
  name: '편집자',
  description: '작성된 글을 교정하고 개선하는 에이전트',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo', 
    client: openaiClient
  }),
  systemPrompt: '당신은 편집 전문가입니다. 텍스트를 검토하고 문법, 명확성, 일관성을 개선하세요.'
});

// 에이전트 팀 구성
const contentTeam = new RobotaTeam({
  name: '콘텐츠 제작 팀',
  agents: [researcherAgent, writerAgent, editorAgent],
  workflow: async (team, task) => {
    // 1. 리서처가 정보 수집
    const researchResult = await team.agents.researcher.run(
      `다음 주제에 대한 정보를 수집하세요: ${task}`
    );
    
    // 2. 작가가 초안 작성
    const draftResult = await team.agents.writer.run(
      `다음 정보를 바탕으로 글을 작성하세요: ${researchResult}`
    );
    
    // 3. 편집자가 최종 교정
    const editedResult = await team.agents.editor.run(
      `다음 글을 교정하고 개선하세요: ${draftResult}`
    );
    
    return editedResult;
  }
});

// 팀 실행
const result = await contentTeam.run('인공지능의 미래와 사회적 영향');
console.log(result);
```

## 고급 에이전트 패턴

### ReAct 패턴 (추론 및 행동)

ReAct 패턴을 구현한 에이전트는 추론과 행동을 번갈아 수행합니다:

```typescript
import { Robota, ReActRobota } from '@robota-sdk/core';
import { Tool } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { z } from 'zod';
import OpenAI from 'openai';

// 계산기 도구
const calculatorTool = new Tool({
  name: 'calculator',
  description: '수학 계산을 수행합니다',
  parameters: z.object({
    expression: z.string().describe('계산할 수식')
  }),
  execute: async ({ expression }) => {
    return { result: eval(expression) };
  }
});

// ReAct 에이전트 생성
const reactAgent = new ReActRobota({
  name: '수학 도우미',
  description: '수학 문제를 풀고 설명하는 에이전트',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }),
  tools: [calculatorTool],
  systemPrompt: `당신은 수학 문제를 푸는 에이전트입니다.
문제를 해결하기 위해 다음 단계를 따르세요:
1. 문제를 분석합니다. (추론)
2. 필요한 계산 도구를 사용합니다. (행동)
3. 결과를 해석합니다. (추론)
4. 최종 답변을 제공합니다.
각 단계에서의 생각과 판단을 명확하게 설명하세요.`,
  maxIterations: 5,
  chainOfThought: true
});

// ReAct 에이전트 실행
const result = await reactAgent.run('3^4 더하기 2^5의 값은 얼마인가요? 그리고 그 결과값이 100보다 큰지 확인해주세요.');
console.log(result);
```

#### ReAct 에이전트 상세 설명

ReAct 에이전트는 다음과 같은 특징을 가집니다:

1. **순차적 추론과 행동**: 에이전트는 주어진 문제에 대해 먼저 "생각"하고 분석한 다음, 필요한 "행동"(도구 사용)을 수행하는 패턴을 반복합니다.

2. **반복 접근 방식**: `maxIterations` 매개변수를 통해 최대 반복 횟수를 정의할 수 있으며, 각 반복마다 이전 단계의 결과를 바탕으로 다음 행동을 결정합니다.

3. **Chain-of-Thought 표현**: `chainOfThought` 옵션을 활성화하면 에이전트가 각 단계에서의 사고 과정을 명시적으로 보여줍니다. 최종 응답에서는 사용자 친화적인 결과만 표시됩니다.

4. **도구 통합**: 다양한 도구를 등록하여 에이전트가 복잡한 작업을 수행할 수 있도록 지원합니다.

#### 주요 매개변수

- **name, description**: 에이전트의 이름과 설명
- **provider**: 사용할 AI 제공업체 (OpenAI, Anthropic 등)
- **tools**: 에이전트가 사용할 수 있는 도구 배열
- **systemPrompt**: 에이전트의 행동을 정의하는 시스템 프롬프트
- **maxIterations**: 최대 반복 횟수 (기본값: 5)
- **chainOfThought**: 사고 체인 활성화 여부 (기본값: true)

ReAct 패턴은 다음과 같은 사용 사례에 특히 유용합니다:

- 복잡한 수학 문제 해결
- 다단계 정보 검색 및 분석
- 사용자 질문에 대한 깊이 있는 조사
- 여러 도구를 조합해야 하는 작업

## 에이전트 사용 사례

Robota 에이전트는 다양한 실제 사용 사례에 적용할 수 있습니다:

1. **고객 지원 에이전트** - 상품 정보 조회, FAQ 답변, 문제 해결
2. **개인 비서 에이전트** - 일정 관리, 이메일 작성, 정보 검색
3. **데이터 분석 에이전트** - 데이터 수집, 가공, 시각화, 인사이트 도출
4. **콘텐츠 생성 에이전트** - 글쓰기, 마케팅 자료 작성, 컨텐츠 요약
5. **코드 작성 에이전트** - 코드 생성, 디버깅, 리팩토링, 문서화

## 에이전트 디자인 모범 사례

효과적인 에이전트를 설계하기 위한 몇 가지 모범 사례:

1. **명확한 시스템 프롬프트** - 에이전트의 역할과 작업 범위를 명확하게 정의
2. **적절한 도구 선택** - 필요한 기능만 제공하여 복잡성 관리
3. **단계적 접근** - 복잡한 작업을 관리 가능한 단계로 분해
4. **실패 처리** - 오류와 예외 상황에 대한 강건한 처리 구현
5. **사용자 피드백 통합** - 사용자 입력을 기반으로 에이전트 개선

## 다음 단계

- [함수 호출](function-calling.md)에 대해 자세히 알아보기
- [도구 생성](api-reference/tools/)에 대한 API 참조 확인
- [제공자 구성](providers.md) 방법 확인 