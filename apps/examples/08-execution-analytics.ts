import { Robota, ExecutionAnalyticsPlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Example: Execution Analytics Plugin
 * 
 * This example demonstrates how to use the ExecutionAnalyticsPlugin
 * to automatically track agent execution performance.
 * 
 * The plugin automatically tracks:
 * - Agent run executions
 * - AI provider calls
 * - Tool executions
 * - Performance metrics
 * - Error tracking
 */

async function main() {
    console.log('🔍 Execution Analytics Plugin Example');
    console.log('=====================================\n');

    // Validate API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    // Create ExecutionAnalyticsPlugin for automatic tracking
    const analyticsPlugin = new ExecutionAnalyticsPlugin({
        maxEntries: 100,
        trackErrors: true,
        performanceThreshold: 2000, // 2 seconds
        enableWarnings: true
    });

    // Create OpenAI client
    const openaiClient = new OpenAI({ apiKey });

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

    // Method 1: Access plugin through agent (recommended)
    console.log('\n📊 Method 1: Access through agent.getPlugin()');

    try {
        // Execute some tasks - plugin automatically tracks everything
        const queries = ['What is AI?', 'Tell me about ML.']; // Minimal queries always

        for (let i = 0; i < queries.length; i++) {
            console.log(`Executing task ${i + 1}...`);
            await agent.run(queries[i]);
        }

        // Access analytics through the agent's plugin
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

    } catch (error) {
        console.error('❌ Task execution failed:', error);

        // Even on error, analytics are tracked
        const pluginFromAgent = agent.getPlugin('ExecutionAnalyticsPlugin');
        if (pluginFromAgent && 'getStats' in pluginFromAgent) {
            const stats = (pluginFromAgent as any).getStats();
            console.log(`\n📊 Analytics after error (${stats.totalExecutions} total, ${stats.failedExecutions} failed)`);
        }
    }

    // Method 2: Direct plugin access (for comparison)
    console.log('\n📊 Method 2: Direct plugin access');
    const directStats = analyticsPlugin.getStats();
    displayAnalytics('Direct Plugin Access', directStats);

    // Demonstrate clearing analytics
    console.log('\n🧹 Clearing analytics data...');
    analyticsPlugin.clearStats();
    const clearedStats = analyticsPlugin.getAggregatedStats();
    console.log(`   └─ After clearing: ${clearedStats.totalExecutions} executions`);

    // Cleanup
    await agent.destroy();

    // Ensure process exits cleanly
    console.log('🧹 Cleanup completed. Exiting...');
    process.exit(0);
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
        console.log(`\n   Operation Breakdown:`);
        Object.entries(stats.operationStats).forEach(([operation, opStats]: [string, any]) => {
            console.log(`   ├─ ${operation}: ${opStats.count} calls (${opStats.averageDuration.toFixed(0)}ms avg)`);
        });
    }

    // Show errors if any
    if (Object.keys(stats.errorStats).length > 0) {
        console.log(`\n   Error Breakdown:`);
        Object.entries(stats.errorStats).forEach(([errorType, count]) => {
            console.log(`   ├─ ${errorType}: ${count} occurrences`);
        });
    }
}

// Run the example
main().catch(console.error); 