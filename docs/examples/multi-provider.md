# Multi-Provider

This guide demonstrates how to use multiple AI providers with Robota, showcasing different models and comparing their responses.

## Overview

The multi-provider example shows how to:
- Configure multiple OpenAI models (GPT-3.5, GPT-4o-mini)
- Create independent agent instances with different providers
- Compare responses from different models
- Monitor individual agent statistics

## Code Example

```typescript
/**
 * 03-multi-providers.ts
 * 
 * This example demonstrates using multiple AI providers:
 * - OpenAI with different models
 * - Comparing responses from different models
 * - Provider switching capabilities
 * - Independent agent instances
 */

import OpenAI from 'openai';
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables from examples directory
dotenv.config();

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

        // Create OpenAI client
        const openaiClient = new OpenAI({ apiKey: openaiKey });

        // === OpenAI GPT-3.5-turbo Provider Test ===
        const openai35Provider = new OpenAIProvider({
            apiKey: openaiKey
        });

        const robota35 = new Robota({
            name: 'GPT35Agent',
            aiProviders: [openai35Provider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo',
                systemMessage: 'You are a helpful assistant powered by OpenAI GPT-3.5. Be concise and mention that you are GPT-3.5.'
            }
        });

        await testProvider('OpenAI GPT-3.5', robota35, 'Hello! Please tell me about artificial intelligence in 2-3 sentences.');

        // === OpenAI GPT-4o-mini Provider Test ===
        const openai4MiniProvider = new OpenAIProvider({
            apiKey: openaiKey
        });

        const robota4Mini = new Robota({
            name: 'GPT4MiniAgent',
            aiProviders: [openai4MiniProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                systemMessage: 'You are a helpful assistant powered by OpenAI GPT-4o-mini. Be detailed and mention that you are GPT-4o-mini.'
            }
        });

        await testProvider('OpenAI GPT-4o-mini', robota4Mini, 'Hello! Please tell me about artificial intelligence in 2-3 sentences.');

        // === Test different model comparison ===
        console.log(`\n${'='.repeat(50)}`);
        console.log('🔄 Testing Model Comparison');
        console.log(`${'='.repeat(50)}`);

        const testQueries = ['What is AI?'];

        for (const query of testQueries) {
            console.log(`\n📝 Query: ${query}`);

            console.log('\n🤖 GPT-3.5-turbo:');
            try {
                const response35 = await robota35.run(query);
                console.log(response35);
            } catch (error) {
                console.error('Error:', error);
            }

            console.log('\n🧠 GPT-4o-mini:');
            try {
                const response4 = await robota4Mini.run(query);
                console.log(response4);
            } catch (error) {
                console.error('Error:', error);
            }

            console.log('\n' + '-'.repeat(40));
        }

        // === Show Agent Statistics ===
        console.log('\n📊 Agent Comparison:');

        const stats35 = robota35.getStats();
        console.log(`\nGPT-3.5 Agent (${stats35.name}):`);
        console.log(`- History length: ${stats35.historyLength}`);
        console.log(`- Current provider: ${stats35.currentProvider}`);
        console.log(`- Uptime: ${Math.round(stats35.uptime)}ms`);

        const stats4 = robota4Mini.getStats();
        console.log(`\nGPT-4o-mini Agent (${stats4.name}):`);
        console.log(`- History length: ${stats4.historyLength}`);
        console.log(`- Current provider: ${stats4.currentProvider}`);
        console.log(`- Uptime: ${Math.round(stats4.uptime)}ms`);

        console.log('\n✅ Multi-Provider Example Completed!');
        console.log('\n💡 To test other providers (Anthropic, Google AI):');
        console.log('   - Set ANTHROPIC_API_KEY environment variable');
        console.log('   - Set GOOGLE_AI_API_KEY environment variable');
        console.log('   - Import @robota-sdk/anthropic and @robota-sdk/google packages');

        // Clean up resources
        await robota35.destroy();
        await robota4Mini.destroy();

        console.log('🧹 Cleanup completed. Exiting...');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main();
```

## Expected Output

```
🌐 Multi-Provider Example Started...

==================================================
🤖 Testing OPENAI GPT-3.5 Provider
==================================================
User: Hello! Please tell me about artificial intelligence in 2-3 sentences.
Assistant: Hello! I'm GPT-3.5, an AI assistant. Artificial intelligence (AI) refers to computer systems that can perform tasks typically requiring human intelligence, such as learning, reasoning, and problem-solving. AI technologies power everything from voice assistants to autonomous vehicles, and continue to advance rapidly across various industries.

==================================================
🤖 Testing OPENAI GPT-4O-MINI Provider
==================================================
User: Hello! Please tell me about artificial intelligence in 2-3 sentences.
Assistant: Hello! I'm GPT-4o-mini, an advanced AI assistant. Artificial intelligence is a field of computer science focused on creating systems that can perform tasks requiring human-like intelligence, including learning from data, recognizing patterns, and making decisions. AI has revolutionized numerous industries by enabling automation, predictive analytics, and intelligent human-computer interactions, from chatbots and recommendation systems to medical diagnosis and autonomous vehicles.

==================================================
🔄 Testing Model Comparison
==================================================

📝 Query: What is AI?

🤖 GPT-3.5-turbo:
AI, or Artificial Intelligence, refers to computer systems designed to perform tasks that typically require human intelligence...

🧠 GPT-4o-mini:
AI (Artificial Intelligence) is a comprehensive field of computer science that focuses on creating intelligent machines...

📊 Agent Comparison:

GPT-3.5 Agent (GPT35Agent):
- History length: 4
- Current provider: openai
- Uptime: 2156ms

GPT-4o-mini Agent (GPT4MiniAgent):
- History length: 4  
- Current provider: openai
- Uptime: 2287ms

✅ Multi-Provider Example Completed!
```

## Key Features

### 1. **Independent Agent Instances**
Each provider has its own Robota instance with separate configuration:

```typescript
// GPT-3.5 instance
const robota35 = new Robota({
    name: 'GPT35Agent',
    aiProviders: [openai35Provider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: 'You are a helpful assistant powered by OpenAI GPT-3.5.'
    }
});

// GPT-4o-mini instance  
const robota4Mini = new Robota({
    name: 'GPT4MiniAgent',
    aiProviders: [openai4MiniProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        systemMessage: 'You are a helpful assistant powered by OpenAI GPT-4o-mini.'
    }
});
```

### 2. **Provider Testing Helper**
Reusable function to test different providers:

```typescript
async function testProvider(providerName: string, robota: Robota, query: string) {
    console.log(`🤖 Testing ${providerName.toUpperCase()} Provider`);
    console.log(`User: ${query}`);
    
        try {
        const response = await robota.run(query);
        console.log(`Assistant: ${response}`);
        } catch (error) {
        console.error(`❌ Error with ${providerName}:`, error);
        }
    }
```

### 3. **Model Comparison**
Side-by-side comparison of model responses:

```typescript
console.log('\n🤖 GPT-3.5-turbo:');
const response35 = await robota35.run(query);
console.log(response35);

console.log('\n🧠 GPT-4o-mini:');
const response4 = await robota4Mini.run(query);
console.log(response4);
```

### 4. **Statistics Comparison**
Compare performance metrics across different agents:

```typescript
const stats35 = robota35.getStats();
const stats4 = robota4Mini.getStats();

console.log(`GPT-3.5 Agent: ${stats35.historyLength} messages, ${stats35.uptime}ms uptime`);
console.log(`GPT-4o-mini Agent: ${stats4.historyLength} messages, ${stats4.uptime}ms uptime`);
```

## Advanced Multi-Provider Setup

### Adding Anthropic Provider

```typescript
import { AnthropicProvider } from '@robota-sdk/anthropic';

const anthropicProvider = new AnthropicProvider({
    apiKey: process.env.ANTHROPIC_API_KEY!
});

const robotaClaude = new Robota({
    name: 'ClaudeAgent',
    aiProviders: [anthropicProvider],
    defaultModel: {
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        systemMessage: 'You are Claude, an AI assistant by Anthropic.'
    }
});
```

### Adding Google AI Provider

```typescript
import { GoogleProvider } from '@robota-sdk/google';

const googleProvider = new GoogleProvider({
    apiKey: process.env.GOOGLE_AI_API_KEY!
});

const robotaGemini = new Robota({
    name: 'GeminiAgent',
    aiProviders: [googleProvider],
    defaultModel: {
        provider: 'google',
        model: 'gemini-1.5-flash',
        systemMessage: 'You are Gemini, an AI model by Google.'
    }
});
```

## Best Practices

1. **Environment Variables**: Use environment variables for API keys
2. **Error Handling**: Implement proper error handling for each provider
3. **Resource Management**: Always call `destroy()` on each agent instance
4. **Provider Naming**: Use clear, descriptive names for different provider instances
5. **Statistics Monitoring**: Track performance metrics for comparison

## Provider Support

Currently supported providers:
- **OpenAI**: GPT-3.5, GPT-4, GPT-4o-mini and other models
- **Anthropic**: Claude 3 family (Haiku, Sonnet, Opus)
- **Google AI**: Gemini 1.5 (Flash, Pro) models

Each provider maintains feature parity through the unified `BaseAIProvider` architecture. 