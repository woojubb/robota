# Multi-Provider

This guide demonstrates how to use multiple AI providers with Robota, showcasing the unified `BaseAIProvider` architecture that ensures consistent behavior across different AI services.

## Overview

The multi-provider example shows how to:
- Configure multiple AI providers (OpenAI, Anthropic, Google AI)
- Use the same tool calling interface across all providers
- Compare responses from different models
- Switch between providers dynamically

## Code Example

```typescript
/**
 * 03-multi-providers.ts
 * 
 * This example demonstrates using multiple AI providers:
 * - OpenAI, Anthropic, and Google AI providers
 * - Each provider with tool calling support
 * - Comparing responses from different models
 */

import { z } from 'zod';
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Simple tool for demonstration
const tools = {
    getRandomFact: {
        name: 'getRandomFact',
        description: 'Returns a random interesting fact',
        parameters: z.object({
            category: z.enum(['science', 'history', 'technology']).describe('Category of fact to retrieve')
        }),
        handler: async (params) => {
            const { category } = params;
            console.log(`📚 Getting ${category} fact...`);

            const facts = {
                science: [
                    'Honey never spoils - archaeologists have found edible honey in ancient Egyptian tombs.',
                    'A group of flamingos is called a "flamboyance".',
                    'Octopuses have three hearts and blue blood.'
                ],
                history: [
                    'The Great Wall of China is not visible from space with the naked eye.',
                    'Cleopatra lived closer in time to the moon landing than to the construction of the Great Pyramid.',
                    'Oxford University is older than the Aztec Empire.'
                ],
                technology: [
                    'The first computer bug was an actual bug - a moth trapped in a Harvard computer in 1947.',
                    'More than 50% of all website traffic comes from mobile devices.',
                    'The first iPhone was released in 2007, just 16 years ago.'
                ]
            };

            const categoryFacts = facts[category];
            const randomFact = categoryFacts[Math.floor(Math.random() * categoryFacts.length)];

            return { category, fact: randomFact };
        }
    }
};

async function testProvider(providerName: string, robota: Robota, query: string) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🤖 Testing ${providerName.toUpperCase()} Provider`);
    console.log(`${'='.repeat(50)}`);
    console.log(`User: ${query}`);

    try {
        const response = await robota.run(query);
        console.log(`Assistant: ${response}`);
    } catch (error) {
        console.error(`❌ Error with ${providerName}:`, error);
    }
}

async function main() {
    try {
        console.log('🌐 Multi-Provider Example Started...\n');

        // Validate API key
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required for this example');
        }

        // Create tool provider
        const toolProvider = createZodFunctionToolProvider({ tools });

        // === OpenAI Provider Test ===
        const openaiClient = new OpenAI({ apiKey: openaiKey });
        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-3.5-turbo'
        });

        const robotaOpenAI = new Robota({
            aiProviders: { openai: openaiProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            toolProviders: [toolProvider],
            systemPrompt: 'You are a helpful assistant powered by OpenAI. Use tools when appropriate and mention that you are using OpenAI.'
        });

        await testProvider('OpenAI', robotaOpenAI, 'Hello! Please tell me a random science fact.');

        // === Test different models ===
        console.log(`\n${'='.repeat(50)}`);
        console.log('🔄 Testing Different Models');
        console.log(`${'='.repeat(50)}`);

        // Test with GPT-4 if available
        const gpt4Provider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4'
        });

        const robotaGPT4 = new Robota({
            aiProviders: { 'gpt-4': gpt4Provider },
            currentProvider: 'gpt-4',
            currentModel: 'gpt-4',
            toolProviders: [toolProvider],
            systemPrompt: 'You are a helpful assistant powered by GPT-4. Use tools when appropriate.'
        });

        console.log('\n🧠 Testing GPT-4:');
        console.log('User: Tell me a technology fact and explain why it\'s significant.');

        try {
            const response = await robotaGPT4.run('Tell me a technology fact and explain why it\'s significant.');
            console.log(`GPT-4: ${response}`);
        } catch (error) {
            console.error('❌ GPT-4 not available or insufficient quota:', error);
        }

        // === Demonstrate tool calling consistency ===
        console.log(`\n${'='.repeat(50)}`);
        console.log('🛠️ Tool Calling Consistency Test');
        console.log(`${'='.repeat(50)}`);

        const queries = [
            'Give me a history fact.',
            'Tell me something interesting about technology.',
            'What\'s a cool science fact?'
        ];

        for (const query of queries) {
            console.log(`\nUser: ${query}`);
            const response = await robotaOpenAI.run(query);
            console.log(`Assistant: ${response}`);
        }

        console.log('\n✅ Multi-Provider Example Completed!');
        console.log('\n💡 To test other providers (Anthropic, Google AI):');
        console.log('   - Set ANTHROPIC_API_KEY environment variable');
        console.log('   - Set GOOGLE_AI_API_KEY environment variable');
        console.log('   - Import and configure respective providers');

        // Clean up resources
        await robotaOpenAI.close();
        await robotaGPT4.close();
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

1. **Environment Variables**: Create a `.env` file with your API keys:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ANTHROPIC_API_KEY=your_anthropic_api_key_here
   GOOGLE_AI_API_KEY=your_google_ai_api_key_here
   ```

2. **Dependencies**: Install required packages:
   ```bash
   npm install @robota-sdk/core @robota-sdk/openai @robota-sdk/anthropic @robota-sdk/google @robota-sdk/tools openai @anthropic-ai/sdk @google/generative-ai zod dotenv
   ```

## Key Concepts

### 1. BaseAIProvider Architecture

All providers now extend the `BaseAIProvider` class, ensuring consistent behavior:

```typescript
// OpenAI Provider
const openaiProvider = new OpenAIProvider({
    client: openaiClient,
    model: 'gpt-3.5-turbo'
});

// Anthropic Provider
const anthropicProvider = new AnthropicProvider({
    client: anthropicClient,
    model: 'claude-3-sonnet-20240229'
});

// Google AI Provider
const googleProvider = new GoogleProvider({
    client: googleClient,
    model: 'gemini-pro'
});
```

### 2. Unified Tool Calling

All providers support the same tool calling interface:

```typescript
// Same tool provider works with all AI providers
const toolProvider = createZodFunctionToolProvider({ tools });

// OpenAI with tools
const robotaOpenAI = new Robota({
    aiProviders: { openai: openaiProvider },
    toolProviders: [toolProvider]
});

// Anthropic with tools
const robotaAnthropic = new Robota({
    aiProviders: { anthropic: anthropicProvider },
    toolProviders: [toolProvider]
});
```

### 3. Provider-Specific Formats

Behind the scenes, each provider uses its native tool calling format:

- **OpenAI**: `tool_calls` format
- **Anthropic**: `tool_use` format
- **Google AI**: `functionDeclarations` format

The adapters automatically convert between the universal format and provider-specific formats.

### 4. Multiple Providers in One Instance

```typescript
const robota = new Robota({
    aiProviders: {
        'openai': openaiProvider,
        'anthropic': anthropicProvider,
        'google': googleProvider
    },
    currentProvider: 'openai',  // Start with OpenAI
    currentModel: 'gpt-3.5-turbo',
    toolProviders: [toolProvider]
});

// Switch provider dynamically
robota.switchProvider('anthropic', 'claude-3-sonnet-20240229');
```

## Complete Multi-Provider Example

Here's a comprehensive example showing all three providers:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';

// Tool definition (works with all providers)
const tools = {
    getWeather: {
        name: 'getWeather',
        description: 'Gets weather information for a city',
        parameters: z.object({
            city: z.string().describe('City name')
        }),
        handler: async ({ city }) => {
            // Mock weather data
            return {
                city,
                temperature: '22°C',
                condition: 'Sunny',
                humidity: '65%'
            };
        }
    }
};

async function demonstrateAllProviders() {
    const toolProvider = createZodFunctionToolProvider({ tools });

    // Create all providers
    const openaiProvider = new OpenAIProvider({
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
        model: 'gpt-3.5-turbo'
    });

    const anthropicProvider = new AnthropicProvider({
        client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
        model: 'claude-3-sonnet-20240229'
    });

    const googleProvider = new GoogleProvider({
        client: new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY),
        model: 'gemini-pro'
    });

    // Test each provider
    const providers = [
        { name: 'OpenAI', provider: openaiProvider, model: 'gpt-3.5-turbo' },
        { name: 'Anthropic', provider: anthropicProvider, model: 'claude-3-sonnet-20240229' },
        { name: 'Google AI', provider: googleProvider, model: 'gemini-pro' }
    ];

    for (const { name, provider, model } of providers) {
        console.log(`\n=== Testing ${name} ===`);
        
        const robota = new Robota({
            aiProviders: { [name.toLowerCase()]: provider },
            currentProvider: name.toLowerCase(),
            currentModel: model,
            toolProviders: [toolProvider]
        });

        try {
            const response = await robota.run('What\'s the weather like in Seoul?');
            console.log(`${name}: ${response}`);
        } catch (error) {
            console.error(`${name} Error:`, error.message);
        }

        await robota.close();
    }
}
```

## Running the Example

```bash
# Navigate to the examples directory
cd apps/examples

# Run the multi-provider example
npx tsx 03-multi-providers.ts
```

## Expected Output

```
🌐 Multi-Provider Example Started...

==================================================
🤖 Testing OPENAI Provider
==================================================
User: Hello! Please tell me a random science fact.
📚 Getting science fact...
Assistant: Hello! I'm powered by OpenAI, and I'd be happy to share a fascinating science fact with you.

Here's an interesting fact: Honey never spoils - archaeologists have found edible honey in ancient Egyptian tombs! This is because honey has natural antimicrobial properties and extremely low moisture content, which prevents bacterial growth and spoilage.

==================================================
🔄 Testing Different Models
==================================================

🧠 Testing GPT-4:
User: Tell me a technology fact and explain why it's significant.
📚 Getting technology fact...
GPT-4: Here's a fascinating technology fact: The first computer bug was an actual bug - a moth trapped in a Harvard computer in 1947.

This is significant because it coined the term "debugging" that we still use today in software development...

==================================================
🛠️ Tool Calling Consistency Test
==================================================

User: Give me a history fact.
📚 Getting history fact...
Assistant: Here's a fascinating history fact: Oxford University is older than the Aztec Empire.

User: Tell me something interesting about technology.
📚 Getting technology fact...
Assistant: Here's an interesting technology fact: More than 50% of all website traffic comes from mobile devices.

User: What's a cool science fact?
📚 Getting science fact...
Assistant: Here's a cool science fact: Octopuses have three hearts and blue blood!

✅ Multi-Provider Example Completed!

💡 To test other providers (Anthropic, Google AI):
   - Set ANTHROPIC_API_KEY environment variable
   - Set GOOGLE_AI_API_KEY environment variable
   - Import and configure respective providers
```

## Provider Comparison

### OpenAI Provider
- **Models**: GPT-3.5-turbo, GPT-4, GPT-4-turbo
- **Tool Format**: `tool_calls`
- **Strengths**: Fast, cost-effective, excellent tool calling
- **Use Cases**: General conversation, function calling, code generation

### Anthropic Provider
- **Models**: Claude-3-haiku, Claude-3-sonnet, Claude-3-opus
- **Tool Format**: `tool_use` (converted to universal format)
- **Strengths**: Strong reasoning, ethical alignment, long context
- **Use Cases**: Complex analysis, ethical AI, long-form content

### Google AI Provider
- **Models**: Gemini-pro, Gemini-pro-vision
- **Tool Format**: `functionDeclarations` (converted to universal format)
- **Strengths**: Multimodal capabilities, fast inference
- **Use Cases**: Visual analysis, real-time applications, Google services integration

## Advanced Multi-Provider Patterns

### Dynamic Provider Switching

```typescript
const robota = new Robota({
    aiProviders: {
        'fast': openaiProvider,
        'smart': anthropicProvider,
        'multimodal': googleProvider
    },
    currentProvider: 'fast'
});

// Switch based on query complexity
async function smartRoute(query: string) {
    if (query.includes('analyze') || query.includes('complex')) {
        robota.switchProvider('smart', 'claude-3-sonnet-20240229');
    } else if (query.includes('image') || query.includes('visual')) {
        robota.switchProvider('multimodal', 'gemini-pro-vision');
    } else {
        robota.switchProvider('fast', 'gpt-3.5-turbo');
    }
    
    return robota.run(query);
}
```

### Provider Fallback

```typescript
async function robustQuery(query: string) {
    const providers = ['openai', 'anthropic', 'google'];
    
    for (const provider of providers) {
        try {
            robota.switchProvider(provider);
            return await robota.run(query);
        } catch (error) {
            console.warn(`Provider ${provider} failed, trying next...`);
        }
    }
    
    throw new Error('All providers failed');
}
```

## Best Practices

### 1. Provider Selection

- **OpenAI**: Best for general use, fast responses, function calling
- **Anthropic**: Best for complex reasoning, ethical considerations
- **Google AI**: Best for multimodal tasks, real-time applications

### 2. Cost Optimization

```typescript
// Use cheaper models for simple tasks
const chatConfig = {
    simple: { provider: 'openai', model: 'gpt-3.5-turbo' },
    complex: { provider: 'anthropic', model: 'claude-3-sonnet-20240229' },
    premium: { provider: 'openai', model: 'gpt-4' }
};
```

### 3. Error Handling

```typescript
try {
    const response = await robota.run(query);
    return response;
} catch (error) {
    if (error.code === 'rate_limit') {
        // Switch to different provider
        robota.switchProvider('backup-provider');
        return robota.run(query);
    }
    throw error;
}
```

## Next Steps

- Try [Advanced Features](./session-management.md) for analytics and limits across providers
- Explore [Provider Switching](./provider-switching.md) for dynamic provider selection
- Learn about [Token Limits](./token-limits.md) for cost optimization across providers 