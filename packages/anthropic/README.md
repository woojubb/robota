# @robota-sdk/anthropic

Anthropic Provider for Robota SDK - Complete type-safe integration with Anthropic's Claude models, featuring advanced reasoning, function calling, and real-time streaming.

## 🚀 Features

### Core Capabilities
- **🎯 Type-Safe Integration**: Complete TypeScript support with zero `any` types
- **🧠 Claude Model Support**: Claude 3 Haiku, Sonnet, and Opus models
- **⚡ Real-Time Streaming**: Asynchronous streaming responses with proper error handling
- **🛠️ Function Calling**: Native Anthropic tool use with type validation
- **🔄 Provider-Agnostic Design**: Seamless integration with other Robota providers
- **📊 Usage Tracking**: Built-in token usage monitoring and cost tracking

### Architecture Highlights
- **Generic Type Parameters**: Full `BaseAIProvider<TConfig, TMessage, TResponse>` implementation
- **Facade Pattern**: Modular design with separated concerns
- **Error Safety**: Comprehensive error handling without any-type compromises
- **Anthropic SDK Compatibility**: Direct integration with official Anthropic SDK types

## 📦 Installation

```bash
npm install @robota-sdk/anthropic @robota-sdk/agents @anthropic-ai/sdk
```

## 🔧 Basic Usage

### Simple Chat Integration

```typescript
import { Robota } from '@robota-sdk/agents';
import { AnthropicProvider } from '@robota-sdk/anthropic';

// Create type-safe Anthropic provider
const provider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-sonnet-20240229',
  maxTokens: 1000
});

// Create Robota agent with Anthropic provider
const agent = new Robota({
  name: 'ClaudeAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-3-sonnet-20240229',
    systemMessage: 'You are Claude, an AI assistant created by Anthropic to be helpful, harmless, and honest.'
  }
});

// Execute conversation
const response = await agent.run('Explain the concept of artificial consciousness');
console.log(response);

// Clean up
await agent.destroy();
```

### Streaming Responses

```typescript
// Real-time streaming for immediate feedback
const stream = await agent.runStream('Write a comprehensive analysis of quantum computing principles');

console.log('Claude is thinking...\n');

for await (const chunk of stream) {
  if (chunk.content) {
    process.stdout.write(chunk.content);
  }
  
  // Handle streaming metadata
  if (chunk.metadata?.usage) {
    console.log(`\nTokens used: ${chunk.metadata.usage.totalTokens}`);
  }
  
  if (chunk.metadata?.isComplete) {
    console.log('\n✓ Response completed');
  }
}
```

## 🛠️ Function Calling

Anthropic Provider supports type-safe function calling with Claude's native tool use:

```typescript
import { FunctionTool } from '@robota-sdk/agents';
import { z } from 'zod';

// Define research tool
const researchTool = new FunctionTool({
  name: 'web_search',
  description: 'Search the web for current information',
  parameters: z.object({
    query: z.string().describe('Search query'),
    domain: z.string().optional().describe('Specific domain to search'),
    limit: z.number().default(5).describe('Number of results to return')
  }),
  handler: async ({ query, domain, limit }) => {
    // Implement web search logic
    const results = await performWebSearch(query, domain, limit);
    return {
      query,
      results: results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet
      })),
      timestamp: new Date().toISOString()
    };
  }
});

// Analysis tool for complex data
const analysisTool = new FunctionTool({
  name: 'analyze_data',
  description: 'Perform statistical analysis on datasets',
  parameters: z.object({
    data: z.array(z.number()).describe('Numerical data to analyze'),
    analysisType: z.enum(['descriptive', 'correlation', 'regression']),
    confidence: z.number().default(0.95).describe('Confidence level for statistics')
  }),
  handler: async ({ data, analysisType, confidence }) => {
    // Implement statistical analysis
    const analysis = await performStatisticalAnalysis(data, analysisType, confidence);
    return {
      analysisType,
      results: analysis,
      confidence,
      dataPoints: data.length
    };
  }
});

// Register tools with agent
agent.registerTool(researchTool);
agent.registerTool(analysisTool);

// Execute with function calling
const result = await agent.run(`
  Research the latest developments in quantum computing, 
  then analyze the trend in quantum processor qubit counts over the last 5 years.
`);
```

## 🔄 Multi-Provider Architecture

Seamlessly integrate with other providers:

```typescript
import { OpenAIProvider } from '@robota-sdk/openai';
import { GoogleProvider } from '@robota-sdk/google';

const claudeProvider = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-3-opus-20240229'
});

const openaiProvider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!
});

const googleProvider = new GoogleProvider({
  apiKey: process.env.GOOGLE_AI_API_KEY!
});

const agent = new Robota({
  name: 'MultiProviderAgent',
  aiProviders: [claudeProvider, openaiProvider, googleProvider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-3-opus-20240229'
  }
});

// Compare reasoning approaches
async function compareReasoningApproaches(problem: string) {
  const results = {};
  
  // Claude's analytical approach
  agent.setModel({ provider: 'anthropic', model: 'claude-3-opus-20240229' });
  results.claude = await agent.run(`Analyze this problem step-by-step: ${problem}`);
  
  // GPT-4's approach
  agent.setModel({ provider: 'openai', model: 'gpt-4' });
  results.gpt4 = await agent.run(`Solve this problem methodically: ${problem}`);
  
  // Gemini's approach
  agent.setModel({ provider: 'google', model: 'gemini-pro' });
  results.gemini = await agent.run(`Approach this problem systematically: ${problem}`);
  
  return results;
}

const comparison = await compareReasoningApproaches(
  'Design an efficient algorithm for real-time fraud detection in financial transactions'
);
```

## ⚙️ Configuration Options

```typescript
interface AnthropicProviderOptions {
  // Required
  client: Anthropic;                 // Anthropic SDK client instance
  
  // Model Configuration
  model?: string;                    // Default: 'claude-3-haiku-20240307'
  maxTokens?: number;               // Maximum tokens to generate (required for Anthropic)
  
  // API Configuration
  apiKey?: string;                  // API key (if not set in client)
  baseURL?: string;                // Custom API base URL
  timeout?: number;                 // Request timeout (ms)
  
  // Generation Parameters
  temperature?: number;             // 0-1, default: 0.7
  topP?: number;                   // Top-p sampling
  topK?: number;                   // Top-k sampling
  stopSequences?: string[];        // Stop sequences
  
  // Advanced Options
  enableUsageTracking?: boolean;    // Track token usage
  enablePayloadLogging?: boolean;   // Debug logging
  payloadLogDir?: string;          // Log directory path
}
```

## 📋 Supported Models

| Model | Description | Use Cases |
|-------|-------------|-----------|
| `claude-3-opus-20240229` | Most capable model | Complex reasoning, research, creative writing |
| `claude-3-sonnet-20240229` | Balanced performance | General tasks, analysis, coding |
| `claude-3-haiku-20240307` | Fast and efficient | Quick responses, simple tasks |

## 🔍 API Reference

### AnthropicProvider Class

```typescript
class AnthropicProvider extends BaseAIProvider<
  AnthropicProviderOptions,
  UniversalMessage,
  UniversalMessage
> {
  // Core methods
  async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage>
  async chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage>
  
  // Provider information
  readonly name: string = 'anthropic'
  readonly version: string = '1.0.0'
  
  // Utility methods
  supportsTools(): boolean
  validateConfig(): boolean
  async dispose(): Promise<void>
}
```

### Type Definitions

```typescript
// Chat Options
interface ChatOptions {
  tools?: ToolSchema[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

// Anthropic-specific types
interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant' | 'user';
  content: AnthropicContent[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  usage: AnthropicUsage;
}

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}
```

## 🔬 Advanced Features

### System Prompts and Context

```typescript
// Specialized system prompts for different tasks
const researchAgent = new Robota({
  name: 'ResearchAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-3-opus-20240229',
    systemMessage: `You are a research assistant specializing in scientific analysis. 
                    Always cite sources and provide evidence for your claims.
                    Break down complex topics into understandable components.`
  }
});

const codeReviewAgent = new Robota({
  name: 'CodeReviewAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-3-sonnet-20240229',
    systemMessage: `You are a senior software engineer reviewing code.
                    Focus on security, performance, maintainability, and best practices.
                    Provide specific, actionable feedback with code examples.`
  }
});
```

### Error Handling and Retry Logic

```typescript
import { RetryPlugin, ErrorHandlingPlugin } from '@robota-sdk/agents';

const agent = new Robota({
  name: 'RobustAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-3-haiku-20240307'
  },
  plugins: [
    new RetryPlugin({
      maxRetries: 3,
      baseDelay: 2000,
      backoffMultiplier: 2,
      retryableErrors: ['rate_limit_error', 'overloaded_error']
    }),
    new ErrorHandlingPlugin({
      logErrors: true,
      enableGracefulDegradation: true,
      fallbackResponses: {
        'overloaded_error': 'I apologize, but I\'m experiencing high demand. Please try again in a moment.'
      }
    })
  ]
});
```

### Usage and Performance Monitoring

```typescript
import { UsagePlugin, PerformancePlugin } from '@robota-sdk/agents';

const agent = new Robota({
  name: 'MonitoredAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'anthropic',
    model: 'claude-3-sonnet-20240229'
  },
  plugins: [
    new UsagePlugin({
      trackTokenUsage: true,
      trackCosts: true,
      // Claude pricing (example rates)
      inputTokenCost: 0.000015,  // per input token
      outputTokenCost: 0.000075, // per output token
      budgetAlert: 50.00         // Alert at $50
    }),
    new PerformancePlugin({
      trackResponseTime: true,
      trackThroughput: true,
      enableMetrics: true
    })
  ]
});

// Monitor usage
const stats = await agent.getUsageStats();
console.log(`Input tokens: ${stats.inputTokens}`);
console.log(`Output tokens: ${stats.outputTokens}`);
console.log(`Total cost: $${stats.totalCost.toFixed(4)}`);
console.log(`Average response time: ${stats.avgResponseTime}ms`);
```

## 🔒 Security Best Practices

### API Key Management
```typescript
// ✅ Good: Environment variables
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ✅ Good: Key validation
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('ANTHROPIC_API_KEY environment variable is required');
}

// ❌ Bad: Hardcoded keys
const client = new Anthropic({
  apiKey: 'sk-ant-...' // Never do this!
});
```

### Input Validation and Sanitization
```typescript
// Validate and sanitize user inputs
const validateInput = (input: string): string => {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }
  
  if (input.length > 10000) {
    throw new Error('Input too long');
  }
  
  // Remove potential injection attempts
  return input.replace(/<script|javascript:|data:/gi, '');
};

const userInput = validateInput(request.body.message);
const response = await agent.run(userInput);
```

## 📊 Performance Optimization

### Token Management
```typescript
// Optimize for token efficiency
const provider = new AnthropicProvider({
  client: anthropicClient,
  model: 'claude-3-haiku-20240307', // Most efficient model
  maxTokens: 500,                   // Limit response length
  temperature: 0.3                  // More deterministic responses
});

// Estimate token usage
const estimateTokens = (text: string): number => {
  // Rough estimation: ~4 characters per token
  return Math.ceil(text.length / 4);
};
```

### Model Selection Strategy
- Use `claude-3-haiku-20240307` for simple, fast responses
- Use `claude-3-sonnet-20240229` for balanced performance
- Use `claude-3-opus-20240229` for complex reasoning tasks

## 🤝 Contributing

This package follows strict type safety guidelines:
- Zero `any` or `unknown` types allowed
- Complete TypeScript coverage
- Comprehensive error handling
- Provider-agnostic design principles

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Related Packages

- **[@robota-sdk/agents](../agents/)**: Core agent framework
- **[@robota-sdk/openai](../openai/)**: OpenAI GPT provider
- **[@robota-sdk/google](../google/)**: Google AI provider
- **[@robota-sdk/team](../team/)**: Multi-agent collaboration

---

For complete documentation and examples, visit the [Robota SDK Documentation](https://robota.io). 