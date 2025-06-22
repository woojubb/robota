/**
 * 01-basic-conversation.ts
 * 
 * This example demonstrates the most basic usage of Robota:
 * - Simple conversation using OpenAI
 * - Message sending and responses
 * - Proper error handling
 */

import { Robota, OpenAIProvider } from '@robota-sdk/agents';
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
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemMessage: 'You are a helpful AI assistant. Provide concise and useful responses.'
        });

        // === Simple Conversation ===
        console.log('📝 Simple Conversation:');
        const query = 'Hello! Please tell me about TypeScript in 2-3 sentences.';
        console.log(`User: ${query}`);

        const response = await robota.run(query);
        console.log(`Assistant: ${response}\n`);

        // === Another Query ===
        console.log('📝 Another Question:');
        const query2 = 'What are the main benefits of using TypeScript?';
        console.log(`User: ${query2}`);

        const response2 = await robota.run(query2);
        console.log(`Assistant: ${response2}\n`);

        console.log('✅ Basic Conversation Example Completed!');

        // Clean up resources
        await robota.destroy();
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main(); 