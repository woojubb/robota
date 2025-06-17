/**
 * 01-basic-conversation.ts
 * 
 * This example demonstrates the most basic usage of Robota:
 * - Simple conversation using OpenAI
 * - Message sending and streaming responses
 * - Proper error handling
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
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
            client: openaiClient,
            model: 'gpt-3.5-turbo'
        });

        // Create Robota instance
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: 'You are a helpful AI assistant. Provide concise and useful responses.'
        });

        // === Simple Conversation ===
        console.log('📝 Simple Conversation:');
        const query = 'Hello! Please tell me about TypeScript in 2-3 sentences.';
        console.log(`User: ${query}`);

        const response = await robota.run(query);
        console.log(`Assistant: ${response}\n`);

        // === Streaming Response ===
        console.log('🌊 Streaming Response:');
        const streamQuery = 'What are the main benefits of using TypeScript?';
        console.log(`User: ${streamQuery}`);
        console.log('Assistant: ');

        const stream = await robota.runStream(streamQuery);
        for await (const chunk of stream) {
            process.stdout.write(chunk.content || '');
        }
        console.log('\n');

        console.log('✅ Basic Conversation Example Completed!');

        // Clean up resources
        await robota.close();
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main(); 