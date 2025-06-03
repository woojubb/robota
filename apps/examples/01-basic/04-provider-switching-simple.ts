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

        // Create Robota instance
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: 'You are a helpful assistant that showcases the characteristics of each AI model. Please briefly mention the model name currently in use when responding.'
        });

        console.log('🤖 Starting Robota Model Switching Example!\n');

        // Test questions
        const testQuestions = [
            'Hello! What AI model are you? Please give a brief introduction.',
            'Please explain 3 main differences between TypeScript and JavaScript.',
            'Creative idea: Describe the future where space travel becomes commonplace.'
        ];

        // Test each question with all models
        for (let i = 0; i < testQuestions.length; i++) {
            const question = testQuestions[i];
            console.log(`\n${'='.repeat(80)}`);
            console.log(`📝 Question ${i + 1}: ${question}`);
            console.log(`${'='.repeat(80)}\n`);

            // Get responses from each model
            for (const model of models) {
                console.log(`🔄 Switching to ${model}...`);

                // Switch model
                robota.setCurrentAI('openai', model);

                const currentAI = robota.getCurrentAI();
                console.log(`   Provider: ${currentAI.provider}`);
                console.log(`   Model: ${currentAI.model}\n`);

                try {
                    // Measure response time
                    const startTime = Date.now();
                    const response = await robota.run(question);
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
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🎯 Conversation History Continuity Test');
        console.log(`${'='.repeat(80)}\n`);

        // Test if conversation history is maintained during model switches
        if (models.length >= 2) {
            // Start conversation with first model
            robota.setCurrentAI('openai', models[0]);

            console.log(`🟢 Starting conversation with ${models[0]}:`);
            const response1 = await robota.run('Please remember my name as "John Smith". Hello!');
            console.log(`Response: ${response1}\n`);

            // Switch to second model and check if it remembers previous conversation
            robota.setCurrentAI('openai', models[1]);

            console.log(`🔄 After switching to ${models[1]}:`);
            const response2 = await robota.run('Do you remember what my name is?');
            console.log(`Response: ${response2}\n`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🏁 Streaming Response Test');
        console.log(`${'='.repeat(80)}\n`);

        // Streaming response test (with fastest model)
        robota.setCurrentAI('openai', 'gpt-3.5-turbo');

        console.log(`🌊 Streaming response with gpt-3.5-turbo:`);
        console.log('Question: Please write a short poem about the future of AI.\n');
        console.log('Streaming response: ');

        const stream = await robota.runStream('Please write a short poem about the future of AI.');
        for await (const chunk of stream) {
            process.stdout.write(chunk.content || '');
        }
        console.log('\n');

        console.log(`\n${'='.repeat(80)}`);
        console.log('🔀 Dynamic Model Switching Demo');
        console.log(`${'='.repeat(80)}\n`);

        // Continuous conversation with dynamic model switching
        const questions = [
            { question: 'Simple addition: What is 123 + 456?', model: 'gpt-3.5-turbo' },
            { question: 'Now I will give you a complex math problem. Use calculus to find the derivative of x^3 + 2x^2 - 5x + 1 and calculate its value at x=2.', model: 'gpt-4' },
            { question: 'Please verify if the previous calculation is correct.', model: 'gpt-4o-mini' }
        ];

        for (const { question, model } of questions) {
            console.log(`🔄 Switching to ${model} for question:`);
            console.log(`❓ ${question}\n`);

            robota.setCurrentAI('openai', model);
            const response = await robota.run(question);

            console.log(`💬 ${model} Response:`);
            console.log(`${response}\n`);
            console.log(`${'-'.repeat(60)}\n`);
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