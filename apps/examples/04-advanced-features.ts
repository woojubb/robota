/**
 * 04-advanced-features.ts
 * 
 * This example demonstrates advanced Robota features:
 * - LoggingPlugin for detailed logging
 * - Custom system messages
 * - Multiple queries with history
 */

import OpenAI from 'openai';
import {
    Robota,
    LoggingPlugin
} from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables from examples directory
dotenv.config();

async function main() {
    try {
        console.log('⚡ Advanced Features Example Started...\n');

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client and provider
        const openaiClient = new OpenAI({ apiKey });
        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-3.5-turbo'
        });

        // Create advanced plugins
        const loggingPlugin = new LoggingPlugin({
            level: 'info',
            strategy: 'console'
        });

        // === Advanced Configuration ===
        const robota = new Robota({
            name: 'AdvancedAgent',
            model: 'gpt-3.5-turbo',
            provider: 'openai',
            aiProviders: { openai: openaiProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemMessage: 'You are an advanced AI assistant with detailed analytical capabilities. Provide comprehensive and well-structured responses.',
            plugins: [loggingPlugin] // Add plugins for advanced features
        });

        // === Conversation History Demo ===
        console.log('💬 Advanced Conversation Demo');
        console.log('='.repeat(40));

        // Use minimal queries for token efficiency
        const queries = [
            'What is AI?',
            'Tell me about ML.'
        ]; // Minimal queries always

        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`\n${i + 1}. User: ${query}`);

            const startTime = Date.now();
            const response = await robota.run(query);
            const duration = Date.now() - startTime;

            console.log(`   Assistant: ${response.substring(0, 200)}${response.length > 200 ? '...' : ''}`);
            console.log(`   ⏱️ Response time: ${duration}ms`);
        }

        // === Plugin Demo (after initialization) ===
        console.log('\n📊 Plugin Status:');
        console.log('='.repeat(40));

        const plugins = robota.getPlugins();
        console.log('- Active plugins:', plugins.map(p => p.name).join(', '));

        // === Plugin Status Check ===
        console.log('\n🔍 Plugin Status:');
        console.log('='.repeat(40));

        const pluginNames = robota.getPluginNames();
        console.log('Logging Plugin Status:');
        console.log('- Active plugins:', pluginNames.join(', '));

        // === Agent Statistics ===
        console.log('\n📈 Agent Statistics:');
        console.log('='.repeat(40));

        const agentStats = robota.getStats();
        console.log(`- Agent name: ${agentStats.name}`);
        console.log(`- History length: ${agentStats.historyLength}`);
        console.log(`- Current provider: ${agentStats.currentProvider}`);
        console.log(`- Plugins: ${agentStats.plugins.join(', ')}`);
        console.log(`- Uptime: ${Math.round(agentStats.uptime)}ms`);

        // === Final Test ===
        console.log('\n🎯 Final Performance Test:');
        console.log('='.repeat(40));

        const finalQuery = 'Summarize our conversation and the key topics we discussed.';
        console.log(`User: ${finalQuery}`);

        const finalResponse = await robota.run(finalQuery);
        console.log(`Assistant: ${finalResponse}`);

        console.log('\n✅ Advanced Features Example Completed!');
        console.log('\n💡 Features Demonstrated:');
        console.log('   - LoggingPlugin for detailed execution logs');
        console.log('   - Plugin lifecycle management');
        console.log('   - Conversation history tracking');
        console.log('   - Advanced system messages');

        // Clean up resources
        await robota.destroy();

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