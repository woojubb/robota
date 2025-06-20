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
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// OpenAI client creation
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Default provider setup
const provider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4'
});

// Agent creation
const agent = new Robota({
  aiProviders: {
    openai: provider
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  systemPrompt: 'You are a helpful AI assistant. Please answer user questions accurately and concisely.'
});

// Agent execution
const result = await agent.run('What are the main differences between TypeScript and JavaScript?');
console.log(result);
```

## Using Tools with Agents

Agents can be enhanced with tools to interact with external systems:

```typescript
import { Robota } from '@robota-sdk/core';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/openai';
import { z } from 'zod';
import OpenAI from 'openai';

// OpenAI client creation
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Create tool provider with weather and time tools
const toolProvider = createZodFunctionToolProvider({
  tools: {
    getWeather: {
      name: 'getWeather',
      description: 'Get current weather information for a specific location',
      parameters: z.object({
        location: z.string().describe('City name to check weather for'),
        unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit')
      }),
      handler: async ({ location, unit = 'celsius' }) => {
        console.log(`Checking weather for ${location} in ${unit} units...`);
        // Actual implementation would call the weather API here
        return { 
          temperature: 22, 
          condition: 'Clear', 
          humidity: 65,
          unit
        };
      }
    },
    getCurrentTime: {
      name: 'getCurrentTime',
      description: 'Get current time for a specific timezone',
      parameters: z.object({
        timezone: z.string().default('Asia/Seoul').describe('Timezone (e.g., "Asia/Seoul", "America/New_York")')
      }),
      handler: async ({ timezone }) => {
        console.log(`Checking current time for ${timezone}...`);
        return {
          time: new Date().toLocaleString('en-US', { timeZone: timezone }),
          timezone
        };
      }
    }
  }
});

// Agent creation
const agent = new Robota({
  aiProviders: {
    openai: new OpenAIProvider({
      client: openaiClient,
      model: 'gpt-4'
    })
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [toolProvider],
  systemPrompt: `You are an information helper agent. 
Use tools to provide accurate weather and time information.
When users request information, always fetch the latest data.`
});

// Agent execution
const result = await agent.run('Tell me the current weather in Seoul and the current time in New York.');
console.log(result);
```

## Agents with Memory

Agents can store conversation history and reference previous conversations:

```typescript
import { Robota, SimpleConversationHistory } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// Conversation history with memory limit
const conversationHistory = new SimpleConversationHistory({
  maxMessages: 10 // Maximum number of messages to store
});

// Agent creation
const agent = new Robota({
  aiProviders: {
    openai: new OpenAIProvider({
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: 'gpt-4'
    })
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  conversationHistory,
  systemPrompt: `You are a friendly conversational agent.
Remember and reference previous conversations to maintain natural dialogue flow.
Remember user preferences and interests to provide personalized responses.`
});

// Conversation progression
await agent.run('Hello! My name is John Smith.');
await agent.run('I enjoy programming and music.');
const result = await agent.run('What was my name again?');
console.log(result); // "Your name is John Smith. You mentioned that you're interested in programming and music."
```

## Planning Agents

Agents that plan and execute complex tasks step-by-step:

```typescript
import { Robota } from '@robota-sdk/core';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/openai';
import { z } from 'zod';
import OpenAI from 'openai';

// Create tool provider with planning tools
const planningToolProvider = createZodFunctionToolProvider({
  tools: {
    searchWeb: {
      name: 'searchWeb',
      description: 'Search for information on the web',
      parameters: z.object({
        query: z.string().describe('Search query')
      }),
      handler: async ({ query }) => {
        console.log(`Searching: ${query}`);
        // Search logic implementation
        return { results: [`Search result 1 for ${query}`, `Search result 2 for ${query}`] };
      }
    },
    summarizeText: {
      name: 'summarizeText',
      description: 'Summarize long text',
      parameters: z.object({
        text: z.string().describe('Text to summarize')
      }),
      handler: async ({ text }) => {
        console.log(`Summarizing text...`);
        // Summarization logic implementation
        return { summary: `${text.substring(0, 50)}... (summarized)` };
      }
    },
    translateText: {
      name: 'translateText',
      description: 'Translate text to another language',
      parameters: z.object({
        text: z.string().describe('Text to translate'),
        targetLanguage: z.string().describe('Target language (e.g., "ko", "en", "ja")')
      }),
      handler: async ({ text, targetLanguage }) => {
        console.log(`Translating to: ${targetLanguage}`);
        // Translation logic implementation
        return { translatedText: `${text} (translated to ${targetLanguage})` };
      }
    }
  }
});

// Planning agent creation
const planningAgent = new Robota({
  aiProviders: {
    openai: new OpenAIProvider({
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: 'gpt-4'
    })
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [planningToolProvider],
  systemPrompt: `You are an information research agent.
Please handle user research requests following these steps:
1. Search for information using appropriate search terms.
2. Summarize the search results.
3. Translate the summary if necessary.
Clearly explain all steps and decision-making processes.`
});

// Planning agent execution
const result = await planningAgent.run('Research the history of artificial intelligence, summarize it, and translate it to English');
console.log(result);
```

## Collaborative Agents

Multiple agents collaborate to perform complex tasks:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Create shared provider
const openaiProvider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4'
});

// Researcher agent
const researcherAgent = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  systemPrompt: 'You are an information gathering specialist. Collect facts and data about the topic.'
});

// Writer agent
const writerAgent = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  systemPrompt: 'You are a writing expert. Create clear and engaging text based on provided information.'
});

// Editor agent
const editorAgent = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  systemPrompt: 'You are an editing expert. Review and improve text for grammar, clarity, and consistency.'
});

// Multi-agent workflow function
async function runContentCreationWorkflow(topic: string) {
  // 1. Researcher collects information
  const researchResult = await researcherAgent.run(
    `Collect information about the following topic: ${topic}`
  );
  
  // 2. Writer writes a draft
  const draftResult = await writerAgent.run(
    `Write content based on the following information: ${researchResult}`
  );
  
  // 3. Editor finalizes
  const editedResult = await editorAgent.run(
    `Proofread and improve the following content: ${draftResult}`
  );
  
  return editedResult;
}

// Team execution
const result = await runContentCreationWorkflow('The future of artificial intelligence and its social impact');
console.log(result);
```

## Advanced Agent Patterns

### ReAct Pattern (Reasoning and Action)

ReAct pattern-based agents alternate between reasoning and action:

```typescript
import { Robota } from '@robota-sdk/core';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/openai';
import { z } from 'zod';
import OpenAI from 'openai';

// Create calculator tool provider
const calculatorToolProvider = createZodFunctionToolProvider({
  tools: {
    calculator: {
      name: 'calculator',
      description: 'Performs mathematical calculations',
      parameters: z.object({
        expression: z.string().describe('Mathematical expression to calculate')
      }),
      handler: async ({ expression }) => {
        return { result: eval(expression) };
      }
    }
  }
});

// ReAct-style agent creation
const reactAgent = new Robota({
  aiProviders: {
    openai: new OpenAIProvider({
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
      model: 'gpt-4'
    })
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [calculatorToolProvider],
  systemPrompt: `You are an agent that solves mathematical problems.
Follow these steps to solve problems:
1. Analyze the problem. (Reasoning)
2. Use necessary calculation tools. (Action)
3. Interpret the results. (Reasoning)
4. Provide the final answer.
Clearly explain your thoughts and decisions at each step.`
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