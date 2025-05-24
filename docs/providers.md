---
title: AI Providers & Tools
description: AI Providers and Tool Providers in Robota SDK
lang: en-US
---

# AI Providers and Tool Providers

Robota SDK operates with two main components:

1. **AI Providers**: Interfaces that communicate with various LLM services
2. **Tool Providers**: Interfaces that provide functions that AI models can call

## AI Providers

AI providers handle direct communication with LLM services like OpenAI, Anthropic, and Google AI. Each provider communicates with specific APIs and leverages the unique features of their respective services.

### Supported AI Providers

#### OpenAI Provider (`@robota-sdk/openai`)

Integration with OpenAI's GPT models including GPT-3.5, GPT-4, GPT-4o, and more.

**Installation:**
```bash
npm install @robota-sdk/openai openai
```

**Supported Models:**
- `gpt-3.5-turbo`
- `gpt-4`
- `gpt-4o`
- `gpt-4o-mini`
- `gpt-4-turbo`

**Usage:**
```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';

// Create OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION // optional
});

// Configure OpenAI provider
const openaiProvider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4',
  temperature: 0.7,
  maxTokens: 1000 // optional
});

// Connect to Robota
const robota = new Robota({
  aiProviders: {
    openai: openaiProvider
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4'
});
```

#### Anthropic Provider (`@robota-sdk/anthropic`)

Integration with Anthropic's Claude models including Claude 3 Opus, Sonnet, and Haiku.

**Installation:**
```bash
npm install @robota-sdk/anthropic @anthropic-ai/sdk
```

**Supported Models:**
- `claude-3-5-sonnet-20241022`
- `claude-3-opus-20240229`
- `claude-3-sonnet-20240229`
- `claude-3-haiku-20240307`
- `claude-instant-1.2`

**Usage:**
```typescript
import { Robota } from '@robota-sdk/core';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import Anthropic from '@anthropic-ai/sdk';

// Create Anthropic client
const anthropicClient = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Configure Anthropic provider
const anthropicProvider = new AnthropicProvider({
  client: anthropicClient,
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7,
  maxTokens: 1000 // optional
});

// Connect to Robota
const robota = new Robota({
  aiProviders: {
    anthropic: anthropicProvider
  },
  currentProvider: 'anthropic',
  currentModel: 'claude-3-5-sonnet-20241022'
});
```

#### Google AI Provider (`@robota-sdk/google`)

Integration with Google's Generative AI models including Gemini Pro and Gemini Pro Vision.

**Installation:**
```bash
npm install @robota-sdk/google @google/generative-ai
```

**Supported Models:**
- `gemini-1.5-pro`
- `gemini-1.5-flash`
- `gemini-pro`
- `gemini-pro-vision`

**Usage:**
```typescript
import { Robota } from '@robota-sdk/core';
import { GoogleProvider } from '@robota-sdk/google';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Create Google AI client
const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Configure Google provider
const googleProvider = new GoogleProvider({
  client: googleClient,
  model: 'gemini-1.5-pro',
  temperature: 0.7,
  maxOutputTokens: 1000 // optional
});

// Connect to Robota
const robota = new Robota({
  aiProviders: {
    google: googleProvider
  },
  currentProvider: 'google',
  currentModel: 'gemini-1.5-pro'
});
```

### Client Instance Injection (Required)

Robota uses externally created API clients for better control and testability:

**Benefits:**
1. Consistent client configuration across the application
2. Improved testability and mocking capabilities
3. Fine-grained control over client settings
4. Custom retry policies and timeouts

**Example with Multiple Providers:**
```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Create clients
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Create providers
const openaiProvider = new OpenAIProvider({ client: openaiClient, model: 'gpt-4' });
const anthropicProvider = new AnthropicProvider({ client: anthropicClient, model: 'claude-3-5-sonnet-20241022' });
const googleProvider = new GoogleProvider({ client: googleClient, model: 'gemini-1.5-pro' });

// Setup Robota with multiple providers
const robota = new Robota({
  aiProviders: {
    openai: openaiProvider,
    anthropic: anthropicProvider,
    google: googleProvider
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  systemPrompt: 'You are a helpful AI assistant.'
});

// Switch providers dynamically
robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');
robota.setCurrentAI('google', 'gemini-1.5-pro');

// Get current configuration
const currentAI = robota.getCurrentAI();
console.log(`Current: ${currentAI.provider}/${currentAI.model}`);
```

## Tool Providers

Tool providers enable AI models to call external functions and interact with systems. This allows for powerful integrations and dynamic functionality.

### Supported Tool Provider Types

#### Zod Function Tool Provider

Provides type-safe function tools using Zod schemas for parameter validation.

**Installation:**
```bash
npm install @robota-sdk/tools zod
```

**Features:**
- Runtime parameter validation
- TypeScript type safety
- Automatic schema generation
- Error handling

**Usage:**
```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';
import OpenAI from 'openai';

// Define tools with Zod schemas
const calculatorTool = {
  name: 'calculate',
  description: 'Performs mathematical calculations',
  parameters: z.object({
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('Mathematical operation'),
    a: z.number().describe('First number'),
    b: z.number().describe('Second number')
  }),
  handler: async ({ operation, a, b }) => {
    switch (operation) {
      case 'add': return { result: a + b };
      case 'subtract': return { result: a - b };
      case 'multiply': return { result: a * b };
      case 'divide': 
        if (b === 0) return { error: 'Cannot divide by zero' };
        return { result: a / b };
      default:
        return { error: 'Invalid operation' };
    }
  }
};

const weatherTool = {
  name: 'getWeather',
  description: 'Gets current weather for a location',
  parameters: z.object({
    location: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('Temperature unit')
  }),
  handler: async ({ location, unit }) => {
    // Mock weather data (replace with real API call)
    return {
      temperature: unit === 'celsius' ? 22 : 72,
      condition: 'Partly cloudy',
      humidity: 65,
      location,
      unit
    };
  }
};

// Create tool provider
const toolProvider = createZodFunctionToolProvider({
  tools: {
    calculate: calculatorTool,
    getWeather: weatherTool
  }
});

// Setup Robota with AI and tools
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiProvider = new OpenAIProvider({ client: openaiClient, model: 'gpt-4' });

const robota = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [toolProvider],
  systemPrompt: 'You are a helpful assistant with access to calculation and weather tools.'
});

// AI will automatically use tools when needed
const result = await robota.run('What is 25 + 17, and what is the weather like in Seoul?');
```

#### MCP (Model Context Protocol) Tool Provider

Integration with Model Context Protocol for advanced tool ecosystems.

```typescript
import { Robota, createMcpToolProvider } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { Client, StdioClientTransport } from '@modelcontextprotocol/sdk';
import OpenAI from 'openai';

// Create MCP client
const transport = new StdioClientTransport({
  command: 'path/to/mcp/server',
  args: ['--config', 'config.json']
});
const mcpClient = new Client({
  name: 'robota-client',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

await mcpClient.connect(transport);

// Create MCP tool provider
const mcpToolProvider = createMcpToolProvider(mcpClient);

// Setup Robota
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiProvider = new OpenAIProvider({ client: openaiClient, model: 'gpt-4' });

const robota = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [mcpToolProvider]
});
```

#### Custom Function Provider

For creating fully custom tool providers:

```typescript
import { Robota } from '@robota-sdk/core';

// Custom tool provider implementation
class CustomToolProvider {
  name = 'custom-tools';
  
  constructor(private tools: Record<string, Function>) {}
  
  getAvailableTools() {
    return Object.keys(this.tools).map(name => ({
      name,
      description: this.tools[name].description || `Custom tool: ${name}`,
      parameters: this.tools[name].schema || {}
    }));
  }
  
  async executeFunction(name: string, parameters: any) {
    if (this.tools[name]) {
      return await this.tools[name](parameters);
    }
    throw new Error(`Tool ${name} not found`);
  }
}

// Usage
const customProvider = new CustomToolProvider({
  currentTime: () => ({ time: new Date().toISOString() }),
  randomNumber: ({ min = 0, max = 100 }) => ({ number: Math.floor(Math.random() * (max - min + 1)) + min })
});

const robota = new Robota({
  aiProviders: { openai: openaiProvider },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [customProvider]
});
```

## Advanced Usage Patterns

### Dynamic Provider Switching

```typescript
// Switch based on task complexity
const handleUserRequest = async (request: string, complexity: 'simple' | 'complex') => {
  if (complexity === 'simple') {
    robota.setCurrentAI('openai', 'gpt-3.5-turbo');
  } else {
    robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');
  }
  
  return await robota.run(request);
};
```

### Provider Fallback Strategy

```typescript
const robustRequest = async (prompt: string) => {
  const providers = [
    { name: 'openai', model: 'gpt-4' },
    { name: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    { name: 'google', model: 'gemini-1.5-pro' }
  ];
  
  for (const provider of providers) {
    try {
      robota.setCurrentAI(provider.name, provider.model);
      return await robota.run(prompt);
    } catch (error) {
      console.warn(`Provider ${provider.name} failed:`, error);
      continue;
    }
  }
  
  throw new Error('All providers failed');
};
```

### Cost Optimization

```typescript
// Route requests based on cost considerations
const costOptimizedRequest = async (prompt: string) => {
  const estimatedTokens = prompt.length / 4; // Rough estimation
  
  if (estimatedTokens < 1000) {
    // Use cheaper model for simple requests
    robota.setCurrentAI('openai', 'gpt-3.5-turbo');
  } else {
    // Use more capable model for complex requests
    robota.setCurrentAI('openai', 'gpt-4');
  }
  
  return await robota.run(prompt);
};
```

## Configuration Reference

### Provider Configuration Options

#### OpenAI Provider Options
```typescript
interface OpenAIProviderConfig {
  client: OpenAI;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string | string[];
}
```

#### Anthropic Provider Options
```typescript
interface AnthropicProviderConfig {
  client: Anthropic;
  model: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}
```

#### Google Provider Options
```typescript
interface GoogleProviderConfig {
  client: GoogleGenerativeAI;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}
```

## Differences Between AI Providers and Tool Providers

| Feature | AI Provider | Tool Provider |
|---------|-------------|-------------|
| **Primary Role** | Communicate with LLM services | Provide callable functions for AI |
| **Interaction Method** | Send prompts, receive responses | Handle specific function calls |
| **Configuration** | Model, temperature, tokens | Tool schemas, handlers |
| **Examples** | OpenAI, Anthropic, Google | Zod tools, MCP, custom functions |
| **Robota Integration** | `aiProviders` property | `toolProviders` property |
| **Switching** | `setCurrentAI()` method | Static registration |

## Best Practices

1. **API Key Management**: Store API keys securely in environment variables
2. **Error Handling**: Implement proper error handling for network failures
3. **Provider Selection**: Choose models based on task complexity and cost
4. **Tool Design**: Keep tools focused and well-documented
5. **Testing**: Test with multiple providers to ensure reliability
6. **Monitoring**: Track usage and costs across providers

## Troubleshooting

### Common Issues

1. **Authentication Errors**: Verify API keys are correctly set
2. **Model Not Available**: Check if model is available for your API tier
3. **Rate Limiting**: Implement retry logic with backoff
4. **Tool Execution Failures**: Validate tool parameters and error handling

### Debug Mode

Enable debug logging to troubleshoot issues:

```typescript
const robota = new Robota({
  // ... configuration
  debug: true,
  logger: {
    info: (msg, ...args) => console.log('INFO:', msg, ...args),
    debug: (msg, ...args) => console.log('DEBUG:', msg, ...args),
    warn: (msg, ...args) => console.warn('WARN:', msg, ...args),
    error: (msg, ...args) => console.error('ERROR:', msg, ...args)
  }
});
```

## Related Documentation

- [Getting Started Guide](./index.md)
- [Examples](./examples/examples.md)
- [API Reference](./api-reference.md)
- [OpenAI Package](./packages/openai.md)
- [Anthropic Package](./packages/anthropic.md)
- [Google Package](./packages/google.md)
- [Tools Package](./packages/tools.md) 