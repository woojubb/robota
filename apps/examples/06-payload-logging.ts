/**
 * Payload Logging Example
 * 
 * This example demonstrates how to enable API payload logging
 * to save OpenAI API request payloads to files for debugging
 * and monitoring purposes.
 */

import 'dotenv/config';
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Define a simple tool for demonstration
const tools = {
    getCurrentTime: {
        name: 'getCurrentTime',
        description: 'Get the current time',
        parameters: z.object({
            timezone: z.string().optional().describe('Timezone (e.g., "UTC", "America/New_York")')
        }),
        handler: async (params: { timezone?: string }) => {
            const now = new Date();
            const timeString = params.timezone
                ? now.toLocaleString('en-US', { timeZone: params.timezone })
                : now.toLocaleString();

            console.log(`[Tool] Current time: ${timeString}`);
            return { currentTime: timeString, timezone: params.timezone || 'local' };
        }
    }
};

async function main() {
    try {
        console.log('📁 Payload Logging Example Started...\n');

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client
        const openaiClient = new OpenAI({ apiKey });

        // Create tool provider
        const toolProvider = createZodFunctionToolProvider({ tools });

        // === Test 1: Basic payload logging ===
        console.log('🔍 Test 1: Basic Payload Logging');
        console.log('='.repeat(50));

        const basicProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini',
            temperature: 0.7,
            maxTokens: 1000,
            enablePayloadLogging: true,  // Enable payload logging
            payloadLogDir: './logs/basic-payloads',
            includeTimestampInLogFiles: true
        });

        const basicRobota = new Robota({
            aiProviders: { openai: basicProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemPrompt: 'You are a helpful assistant that logs all API calls.'
        });

        console.log('\n📤 Making API call (will be logged)...');
        const basicResponse = await basicRobota.run('Hello! Tell me a fun fact about space.');
        console.log('\n✅ Response received:', basicResponse.substring(0, 100) + '...');

        // === Test 2: Payload logging with tools ===
        console.log('\n\n🛠️  Test 2: Payload Logging with Tools');
        console.log('='.repeat(50));

        const toolProvider2 = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,
            payloadLogDir: './logs/tool-payloads',
            includeTimestampInLogFiles: true
        });

        const toolRobota = new Robota({
            aiProviders: { openai: toolProvider2 },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            toolProviders: [toolProvider],
            systemPrompt: 'You are a helpful assistant. Use tools when appropriate.',
            debug: true
        });

        console.log('\n📤 Making API call with tools (will be logged)...');
        const toolResponse = await toolRobota.run('What is the current time in New York?');
        console.log('\n✅ Tool response received:', toolResponse.substring(0, 100) + '...');

        // === Test 3: Streaming with payload logging ===
        console.log('\n\n🌊 Test 3: Streaming with Payload Logging');
        console.log('='.repeat(50));

        const streamProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,
            payloadLogDir: './logs/stream-payloads',
            includeTimestampInLogFiles: true
        });

        const streamRobota = new Robota({
            aiProviders: { openai: streamProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemPrompt: 'You are a helpful assistant that provides streaming responses.'
        });

        console.log('\n📤 Making streaming API call (will be logged)...');
        const stream = await streamRobota.runStream('Tell me a short story about a robot learning to code.');

        console.log('\n📡 Streaming response:');
        let streamContent = '';
        for await (const chunk of stream) {
            if (chunk.content) {
                process.stdout.write(chunk.content);
                streamContent += chunk.content;
            }
        }

        console.log('\n\n✅ Streaming completed. Total length:', streamContent.length);

        // === Test 4: Disabled logging ===
        console.log('\n\n🚫 Test 4: Disabled Payload Logging');
        console.log('='.repeat(50));

        const noLogProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini',
            enablePayloadLogging: false  // Logging disabled
        });

        const noLogRobota = new Robota({
            aiProviders: { openai: noLogProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemPrompt: 'You are a helpful assistant without logging.'
        });

        console.log('\n📤 Making API call (will NOT be logged)...');
        const noLogResponse = await noLogRobota.run('Tell me about artificial intelligence.');
        console.log('\n✅ Response received (no log file created):', noLogResponse.substring(0, 100) + '...');

        console.log('\n\n🎉 Payload logging demonstration completed!');
        console.log('📁 Check the ./logs/ directory for saved payload files.');
        console.log('💡 Each log file contains the complete API request payload sent to OpenAI.');

    } catch (error) {
        console.error('\n❌ Error in payload logging example:', error);
        process.exit(1);
    }
}

// Auto-run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main()
        .then(() => {
            console.log('\n✅ Example completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Example failed:', error);
            process.exit(1);
        });
}

export { main }; 