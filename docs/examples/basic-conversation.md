# Basic Conversation

This example demonstrates the fundamental usage of the Robota SDK for simple AI conversations.

## Overview

The basic conversation example shows how to:
- Set up an OpenAI client and provider
- Create a Robota instance
- Send messages and receive responses
- Use streaming responses for real-time output

## Source Code

**Location**: `apps/examples/01-basic/01-simple-conversation.ts`

## Key Concepts

### 1. Provider Setup
```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';

// Create OpenAI client
const openaiClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Create provider
const openaiProvider = new OpenAIProvider(openaiClient);
```

### 2. Robota Instance Creation
```typescript
const robota = new Robota({
    aiProviders: {
        'openai': openaiProvider
    },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    systemPrompt: 'You are a helpful AI assistant. Provide concise and useful responses.'
});
```

### 3. Simple Conversation
```typescript
// Send a message and get a complete response
const response = await robota.run('Hello! Please tell me about TypeScript.');
console.log('Response:', response);
```

### 4. Streaming Response
```typescript
// Get a streaming response for real-time output
const stream = await robota.runStream('Please briefly explain the advantages of TypeScript.');

for await (const chunk of stream) {
    process.stdout.write(chunk.content || '');
}
```

## Running the Example

1. **Ensure setup is complete** (see [Setup Guide](./setup.md))

2. **Navigate to examples directory**:
   ```bash
   cd apps/examples
   ```

3. **Run the example**:
   ```bash
   # Using bun (recommended)
   bun run 01-basic/01-simple-conversation.ts
   
   # Using pnpm + tsx
   pnpm tsx 01-basic/01-simple-conversation.ts
   ```

## Expected Output

```
===== Simple Conversation Example =====
Response: TypeScript is a strongly typed programming language that builds on JavaScript by adding static type definitions. It helps catch errors during development, provides better IDE support with autocompletion and refactoring tools, and makes code more maintainable and self-documenting...

===== Streaming Response Example =====
Response: 
TypeScript offers several key advantages:

1. **Type Safety**: Catches errors at compile time rather than runtime
2. **Better IDE Support**: Enhanced autocompletion, navigation, and refactoring
3. **Improved Maintainability**: Self-documenting code with clear interfaces
4. **Modern JavaScript Features**: Access to latest ECMAScript features
5. **Gradual Adoption**: Can be incrementally adopted in existing JavaScript projects
```

## Configuration Options

### Robota Constructor Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `aiProviders` | `Record<string, AIProvider>` | Map of provider names to provider instances |
| `currentProvider` | `string` | Name of the active provider |
| `currentModel` | `string` | Model to use with the current provider |
| `systemPrompt` | `string` | System prompt for AI behavior |

### OpenAI Provider Options

```typescript
const openaiProvider = new OpenAIProvider(openaiClient, {
    temperature: 0.7,        // Creativity level (0-1)
    maxTokens: 1000,         // Maximum response length
    topP: 1.0,               // Nucleus sampling parameter
    frequencyPenalty: 0.0,   // Repetition penalty
    presencePenalty: 0.0     // Topic diversity penalty
});
```

### Available Models

Common OpenAI models you can use:
- `gpt-3.5-turbo` - Fast and cost-effective
- `gpt-4` - More capable, higher cost
- `gpt-4-turbo` - Latest GPT-4 with improved performance
- `gpt-4o` - Optimized version
- `gpt-4o-mini` - Smaller, faster variant

## Error Handling

### Basic Error Handling
```typescript
try {
    const response = await robota.run(userInput);
    console.log(response);
} catch (error) {
    console.error('AI request failed:', error);
}
```

### Common Errors

1. **Missing API Key**
   ```
   Error: OPENAI_API_KEY environment variable is required
   ```
   **Solution**: Set your OpenAI API key in `.env`

2. **Network Issues**
   ```
   Error: Request failed with status 429
   ```
   **Solution**: Rate limiting - wait and retry

3. **Model Access**
   ```
   Error: Model not found
   ```
   **Solution**: Verify model name and API tier access

## Best Practices

### 1. Environment Variables
Always use environment variables for API keys:
```typescript
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
}
```

### 2. Error Handling
Implement comprehensive error handling:
```typescript
async function safeAICall(prompt: string) {
    try {
        return await robota.run(prompt);
    } catch (error) {
        if (error.status === 429) {
            // Rate limit - implement backoff
            await new Promise(resolve => setTimeout(resolve, 1000));
            return safeAICall(prompt);
        }
        throw error;
    }
}
```

### 3. Resource Management
```typescript
// For long-running applications, consider cleanup
process.on('SIGINT', async () => {
    // Clean up resources if needed
    process.exit(0);
});
```

## Next Steps

Once you've mastered basic conversations, explore:

1. [**AI with Tools**](./ai-with-tools.md) - Add function calling capabilities
2. [**Multi-Provider Setup**](./multi-provider.md) - Use multiple AI providers
3. [**Provider Switching**](./provider-switching.md) - Dynamic provider switching

## Troubleshooting

### Performance Issues
- Use streaming for long responses
- Consider using faster models like `gpt-3.5-turbo`
- Implement proper error handling and retries

### Cost Optimization
- Monitor token usage
- Use appropriate models for the task complexity
- Implement response length limits

### Development Tips
- Use debug mode during development
- Log requests and responses for debugging
- Test with different models to find the best fit 