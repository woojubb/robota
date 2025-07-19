/**
 * 06-payload-logging.ts
 * 
 * Simplified Payload Logging Example
 * This example demonstrates how to enable API payload logging
 * to save OpenAI API request payloads to files for debugging.
 */

import 'dotenv/config';
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

async function main() {
    try {
        console.log('📁 Payload Logging Example Started...\\n');

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // === Test 1: Basic payload logging ===
        console.log('🔍 Test 1: Basic Payload Logging');
        console.log('='.repeat(50));

        const basicProvider = new OpenAIProvider({
            apiKey,
            enablePayloadLogging: true,  // Enable payload logging
            payloadLogDir: './logs/basic-payloads',
            includeTimestampInLogFiles: true
        });

        const basicRobota = new Robota({
            name: 'PayloadLogger',
            aiProviders: [basicProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                systemMessage: 'You are a helpful assistant that logs all API calls.'
            }
        });

        console.log('\\n📤 Making API call (will be logged)...');
        const basicResponse = await basicRobota.run('Hello! Tell me a fun fact about space.');
        console.log('\\n✅ Response received:', basicResponse.substring(0, 100) + '...');

        // === Test 2: Disabled logging ===
        console.log('\\n\\n🚫 Test 2: Disabled Payload Logging');
        console.log('='.repeat(50));

        const noLogProvider = new OpenAIProvider({
            apiKey,
            enablePayloadLogging: false  // Logging disabled
        });

        const noLogRobota = new Robota({
            name: 'NoLogger',
            aiProviders: [noLogProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                systemMessage: 'You are a helpful assistant without logging.'
            }
        });

        console.log('\\n📤 Making API call (will NOT be logged)...');
        const noLogResponse = await noLogRobota.run('Tell me about artificial intelligence.');
        console.log('\\n✅ Response received (no log file created):', noLogResponse.substring(0, 100) + '...');

        console.log('\\n\\n🎉 Payload logging demonstration completed!');
        console.log('📁 Check the ./logs/ directory for saved payload files.');
        console.log('💡 Each log file contains the complete API request payload sent to OpenAI.');

    } catch (error) {
        console.error('\\n❌ Error in payload logging example:', error);
        process.exit(1);
    }
}

// Auto-run when executed directly
main()
    .then(() => {
        console.log('\\n✅ Example completed successfully');
        console.log('🧹 Cleanup completed. Exiting...');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\\n❌ Example failed:', error);
        process.exit(1);
    });