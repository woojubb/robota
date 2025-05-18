# Robota Example Guide

Learn how to use Robota through various examples provided by the library. This document explains the main features and how to run each example.

## Before You Begin

Before running the examples, you need to complete the following preparation steps:

1. Install the required dependencies:

```bash
pnpm install
```

2. Set up environment variables:

Create a `.env` file in the project root and set up the necessary API keys:

```
OPENAI_API_KEY=your_openai_api_key_here
WEATHER_API_KEY=your_weather_api_key_here  # Optional: Used for weather examples
```

## How to Run Examples

You can run examples using the following methods:

```bash
# Run all examples
pnpm run example:all

# Run only basic examples
pnpm run example:basic

# Run only function calling examples
pnpm run example:function-calling

# Run only tool usage examples
pnpm run example:tools

# Run only agent examples
pnpm run example:agents

# Run only system message examples
pnpm run example:system-messages
```

To run directly from the apps/examples directory:

```bash
# Navigate to apps/examples directory
cd apps/examples

# Run TypeScript directly (using tsx)
pnpm run start:basic
pnpm run start:function-calling
# Other examples...

# Or run lint checks
pnpm run lint
pnpm run lint:fix
```

## Example Categories

Robota examples are categorized as follows:

### 1. Basic Examples

Basic examples demonstrate the most fundamental features of Robota.

- **[simple-conversation.ts](../apps/examples/basic/simple-conversation.ts)**: How to use simple conversation and streaming responses
  - Basic Robota setup
  - Simple conversational message handling
  - Streaming response processing
  
Sample code:
```typescript
// Create Robota instance
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

const robota = new Robota({
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: openaiClient
  }),
  systemPrompt: 'You are a helpful AI assistant. Provide concise and useful responses.'
});

// Run a simple conversation
const response = await robota.run('Hello! Tell me about TypeScript.');
```

### 2. Function Calling Examples

Function calling examples show how to call external functions in Robota.

- **[weather-calculator.ts](../apps/examples/function-calling/weather-calculator.ts)**: Weather information lookup and calculator functionality
  - How to define and register functions
  - How to use automatic function calling mode
  - How to use forced function calling mode
  
Sample code:
```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';

// Define functions
const functions = {
  getWeather: async (location: string, unit: 'celsius' | 'fahrenheit' = 'celsius') => {
    console.log(`Searching for weather in ${location} with ${unit} units...`);
    return {
      temperature: unit === 'celsius' ? 22 : 71.6,
      condition: 'Clear',
      humidity: 65,
      unit
    };
  },
  // Other functions...
};

// Register functions
robota.registerFunctions(functions);

// Execute with automatic function calling mode
const response = await robota.run('What is the current weather in Seoul, and can you convert the temperature to Fahrenheit?');
```

### 3. Tool Usage Examples

Tool usage examples demonstrate how to define and use tools in Robota with Zod.

- **[tool-examples.ts](../apps/examples/tools/tool-examples.ts)**: Defining and using tools with Zod
  - Tool schema definition
  - Tool registration and execution
  - Combining multiple tools
  
Sample code:
```typescript
import { Robota } from '@robota-sdk/core';
import { Tool } from '@robota-sdk/tools';
import { z } from 'zod';

// Create tool
const weatherTool = new Tool({
  name: 'getWeather',
  description: 'Get current weather information for a specific location',
  parameters: z.object({
    location: z.string().describe('City name to check weather'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().describe('Temperature unit')
  }),
  execute: async ({ location, unit = 'celsius' }) => {
    console.log(`Looking up weather in ${location} with ${unit} units...`);
    // Return results
    return { temperature: 22, condition: 'Clear', humidity: 65, unit };
  }
});

// Register tools
robota.registerTools([weatherTool, calculatorTool, emailTool, searchTool]);
```

### 4. Agent Examples

Agent examples show how to implement complex agents using Robota.

- **[research-agent.ts](../apps/examples/agents/research-agent.ts)**: Research agent with search, summarization, and translation capabilities
  - How to configure agents
  - Handling complex tasks with multiple tools
  - Implementing multi-step workflows
  
Sample code:
```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { Tool } from '@robota-sdk/tools';

// Create agent
const researchAgent = new Robota({
  name: 'Research Agent',
  description: 'An agent that searches, summarizes, and translates information',
  provider: new OpenAIProvider({
    model: 'gpt-4',
    client: openaiClient
  }),
  tools: [searchTool, summarizeTool, translateTool],
  systemPrompt: `You are a research agent.
For user questions, gather and provide information by following these steps:
1. Analyze the user's question and determine appropriate search terms.
2. Use the search tool to find information on the web.
3. Use the summarization tool to concisely summarize the search results.
4. If needed, use the translation tool to translate to another language.
5. Provide a comprehensive response based on the collected information.`
});

// Execute agent
const result = await researchAgent.run('I want to learn about the history and development of artificial intelligence.');
```

### 5. System Message Examples

- **[system-messages.ts](../apps/examples/system-messages/system-messages.ts)**: Examples of using various system message templates
  - Different types of system messages
  - Using message templates
  - Context adjustment

## Using Client Adapters

Client adapters provide a flexible way to integrate with various AI clients. You can create Provider implementations from different sources such as MCP clients, OpenAPI schemas, or custom functions.

### MCP Client Adapter

```typescript
import { createMcpToolProvider, Robota } from 'robota';
import { Client, StdioClientTransport } from '@modelcontextprotocol/sdk';

// Create MCP client
const transport = new StdioClientTransport(/* configuration */);
const mcpClient = new Client(transport);

// Create Provider from MCP client adapter
const provider = createMcpToolProvider(mcpClient, {
  model: 'gpt-4'
});

// Create Robota instance (using provider directly)
const robota = new Robota({
  provider,
  systemPrompt: 'You are a helpful AI assistant.'
});

// Execute
const response = await robota.run('Hello!');
console.log(response);
```

### OpenAPI Schema Adapter

```typescript
import { createOpenAPIToolProvider, Robota } from 'robota';

// Create Provider from OpenAPI schema adapter
const provider = createOpenAPIToolProvider({
  schema: 'https://api.example.com/openapi.json',
  baseURL: 'https://api.example.com',
  headers: {
    'Authorization': `Bearer ${process.env.API_KEY}`
  },
  model: 'model-name'
});

// Create Robota instance (using provider directly)
const robota = new Robota({
  provider,
  systemPrompt: 'You are a helpful AI assistant.'
});

// Execute
const response = await robota.run('Hello!');
console.log(response);
```

### Function-Based Adapter

```typescript
import { createFunctionToolProvider, Robota } from 'robota';

// Create Provider from function-based adapter
const provider = createFunctionToolProvider({
  chat: async (options) => {
    console.log('Chat request:', options);
    // External API call or custom implementation logic
    return {
      content: `Response to input message: ${options.messages[options.messages.length - 1].content}`,
      // Add function call information if needed
      function_call: options.functions?.length > 0 ? {
        name: options.functions[0].name,
        arguments: '{}'
      } : undefined
    };
  },
  stream: async function* (options) {
    // Streaming implementation (optional)
    const chunks = ['Hello', 'I am', 'a custom', 'adapter'];
    for (const chunk of chunks) {
      yield { content: chunk };
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  },
  model: 'custom-model'
});

// Create Robota instance (using provider directly)
const robota = new Robota({
  provider,
  systemPrompt: 'You are a helpful AI assistant.'
});

// Execute
const response = await robota.run('Hello!');
console.log(response);

// Execute with streaming
const stream = await robota.runStream('Hello!');
for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}
```

### Switching Between Multiple Adapters

```typescript
import { createMcpToolProvider, createFunctionToolProvider, Robota } from 'robota';
import { Client } from '@modelcontextprotocol/sdk';

// Create two adapters
const mcpProvider = createMcpToolProvider(new Client(transport), {
  model: 'gpt-4'
});

const fallbackProvider = createFunctionToolProvider({
  chat: async (options) => {
    return { content: 'This is a fallback response.' };
  },
  model: 'fallback-model'
});

// Create Robota instance (using default provider)
const robota = new Robota({
  provider: mcpProvider,
  systemPrompt: 'You are a helpful AI assistant.'
});

try {
  // Execute with default adapter
  const response = await robota.run('Hello!');
  console.log(response);
} catch (error) {
  // Switch to fallback adapter on error
  console.error('Default adapter error:', error);
  
  // Change to fallback adapter
  robota.provider = fallbackProvider;
  
  // Retry with fallback adapter
  const fallbackResponse = await robota.run('Hello!');
  console.log('Fallback response:', fallbackResponse);
}
```

## Extending the Examples

These examples are simple demonstrations of the basic functionality of the Robota library. You can extend them in the following ways:

1. **Integrate with Real APIs**: Use real external APIs instead of virtual data.
2. **Add More Complex Tools**: Implement various tools like file system access, database connections, etc.
3. **Implement Advanced Agent Patterns**: Implement advanced patterns like ReAct, multi-agent collaboration, etc.
4. **Add UI**: Implement systems that can interact through web interfaces or CLI.

## Troubleshooting

If you encounter issues while running the examples:

1. Make sure all necessary dependencies are installed.
2. Ensure that API keys are correctly set up.
3. Verify that you're using the latest version of Node.js (v18 or higher recommended).
4. Check that your Provider class correctly implements the ModelContextProtocol interface.

For additional help, please open an issue on [GitHub Issues](https://github.com/woojubb/robota/issues).