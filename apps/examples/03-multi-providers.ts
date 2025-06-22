/**
 * 03-multi-providers.ts
 * 
 * This example demonstrates using multiple AI providers:
 * - OpenAI with different models
 * - Comparing responses from different models
 * - Provider switching capabilities
 */

import { Robota, OpenAIProvider } from '@robota-sdk/agents';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function testProvider(providerName: string, robota: Robota, query: string) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`🤖 Testing ${providerName.toUpperCase()} Provider`);
    console.log(`${'='.repeat(50)}`);
    console.log(`User: ${query}`);

    try {
        const response = await robota.run(query);
        console.log(`Assistant: ${response}`);
    } catch (error) {
        console.error(`❌ Error with ${providerName}:`, error);
    }
}

async function main() {
    try {
        console.log('🌐 Multi-Provider Example Started...\\n');

        // Validate API key
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required for this example');
        }

        // Create OpenAI client
        const openaiClient = new OpenAI({ apiKey: openaiKey });

        // === OpenAI GPT-3.5-turbo Provider Test ===
        const openai35Provider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-3.5-turbo'
        });

        const robota35 = new Robota({
            aiProviders: { openai: openai35Provider },
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemMessage: 'You are a helpful assistant powered by OpenAI GPT-3.5. Be concise and mention that you are GPT-3.5.'
        });

        await testProvider('OpenAI GPT-3.5', robota35, 'Hello! Please tell me about artificial intelligence in 2-3 sentences.');

        // === OpenAI GPT-4o-mini Provider Test ===
        const openai4MiniProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini'
        });

        const robota4Mini = new Robota({
            aiProviders: { openai: openai4MiniProvider },
            provider: 'openai',
            model: 'gpt-4o-mini',
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemMessage: 'You are a helpful assistant powered by OpenAI GPT-4o-mini. Be detailed and mention that you are GPT-4o-mini.'
        });

        await testProvider('OpenAI GPT-4o-mini', robota4Mini, 'Hello! Please tell me about artificial intelligence in 2-3 sentences.');

        // === Test different model comparison ===
        console.log(`\\n${'='.repeat(50)}`);
        console.log('🔄 Testing Model Comparison');
        console.log(`${'='.repeat(50)}`);

        const testQueries = [
            'What are the main benefits of renewable energy?',
            'Explain quantum computing in simple terms.',
            'What is the future of artificial intelligence?'
        ];

        for (const query of testQueries) {
            console.log(`\\n📝 Query: ${query}`);

            console.log('\\n🤖 GPT-3.5-turbo:');
            try {
                const response35 = await robota35.run(query);
                console.log(response35);
            } catch (error) {
                console.error('Error:', error);
            }

            console.log('\\n🧠 GPT-4o-mini:');
            try {
                const response4 = await robota4Mini.run(query);
                console.log(response4);
            } catch (error) {
                console.error('Error:', error);
            }

            console.log('\\n' + '-'.repeat(40));
        }

        console.log('\\n✅ Multi-Provider Example Completed!');
        console.log('\\n💡 To test other providers (Anthropic, Google AI):');
        console.log('   - Set ANTHROPIC_API_KEY environment variable');
        console.log('   - Set GOOGLE_AI_API_KEY environment variable');
        console.log('   - Import @robota-sdk/anthropic and @robota-sdk/google packages');

        // Clean up resources
        await robota35.destroy();
        await robota4Mini.destroy();
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main(); 