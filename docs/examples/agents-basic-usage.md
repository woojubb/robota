# Agents Package Basic Usage

This example demonstrates the core features of the new `@robota-sdk/agents` package, showcasing the unified architecture and advanced capabilities.

## Overview

The agents package basic usage example shows how to:
- Use instance-specific managers (no singletons)
- Monitor comprehensive statistics and analytics
- Leverage the plugin system with built-in plugins
- Update configuration at runtime
- Properly manage resources

## Code Example

```typescript
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
import { Robota, type RobotaConfig, LoggingPlugin, UsagePlugin } from '@robota-sdk/agents';
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

        const config: RobotaConfig = {
            name: 'DemoAgent',
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            plugins: [
                new LoggingPlugin({
                    level: 'info',
                    enabled: true,
                    strategy: 'console'
                }),
                new UsagePlugin({
                    trackTokens: true,
                    trackCosts: true,
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
        console.log('⚙️ Updating configuration at runtime...');
        robota.updateConfig({
            temperature: 0.8,
            maxTokens: 500
        });
        console.log('✅ Configuration updated\n');

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
```

## Key Features Demonstrated

### 1. Comprehensive Configuration

The example shows how to configure a Robota agent with all the new features:

```typescript
const config: RobotaConfig = {
    name: 'DemoAgent',
    aiProviders: { 'openai': openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    plugins: [
        new LoggingPlugin({ level: 'info', enabled: true }),
        new UsagePlugin({ trackTokens: true, trackCosts: true })
    ],
    logging: { level: 'info', enabled: true }
};
```

### 2. Built-in Plugin System

The new agents package includes several built-in plugins:

- **LoggingPlugin**: Comprehensive logging with different strategies
- **UsagePlugin**: Token and cost tracking
- **PerformancePlugin**: Performance monitoring
- **EventEmitterPlugin**: Event-driven architecture

### 3. Real-time Statistics

Get comprehensive agent statistics:

```typescript
const stats = robota.getStats();
console.log(`Agent Name: ${stats.name}`);
console.log(`Uptime: ${Math.round(stats.uptime / 1000)}s`);
console.log(`Current Provider: ${stats.currentProvider}`);
console.log(`Active Plugins: ${stats.plugins.join(', ')}`);
```

### 4. Conversation History Management

Access and inspect conversation history:

```typescript
const history = robota.getHistory();
history.forEach((msg, index) => {
    console.log(`${index + 1}. [${msg.role}]: ${msg.content}`);
});
```

### 5. Runtime Configuration Updates

Update agent configuration during execution:

```typescript
robota.updateConfig({
    temperature: 0.8,
    maxTokens: 500
});
```

### 6. Plugin Interaction

Interact with specific plugins:

```typescript
const usagePlugin = robota.getPlugin<UsagePlugin>('usage-plugin');
if (usagePlugin) {
    const usageStats = usagePlugin.getStats();
    console.log(`Total Executions: ${usageStats.totalExecutions}`);
}
```

## Architecture Highlights

### Instance-Specific Managers

Unlike previous versions that used singleton patterns, the new agents package uses instance-specific managers:

- Each agent has its own conversation history
- Plugin state is isolated per agent
- No global state conflicts
- Better resource management

### Type Safety

Complete TypeScript coverage without `any` types:

```typescript
// All configurations are fully typed
const config: RobotaConfig = { /* fully typed */ };

// Plugin interactions are type-safe
const usagePlugin = robota.getPlugin<UsagePlugin>('usage-plugin');
```

### Resource Management

Proper resource cleanup prevents memory leaks:

```typescript
// Always call destroy() to clean up
await robota.destroy();
```

## Running the Example

```bash
# Navigate to examples directory
cd apps/examples

# Run the agents basic usage example
npx tsx 10-agents-basic-usage.ts
```

## Expected Output

```
🤖 Agents Package Basic Usage Example Started...

⚙️ Creating agent with comprehensive configuration...
✅ Agent 'DemoAgent' created successfully

💬 Basic Conversation:
User: What is an AI agent?
Assistant: An AI agent is a software program that uses artificial intelligence to perform tasks autonomously, make decisions, and interact with its environment or users to achieve specific goals.

📊 Agent Statistics:
- Agent Name: DemoAgent
- Version: 2.0.0
- Uptime: 2s
- Current Provider: openai
- Available Providers: openai
- Active Plugins: logging-plugin, usage-plugin
- Messages in History: 2

📜 Conversation History:
1. [user]: What is an AI agent?
2. [assistant]: An AI agent is a software program that uses artificial intelligence to perform tasks...

⚙️ Updating configuration at runtime...
✅ Configuration updated

🔌 Plugin Information:
- Plugin: logging-plugin (version: 1.0.0)
- Plugin: usage-plugin (version: 1.0.0)

📈 Usage Statistics:
- Total Executions: 1
- Total Tokens: 45
- Average Tokens per Execution: 45

📊 Final Agent Statistics:
- Total Messages: 2
- Session Duration: 2s
- Conversation ID: conv_1234567890

✅ Agents Package Basic Usage Example Completed!
🧹 Cleaning up resources...
✅ Cleanup complete!
🧹 Exiting...
```

## Next Steps

- Try [Agents Streaming](./agents-streaming.md) for real-time response streaming
- Explore [Tool Calling](./ai-with-tools.md) with the new agents package
- Learn about [Multi-Provider](./multi-provider.md) configurations
- Dive into [Team Collaboration](./team-collaboration.md) for multi-agent systems 