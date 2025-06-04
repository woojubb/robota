# Multi-Provider Usage Examples

This guide demonstrates how to use multiple AI providers with Robota SDK, including OpenAI, Anthropic, and Google AI.

## Overview

Robota SDK supports multiple AI providers, allowing you to:
- Use different providers for different tasks
- Switch between providers dynamically
- Compare responses from different models
- Leverage the strengths of each provider

## Basic Multi-Provider Setup

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
const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);

// Create providers
const openaiProvider = new OpenAIProvider(openaiClient);
const anthropicProvider = new AnthropicProvider({ client: anthropicClient });
const googleProvider = new GoogleProvider({ client: googleClient });

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
```

## Dynamic Provider Switching

```typescript
// Check current provider
const currentAI = robota.getCurrentAI();
console.log(`Current: ${currentAI.provider}/${currentAI.model}`);

// Switch to OpenAI GPT-4
robota.setCurrentAI('openai', 'gpt-4');
const openaiResponse = await robota.run('Explain quantum computing briefly.');

// Switch to Anthropic Claude
robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');
const anthropicResponse = await robota.run('Explain quantum computing briefly.');

// Switch to Google Gemini
robota.setCurrentAI('google', 'gemini-1.5-pro');
const googleResponse = await robota.run('Explain quantum computing briefly.');

console.log('OpenAI:', openaiResponse);
console.log('Anthropic:', anthropicResponse);
console.log('Google:', googleResponse);
```

## Provider-Specific Model Selection

```typescript
// OpenAI models
robota.setCurrentAI('openai', 'gpt-4');              // GPT-4
robota.setCurrentAI('openai', 'gpt-3.5-turbo');     // GPT-3.5 Turbo

// Anthropic models
robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');  // Claude 3.5 Sonnet
robota.setCurrentAI('anthropic', 'claude-3-opus-20240229');      // Claude 3 Opus
robota.setCurrentAI('anthropic', 'claude-3-haiku-20240307');     // Claude 3 Haiku

// Google models
robota.setCurrentAI('google', 'gemini-1.5-pro');    // Gemini 1.5 Pro
robota.setCurrentAI('google', 'gemini-1.5-flash');  // Gemini 1.5 Flash
```

## Streaming with Multiple Providers

```typescript
async function streamWithProvider(provider: string, model: string, message: string) {
    robota.setCurrentAI(provider, model);
    console.log(`\n--- ${provider.toUpperCase()} (${model}) ---`);
    
    const stream = await robota.runStream(message);
    for await (const chunk of stream) {
        process.stdout.write(chunk.content || '');
    }
    console.log('\n');
}

const message = 'Write a haiku about programming';

// Stream responses from all providers
await streamWithProvider('openai', 'gpt-4', message);
await streamWithProvider('anthropic', 'claude-3-5-sonnet-20241022', message);
await streamWithProvider('google', 'gemini-1.5-pro', message);
```

## Provider-Specific Optimizations

### OpenAI - Function Calling Excellence

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { z } from 'zod';

const calculatorTool = createZodFunctionToolProvider({
    tools: {
        calculate: {
            name: 'calculate',
            description: 'Perform mathematical calculations',
            parameters: z.object({
                expression: z.string().describe('Mathematical expression to evaluate')
            }),
            handler: async ({ expression }) => {
                return { result: eval(expression) };
            }
        }
    }
});

// OpenAI excels at function calling
robota.setCurrentAI('openai', 'gpt-4');
const robotaWithTools = new Robota({
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    toolProviders: [calculatorTool],
    systemPrompt: 'Use the calculator tool for mathematical operations.'
});

const result = await robotaWithTools.run('Calculate (15 * 7) + (9 / 3)');
```

### Anthropic - Long Context and Analysis

```typescript
// Anthropic excels at long context and detailed analysis
robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');

const longText = `
[Insert a very long document here...]
`;

const analysisPrompt = `Please analyze the following document and provide:
1. A comprehensive summary
2. Key themes and insights
3. Potential implications

Document:
${longText}`;

const analysis = await robota.run(analysisPrompt);
```

### Google - Multimodal Capabilities

```typescript
// Google excels at multimodal understanding
robota.setCurrentAI('google', 'gemini-1.5-pro');

// Note: Image handling would require additional setup
const multimodalPrompt = `Analyze this data and provide insights about trends and patterns.`;
const dataAnalysis = await robota.run(multimodalPrompt);
```

## Comparing Provider Responses

```typescript
async function compareProviders(question: string) {
    const providers = [
        { name: 'openai', model: 'gpt-4' },
        { name: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
        { name: 'google', model: 'gemini-1.5-pro' }
    ];

    const responses = [];

    for (const provider of providers) {
        robota.setCurrentAI(provider.name, provider.model);
        const response = await robota.run(question);
        responses.push({
            provider: provider.name,
            model: provider.model,
            response
        });
    }

    return responses;
}

// Compare responses
const question = 'What are the key principles of good software architecture?';
const comparison = await compareProviders(question);

comparison.forEach(({ provider, model, response }) => {
    console.log(`\n--- ${provider.toUpperCase()} (${model}) ---`);
    console.log(response);
});
```

## Error Handling and Fallbacks

```typescript
async function askWithFallback(question: string) {
    const providers = ['openai', 'anthropic', 'google'];
    
    for (const provider of providers) {
        try {
            robota.setCurrentAI(provider, getDefaultModel(provider));
            const response = await robota.run(question);
            console.log(`Success with ${provider}: ${response}`);
            return response;
        } catch (error) {
            console.log(`Failed with ${provider}: ${error.message}`);
            continue;
        }
    }
    
    throw new Error('All providers failed');
}

function getDefaultModel(provider: string): string {
    switch (provider) {
        case 'openai': return 'gpt-4';
        case 'anthropic': return 'claude-3-5-sonnet-20241022';
        case 'google': return 'gemini-1.5-pro';
        default: throw new Error(`Unknown provider: ${provider}`);
    }
}

// Use with fallback
try {
    const response = await askWithFallback('Explain machine learning');
} catch (error) {
    console.error('All providers failed:', error.message);
}
```

## Provider Selection Strategy

```typescript
class ProviderSelector {
    selectProvider(taskType: string): { provider: string; model: string } {
        switch (taskType) {
            case 'function-calling':
                return { provider: 'openai', model: 'gpt-4' };
            
            case 'long-analysis':
                return { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' };
            
            case 'creative-writing':
                return { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' };
            
            case 'code-generation':
                return { provider: 'openai', model: 'gpt-4' };
            
            case 'data-analysis':
                return { provider: 'google', model: 'gemini-1.5-pro' };
            
            default:
                return { provider: 'openai', model: 'gpt-4' };
        }
    }
}

// Usage
const selector = new ProviderSelector();

async function handleTask(taskType: string, content: string) {
    const { provider, model } = selector.selectProvider(taskType);
    robota.setCurrentAI(provider, model);
    
    console.log(`Using ${provider}/${model} for ${taskType}`);
    return await robota.run(content);
}

// Examples
await handleTask('function-calling', 'Calculate the area of a circle with radius 5');
await handleTask('long-analysis', 'Analyze this 50-page research paper...');
await handleTask('creative-writing', 'Write a short story about time travel');
```

## Environment Variables

Make sure to set up your environment variables:

```bash
# .env file
OPENAI_API_KEY=your_openai_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
```

## Best Practices

1. **Provider Selection**: Choose providers based on their strengths
   - OpenAI: Function calling, code generation
   - Anthropic: Long context, analysis, creative writing
   - Google: Multimodal, data analysis

2. **Error Handling**: Always implement fallbacks when using multiple providers

3. **Cost Optimization**: Consider token costs when selecting providers and models

4. **Performance**: Some providers may be faster for certain types of tasks

5. **Context Management**: Each provider switch creates a new conversation context

## Complete Example

```typescript
import dotenv from 'dotenv';
dotenv.config();

async function main() {
    // Setup (as shown above)
    const robota = new Robota({
        aiProviders: {
            openai: openaiProvider,
            anthropic: anthropicProvider,
            google: googleProvider
        },
        currentProvider: 'openai',
        currentModel: 'gpt-4'
    });

    // Different tasks with different providers
    console.log('=== OpenAI for Code Generation ===');
    robota.setCurrentAI('openai', 'gpt-4');
    const code = await robota.run('Write a TypeScript function to reverse a string');
    console.log(code);

    console.log('\n=== Anthropic for Analysis ===');
    robota.setCurrentAI('anthropic', 'claude-3-5-sonnet-20241022');
    const analysis = await robota.run('Analyze the pros and cons of microservices architecture');
    console.log(analysis);

    console.log('\n=== Google for Creative Task ===');
    robota.setCurrentAI('google', 'gemini-1.5-pro');
    const creative = await robota.run('Write a creative product description for a smart watch');
    console.log(creative);
}

main().catch(console.error);
```

This demonstrates the flexibility and power of using multiple AI providers with Robota SDK, allowing you to leverage the best capabilities of each provider for different tasks. 