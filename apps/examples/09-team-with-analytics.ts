import { Robota, OpenAIProvider, ExecutionAnalyticsPlugin } from '@robota-sdk/agents';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

/**
 * Example: Agent with ExecutionAnalyticsPlugin
 * 
 * This example demonstrates how ExecutionAnalyticsPlugin automatically tracks
 * agent execution performance through lifecycle hooks.
 * 
 * The plugin automatically tracks:
 * - Agent run executions
 * - AI provider calls  
 * - Tool executions
 * - Performance metrics
 * - Error tracking
 */

async function main() {
    console.log('🏆 Agent with Analytics Example');
    console.log('================================\n');

    // Create ExecutionAnalyticsPlugin for automatic tracking
    const analyticsPlugin = new ExecutionAnalyticsPlugin({
        maxEntries: 100,
        trackErrors: true,
        performanceThreshold: 2000, // 2 seconds
        enableWarnings: true
    });

    // Create OpenAI client
    const openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY!
    });

    // Create agent with analytics plugin
    const agent = new Robota({
        provider: 'openai',
        model: 'gpt-4o-mini',
        currentProvider: 'openai',
        currentModel: 'gpt-4o-mini',
        systemMessage: 'You are a helpful assistant that provides detailed responses.',
        aiProviders: {
            openai: new OpenAIProvider({
                client: openaiClient,
                model: 'gpt-4o-mini'
            })
        },
        plugins: [analyticsPlugin] // Plugin will automatically track all executions
    });

    console.log('🤖 Agent created with ExecutionAnalyticsPlugin');

    try {
        // Execute some tasks - plugin automatically tracks everything
        console.log('\n📋 Executing tasks...');

        console.log('Task 1: What is artificial intelligence?');
        const result1 = await agent.run('What is artificial intelligence?');
        console.log('✅ Task 1 completed');

        console.log('\nTask 2: Explain machine learning');
        const result2 = await agent.run('Explain machine learning in simple terms.');
        console.log('✅ Task 2 completed');

        console.log('\nTask 3: Benefits of renewable energy');
        const result3 = await agent.run('What are the benefits of renewable energy?');
        console.log('✅ Task 3 completed');

        // Access analytics through the agent's plugin (Method 1 - Recommended)
        console.log('\n📊 Method 1: Access through agent.getPlugin()');
        const pluginFromAgent = agent.getPlugin('ExecutionAnalyticsPlugin');
        if (pluginFromAgent && 'getStats' in pluginFromAgent) {
            const stats = (pluginFromAgent as any).getStats();
            displayAnalytics('Agent Plugin Access', stats);
        }

        // Also demonstrate getting raw data
        if (pluginFromAgent && 'getData' in pluginFromAgent) {
            const rawData = (pluginFromAgent as any).getData();
            console.log(`\n📋 Raw execution data: ${rawData.length} entries`);

            // Show last execution details
            if (rawData.length > 0) {
                const lastExecution = rawData[rawData.length - 1];
                console.log(`   └─ Last execution: ${lastExecution.operation} (${lastExecution.duration}ms, ${lastExecution.success ? 'success' : 'failed'})`);
            }
        }

        // Demonstrate plugin status
        if (pluginFromAgent && 'getStatus' in pluginFromAgent) {
            const status = (pluginFromAgent as any).getStatus();
            console.log(`\n🔍 Plugin Status:`);
            console.log(`   ├─ Name: ${status.name}`);
            console.log(`   ├─ Version: ${status.version}`);
            console.log(`   ├─ Enabled: ${status.enabled}`);
            if ('totalRecorded' in status) {
                console.log(`   ├─ Total Recorded: ${status.totalRecorded}`);
                console.log(`   ├─ Active Executions: ${status.activeExecutions}`);
                console.log(`   └─ Memory Usage: ${status.memoryUsage} items`);
            }
        }

        // Method 2: Direct plugin access (for comparison)
        console.log('\n📊 Method 2: Direct plugin access');
        const directStats = analyticsPlugin.getStats();
        displayAnalytics('Direct Plugin Access', directStats);

        // Show operation breakdown
        const runOperations = analyticsPlugin.getExecutionStats('run');
        const providerOperations = analyticsPlugin.getExecutionStats('provider-call');

        console.log('\n📊 Detailed Operation Statistics:');
        console.log(`   ├─ Agent runs: ${runOperations.length} executions`);
        console.log(`   └─ Provider calls: ${providerOperations.length} executions`);

        // Demonstrate clearing analytics
        console.log('\n🧹 Clearing analytics data...');
        analyticsPlugin.clearStats();
        const clearedStats = analyticsPlugin.getAggregatedStats();
        console.log(`   └─ After clearing: ${clearedStats.totalExecutions} executions`);

    } catch (error) {
        console.error('❌ Task execution failed:', error);

        // Even on error, analytics are tracked
        const pluginFromAgent = agent.getPlugin('ExecutionAnalyticsPlugin');
        if (pluginFromAgent && 'getStats' in pluginFromAgent) {
            const stats = (pluginFromAgent as any).getStats();
            console.log(`\n📊 Analytics after error (${stats.totalExecutions} total, ${stats.failedExecutions} failed)`);
        }
    } finally {
        // Cleanup
        console.log('\n🧹 Agent cleanup completed');
    }
}

function displayAnalytics(method: string, stats: any) {
    console.log(`\n📊 ${method} Analytics:`);
    console.log(`   ├─ Total Executions: ${stats.totalExecutions}`);
    console.log(`   ├─ Successful: ${stats.successfulExecutions}`);
    console.log(`   ├─ Failed: ${stats.failedExecutions}`);
    console.log(`   ├─ Success Rate: ${(stats.successRate * 100).toFixed(1)}%`);
    console.log(`   ├─ Average Duration: ${stats.averageDuration.toFixed(0)}ms`);
    console.log(`   └─ Total Duration: ${stats.totalDuration}ms`);

    // Show operation breakdown
    if (Object.keys(stats.operationStats).length > 0) {
        console.log(`\n   📈 Operation Breakdown:`);
        Object.entries(stats.operationStats).forEach(([operation, opStats]: [string, any]) => {
            console.log(`   ├─ ${operation}: ${opStats.count} executions (${opStats.averageDuration.toFixed(0)}ms avg)`);
        });
    }

    // Show errors if any
    if (Object.keys(stats.errorStats).length > 0) {
        console.log(`\n   ❌ Error Breakdown:`);
        Object.entries(stats.errorStats).forEach(([errorType, count]) => {
            console.log(`   ├─ ${errorType}: ${count} occurrences`);
        });
    }
}

// Run the example
main().catch(console.error); 