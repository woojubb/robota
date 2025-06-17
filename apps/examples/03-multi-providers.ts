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