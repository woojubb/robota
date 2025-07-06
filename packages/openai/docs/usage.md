# OpenAI Provider Usage Guide

Complete guide for using the OpenAI Provider with Robota SDK agents framework.

## Overview

The OpenAI Provider enables seamless integration with OpenAI's GPT models, providing type-safe access to advanced AI capabilities including chat completions, function calling, and real-time streaming.

## Installation

```bash
npm install @robota-sdk/openai @robota-sdk/agents openai
```

## Basic Setup

### Quick Start

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// Initialize OpenAI client
const openaiClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORGANIZATION // Optional
});

// Create OpenAI provider
const provider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4',
  temperature: 0.7
});

// Create Robota agent
const agent = new Robota({
  aiProviders: {
    openai: provider
  },
  systemPrompt: 'You are a helpful AI assistant.'
});

// Simple conversation
const response = await agent.run('Hello! How can you help me today?');
console.log(response.content);
```

### Environment Variables

Create a `.env` file in your project root:

```env
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_ORGANIZATION=org-your-org-id  # Optional
```

## Configuration Options

### Complete Configuration

```typescript
const provider = new OpenAIProvider({
  // Required
  client: openaiClient,
  
  // Model settings
  model: 'gpt-4',                    // Default model
  temperature: 0.7,                  // Creativity (0-1)
  maxTokens: 2000,                   // Max response length
  
  // Advanced options
  responseFormat: 'text',            // 'text' | 'json_object' | 'json_schema'
  enablePayloadLogging: true,        // Debug logging
  payloadLogDir: './logs/openai',    // Log directory
  
  // JSON Schema for structured outputs
  jsonSchema: {
    name: 'response_format',
    description: 'Structured response format',
    schema: {
      type: 'object',
      properties: {
        answer: { type: 'string' },
        confidence: { type: 'number' }
      },
      required: ['answer']
    },
    strict: true
  }
});
```

### Model Selection

```typescript
// Different models for different use cases
const models = {
  creative: new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-4',
    temperature: 0.9,      // High creativity
    maxTokens: 3000
  }),
  
  analytical: new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-4-turbo',
    temperature: 0.2,      // Low creativity, focused
    maxTokens: 1500
  }),
  
  efficient: new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-3.5-turbo',
    temperature: 0.5,      // Balanced
    maxTokens: 1000
  })
};
```

## Chat Conversations

### Basic Chat

```typescript
// Single message
const response = await agent.run('Explain quantum computing in simple terms');
console.log(response.content);

// Multi-turn conversation
await agent.run('What is machine learning?');
const followUp = await agent.run('Can you give me a practical example?');
console.log(followUp.content);
```

### Conversation History

```typescript
import { ConversationHistory } from '@robota-sdk/agents';

// Enable conversation memory
const agent = new Robota({
  aiProviders: { openai: provider },
  plugins: [
    new ConversationHistory({
      maxMessages: 20,
      persistToFile: './conversations/chat.json'
    })
  ]
});

// Contextual conversation
await agent.run('My name is Alice');
await agent.run('What programming languages should I learn?');
const response = await agent.run('What was my name again?');
// Response will remember "Alice"
```

## Streaming Responses

### Real-Time Streaming

```typescript
// Stream responses for better UX
const stream = await agent.runStream('Write a detailed essay about artificial intelligence');

console.log('AI is typing...\n');

for await (const chunk of stream) {
  if (chunk.content) {
    process.stdout.write(chunk.content);
  }
  
  // Handle metadata
  if (chunk.metadata?.tokenCount) {
    console.log(`\nTokens used: ${chunk.metadata.tokenCount}`);
  }
  
  if (chunk.metadata?.isComplete) {
    console.log('\n✓ Response completed');
  }
}
```

### Streaming with Progress

```typescript
let totalTokens = 0;
let chunkCount = 0;

for await (const chunk of stream) {
  chunkCount++;
  
  if (chunk.content) {
    process.stdout.write(chunk.content);
    totalTokens += chunk.content.length; // Approximate
  }
  
  // Show progress
  if (chunkCount % 10 === 0) {
    process.stdout.write(`\n[${chunkCount} chunks, ~${totalTokens} chars]`);
  }
}
```

## Function Calling

### Define Tools

```typescript
import { FunctionTool } from '@robota-sdk/agents';
import { z } from 'zod';

// Weather tool
const weatherTool = new FunctionTool({
  name: 'getWeather',
  description: 'Get current weather information for a location',
  parameters: z.object({
    location: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
    includeHourly: z.boolean().default(false)
  }),
  handler: async ({ location, unit, includeHourly }) => {
    // Implement weather API call
    const weatherData = await fetchWeatherAPI(location, unit);
    
    return {
      location,
      temperature: weatherData.current.temp,
      condition: weatherData.current.condition,
      humidity: weatherData.current.humidity,
      hourlyForecast: includeHourly ? weatherData.hourly : null
    };
  }
});

// Calculator tool
const calculatorTool = new FunctionTool({
  name: 'calculate',
  description: 'Perform mathematical calculations',
  parameters: z.object({
    expression: z.string().describe('Mathematical expression to evaluate'),
    precision: z.number().default(2).describe('Decimal places for result')
  }),
  handler: async ({ expression, precision }) => {
    try {
      // Safe expression evaluation
      const result = evaluateMathExpression(expression);
      return {
        expression,
        result: Number(result.toFixed(precision)),
        isValid: true
      };
    } catch (error) {
      return {
        expression,
        result: null,
        isValid: false,
        error: error instanceof Error ? error.message : 'Calculation error'
      };
    }
  }
});
```

### Register and Use Tools

```typescript
// Register tools with agent
agent.registerTool(weatherTool);
agent.registerTool(calculatorTool);

// Use tools in conversation
const result = await agent.run(`
  What's the weather like in New York? 
  Also, calculate what 15% tip would be on a $47.80 bill.
`);

console.log(result.content);
// AI will automatically call both functions and provide a comprehensive answer
```

### Complex Tool Interactions

```typescript
// Database tool
const databaseTool = new FunctionTool({
  name: 'queryDatabase',
  description: 'Query user database for information',
  parameters: z.object({
    table: z.enum(['users', 'orders', 'products']),
    filters: z.record(z.any()).optional(),
    limit: z.number().default(10)
  }),
  handler: async ({ table, filters, limit }) => {
    // Implement database query
    const results = await queryDB(table, filters, limit);
    return { results, count: results.length };
  }
});

// File system tool
const fileSystemTool = new FunctionTool({
  name: 'readFile',
  description: 'Read contents of a file',
  parameters: z.object({
    path: z.string(),
    encoding: z.enum(['utf8', 'base64']).default('utf8')
  }),
  handler: async ({ path, encoding }) => {
    const content = await fs.readFile(path, encoding);
    return { path, content, size: content.length };
  }
});

agent.registerTool(databaseTool);
agent.registerTool(fileSystemTool);

// Multi-tool workflow
const analysis = await agent.run(`
  Find all users from the database who made orders in the last month.
  Then read the config.json file and tell me if there are any settings 
  that might affect user experience.
`);
```

## Multi-Provider Setup

### Provider Switching

```typescript
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';

const openaiProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

const anthropicProvider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!
});

const googleProvider = new GoogleProvider({
  apiKey: process.env.GOOGLE_AI_API_KEY!
});

const agent = new Robota({
  name: 'MultiProviderAgent',
  aiProviders: [openaiProvider, anthropicProvider, googleProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4'
  }
});

// Compare responses from different models
async function compareModels(question: string) {
  const results = {};
  
  // OpenAI
  agent.setModel({ provider: 'openai', model: 'gpt-4' });
  results.openai = await agent.run(question);
  
  // Anthropic
  agent.setModel({ provider: 'anthropic', model: 'claude-3-sonnet-20240229' });
  results.claude = await agent.run(question);
  
  // Google
  agent.setModel({ provider: 'google', model: 'gemini-pro' });
  results.gemini = await agent.run(question);
  
  return results;
}

const comparison = await compareModels('What are the pros and cons of TypeScript?');
```

### Model-Specific Configurations

```typescript
// Specialized configurations for different tasks
const creativeProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4',
  temperature: 0.9,
  maxTokens: 3000
});

const coderProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4',
  temperature: 0.1,
  maxTokens: 2000
});

const quickProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-3.5-turbo',
  temperature: 0.5,
  maxTokens: 500
});

// Create separate agents for different tasks
const creativeAgent = new Robota({
  name: 'CreativeAgent',
  aiProviders: [creativeProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4',
    systemMessage: 'You are a creative writing assistant.'
  }
});

const coderAgent = new Robota({
  name: 'CoderAgent',
  aiProviders: [coderProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4',
    systemMessage: 'You are an expert code reviewer.'
  }
});

const quickAgent = new Robota({
  name: 'QuickAgent',
  aiProviders: [quickProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-3.5-turbo',
    systemMessage: 'You provide quick, concise answers.'
  }
});

// Use appropriate agent for task
const story = await creativeAgent.run('Write a short story about time travel');
const codeReview = await coderAgent.run('Review this JavaScript function for bugs');
const summary = await quickAgent.run('Summarize this text in 2 sentences');
```

## Advanced Features

### Structured Outputs

```typescript
// JSON Schema response format
const provider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4',
  responseFormat: 'json_schema',
  jsonSchema: {
    name: 'task_analysis',
    description: 'Analysis of a task with structured output',
    schema: {
      type: 'object',
      properties: {
        difficulty: {
          type: 'string',
          enum: ['easy', 'medium', 'hard']
        },
        timeEstimate: {
          type: 'number',
          description: 'Estimated time in hours'
        },
        skills: {
          type: 'array',
          items: { type: 'string' }
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              step: { type: 'string' },
              duration: { type: 'number' }
            }
          }
        }
      },
      required: ['difficulty', 'timeEstimate', 'skills', 'steps']
    },
    strict: true
  }
});

const analysis = await agent.run('Analyze the task of building a React web application');
// Response will be structured JSON matching the schema
```

### Error Handling

```typescript
import { RetryPlugin, ErrorHandlingPlugin } from '@robota-sdk/agents';

const agent = new Robota({
  name: 'RobustAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4'
  },
  plugins: [
    new RetryPlugin({
      maxRetries: 3,
      baseDelay: 1000,
      backoffMultiplier: 2
    }),
    new ErrorHandlingPlugin({
      logErrors: true,
      enableGracefulDegradation: true
    })
  ]
});

try {
  const response = await agent.run('Complex request here');
} catch (error) {
  if (error instanceof Error) {
    console.error('AI request failed:', error.message);
    
    // Implement fallback logic
    const fallbackResponse = await agent.run('Simplified version of the request');
  }
}
```

### Performance Monitoring

```typescript
import { PerformancePlugin, UsagePlugin } from '@robota-sdk/agents';

const agent = new Robota({
  name: 'MonitoredAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4'
  },
  plugins: [
    new PerformancePlugin({
      trackTokenUsage: true,
      trackResponseTime: true,
      enableMetrics: true
    }),
    new UsagePlugin({
      trackCosts: true,
      costPerToken: 0.00003, // GPT-4 pricing
      budgetLimit: 10.00     // $10 budget
    })
  ]
});

// Monitor usage
const stats = await agent.getUsageStats();
console.log(`Total tokens: ${stats.totalTokens}`);
console.log(`Total cost: $${stats.totalCost}`);
console.log(`Average response time: ${stats.avgResponseTime}ms`);
```

## Best Practices

### 1. API Key Security

```typescript
// ✅ Good: Environment variables
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ✅ Good: Key rotation
const rotateApiKey = async () => {
  const newKey = await getNewApiKey();
  provider.updateConfig({ 
    client: new OpenAI({ apiKey: newKey }) 
  });
};
```

### 2. Cost Management

```typescript
// Set reasonable limits
const provider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4',
  maxTokens: 1000,      // Limit response length
  temperature: 0.3      // More deterministic = fewer retries
});

// Use appropriate models
const chooseBestModel = (taskComplexity: 'simple' | 'complex') => {
  return taskComplexity === 'simple' ? 'gpt-3.5-turbo' : 'gpt-4';
};
```

### 3. Error Recovery

```typescript
// Implement graceful degradation
const safeRun = async (prompt: string, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await agent.run(prompt);
    } catch (error) {
      if (attempt === maxRetries) {
        // Final fallback
        return { 
          content: 'I apologize, but I encountered an error processing your request.',
          metadata: { error: true }
        };
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
};
```

### 4. Memory Management

```typescript
// Clean up resources
const cleanup = async () => {
  await agent.dispose();
  // Clear any cached data
  await clearConversationHistory();
};

// Handle process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
```

## Troubleshooting

### Common Issues

1. **API Key Issues**
   ```typescript
   // Verify API key is valid
   const testProvider = new OpenAIProvider({
     client: new OpenAI({ apiKey: 'your-key' })
   });
   
   try {
     await testProvider.chat([{ role: 'user', content: 'test' }]);
     console.log('API key is valid');
   } catch (error) {
     console.error('API key issue:', error.message);
   }
   ```

2. **Rate Limiting**
   ```typescript
   // Implement backoff strategy
   const rateLimitHandler = async (error: any) => {
     if (error.status === 429) {
       const retryAfter = error.headers['retry-after'] || 60;
       await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
       return true; // Retry
     }
     return false; // Don't retry
   };
   ```

3. **Token Limits**
   ```typescript
   // Monitor token usage
   const estimateTokens = (text: string) => {
     return Math.ceil(text.length / 4); // Rough estimate
   };
   
   const prompt = 'Your long prompt here...';
   if (estimateTokens(prompt) > 3000) {
     console.warn('Prompt may be too long for model context');
   }
   ```

### Debug Mode

```typescript
// Enable comprehensive logging
const provider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4',
  enablePayloadLogging: true,
  payloadLogDir: './debug/openai-logs'
});

// The logs will contain:
// - Request parameters
// - Response data
// - Timing information
// - Error details
```

## Migration Guide

### From Legacy OpenAI Integration

```typescript
// Old way (deprecated)
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: 'sk-...' });
const response = await client.chat.completions.create({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Hello' }]
});

// New way (recommended)
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4'
});

const agent = new Robota({
  name: 'MyAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4'
  }
});

const response = await agent.run('Hello');
```

### Benefits of Migration

- **Type Safety**: Complete TypeScript support
- **Multi-Provider**: Easy switching between AI providers
- **Plugin System**: Extensive functionality through plugins
- **Error Handling**: Robust error recovery mechanisms
- **Monitoring**: Built-in performance and usage tracking

---

For more examples and advanced use cases, visit the [Robota SDK Examples](../../../docs/examples/) documentation. 