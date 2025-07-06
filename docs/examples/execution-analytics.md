# Execution Analytics

This example demonstrates how to use the ExecutionAnalyticsPlugin to automatically track agent execution performance, providing detailed insights into agent operations.

## Overview

The execution analytics example shows how to:
- Automatically track agent execution performance
- Monitor AI provider calls and tool executions
- Analyze performance metrics and error tracking
- Access analytics through different methods
- Clear analytics data when needed

## Code Example

```typescript
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
        const queries = ['What is AI?', 'Tell me about ML.']; // Minimal queries

        for (let i = 0; i < queries.length; i++) {
            console.log(`Executing task ${i + 1}...`);
            await agent.run(queries[i]);
        }

        // Access analytics through the agent's plugin
        const pluginFromAgent = agent.getPlugin('ExecutionAnalyticsPlugin');
        if (pluginFromAgent && 'getAggregatedStats' in pluginFromAgent) {
            const stats = (pluginFromAgent as any).getAggregatedStats();
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
        if (pluginFromAgent && 'getAggregatedStats' in pluginFromAgent) {
            const stats = (pluginFromAgent as any).getAggregatedStats();
            console.log(`\n📊 Analytics after error (${stats.totalExecutions} total, ${stats.failedExecutions} failed)`);
        }
    }

    // Method 2: Direct plugin access (for comparison)
    console.log('\n📊 Method 2: Direct plugin access');
    const directStats = analyticsPlugin.getAggregatedStats();
    displayAnalytics('Direct Plugin Access', directStats);

    // Demonstrate clearing analytics
    console.log('\n🧹 Clearing analytics data...');
    analyticsPlugin.clearStats();
    const clearedStats = analyticsPlugin.getAggregatedStats();
    console.log(`   └─ After clearing: ${clearedStats.totalExecutions} executions`);

    // Cleanup
    await agent.destroy();
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
```

## Expected Output

```
🔍 Execution Analytics Plugin Example
=====================================

🤖 Agent created with ExecutionAnalyticsPlugin

📊 Method 1: Access through agent.getPlugin()
Executing task 1...
Executing task 2...

📊 Agent Plugin Access Analytics:
   ├─ Total Executions: 4
   ├─ Successful: 4
   ├─ Failed: 0
   ├─ Success Rate: 100.0%
   ├─ Average Duration: 1250ms
   └─ Total Duration: 5000ms

   Operation Breakdown:
   ├─ run: 2 calls (1800ms avg)
   ├─ provider-call: 2 calls (700ms avg)

📋 Raw execution data: 4 entries
   └─ Last execution: provider-call (698ms, success)

🔍 Plugin Status:
   ├─ Name: ExecutionAnalyticsPlugin
   ├─ Version: 1.0.0
   ├─ Enabled: true
   ├─ Total Recorded: 4
   ├─ Active Executions: 0
   └─ Memory Usage: 4 items

📊 Method 2: Direct plugin access
📊 Direct Plugin Access Analytics:
   ├─ Total Executions: 4
   ├─ Successful: 4
   ├─ Failed: 0
   ├─ Success Rate: 100.0%
   ├─ Average Duration: 1250ms
   └─ Total Duration: 5000ms

🧹 Clearing analytics data...
   └─ After clearing: 0 executions
```

## Key Features

### 1. **Automatic Execution Tracking**

The plugin automatically tracks all agent operations without manual intervention:

```typescript
const analyticsPlugin = new ExecutionAnalyticsPlugin({
    maxEntries: 100,         // Maximum number of entries to store
    trackErrors: true,       // Track error occurrences
    performanceThreshold: 2000, // Threshold for performance warnings
    enableWarnings: true     // Enable performance warnings
});
```

### 2. **Comprehensive Metrics**

The plugin tracks multiple types of operations:

- **Agent runs**: Complete user interactions
- **Provider calls**: AI provider API calls
- **Tool executions**: Function tool calls
- **Performance metrics**: Duration, success rates
- **Error tracking**: Failure types and frequencies

### 3. **Multiple Access Methods**

Access analytics through different approaches:

```typescript
// Method 1: Through agent (recommended)
const pluginFromAgent = agent.getPlugin('ExecutionAnalyticsPlugin');
const stats = pluginFromAgent.getAggregatedStats();

// Method 2: Direct plugin access
const directStats = analyticsPlugin.getAggregatedStats();
```

### 4. **Detailed Analytics Data**

The plugin provides comprehensive statistics:

```typescript
{
    totalExecutions: 4,
    successfulExecutions: 4,
    failedExecutions: 0,
    successRate: 1.0,
    averageDuration: 1250,
    totalDuration: 5000,
    operationStats: {
        'run': { count: 2, averageDuration: 1800 },
        'provider-call': { count: 2, averageDuration: 700 }
    },
    errorStats: {}
}
```

### 5. **Raw Execution Data**

Access detailed execution information:

```typescript
const rawData = plugin.getData();
// Returns array of execution records with:
// - operation: type of operation
// - duration: execution time
// - success: success/failure status
// - timestamp: when it occurred
// - metadata: additional context
```

## Plugin Configuration

### Basic Configuration

```typescript
const analyticsPlugin = new ExecutionAnalyticsPlugin({
    maxEntries: 100,           // Limit memory usage
    trackErrors: true,         // Include error tracking
    performanceThreshold: 2000, // Warn on slow operations
    enableWarnings: true       // Enable console warnings
});
```

### Advanced Configuration

```typescript
const analyticsPlugin = new ExecutionAnalyticsPlugin({
    maxEntries: 500,
    trackErrors: true,
    performanceThreshold: 1000,
    enableWarnings: true,
    // Optional: Custom operation filters
    operationFilters: ['run', 'provider-call'],
    // Optional: Custom metadata collection
    collectMetadata: true
});
```

## Use Cases

### 1. **Performance Monitoring**
Track agent response times and identify bottlenecks:

```typescript
const stats = plugin.getAggregatedStats();
if (stats.averageDuration > 2000) {
    console.warn('Agent performance is below threshold');
}
```

### 2. **Success Rate Analysis**
Monitor agent reliability:

```typescript
const successRate = stats.successRate * 100;
if (successRate < 95) {
    console.warn(`Success rate: ${successRate}% - investigate issues`);
}
```

### 3. **Operation Breakdown**
Analyze where time is spent:

```typescript
Object.entries(stats.operationStats).forEach(([operation, opStats]) => {
    console.log(`${operation}: ${opStats.averageDuration}ms average`);
});
```

### 4. **Error Analysis**
Identify common failure patterns:

```typescript
Object.entries(stats.errorStats).forEach(([errorType, count]) => {
    console.log(`${errorType}: ${count} occurrences`);
});
```

## Best Practices

1. **Memory Management**: Set appropriate `maxEntries` to prevent memory leaks
2. **Performance Thresholds**: Configure thresholds based on your application requirements
3. **Regular Analysis**: Review analytics data regularly to identify trends
4. **Error Tracking**: Enable error tracking to identify and resolve issues
5. **Data Cleanup**: Clear analytics data when needed to reset metrics

The ExecutionAnalyticsPlugin provides invaluable insights for optimizing agent performance and ensuring reliable operation. 