/**
 * 01-simple-conversation.ts
 * 
 * This example demonstrates the most basic usage of Robota:
 * - Simple conversation using OpenAI client
 * - Message sending (run method)
 * - Streaming response (runStream method)
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    // Validate API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    // Create OpenAI client
    const openaiClient = new OpenAI({
        apiKey
    });

    // Create OpenAI Provider
    const openaiProvider = new OpenAIProvider(openaiClient);

    // Create Robota instance
    const robota = new Robota({
        aiProviders: {
            'openai': openaiProvider
        },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'You are a helpful AI assistant. Provide concise and useful responses.'
    });

    // Execute simple conversation
    console.log('===== Simple Conversation Example =====');

    const response1 = await robota.run('Hello! Please tell me about TypeScript.');
    console.log('Response: ', response1);

    // Streaming response example
    console.log('\n===== Streaming Response Example =====');
    console.log('Response: ');

    const stream = await robota.runStream('Please briefly explain the advantages of TypeScript.');

    for await (const chunk of stream) {
        process.stdout.write(chunk.content || '');
    }
    console.log('\n');
}

// Execute
main().catch(error => {
    console.error('Error occurred:', error);
}); 