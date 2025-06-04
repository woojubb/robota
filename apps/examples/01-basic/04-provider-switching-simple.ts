/**
 * 04-provider-switching-simple.ts
 * 
 * This example demonstrates how to switch between different models within the OpenAI provider:
 * - Switch to different models within the same provider
 * - Compare response styles and characteristics of each model
 * - Verify if conversation history is maintained during model switches
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        // Check API key
        const openaiApiKey = process.env.OPENAI_API_KEY;

        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required.');
        }

        // Create OpenAI Client
        const openaiClient = new OpenAI({ apiKey: openaiApiKey });

        // Create OpenAI Provider
        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-3.5-turbo',
            temperature: 0.7
        });

        // Models to test
        const models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o-mini'];

        // Create Robota instance with increased token limit and no tools to avoid function calling issues
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: 'You are a helpful assistant that showcases the characteristics of each AI model. Please briefly mention the model name currently in use when responding.',
            maxTokenLimit: 8192,  // Increased token limit
            maxRequestLimit: 100
        });

        console.log('🤖 Starting Robota Model Switching Example!\n');

        // Test questions (simplified to avoid token issues)
        const testQuestions = [
            'Hello! What AI model are you? Please give a brief introduction.',
            'Please explain 3 main differences between TypeScript and JavaScript.',
            'Creative idea: Describe the future where space travel becomes commonplace.'
        ];

        // Test each question with all models (but reset conversation for each question to avoid token buildup)
        for (let i = 0; i < testQuestions.length; i++) {
            const question = testQuestions[i];
            console.log(`\n${'='.repeat(80)}`);
            console.log(`📝 Question ${i + 1}: ${question}`);
            console.log(`${'='.repeat(80)}\n`);

            // Get responses from each model (with fresh conversation)
            for (const model of models) {
                // Create a fresh robota instance for each model to avoid token accumulation
                const freshRobota = new Robota({
                    aiProviders: {
                        'openai': openaiProvider
                    },
                    currentProvider: 'openai',
                    currentModel: model,
                    systemPrompt: 'You are a helpful assistant that showcases the characteristics of each AI model. Please briefly mention the model name currently in use when responding.',
                    maxTokenLimit: 8192,
                    maxRequestLimit: 100
                });

                console.log(`🔄 Switching to ${model}...`);

                const currentAI = freshRobota.getCurrentAI();
                console.log(`   Provider: ${currentAI.provider}`);
                console.log(`   Model: ${currentAI.model}\n`);

                try {
                    // Measure response time
                    const startTime = Date.now();
                    const response = await freshRobota.run(question);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;

                    console.log(`💬 ${model} Response (${responseTime}ms):`);
                    console.log(`${response}\n`);
                    console.log(`${'-'.repeat(60)}\n`);

                } catch (error) {
                    console.error(`❌ ${model} Error:`, error);
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

        // Test if conversation history is maintained during model switches
        if (models.length >= 2) {
            // Create a fresh instance for continuity test
            const continuityRobota = new Robota({
                aiProviders: {
                    'openai': openaiProvider
                },
                currentProvider: 'openai',
                currentModel: models[0],
                systemPrompt: 'You are a helpful assistant that showcases the characteristics of each AI model. Please briefly mention the model name currently in use when responding.',
                maxTokenLimit: 8192,
                maxRequestLimit: 100
            });

            try {
                console.log(`🟢 Starting conversation with ${models[0]}:`);
                const response1 = await continuityRobota.run('Please remember my name as "John Smith". Hello!');
                console.log(`Response: ${response1}\n`);

                // Switch to second model and check if it remembers previous conversation
                continuityRobota.setCurrentAI('openai', models[1]);

                console.log(`🔄 After switching to ${models[1]}:`);
                const response2 = await continuityRobota.run('Do you remember what my name is?');
                console.log(`Response: ${response2}\n`);
            } catch (error) {
                console.log('Token limit check failed:', (error as Error).message);
                console.log('❌ Error occurred:', error);
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🏁 Streaming Response Test');
        console.log(`${'='.repeat(80)}\n`);

        // Streaming response test (with fresh instance)
        const streamingRobota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: 'You are a helpful assistant.',
            maxTokenLimit: 8192,
            maxRequestLimit: 100
        });

        console.log(`🌊 Streaming response with gpt-3.5-turbo:`);
        console.log('Question: Please write a short poem about the future of AI.\n');
        console.log('Streaming response: ');

        try {
            const stream = await streamingRobota.runStream('Please write a short poem about the future of AI.');
            for await (const chunk of stream) {
                process.stdout.write(chunk.content || '');
            }
            console.log('\n');
        } catch (error) {
            console.log(`❌ Streaming error: ${(error as Error).message}`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🔀 Dynamic Model Switching Demo');
        console.log(`${'='.repeat(80)}\n`);

        // Continuous conversation with dynamic model switching (fresh instance for each)
        const questions = [
            { question: 'Simple addition: What is 123 + 456?', model: 'gpt-3.5-turbo' },
            { question: 'Now solve this: What is the derivative of x^3 + 2x^2 - 5x + 1?', model: 'gpt-4' },
            { question: 'What is 2 + 2?', model: 'gpt-4o-mini' }
        ];

        for (const { question, model } of questions) {
            // Create fresh instance for each question to avoid token accumulation
            const freshRobota = new Robota({
                aiProviders: {
                    'openai': openaiProvider
                },
                currentProvider: 'openai',
                currentModel: model,
                systemPrompt: 'You are a helpful assistant.',
                maxTokenLimit: 8192,
                maxRequestLimit: 100
            });

            console.log(`🔄 Switching to ${model} for question:`);
            console.log(`❓ ${question}\n`);

            try {
                const response = await freshRobota.run(question);

                console.log(`💬 ${model} Response:`);
                console.log(`${response}\n`);
                console.log(`${'-'.repeat(60)}\n`);
            } catch (error) {
                console.log(`❌ ${model} Error: ${(error as Error).message}`);
                console.log(`${'-'.repeat(60)}\n`);
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('✅ All tests completed!');
        console.log('📊 Model characteristics summary:');
        console.log('   - gpt-3.5-turbo: Fast and efficient, suitable for general tasks');
        console.log('   - gpt-4: More accurate and complex reasoning, suitable for professional tasks');
        console.log('   - gpt-4o-mini: Balanced performance, versatile for various tasks');
        console.log(`${'='.repeat(80)}`);

    } catch (error) {
        console.error('❌ Error occurred:', error);
    }
}

// Execute
main().catch(console.error); 