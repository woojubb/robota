import { createTeam } from '@robota-sdk/team';
import { Robota, ExecutionAnalyticsPlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
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
        performanceThreshold: 2000,
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

        const queries = ['What is AI?', 'Tell me about ML.']; // Minimal queries always

        for (let i = 0; i < queries.length; i++) {
            console.log(`Task ${i + 1}: ${queries[i]}`);
            const result = await agent.run(queries[i]);
            console.log(`✅ Task ${i + 1} completed`);
        }

        // Access analytics through the agent's plugin (Method 1 - Recommended)
        console.log('\n📊 Method 1: Access through agent.getPlugin()');
        const pluginFromAgent = agent.getPlugin('execution-analytics');
        if (pluginFromAgent && 'getStats' in pluginFromAgent) {
            const stats = (pluginFromAgent as any).getStats();
            displayAnalytics('Agent Plugin Access', stats);
        }

        // Also demonstrate getting raw data
        if (pluginFromAgent && 'getData' in pluginFromAgent) {
            const rawData = (pluginFromAgent as any).getData();
            console.log(`\n📋 Raw execution data: ${rawData.operations.length} operations`);

            // Show last execution details
            if (rawData.operations.length > 0) {
                const lastExecution = rawData.operations[rawData.operations.length - 1];
                console.log(`   └─ Last execution: ${lastExecution.operation} (${lastExecution.duration}ms)`);
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
        const directStats = analyticsPlugin.getAggregatedStats();
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
        const pluginFromAgent = agent.getPlugin('execution-analytics');
        if (pluginFromAgent && 'getAggregatedStats' in pluginFromAgent) {
            const stats = (pluginFromAgent as any).getAggregatedStats();
            console.log(`\n📊 Analytics after error (${stats.totalExecutions} total, ${stats.failedExecutions} failed)`);
        }
    } finally {
        // Cleanup
        await agent.destroy();
        console.log('🧹 Agent cleanup completed');

        // Ensure process exits cleanly
        console.log('🧹 Exiting...');
        process.exit(0);
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

async function demonstrateTeamAnalytics() {
    console.log('🔧 Starting team with analytics demonstration...\n');

    try {
        // Create team with analytics
        const team = await createTeam({
            name: 'Analytics Demo Team',
            description: 'Demonstrating execution analytics in team workflows',
            agents: [
                {
                    name: 'Analyst',
                    model: 'gpt-4o-mini',
                    provider: 'openai',
                    systemMessage: 'You are a data analyst. Analyze the given data and provide insights.',
                    plugins: [
                        new ExecutionAnalyticsPlugin({
                            maxEntries: 100,
                            trackErrors: true,
                            performanceThreshold: 2000,
                            enableWarnings: true
                        })
                    ]
                },
                {
                    name: 'Reviewer',
                    model: 'gpt-4o-mini',
                    provider: 'openai',
                    systemMessage: 'You are a quality reviewer. Review analysis and provide feedback.',
                    plugins: [
                        new ExecutionAnalyticsPlugin({
                            maxEntries: 100,
                            trackErrors: true,
                            performanceThreshold: 2000,
                            enableWarnings: true
                        })
                    ]
                }
            ],
            aiProviders: {
                openai: new OpenAIProvider({
                    apiKey: process.env.OPENAI_API_KEY || ''
                })
            }
        });

        console.log('✅ Team created successfully\n');

        const _result = await team.execute(
            'Analyze the quarterly sales data and provide actionable insights. Data: Q1: $100k, Q2: $150k, Q3: $120k, Q4: $180k. Focus on trends and growth opportunities.'
        );

        // Get analytics from agents
        console.log('📊 Analytics Report:');
        console.log('='.repeat(50));

        for (const agent of team.getAgents()) {
            const pluginFromAgent = agent.plugins.find(p => p.name === 'execution-analytics');
            if (pluginFromAgent) {
                const stats = (pluginFromAgent as any).getStats();

                console.log(`\n📈 Agent: ${agent.name}`);
                const rawData = (pluginFromAgent as any).getData();

                if (rawData && rawData.operations) {
                    console.log(`   Operations Tracked: ${rawData.operations.length}`);
                    rawData.operations.forEach((op: any, index: number) => {
                        console.log(`   ${index + 1}. ${op.operation} - ${op.duration}ms`);
                    });
                }

                const status = (pluginFromAgent as any).getStatus();
                console.log(`   Plugin Status: ${status.enabled ? 'Active' : 'Inactive'}`);

                displayAnalytics(`${agent.name} Analytics`, stats);
            }
        }

        return team;

    } catch (error) {
        console.error('❌ Error in team analytics demo:', error);
        throw error;
    }
}

// Run the example
main().catch(console.error); 