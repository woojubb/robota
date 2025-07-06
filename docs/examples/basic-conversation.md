# Basic Conversation

This guide demonstrates the most fundamental usage of Robota for basic AI conversations.

## Overview

The basic conversation example shows how to:
- Set up Robota with an AI provider
- Send simple messages and receive responses
- Monitor agent statistics
- Proper resource cleanup

## Code Example

```typescript
/**
 * 01-basic-conversation.ts
 * 
 * This example demonstrates the most basic usage of Robota:
 * - Simple conversation using OpenAI
 * - Message sending and responses
 * - Proper error handling
 * - Basic statistics and resource management
 */

import OpenAI from 'openai';
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables from examples directory
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
            apiKey: apiKey
        });

        // Create Robota instance with basic configuration
        const robota = new Robota({
            name: 'BasicAgent',
            aiProviders: [openaiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo',
                systemMessage: 'You are a helpful AI assistant. Provide concise and useful responses.'
            }
        });

        // === Simple Conversation ===
        console.log('📝 Simple Question:');
        const query = 'Hi, what is TypeScript?';
        console.log(`User: ${query}`);

        const response = await robota.run(query);
        console.log(`Assistant: ${response}\n`);

        // === Show Statistics ===
        console.log('📊 Session Statistics:');
        const stats = robota.getStats();
        console.log(`- Agent name: ${stats.name}`);
        console.log(`- Current provider: ${stats.currentProvider}`);
        console.log(`- History length: ${stats.historyLength}`);
        console.log(`- Available tools: ${stats.tools.length}`);
        console.log(`- Plugins: ${stats.plugins.length}`);
        console.log(`- Uptime: ${Math.round(stats.uptime)}ms\n`);

        console.log('✅ Basic Conversation Example Completed!');

        // Clean up resources
        await robota.destroy();

        // Ensure process exits cleanly
        console.log('🧹 Cleanup completed. Exiting...');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error occurred:', error);
        if (error instanceof Error) {
            console.error('Stack trace:', error.stack);
        }
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
   npm install @robota-sdk/agents @robota-sdk/openai openai dotenv
   ```

## Key Concepts

### 1. Provider Configuration

The example uses the OpenAI provider with API key configuration:

```typescript
const openaiProvider = new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY
});
```

### 2. Robota Instance Creation

```typescript
const robota = new Robota({
    name: 'BasicAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful AI assistant.'
    }
});
```

### 3. Simple Message Exchange

```typescript
const response = await robota.run(query);
```

The `run()` method sends a message and returns the complete response.

### 4. Agent Statistics

```typescript
const stats = robota.getStats();
```

Get comprehensive statistics about the agent's current state and usage.

### 5. Resource Cleanup

```typescript
await robota.destroy();
```

Always call `destroy()` to properly clean up resources and prevent memory leaks.

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

📝 Simple Question:
User: Hi, what is TypeScript?
Assistant: TypeScript is a strongly typed programming language developed by Microsoft that builds on JavaScript by adding static type definitions. It helps catch errors during development time rather than runtime, making code more reliable and maintainable.

📊 Session Statistics:
- Agent name: BasicAgent
- Current provider: openai
- History length: 2
- Available tools: 0
- Plugins: 0
- Uptime: 1234ms

✅ Basic Conversation Example Completed!
🧹 Cleanup completed. Exiting...
```

## Next Steps

- Try [Tool Calling](./ai-with-tools.md) to add function calling capabilities
- Explore [Multi-Provider](./multi-provider.md) setup for using different AI services
- Learn about [Advanced Features](./session-management.md) like analytics and limits 