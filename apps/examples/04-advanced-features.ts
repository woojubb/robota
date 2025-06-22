/**
 * 04-advanced-features.ts
 * 
 * This example demonstrates advanced Robota features:
 * - ExecutionAnalyticsPlugin for usage tracking
 * - LoggingPlugin for detailed logging
 * - Custom system messages
 * - Multiple queries with history
 */

import OpenAI from 'openai';
import { Robota, ExecutionAnalyticsPlugin, LoggingPlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        console.log('⚡ Advanced Features Example Started...\\n');

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
        const analyticsPlugin = new ExecutionAnalyticsPlugin({
            maxEntries: 50,
            trackErrors: true,
            performanceThreshold: 1500, // 1.5 seconds
            enableWarnings: true
        });

        const loggingPlugin = new LoggingPlugin({
            level: 'info',
            strategy: 'console'
        });

        // === Advanced Configuration ===
        const robota = new Robota({
            aiProviders: { openai: openaiProvider },
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemMessage: 'You are an advanced AI assistant with detailed analytical capabilities. Provide comprehensive and well-structured responses.',
            plugins: [analyticsPlugin, loggingPlugin] // Add plugins for advanced features
        });

        // === Plugin Demo ===
        console.log('📊 Advanced Plugin Demo');
        console.log('='.repeat(40));

        // Check initial analytics
        console.log('\\n📈 Initial Plugin Status:');
        const initialStats = analyticsPlugin.getStats();
        console.log('- Total executions:', initialStats.totalExecutions);
        console.log('- Success rate:', initialStats.successRate.toFixed(1) + '%');

        // === Conversation History Demo ===
        console.log('\\n💬 Advanced Conversation Demo');
        console.log('='.repeat(40));

        const queries = [
            'Hello! What are the latest developments in artificial intelligence?',
            'How do neural networks learn from data? Please explain in detail.',
            'What are the ethical considerations in AI development?',
            'Compare machine learning and deep learning approaches.',
            'What is the future of AGI (Artificial General Intelligence)?'
        ];

        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`\\n${i + 1}. User: ${query}`);

            const startTime = Date.now();
            const response = await robota.run(query);
            const duration = Date.now() - startTime;

            console.log(`   Assistant: ${response.substring(0, 200)}${response.length > 200 ? '...' : ''}`);
            console.log(`   ⏱️ Response time: ${duration}ms`);

            // Show updated analytics
            const currentStats = analyticsPlugin.getStats();
            console.log(`   📊 Total executions: ${currentStats.totalExecutions}`);
        }

        // === Analytics Deep Dive ===
        console.log('\\n📊 Detailed Analytics:');
        console.log('='.repeat(40));

        const finalStats = analyticsPlugin.getStats();
        console.log('Final Analytics Report:');
        console.log('- Total Executions:', finalStats.totalExecutions);
        console.log('- Successful:', finalStats.successfulExecutions);
        console.log('- Failed:', finalStats.failedExecutions);
        console.log('- Success Rate:', finalStats.successRate.toFixed(1) + '%');
        console.log('- Average Duration:', finalStats.averageDuration.toFixed(0) + 'ms');
        console.log('- Total Duration:', finalStats.totalDuration + 'ms');

        // Operation breakdown - removed due to type constraints
        console.log('\\nExecution Summary:');
        console.log(`- Success Rate: ${finalStats.successRate.toFixed(1)}%`);
        if (finalStats.failedExecutions > 0) {
            console.log(`- ${finalStats.failedExecutions} failed executions detected`);
        }

        // === Plugin Status Check ===
        console.log('\\n🔍 Plugin Status:');
        console.log('='.repeat(40));

        const analyticsStatus = analyticsPlugin.getStatus();
        console.log('Analytics Plugin Status:');
        console.log('- Name:', analyticsStatus.name);
        console.log('- Version:', analyticsStatus.version);
        console.log('- Enabled:', analyticsStatus.enabled);
        console.log('- Total Recorded:', analyticsStatus.totalRecorded);

        // === Memory Management Demo ===
        console.log('\\n🧹 Memory Management:');
        console.log('='.repeat(40));

        console.log('Clearing analytics data...');
        analyticsPlugin.clearData();

        const clearedStats = analyticsPlugin.getStats();
        console.log('After clearing - Total executions:', clearedStats.totalExecutions);

        // === Final Test ===
        console.log('\\n🎯 Final Performance Test:');
        console.log('='.repeat(40));

        const finalQuery = 'Summarize our conversation and the key topics we discussed.';
        console.log(`User: ${finalQuery}`);

        const finalResponse = await robota.run(finalQuery);
        console.log(`Assistant: ${finalResponse}`);

        const postClearStats = analyticsPlugin.getStats();
        console.log(`Final execution count: ${postClearStats.totalExecutions}`);

        console.log('\\n✅ Advanced Features Example Completed!');
        console.log('\\n💡 Features Demonstrated:');
        console.log('   - ExecutionAnalyticsPlugin for performance tracking');
        console.log('   - LoggingPlugin for detailed execution logs');
        console.log('   - Plugin lifecycle management');
        console.log('   - Memory and performance monitoring');

        // Clean up resources
        await robota.destroy();
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main(); 