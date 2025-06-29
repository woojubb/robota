# AI with Tools

This guide demonstrates how to use Robota with tool calling capabilities, allowing AI agents to automatically call functions to retrieve information or perform actions.

## Overview

The tool calling example shows how to:
- Define tools using manual JSON schemas with `createFunctionTool`
- Create AI agents that automatically call appropriate tools
- Handle tool execution results
- Monitor tool usage and statistics

## Code Example

```typescript
/**
 * 02-tool-calling.ts
 * 
 * This example demonstrates tool calling functionality:
 * - Define tools using JSON schemas
 * - AI agent automatically calls appropriate tools
 * - Handle tool execution results
 * - Show tool usage statistics
 */

import { Robota, createFunctionTool } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables from examples directory
dotenv.config();

// Define tool functions using createFunctionTool with manual JSON schema
const calculateTool = createFunctionTool(
    'calculate',
    'Performs basic mathematical calculations (add, subtract, multiply, divide)',
    {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['add', 'subtract', 'multiply', 'divide'],
                description: 'Mathematical operation to perform'
            },
            a: {
                type: 'number',
                description: 'First number'
            },
            b: {
                type: 'number',
                description: 'Second number'
            }
        },
        required: ['operation', 'a', 'b']
    },
    async (params) => {
            const { operation, a, b } = params;
            console.log(`🧮 Calculating: ${a} ${operation} ${b}`);

            let result: number;
            switch (operation) {
                case 'add':
                    result = a + b;
                    break;
                case 'subtract':
                    result = a - b;
                    break;
                case 'multiply':
                    result = a * b;
                    break;
                case 'divide':
                    if (b === 0) throw new Error('Division by zero is not allowed');
                    result = a / b;
                    break;
                default:
                    throw new Error(`Unknown operation: ${operation}`);
            }

            return { result, operation: `${a} ${operation} ${b} = ${result}` };
        }
);

async function main() {
    try {
        console.log('🛠️ Tool Calling Example Started...\n');

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client and provider
        const openaiClient = new OpenAI({ apiKey });
        const openaiProvider = new OpenAIProvider({
            client: openaiClient
        });

        // Create Robota instance with tools
        const robota = new Robota({
            name: 'ToolAgent',
            model: 'gpt-3.5-turbo',
            provider: 'openai',
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            tools: [calculateTool],
            systemMessage: 'You are a helpful assistant that can perform calculations.',
            logging: {
                level: 'info',
                enabled: true
            }
        });

        // Test queries
        const queries = [
            'Hi',
            'What is 5 plus 3?'
        ];

        console.log(`📝 Executing ${queries.length} queries`);

        // Process each query with error handling
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`\n${i + 1}. User: ${query}`);

            try {
            const response = await robota.run(query);
            console.log(`   Assistant: ${response}`);
            } catch (error) {
                console.error(`   Error: ${error}`);
                break;
            }

            if (i < queries.length - 1) {
                console.log('   ' + '─'.repeat(50));
            }
        }

        // Show Final Statistics
        console.log('\n📊 Final Statistics:');
        const stats = robota.getStats();
        console.log(`- Agent name: ${stats.name}`);
        console.log(`- Tools registered: ${stats.tools.join(', ')}`);
        console.log(`- History length: ${stats.historyLength}`);
        console.log(`- Current provider: ${stats.currentProvider}`);
        console.log(`- Uptime: ${Math.round(stats.uptime)}ms`);

        console.log('\n✅ Tool Calling Example Completed!');

        // Clean up resources
        await robota.destroy();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main();
```

## Expected Output

```
🛠️ Tool Calling Example Started...

📝 Executing 2 queries

1. User: Hi
   Assistant: Hello! I'm a helpful assistant that can perform calculations. How can I help you today?

────────────────────────────────────────────────

2. User: What is 5 plus 3?
🧮 Calculating: 5 add 3
   Assistant: 5 plus 3 equals 8.

📊 Final Statistics:
- Agent name: ToolAgent
- Tools registered: calculate
- History length: 4
- Current provider: openai
- Uptime: 2347ms

✅ Tool Calling Example Completed!
```

## Key Features

### 1. **Function Tool Creation**
```typescript
const calculateTool = createFunctionTool(
    'calculate',
    'Tool description',
    {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['add', 'subtract', 'multiply', 'divide']
            }
        },
        required: ['operation', 'a', 'b']
    },
    async (params) => {
        // Tool implementation
        return result;
            }
);
```

### 2. **Tool Registration**
```typescript
const robota = new Robota({
    tools: [calculateTool],
    systemMessage: 'You are a helpful assistant that can perform calculations.'
});
```

### 3. **Automatic Tool Calling**
The AI automatically determines when to use tools based on the user's request. No manual tool invocation needed.

### 4. **Tool Statistics**
Monitor tool usage through the agent's statistics:
```typescript
const stats = robota.getStats();
console.log(`Tools registered: ${stats.tools.join(', ')}`);
```

## Advanced Features

### Error Handling
Tools can throw errors that are handled gracefully:
```typescript
if (b === 0) throw new Error('Division by zero is not allowed');
```

### Multiple Tools
Register multiple tools for complex functionality:
```typescript
const robota = new Robota({
    tools: [calculateTool, weatherTool, timeTool]
});
```

### Tool Metadata
Access detailed execution information through conversation history and statistics.

## Best Practices

1. **Clear Tool Descriptions**: Provide detailed descriptions so the AI knows when to use each tool
2. **Parameter Validation**: Use JSON schema validation for robust parameter handling  
3. **Error Handling**: Implement proper error handling in tool implementations
4. **Resource Cleanup**: Always call `robota.destroy()` to clean up resources
5. **Logging**: Enable logging to monitor tool execution and debug issues 