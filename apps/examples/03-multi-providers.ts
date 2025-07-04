/**
 * 03-multi-providers.ts
 * 
 * This example demonstrates using multiple AI providers:
 * - OpenAI with different models
 * - Comparing responses from different models
 * - Provider switching capabilities
 * - Independent agent instances
 */

import OpenAI from 'openai';
import { Robota, type AIProvider } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables from examples directory
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
        console.log('🌐 Multi-Provider Example Started...\n');

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
            name: 'GPT35Agent',
            model: 'gpt-3.5-turbo',
            provider: 'openai',
            aiProviders: { openai: openai35Provider } as Record<string, AIProvider>,
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
            name: 'GPT4MiniAgent',
            model: 'gpt-4o-mini',
            provider: 'openai',
            aiProviders: { openai: openai4MiniProvider } as Record<string, AIProvider>,
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemMessage: 'You are a helpful assistant powered by OpenAI GPT-4o-mini. Be detailed and mention that you are GPT-4o-mini.'
        });

        await testProvider('OpenAI GPT-4o-mini', robota4Mini, 'Hello! Please tell me about artificial intelligence in 2-3 sentences.');

        // === Test different model comparison ===
        console.log(`\n${'='.repeat(50)}`);
        console.log('🔄 Testing Model Comparison');
        console.log(`${'='.repeat(50)}`);

        // Optimize queries for minimal token usage
        const testQueries = ['What is AI?']; // Single short query

        for (const query of testQueries) {
            console.log(`\n📝 Query: ${query}`);

            console.log('\n🤖 GPT-3.5-turbo:');
            try {
                const response35 = await robota35.run(query);
                console.log(response35);
            } catch (error) {
                console.error('Error:', error);
            }

            console.log('\n🧠 GPT-4o-mini:');
            try {
                const response4 = await robota4Mini.run(query);
                console.log(response4);
            } catch (error) {
                console.error('Error:', error);
            }

            console.log('\n' + '-'.repeat(40));
        }

        // === Show Agent Statistics ===
        console.log('\n📊 Agent Comparison:');

        const stats35 = robota35.getStats();
        console.log(`\nGPT-3.5 Agent (${stats35.name}):`);
        console.log(`- History length: ${stats35.historyLength}`);
        console.log(`- Current provider: ${stats35.currentProvider}`);
        console.log(`- Uptime: ${Math.round(stats35.uptime)}ms`);

        const stats4 = robota4Mini.getStats();
        console.log(`\nGPT-4o-mini Agent (${stats4.name}):`);
        console.log(`- History length: ${stats4.historyLength}`);
        console.log(`- Current provider: ${stats4.currentProvider}`);
        console.log(`- Uptime: ${Math.round(stats4.uptime)}ms`);

        console.log('\n✅ Multi-Provider Example Completed!');
        console.log('\n💡 To test other providers (Anthropic, Google AI):');
        console.log('   - Set ANTHROPIC_API_KEY environment variable');
        console.log('   - Set GOOGLE_AI_API_KEY environment variable');
        console.log('   - Import @robota-sdk/anthropic and @robota-sdk/google packages');

        // Clean up resources
        await robota35.destroy();
        await robota4Mini.destroy();

        // Ensure process exits cleanly
        console.log('🧹 Cleanup completed. Exiting...');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error occurred:', error);
        if (error instanceof Error) {
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}

// Execute
main(); 