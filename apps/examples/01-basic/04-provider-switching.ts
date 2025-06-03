/**
 * 04-provider-switching.ts
 * 
 * This example demonstrates how to switch between multiple AI providers and compare responses to the same question:
 * - Register multiple AI providers simultaneously (OpenAI, Anthropic, Google)
 * - Switch between each provider and ask the same question
 * - Compare response styles and characteristics of each provider
 * - Verify if conversation history is maintained during provider switches
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        // Check API keys
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        const googleApiKey = process.env.GOOGLE_API_KEY;

        if (!openaiApiKey) {
            console.log('⚠️  OpenAI provider will be skipped due to missing OPENAI_API_KEY.');
        }
        if (!anthropicApiKey) {
            console.log('⚠️  Anthropic provider will be skipped due to missing ANTHROPIC_API_KEY.');
        }
        if (!googleApiKey) {
            console.log('⚠️  Google provider will be skipped due to missing GOOGLE_API_KEY.');
        }

        // Available providers and model settings
        const aiProviders: Record<string, any> = {};
        const providerModels: Record<string, string> = {};

        // Create OpenAI Provider
        if (openaiApiKey) {
            const openaiClient = new OpenAI({ apiKey: openaiApiKey });
            aiProviders['openai'] = new OpenAIProvider({
                client: openaiClient,
                model: 'gpt-4',
                temperature: 0.7
            });
            providerModels['openai'] = 'gpt-4';
        }

        // Create Anthropic Provider
        if (anthropicApiKey) {
            const anthropicClient = new Anthropic({ apiKey: anthropicApiKey });
            aiProviders['anthropic'] = new AnthropicProvider({
                client: anthropicClient,
                model: 'claude-3-5-sonnet-20241022',
                temperature: 0.7
            });
            providerModels['anthropic'] = 'claude-3-5-sonnet-20241022';
        }

        // Create Google Provider
        if (googleApiKey) {
            const googleClient = new GoogleGenerativeAI(googleApiKey);
            aiProviders['google'] = new GoogleProvider({
                client: googleClient,
                model: 'gemini-1.5-pro',
                temperature: 0.7
            });
            providerModels['google'] = 'gemini-1.5-pro';
        }

        if (Object.keys(aiProviders).length === 0) {
            throw new Error('No AI providers available. Please set at least one API key.');
        }

        // Set the first provider as default
        const firstProviderName = Object.keys(aiProviders)[0];

        // Create Robota instance
        const robota = new Robota({
            aiProviders,
            currentProvider: firstProviderName,
            currentModel: providerModels[firstProviderName],
            systemPrompt: 'You are a helpful assistant that showcases the characteristics of each AI model. Please briefly mention which model you are when responding.'
        });

        console.log('🤖 Starting Robota Provider Switching Example!\n');

        // Test questions
        const testQuestions = [
            'Hello! What AI model are you? Please give a brief introduction.',
            'Please explain 3 advantages of functional programming.',
            'Creative idea: What will future cities look like?'
        ];

        // Test each question with all providers
        for (let i = 0; i < testQuestions.length; i++) {
            const question = testQuestions[i];
            console.log(`\n${'='.repeat(80)}`);
            console.log(`📝 Question ${i + 1}: ${question}`);
            console.log(`${'='.repeat(80)}\n`);

            // Get responses from each provider
            for (const providerName of Object.keys(aiProviders)) {
                console.log(`🔄 Switching to ${providerName.toUpperCase()} Provider...`);

                // Switch provider and model
                robota.setCurrentAI(providerName, providerModels[providerName]);

                const currentAI = robota.getCurrentAI();
                console.log(`   Provider: ${currentAI.provider}`);
                console.log(`   Model: ${currentAI.model}\n`);

                try {
                    // Measure response time
                    const startTime = Date.now();
                    const response = await robota.run(question);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;

                    console.log(`💬 ${providerName.toUpperCase()} Response (${responseTime}ms):`);
                    console.log(`${response}\n`);
                    console.log(`${'-'.repeat(60)}\n`);

                } catch (error) {
                    console.error(`❌ ${providerName.toUpperCase()} Error:`, error);
                    console.log(`${'-'.repeat(60)}\n`);
                }
            }

            // Wait between questions
            if (i < testQuestions.length - 1) {
                console.log('⏳ Waiting for next question...\n');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🎯 Conversation History Continuity Test');
        console.log(`${'='.repeat(80)}\n`);

        // Test if conversation history is maintained during provider switches
        const availableProviders = Object.keys(aiProviders);
        if (availableProviders.length >= 2) {
            // Start conversation with first provider
            const firstProvider = availableProviders[0];
            robota.setCurrentAI(firstProvider, providerModels[firstProvider]);

            console.log(`🟢 Starting conversation with ${firstProvider.toUpperCase()}:`);
            const response1 = await robota.run('Please remember my name as "John Smith". Hello!');
            console.log(`Response: ${response1}\n`);

            // Switch to second provider and check if it remembers previous conversation
            const secondProvider = availableProviders[1];
            robota.setCurrentAI(secondProvider, providerModels[secondProvider]);

            console.log(`🔄 After switching to ${secondProvider.toUpperCase()}:`);
            const response2 = await robota.run('Do you remember what my name is?');
            console.log(`Response: ${response2}\n`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🏁 Streaming Response Test');
        console.log(`${'='.repeat(80)}\n`);

        // Streaming response test (with first available provider)
        const streamingProvider = Object.keys(aiProviders)[0];
        robota.setCurrentAI(streamingProvider, providerModels[streamingProvider]);

        console.log(`🌊 Streaming response with ${streamingProvider.toUpperCase()}:`);
        console.log('Question: Please briefly explain the future of artificial intelligence.\n');
        console.log('Streaming response: ');

        const stream = await robota.runStream('Please briefly explain the future of artificial intelligence.');
        for await (const chunk of stream) {
            process.stdout.write(chunk.content || '');
        }
        console.log('\n');

        console.log(`\n${'='.repeat(80)}`);
        console.log('✅ All tests completed!');
        console.log(`${'='.repeat(80)}`);

    } catch (error) {
        console.error('❌ Error occurred:', error);
    }
}

// Execute
main().catch(console.error); 