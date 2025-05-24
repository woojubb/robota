---
title: Building Agents
description: Building AI agents with Robota
lang: en-US
---

# Building Agents

Agents are one of the core features of the Robota library, enabling AI models to reason and use tools to achieve specific goals. This document explains how to build powerful AI agents using Robota.

## Creating Basic Agents

The most basic agent can be created as follows:

```typescript
import { Robota, RobotaTeam } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import OpenAI from 'openai';

// OpenAI client creation
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Default provider setup
const provider = new OpenAIProvider({
  model: 'gpt-4-turbo',
  client: openaiClient
});

// Agent creation
const agent = new Robota({
  name: '도우미 에이전트',
  description: '사용자의 질문에 답변하는 도우미 에이전트',
  provider: provider,
  systemPrompt: '당신은 유용한 AI 도우미입니다. 사용자의 질문에 정확하고 간결하게 답변하세요.'
});

// Agent execution
const result = await agent.run('타입스크립트와 자바스크립트의 주요 차이점은 무엇인가요?');
console.log(result);
```

## Using Tools with Agents

Agents can be enhanced with tools to interact with external systems:

```typescript
import { Robota, RobotaTeam } from '@robota-sdk/core';
import { Tool } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { z } from 'zod';
import OpenAI from 'openai';

// OpenAI client creation
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Weather search tool creation
const weatherTool = new Tool({
  name: 'getWeather',
  description: '특정 위치의 현재 날씨 정보를 가져옵니다',
  parameters: z.object({
    location: z.string().describe('날씨를 확인할 도시 이름'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().describe('온도 단위')
  }),
  execute: async ({ location, unit = 'celsius' }) => {
    console.log(`${location}의 날씨를 ${unit} 단위로 조회 중...`);
    // Actual implementation would call the weather API here
    return { 
      temperature: 22, 
      condition: '맑음', 
      humidity: 65,
      unit
    };
  }
});

// Time lookup tool creation
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

// Agent creation
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

// Agent execution
const result = await agent.run('서울의 현재 날씨와 뉴욕의 현재 시간을 알려줘.');
console.log(result);
```

## Agents with Memory

Agents can store conversation history and reference previous conversations:

```typescript
import { Robota, RobotaTeam } from '@robota-sdk/core';
import { ConversationMemory } from '@robota-sdk/memory';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import OpenAI from 'openai';

// Memory creation
const memory = new ConversationMemory({
  maxMessages: 10 // Maximum number of messages to store
});

// Agent creation
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

// Conversation progression
await agent.run('안녕하세요! 제 이름은 김철수입니다.');
await agent.run('저는 프로그래밍과 음악을 좋아해요.');
const result = await agent.run('제 이름이 뭐였지?');
console.log(result); // "김철수님이 맞습니다. 프로그래밍과 음악에 관심이 있으시다고 하셨어요."
```

## Planning Agents

Agents that plan and execute complex tasks step-by-step:

```typescript
import { Robota, PlanningRobota } from '@robota-sdk/core';
import { Tool } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { z } from 'zod';
import OpenAI from 'openai';

// Tool definition (example for search, summarization, translation tools)
const searchTool = new Tool({
  name: 'searchWeb',
  description: '웹에서 정보를 검색합니다',
  parameters: z.object({
    query: z.string().describe('검색어')
  }),
  execute: async ({ query }) => {
    console.log(`검색 중: ${query}`);
    // Search logic implementation
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
    // Summarization logic implementation
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
    // Translation logic implementation
    return { translatedText: `${text} (${targetLanguage}로 번역됨)` };
  }
});

// Planning agent creation
const planningAgent = new PlanningRobota({
  name: 'Research Agent',
  description: 'An agent that searches, summarizes, and translates information',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }),
  tools: [searchTool, summarizeTool, translateTool],
  systemPrompt: `You are an information research agent.
Please handle user research requests following these steps:
1. Search for information using appropriate search terms.
2. Summarize the search results.
3. Translate the summary if necessary.
Clearly explain all steps and decision-making processes.`
});

// Planning agent execution
const result = await planningAgent.run('Research the history of artificial intelligence, summarize it, and translate it to Korean');
console.log(result);
```

## Collaborative Agents

Multiple agents collaborate to perform complex tasks:

```typescript
import { Robota, RobotaTeam } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import OpenAI from 'openai';

// OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Researcher agent
const researcherAgent = new Robota({
  name: 'Researcher',
  description: 'An agent that searches and collects information',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: openaiClient
  }),
  systemPrompt: 'You are an information gathering specialist. Collect facts and data about the topic.'
});

// Writer agent
const writerAgent = new Robota({
  name: 'Writer',
  description: 'An agent that writes content based on collected information',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: openaiClient
  }),
  systemPrompt: 'You are a writing expert. Create clear and engaging text based on provided information.'
});

// Editor agent
const editorAgent = new Robota({
  name: 'Editor',
  description: 'An agent that proofreads and improves written content',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo', 
    client: openaiClient
  }),
  systemPrompt: 'You are an editing expert. Review and improve text for grammar, clarity, and consistency.'
});

// Agent team configuration
const contentTeam = new RobotaTeam({
  name: 'Content Creation Team',
  agents: [researcherAgent, writerAgent, editorAgent],
  workflow: async (team, task) => {
    // 1. Researcher collects information
    const researchResult = await team.agents.researcher.run(
      `Collect information about the following topic: ${task}`
    );
    
    // 2. Writer writes a draft
    const draftResult = await team.agents.writer.run(
      `Write content based on the following information: ${researchResult}`
    );
    
    // 3. Editor finalizes
    const editedResult = await team.agents.editor.run(
      `Proofread and improve the following content: ${draftResult}`
    );
    
    return editedResult;
  }
});

// Team execution
const result = await contentTeam.run('The future of artificial intelligence and its social impact');
console.log(result);
```

## Advanced Agent Patterns

### ReAct Pattern (Reasoning and Action)

ReAct pattern-based agents alternate between reasoning and action:

```typescript
import { Robota, ReActRobota } from '@robota-sdk/core';
import { Tool } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { z } from 'zod';
import OpenAI from 'openai';

// Calculator tool
const calculatorTool = new Tool({
  name: 'calculator',
  description: 'Performs mathematical calculations',
  parameters: z.object({
    expression: z.string().describe('Mathematical expression to calculate')
  }),
  execute: async ({ expression }) => {
    return { result: eval(expression) };
  }
});

// ReAct agent creation
const reactAgent = new ReActRobota({
  name: 'Math Helper',
  description: 'An agent that solves and explains mathematical problems',
  provider: new OpenAIProvider({
    model: 'gpt-4-turbo',
    client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }),
  tools: [calculatorTool],
  systemPrompt: `You are an agent that solves mathematical problems.
Follow these steps to solve problems:
1. Analyze the problem. (Reasoning)
2. Use necessary calculation tools. (Action)
3. Interpret the results. (Reasoning)
4. Provide the final answer.
Clearly explain your thoughts and decisions at each step.`,
  maxIterations: 5,
  chainOfThought: true
});

// ReAct agent execution
const result = await reactAgent.run('What is 3^4 plus 2^5? And please check if the result is greater than 100.');
console.log(result);
```

#### ReAct Agent Detailed Description

ReAct agents have the following characteristics:

1. **Sequential Reasoning and Action**: The agent first "thinks" about the given problem and analyzes it before performing the necessary "action" (tool usage).

2. **Iterative Approach**: The `maxIterations` parameter allows you to define the maximum number of iterations, and each iteration determines the next action based on the result of the previous step.

3. **Chain-of-Thought Expression**: When `chainOfThought` is enabled, the agent explicitly shows its thought process at each step. The final response is only shown to the user.

4. **Tool Integration**: Various tools can be registered to allow the agent to perform complex tasks.

#### Key Parameters

- **name, description**: The agent's name and description
- **provider**: The AI provider to use (OpenAI, Anthropic, etc.)
- **tools**: An array of tools the agent can use
- **systemPrompt**: The system prompt that defines the agent's behavior
- **maxIterations**: Maximum number of iterations (default: 5)
- **chainOfThought**: Whether to enable Chain-of-Thought (default: true)

ReAct pattern is particularly useful for the following use cases:

- Solving complex math problems
- Multi-step information search and analysis
- Deep investigation of user questions
- Tasks that require combining multiple tools

## Agent Use Cases

Robota agents can be applied to various real-world use cases:

1. **Customer Support Agent** - Product information lookup, FAQ answering, problem solving
2. **Personal Assistant Agent** - Schedule management, email writing, information lookup
3. **Data Analysis Agent** - Data collection, processing, visualization, insight extraction
4. **Content Creation Agent** - Writing, marketing material creation, content summarization
5. **Code Writing Agent** - Code generation, debugging, refactoring, documentation

## Agent Design Best Practices

Several best practices for designing effective agents:

1. **Clear System Prompt**: Define the agent's role and scope of work clearly
2. **Appropriate Tool Selection**: Provide only the necessary features to manage complexity
3. **Step-by-Step Approach**: Break down complex tasks into manageable steps
4. **Failure Handling**: Implement robust handling for errors and exceptions
5. **User Feedback Integration**: Improve the agent based on user input

## Next Steps

- Learn more about [Function Calling](function-calling.md)
- Check out the API reference for [Tool Creation](api-reference/tools/)
- Learn how to configure [Providers](providers.md) 