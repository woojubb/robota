# @robota-sdk/core

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fcore.svg)](https://www.npmjs.com/package/@robota-sdk/core)

Core package for Robota SDK - A powerful AI agent framework with a modular Manager pattern architecture.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/core
```

## Overview

`@robota-sdk/core` provides the foundation for building AI agents with Robota SDK. Built with a clean Manager pattern architecture, it separates concerns across specialized managers while providing a unified API through the main Robota class.

## Key Features & Advantages

### 🚀 **Multi-Provider Support**
- **OpenAI**: GPT-4, GPT-3.5 - Function calling, streaming, vision support
- **Anthropic**: Claude 3.5 Sonnet, Claude 3 - Large context, advanced reasoning
- **Google AI**: Gemini 1.5 Pro, Gemini Flash - Multimodal, long context
- Seamless switching between providers and dynamic configuration

### ⚡ **Real-Time Streaming Responses**
- Real-time streaming support across all providers
- Chunk-based response processing for fast user experience
- Background processing and asynchronous responses

### 📊 **Analytics & Monitoring**
- Detailed usage statistics including request count and token usage
- Real-time limit management (token and request limits)
- Comprehensive logging system for debugging

### 🏗️ **Modular Architecture**
- Clean separation of concerns with high extensibility
- Independent usage of each component
- Plugin-style tool and provider system

### 🛠️ **Type-Safe Function Calling**
- Zod schema-based type-safe function definitions
- Automatic parameter validation and type inference
- Extensible tool system architecture

## Architecture Overview

### Manager Pattern
The core package is built around specialized managers that handle specific domains:

- **AIProviderManager**: Manages multiple AI providers and model switching
- **ToolProviderManager**: Handles tool registration and execution
- **SystemMessageManager**: Manages system prompts and messages
- **FunctionCallManager**: Controls function calling behavior and configuration
- **AnalyticsManager**: Tracks usage, token consumption, and request history
- **RequestLimitManager**: Enforces token and request limits

### Service Layer
- **ConversationService**: Orchestrates conversation flow and AI interactions
- **TokenAnalyzer**: Calculates and estimates token usage

### Core Features
- Provider-agnostic architecture with easy switching
- Real-time streaming responses across all providers
- Comprehensive conversation history management
- Built-in analytics and monitoring
- Request/token limit enforcement
- Type-safe function calling integration

## Basic Usage

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';
import OpenAI from 'openai';

// Create OpenAI client and provider
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiProvider = new OpenAIProvider(openaiClient);

// Create tool provider
const toolProvider = createZodFunctionToolProvider({
  tools: {
    getWeather: {
      name: 'getWeather',
      description: 'Get weather information',
      parameters: z.object({
        location: z.string().describe('City name')
      }),
      handler: async ({ location }) => {
        return { temperature: 22, condition: 'Sunny', location };
      }
    }
  }
});

// Create Robota instance with Manager pattern
const robota = new Robota({
  aiProviders: {
    openai: openaiProvider
  },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [toolProvider],
  systemPrompt: 'You are a helpful AI assistant.',
  maxTokenLimit: 4096,  // Request limit management
  maxRequestLimit: 25,  // Request count limit
  debug: true          // Enable detailed logging
});

// Simple conversation
const response = await robota.run('Tell me about TypeScript and check weather in Seoul');
console.log(response);

// Streaming response
const stream = await robota.runStream('What is the weather like?');
for await (const chunk of stream) {
  process.stdout.write(chunk.content || '');
}

// Analytics and monitoring
console.log('Analytics:', robota.getAnalytics());
console.log('Limit Info:', robota.getLimitInfo());
```

## Manager APIs

### AI Provider Management
```typescript
// Add providers dynamically
robota.addAIProvider('anthropic', anthropicProvider);
robota.addAIProvider('google', googleProvider);

// Switch providers
robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');
robota.setCurrentAI('google', 'gemini-1.5-pro');

// Get current configuration
const currentAI = robota.getCurrentAI();
console.log(`Using: ${currentAI.provider}/${currentAI.model}`);
```

### System Message Management
```typescript
// Set system prompt
robota.setSystemPrompt('You are a helpful coding assistant.');

// Add multiple system messages
robota.setSystemMessages([
  { role: 'system', content: 'You are an expert in TypeScript.' },
  { role: 'system', content: 'Always provide code examples.' }
]);

// Add individual system message
robota.addSystemMessage('Focus on best practices and clean code.');
```

### Function Call Configuration
```typescript
// Configure function calling
robota.configureFunctionCall({
  mode: 'auto',              // 'auto', 'required', 'disabled'
  maxCalls: 5,               // Maximum function calls per conversation
  timeout: 30000,            // Function call timeout (ms)
  allowedFunctions: ['getWeather', 'calculate']  // Restrict available functions
});

// Set function call mode
robota.setFunctionCallMode('required');
```

### Analytics and Monitoring
```typescript
// Get usage statistics
const analytics = robota.getAnalytics();
console.log(`Requests: ${analytics.requestCount}`);
console.log(`Total tokens: ${analytics.totalTokensUsed}`);
console.log(`Average tokens per request: ${analytics.averageTokensPerRequest}`);

// Get detailed limit information
const limitInfo = robota.getLimitInfo();
console.log(`Token usage: ${limitInfo.currentTokensUsed}/${limitInfo.maxTokens}`);
console.log(`Requests: ${limitInfo.currentRequestCount}/${limitInfo.maxRequests}`);

// Get token usage for specific period
const weeklyUsage = robota.getTokenUsageByPeriod(
  new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
  new Date()
);
```

### Request Limit Management
```typescript
// Set limits
robota.setMaxTokenLimit(10000);  // 10k tokens max
robota.setMaxRequestLimit(100);  // 100 requests max

// Set unlimited (0 = unlimited)
robota.setMaxTokenLimit(0);
robota.setMaxRequestLimit(0);

// Check current limits
console.log('Max tokens:', robota.getMaxTokenLimit());
console.log('Max requests:', robota.getMaxRequestLimit());
```

## Core Components

### Interfaces
- `AIProvider`: Interface for AI provider implementations
- `ToolProvider`: Interface for tool provider implementations  
- `ConversationHistory`: Interface for conversation history management
- `Logger`: Interface for custom logging implementations

### Conversation History
```typescript
import { SimpleConversationHistory, PersistentSystemConversationHistory } from '@robota-sdk/core';

// Simple in-memory history
const simpleHistory = new SimpleConversationHistory();

// Persistent history with system message handling
const persistentHistory = new PersistentSystemConversationHistory();

const robota = new Robota({
  // ... other options
  conversationHistory: persistentHistory
});
```

### Custom Logger
```typescript
const customLogger = {
  info: (msg, ...args) => console.log(`[INFO] ${msg}`, ...args),
  debug: (msg, ...args) => console.log(`[DEBUG] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args)
};

const robota = new Robota({
  // ... other options
  logger: customLogger,
  debug: true
});
```

### Tool Integration
Tool and function creation utilities are provided by the `@robota-sdk/tools` package:
- `createZodFunctionToolProvider` - Zod schema-based tools
- `createMcpToolProvider` - MCP (Model Context Protocol) integration
- `createOpenAPIToolProvider` - OpenAPI specification tools

## License

MIT 