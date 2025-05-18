# Model Context Protocol (MCP)

The Model Context Protocol (MCP) is Robota's standardized method for communicating with various AI models in a consistent way. This protocol ensures compatibility between different AI providers and makes it easy to switch between models.

## Protocol Overview

MCP consists of the following elements:

1. **Message Format** - How to structure conversations between users and AI
2. **Function Schema** - How to represent function and tool definitions
3. **Context Management** - How to manage conversation context and state
4. **Response Format** - How to structure AI responses

## Message Format

In MCP, messages have the following structure:

```typescript
interface Message {
  role: 'user' | 'assistant' | 'system' | 'function';
  content: string;
  name?: string;  // function name in case of function call
  functionCall?: {
    name: string;
    arguments: Record<string, any>;
  };
  functionResult?: any;
}
```

Examples:

```typescript
// User message
const userMessage: Message = {
  role: 'user',
  content: 'What is the weather in Seoul?'
};

// System message
const systemMessage: Message = {
  role: 'system',
  content: 'You are a helpful AI assistant.'
};

// Assistant message with function call
const assistantMessage: Message = {
  role: 'assistant',
  content: 'I will check the weather in Seoul.',
  functionCall: {
    name: 'getWeather',
    arguments: { location: 'Seoul' }
  }
};

// Function result message
const functionMessage: Message = {
  role: 'function',
  name: 'getWeather',
  content: JSON.stringify({ temperature: 25, condition: 'Clear' })
};
```

## Function Schema

MCP defines functions in JSON schema format:

```typescript
interface FunctionSchema {
  name: string;
  description?: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: any[];
      default?: any;
      // Additional JSON schema properties
    }>;
    required?: string[];
  };
}
```

Example:

```typescript
const weatherFunctionSchema: FunctionSchema = {
  name: 'getWeather',
  description: 'Get current weather information for a specific location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name to check weather (e.g., Seoul, New York)'
      },
      unit: {
        type: 'string',
        description: 'Temperature unit',
        enum: ['celsius', 'fahrenheit'],
        default: 'celsius'
      }
    },
    required: ['location']
  }
};
```

## Context Management

In MCP, context represents the state of a conversation and includes the following elements:

```typescript
interface Context {
  messages: Message[];            // Conversation history so far
  functions?: FunctionSchema[];   // Available functions list
  systemPrompt?: string;          // Single system prompt
  systemMessages?: Message[];     // Multiple system messages
  metadata?: Record<string, any>; // Additional metadata
}
```

### System Message Management

Robota supports both single system prompts and multiple system messages:

```typescript
// Set single system prompt
robota.setSystemPrompt('You are a helpful AI assistant.');

// Set multiple system messages
robota.setSystemMessages([
  { role: 'system', content: 'You are a professional data analyst.' },
  { role: 'system', content: 'Whenever a user asks about data analysis, explain step by step.' }
]);

// Add to existing system messages
robota.addSystemMessage('Always try to provide accurate information.');
```

You can also set system messages when creating a Robota instance:

```typescript
// Initialize with single system prompt
const robota1 = new Robota({
  provider: provider,
  systemPrompt: 'You are a helpful AI assistant.'
});

// Initialize with multiple system messages
const robota2 = new Robota({
  provider: provider,
  systemMessages: [
    { role: 'system', content: 'You are a professional data analyst.' },
    { role: 'system', content: 'Whenever a user asks about data analysis, explain step by step.' }
  ]
});
```

## Response Format

Model responses are standardized with the following structure:

```typescript
interface ModelResponse {
  content?: string;               // Text response
  functionCall?: {                // Function call (if any)
    name: string;
    arguments: Record<string, any>;
  };
  usage?: {                       // Token usage information
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, any>; // Additional metadata
}
```

## Protocol Conversion Between Providers

Robota automatically handles the conversion between each AI provider's unique API format and MCP. For example, OpenAI and Anthropic use different message formats, but Robota standardizes them to MCP.

```typescript
// Convert from OpenAI format to MCP
function openaiToMCP(openaiResponse) {
  return {
    content: openaiResponse.choices[0].message.content,
    functionCall: openaiResponse.choices[0].message.function_call
      ? {
          name: openaiResponse.choices[0].message.function_call.name,
          arguments: JSON.parse(openaiResponse.choices[0].message.function_call.arguments)
        }
      : undefined,
    usage: {
      promptTokens: openaiResponse.usage.prompt_tokens,
      completionTokens: openaiResponse.usage.completion_tokens,
      totalTokens: openaiResponse.usage.total_tokens
    }
  };
}

// Convert from MCP to Anthropic format
function mcpToAnthropic(mcpContext) {
  return {
    messages: mcpContext.messages.map(message => {
      if (message.role === 'user') {
        return { role: 'human', content: message.content };
      } else if (message.role === 'assistant') {
        return { role: 'assistant', content: message.content };
      }
      // Other conversion logic
    }),
    system: mcpContext.systemPrompt
  };
}
```

## Integrating Custom Models

To integrate a new AI model with Robota, you need to implement conversion logic between the model's API and MCP:

```typescript
import { BaseProvider, ModelContextProtocol } from 'robota';

class CustomModelProvider extends BaseProvider implements ModelContextProtocol {
  // Convert MCP context to model-specific format
  convertContextToModelFormat(context) {
    // Implement conversion logic
    return customFormat;
  }

  // Convert model response to MCP format
  convertModelResponseToMCP(modelResponse) {
    // Implement conversion logic
    return mcpResponse;
  }
  
  // Implement other necessary methods
}
```

## Benefits of MCP

1. **Provider Independence** - Switch between different AI models without changing application code
2. **Standardized Interface** - Interact with all AI models in a consistent way
3. **Extensibility** - Easily integrate new models and providers
4. **Portability** - Reuse the same code across different environments 