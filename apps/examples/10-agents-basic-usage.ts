/**
 * 10-agents-basic-usage.ts
 * 
 * This example demonstrates the core features of the new @robota-sdk/agents package:
 * - Instance-specific managers (no singletons)
 * - Comprehensive statistics and monitoring
 * - Plugin system with built-in plugins
 * - Runtime configuration updates
 * - Proper resource management
 */

import OpenAI from 'openai';
import { Robota, LoggingPlugin, UsagePlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables from examples directory
dotenv.config();

async function main() {
    try {
        console.log('🤖 Agents Package Basic Usage Example Started...\n');

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

        // ===== AGENT CONFIGURATION =====
        console.log('⚙️ Creating agent with comprehensive configuration...');

        const config = {
            name: 'DemoAgent',
            aiProviders: [openaiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo'
            },
            plugins: [
                new LoggingPlugin({
                    level: 'info',
                    enabled: true,
                    strategy: 'console'
                }),
                new UsagePlugin({
                    strategy: 'memory'
                })
            ],
            logging: {
                level: 'info',
                enabled: true
            }
        };

        const robota = new Robota(config);
        console.log(`✅ Agent '${robota.name}' created successfully\n`);

        // ===== BASIC CONVERSATION =====
        console.log('💬 Basic Conversation:');
        const query1 = 'What is an AI agent?';
        console.log(`User: ${query1}`);

        const response1 = await robota.run(query1);
        console.log(`Assistant: ${response1}\n`);

        // ===== STATISTICS MONITORING =====
        console.log('📊 Agent Statistics:');
        const stats = robota.getStats();
        console.log(`- Agent Name: ${stats.name}`);
        console.log(`- Version: ${stats.version}`);
        console.log(`- Uptime: ${Math.round(stats.uptime / 1000)}s`);
        console.log(`- Current Provider: ${stats.currentProvider}`);
        console.log(`- Available Providers: ${stats.providers.join(', ')}`);
        console.log(`- Active Plugins: ${stats.plugins.join(', ')}`);
        console.log(`- Messages in History: ${stats.historyLength}\n`);

        // ===== CONVERSATION HISTORY =====
        console.log('📜 Conversation History:');
        const history = robota.getHistory();
        history.forEach((msg, index) => {
            console.log(`${index + 1}. [${msg.role}]: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
        });
        console.log();

        // ===== RUNTIME CONFIGURATION UPDATE =====
        console.log('⚙️ Demonstrating configuration access...');
        const currentConfig = robota.getConfig();
        console.log(`✅ Current model: ${currentConfig.defaultModel.provider}/${currentConfig.defaultModel.model}\n`);

        // ===== ANOTHER CONVERSATION WITH NEW CONFIG =====
        console.log('💬 Skipping second conversation for token efficiency\n');

        // ===== PLUGIN INTERACTION =====
        console.log('🔌 Plugin Information:');
        const plugins = robota.getPlugins();
        plugins.forEach(plugin => {
            console.log(`- Plugin: ${plugin.name} (version: ${plugin.version})`);
        });

        // Get usage plugin specifically
        const usagePlugin = robota.getPlugin<UsagePlugin>('usage-plugin');
        if (usagePlugin) {
            console.log('\n📈 Usage Statistics:');
            const usageStats = usagePlugin.getStats();
            console.log(`- Total Executions: ${usageStats.totalExecutions}`);
            console.log(`- Total Tokens: ${usageStats.totalTokens}`);
            console.log(`- Average Tokens per Execution: ${Math.round(usageStats.averageTokensPerExecution)}`);
        }
        console.log();

        // ===== FINAL STATISTICS =====
        console.log('📊 Final Agent Statistics:');
        const finalStats = robota.getStats();
        console.log(`- Total Messages: ${finalStats.historyLength}`);
        console.log(`- Session Duration: ${Math.round(finalStats.uptime / 1000)}s`);
        console.log(`- Conversation ID: ${finalStats.conversationId}\n`);

        console.log('✅ Agents Package Basic Usage Example Completed!');

        // ===== RESOURCE CLEANUP =====
        console.log('🧹 Cleaning up resources...');
        await robota.destroy();
        console.log('✅ Cleanup complete!');

        // Ensure process exits cleanly
        console.log('🧹 Exiting...');
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