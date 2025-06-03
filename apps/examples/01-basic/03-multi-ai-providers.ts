/**
 * 03-multi-ai-providers.ts
 * 
 * This example demonstrates how to use multiple AI providers in Robota:
 * - Register multiple AI providers
 * - Set current provider and model to use
 * - Dynamically change provider and model
 * - User explicitly specifying provider and model
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        // Validate API key
        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client
        const openaiClient = new OpenAI({
            apiKey: openaiApiKey
        });

        // Create OpenAI Provider
        const openaiProvider = new OpenAIProvider(openaiClient);

        // Create Robota instance (register multiple providers initially)
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: 'You are a helpful AI assistant. Please briefly mention the AI model currently in use and answer the question.'
        });

        // 1. Check current settings
        console.log('===== Current AI Settings =====');
        const currentAI = robota.getCurrentAI();
        console.log(`Current Provider: ${currentAI.provider}`);
        console.log(`Current Model: ${currentAI.model}`);

        // 2. Conversation with current settings
        console.log('\n===== Conversation with GPT-3.5-Turbo =====');
        const response1 = await robota.run('Hello! Please briefly explain TypeScript.');
        console.log('Response:', response1);

        // 3. Change to different model
        console.log('\n===== Change Model to GPT-4 =====');
        robota.setCurrentAI('openai', 'gpt-4');
        const currentAI2 = robota.getCurrentAI();
        console.log(`Changed Provider: ${currentAI2.provider}`);
        console.log(`Changed Model: ${currentAI2.model}`);

        const response2 = await robota.run('Please answer the same question as before. Also tell me which model you are using.');
        console.log('Response:', response2);

        // 4. Streaming test
        console.log('\n===== Streaming Response Test =====');
        console.log('Response: ');
        const stream = await robota.runStream('Please briefly explain the differences between React and Vue.');

        for await (const chunk of stream) {
            process.stdout.write(chunk.content || '');
        }
        console.log('\n');

        // 5. Add new provider at runtime (example)
        console.log('\n===== Add Provider at Runtime =====');
        // If Anthropic was available:
        // const anthropicProvider = new AnthropicProvider(anthropicClient);
        // robota.addAIProvider('anthropic', anthropicProvider);

        // Add new OpenAI provider (with different settings)
        const anotherOpenaiProvider = new OpenAIProvider(openaiClient);
        robota.addAIProvider('openai-alternative', anotherOpenaiProvider);

        console.log('openai-alternative provider has been added.');
        console.log('Now you can use it like this:');
        console.log('robota.setCurrentAI("openai-alternative", "gpt-4o");');

    } catch (error) {
        console.error('Error occurred:', error);
    }
}

// Execute
main().catch(console.error); 