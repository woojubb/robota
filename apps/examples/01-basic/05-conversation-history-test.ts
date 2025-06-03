/**
 * 05-conversation-history-test.ts
 * 
 * This example verifies that Robota's conversation history is properly accumulated sequentially:
 * - Check if user messages and assistant responses are added in correct order
 * - Verify history state after multiple conversations
 * - Confirm history preservation during provider switches
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// History checking function
function printHistory(robota: Robota, step: string) {
    const history = (robota as any).conversationHistory;
    const messages = history.getMessages();
    console.log(`\n📋 ${step} - Current conversation history (${messages.length} messages):`);
    messages.forEach((msg: any, index: number) => {
        console.log(`  ${index + 1}. [${msg.role}] ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
    });
    console.log('');
}

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

        // Create Robota instance
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: 'You are an assistant for conversation history testing. Please respond simply and clearly.'
        });

        console.log('🧪 Starting conversation history test!\n');

        // Check initial state
        printHistory(robota, 'Initial state');

        // First conversation
        console.log('🗣️  Asking first question...');
        const response1 = await robota.run('Hello! I am John Smith.');
        console.log(`💬 Response: ${response1}`);
        printHistory(robota, 'After first conversation');

        // Second conversation
        console.log('🗣️  Asking second question...');
        const response2 = await robota.run('Do you remember my name?');
        console.log(`💬 Response: ${response2}`);
        printHistory(robota, 'After second conversation');

        // Third conversation
        console.log('🗣️  Asking third question...');
        const response3 = await robota.run('How is the weather today?');
        console.log(`💬 Response: ${response3}`);
        printHistory(robota, 'After third conversation');

        console.log(`\n${'='.repeat(80)}`);
        console.log('🔄 Provider Switch Test');
        console.log(`${'='.repeat(80)}\n`);

        // Model switching within same provider
        console.log('🔄 Switching to gpt-4 model...');
        robota.setCurrentAI('openai', 'gpt-4');
        printHistory(robota, 'After model switch (gpt-4)');

        console.log('🗣️  Question after model switch...');
        const response4 = await robota.run('Please summarize our previous conversation.');
        console.log(`💬 Response: ${response4}`);
        printHistory(robota, 'Conversation after model switch');

        console.log(`\n${'='.repeat(80)}`);
        console.log('🚨 Simulating Incorrect Usage (Repeated Same Question)');
        console.log(`${'='.repeat(80)}\n`);

        // Problematic pattern: sending same question multiple times
        const sameQuestion = 'This is a test question.';

        console.log('⚠️  Sending the same question 3 times in a row...');

        for (let i = 1; i <= 3; i++) {
            console.log(`🗣️  ${i}th same question: "${sameQuestion}"`);
            const response = await robota.run(sameQuestion);
            console.log(`💬 Response ${i}: ${response.substring(0, 100)}...`);
            printHistory(robota, `After ${i}th same question`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🎯 Correct Usage: Different Questions');
        console.log(`${'='.repeat(80)}\n`);

        // Clear history
        console.log('🧹 Clearing conversation history...');
        robota.clearConversationHistory();
        printHistory(robota, 'After history clear');

        // Different questions
        const questions = [
            'Hello!',
            'What are you doing today?',
            'Tell me about TypeScript.',
            'Thank you!'
        ];

        for (let i = 0; i < questions.length; i++) {
            console.log(`🗣️  Question ${i + 1}: "${questions[i]}"`);
            const response = await robota.run(questions[i]);
            console.log(`💬 Response ${i + 1}: ${response.substring(0, 100)}...`);
            printHistory(robota, `After question ${i + 1}`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('✅ Test completed!');
        console.log('📊 Conclusion:');
        console.log('   - Each robota.run() call adds user message to history');
        console.log('   - Sending same question multiple times creates duplicates in history');
        console.log('   - History is preserved during provider/model switches');
        console.log('   - History management is needed when comparing multiple providers');
        console.log(`${'='.repeat(80)}`);

    } catch (error) {
        console.error('❌ Error occurred:', error);
    }
}

// Execute
main().catch(console.error); 