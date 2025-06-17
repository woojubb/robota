# Basic Conversation

This guide demonstrates the most fundamental usage of Robota for basic AI conversations.

## Overview

The basic conversation example shows how to:
- Set up Robota with an AI provider
- Send simple messages and receive responses
- Handle streaming responses
- Proper resource cleanup

## Code Example

```typescript
/**
 * 01-basic-conversation.ts
 * 
 * This example demonstrates the most basic usage of Robota:
 * - Simple conversation using OpenAI
 * - Message sending and streaming responses
 * - Proper error handling
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        console.log('🤖 Basic Conversation Example Started...\n');

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client
        const openaiClient = new OpenAI({ apiKey });

        // Create OpenAI Provider
        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-3.5-turbo'
        });

        // Create Robota instance
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: 'You are a helpful AI assistant. Provide concise and useful responses.'
        });

        // === Simple Conversation ===
        console.log('📝 Simple Conversation:');
        const query = 'Hello! Please tell me about TypeScript in 2-3 sentences.';
        console.log(`User: ${query}`);

        const response = await robota.run(query);
        console.log(`Assistant: ${response}\n`);

        // === Streaming Response ===
        console.log('🌊 Streaming Response:');
        const streamQuery = 'What are the main benefits of using TypeScript?';
        console.log(`User: ${streamQuery}`);
        console.log('Assistant: ');

        const stream = await robota.runStream(streamQuery);
        for await (const chunk of stream) {
            process.stdout.write(chunk.content || '');
        }
        console.log('\n');

        console.log('✅ Basic Conversation Example Completed!');

        // Clean up resources
        await robota.close();
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main();
```

## Setup Requirements

Before running this example, ensure you have:

1. **Environment Variables**: Create a `.env` file with your API key:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

2. **Dependencies**: Install required packages:
   ```bash
   npm install @robota-sdk/core @robota-sdk/openai openai dotenv
   ```

## Key Concepts

### 1. Provider Configuration

The example uses the OpenAI provider, which extends the new `BaseAIProvider` class:

```typescript
const openaiProvider = new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-3.5-turbo'
});
```

All providers now inherit common functionality from `BaseAIProvider`, ensuring consistent behavior across different AI services.

### 2. Robota Instance Creation

```typescript
const robota = new Robota({
    aiProviders: {
        'openai': openaiProvider
    },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    systemPrompt: 'You are a helpful AI assistant.'
});
```

### 3. Simple Message Exchange

```typescript
const response = await robota.run(query);
```

The `run()` method sends a message and returns the complete response.

### 4. Streaming Responses

```typescript
const stream = await robota.runStream(streamQuery);
for await (const chunk of stream) {
    process.stdout.write(chunk.content || '');
}
```

The `runStream()` method provides real-time streaming of the AI response.

### 5. Resource Cleanup

```typescript
await robota.close();
```

Always call `close()` to properly clean up resources and prevent memory leaks.

## Running the Example

```bash
# Navigate to the examples directory
cd apps/examples

# Run the basic conversation example
npx tsx 01-basic-conversation.ts
```

## Expected Output

```
🤖 Basic Conversation Example Started...

📝 Simple Conversation:
User: Hello! Please tell me about TypeScript in 2-3 sentences.
Assistant: TypeScript is a strongly typed programming language developed by Microsoft that builds on JavaScript by adding static type definitions. It helps catch errors during development time rather than runtime, making code more reliable and maintainable. TypeScript compiles to plain JavaScript and can run anywhere JavaScript runs.

🌊 Streaming Response:
User: What are the main benefits of using TypeScript?
Assistant: TypeScript offers several key benefits: static typing helps catch errors early in development, improved IDE support with better autocomplete and refactoring capabilities, enhanced code documentation through type annotations, better team collaboration with clear interfaces, easier refactoring of large codebases, and seamless integration with existing JavaScript projects.

✅ Basic Conversation Example Completed!
```

## Next Steps

- Try [Tool Calling](./ai-with-tools.md) to add function calling capabilities
- Explore [Multi-Provider](./multi-provider.md) setup for using different AI services
- Learn about [Advanced Features](./session-management.md) like analytics and limits 