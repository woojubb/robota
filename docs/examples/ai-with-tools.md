# AI with Tools

This guide demonstrates how to use Robota with tool calling capabilities, allowing AI agents to automatically call functions to retrieve information or perform actions.

## Overview

The tool calling example shows how to:
- Define tools using Zod schemas
- Create AI agents that automatically call appropriate tools
- Handle tool execution results
- Process complex multi-tool interactions

## Code Example

```typescript
/**
 * 02-tool-calling.ts
 * 
 * This example demonstrates tool calling functionality:
 * - Define tools using Zod schemas
 * - AI agent automatically calls appropriate tools
 * - Handle tool execution results
 */

import { z } from 'zod';
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Define tool functions using Zod schemas
const tools = {
    // Calculator tool
    calculate: {
        name: 'calculate',
        description: 'Performs basic mathematical calculations (add, subtract, multiply, divide)',
        parameters: z.object({
            operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('Mathematical operation to perform'),
            a: z.number().describe('First number'),
            b: z.number().describe('Second number')
        }),
        handler: async (params) => {
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
    },

    // Weather tool (mock data)
    getWeather: {
        name: 'getWeather',
        description: 'Gets current weather information for a city',
        parameters: z.object({
            city: z.string().describe('City name to get weather for'),
            unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('Temperature unit')
        }),
        handler: async (params) => {
            const { city, unit } = params;
            console.log(`🌤️ Getting weather for: ${city} (${unit})`);

            // Mock weather data
            const weatherData: Record<string, any> = {
                'seoul': { temp: 22, condition: 'Clear', humidity: 65 },
                'busan': { temp: 24, condition: 'Partly Cloudy', humidity: 70 },
                'jeju': { temp: 26, condition: 'Cloudy', humidity: 75 },
                'tokyo': { temp: 20, condition: 'Rainy', humidity: 80 },
                'new york': { temp: 18, condition: 'Sunny', humidity: 55 }
            };

            const cityKey = city.toLowerCase();
            const data = weatherData[cityKey] || { temp: 15, condition: 'Unknown', humidity: 60 };

            const temperature = unit === 'fahrenheit'
                ? Math.round(data.temp * 9 / 5 + 32)
                : data.temp;

            return {
                city,
                temperature,
                unit: unit === 'celsius' ? '°C' : '°F',
                condition: data.condition,
                humidity: `${data.humidity}%`
            };
        }
    },

    // Time tool
    getCurrentTime: {
        name: 'getCurrentTime',
        description: 'Gets the current date and time',
        parameters: z.object({
            timezone: z.string().optional().default('UTC').describe('Timezone (e.g., UTC, Asia/Seoul)')
        }),
        handler: async (params) => {
            const { timezone } = params;
            console.log(`🕐 Getting current time for timezone: ${timezone}`);

            const now = new Date();
            const timeString = timezone === 'UTC'
                ? now.toISOString()
                : now.toLocaleString('en-US', { timeZone: timezone });

            return {
                timezone,
                currentTime: timeString,
                timestamp: now.getTime()
            };
        }
    }
};

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
            client: openaiClient,
            model: 'gpt-3.5-turbo'
        });

        // Create tool provider
        const toolProvider = createZodFunctionToolProvider({ tools });

        // Create Robota instance with tools
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            toolProviders: [toolProvider],
            systemPrompt: 'You are a helpful assistant that can perform calculations, check weather, and tell time. Use the available tools when needed.'
        });

        // Test queries that should trigger tool calls
        const queries = [
            'Hello! What can you help me with?',
            'What is 15 multiplied by 8?',
            'What\'s the weather like in Seoul?',
            'Can you tell me the current time in UTC?',
            'Calculate 100 divided by 4, and then tell me the weather in Tokyo in Fahrenheit'
        ];

        // Process each query
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`\n${i + 1}. User: ${query}`);

            const response = await robota.run(query);
            console.log(`   Assistant: ${response}`);

            if (i < queries.length - 1) {
                console.log('   ' + '─'.repeat(50));
            }
        }

        console.log('\n✅ Tool Calling Example Completed!');

        // Clean up resources and exit
        await robota.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main();
```

## Setup Requirements

Before running this example, ensure you have:

1. **Environment Variables**: Create a `.env` file with your API key:
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

2. **Dependencies**: Install required packages:
   ```bash
   npm install @robota-sdk/core @robota-sdk/openai @robota-sdk/tools openai zod dotenv
   ```

## Key Concepts

### 1. Tool Definition with Zod

Tools are defined using Zod schemas for type safety and automatic validation:

```typescript
const tools = {
    calculate: {
        name: 'calculate',
        description: 'Performs basic mathematical calculations',
        parameters: z.object({
            operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
            a: z.number().describe('First number'),
            b: z.number().describe('Second number')
        }),
        handler: async (params) => {
            // Tool implementation
            return { result: /* calculation result */ };
        }
    }
};
```

### 2. Tool Provider Creation

```typescript
const toolProvider = createZodFunctionToolProvider({ tools });
```

The `createZodFunctionToolProvider` function creates a tool provider from your Zod-defined tools.

### 3. Robota Configuration with Tools

```typescript
const robota = new Robota({
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    toolProviders: [toolProvider],  // Add tool providers here
    systemPrompt: 'You are a helpful assistant with calculation, weather, and time tools.'
});
```

### 4. Automatic Tool Calling

When the AI determines a tool is needed, it automatically:
1. Calls the appropriate tool with the correct parameters
2. Receives the tool result
3. Incorporates the result into its response

```typescript
// This query will automatically trigger the calculate tool
const response = await robota.run('What is 15 multiplied by 8?');
```

### 5. Modern Tool Calling Format

The system uses the modern `toolCalls` format (not legacy `functionCall`):

```typescript
// Assistant message with tool calls
{
    role: 'assistant',
    content: 'I will calculate that for you.',
    toolCalls: [{
        id: 'call_123',
        type: 'function',
        function: {
            name: 'calculate',
            arguments: JSON.stringify({ operation: 'multiply', a: 15, b: 8 })
        }
    }]
}

// Tool result message
{
    role: 'tool',
    content: JSON.stringify({ result: 120, operation: '15 multiply 8 = 120' }),
    toolCallId: 'call_123'
}
```

## Running the Example

```bash
# Navigate to the examples directory
cd apps/examples

# Run the tool calling example
npx tsx 02-tool-calling.ts
```

## Expected Output

```
🛠️ Tool Calling Example Started...

1. User: Hello! What can you help me with?
   Assistant: Hello! I'm a helpful assistant with several capabilities. I can help you with:

   🧮 **Calculations** - I can perform basic math operations (add, subtract, multiply, divide)
   🌤️ **Weather Information** - I can check current weather conditions for different cities
   🕐 **Time Information** - I can tell you the current time in different timezones

   Feel free to ask me anything like "What's 25 times 4?", "What's the weather in Seoul?", or "What time is it in UTC?"

   ──────────────────────────────────────────────────

2. User: What is 15 multiplied by 8?
🧮 Calculating: 15 multiply 8
   Assistant: 15 multiplied by 8 equals 120.

   ──────────────────────────────────────────────────

3. User: What's the weather like in Seoul?
🌤️ Getting weather for: seoul (celsius)
   Assistant: The current weather in Seoul is clear with a temperature of 22°C and humidity of 65%.

   ──────────────────────────────────────────────────

4. User: Can you tell me the current time in UTC?
🕐 Getting current time for timezone: UTC
   Assistant: The current time in UTC is 2024-01-15T14:30:25.123Z.

   ──────────────────────────────────────────────────

5. User: Calculate 100 divided by 4, and then tell me the weather in Tokyo in Fahrenheit
🧮 Calculating: 100 divide 4
🌤️ Getting weather for: tokyo (fahrenheit)
   Assistant: I've completed both requests for you:

   **Calculation**: 100 divided by 4 equals 25.

   **Weather in Tokyo**: The current weather in Tokyo is rainy with a temperature of 68°F and humidity of 80%.

✅ Tool Calling Example Completed!
```

## Advanced Tool Patterns

### Error Handling in Tools

```typescript
const tools = {
    riskyOperation: {
        name: 'riskyOperation',
        description: 'An operation that might fail',
        parameters: z.object({
            input: z.string()
        }),
        handler: async (params) => {
            try {
                // Risky operation
                return { success: true, result: "Operation completed" };
            } catch (error) {
                // Return error information that the AI can use
                return { 
                    success: false, 
                    error: error.message,
                    suggestion: "Try with different parameters"
                };
            }
        }
    }
};
```

### Async Tool Operations

```typescript
const tools = {
    fetchData: {
        name: 'fetchData',
        description: 'Fetches data from an external API',
        parameters: z.object({
            url: z.string().url()
        }),
        handler: async (params) => {
            // Async operation
            const response = await fetch(params.url);
            const data = await response.json();
            return { data, status: response.status };
        }
    }
};
```

### Complex Tool Interactions

Tools can be chained automatically by the AI:

```typescript
// The AI might call multiple tools in sequence:
// 1. getCurrentTime to get current time
// 2. calculate to determine time difference
// 3. getWeather to check conditions
const response = await robota.run(
    'What time is it in Seoul, and how many hours ahead is that from UTC? Also check the weather there.'
);
```

## Provider Compatibility

All AI providers now support tool calling through the unified `BaseAIProvider` architecture:

- **OpenAI**: Uses `tool_calls` format
- **Anthropic**: Uses `tool_use` format (automatically converted)
- **Google AI**: Uses `functionDeclarations` format (automatically converted)

The tool calling interface remains consistent regardless of the underlying provider.

## Best Practices

### 1. Clear Tool Descriptions

```typescript
const tools = {
    searchWeb: {
        name: 'searchWeb',
        description: 'Searches the web for current information about a specific topic. Use this when you need up-to-date information that you might not have in your training data.',
        parameters: z.object({
            query: z.string().describe('Search query - be specific and include relevant keywords')
        }),
        handler: async (params) => {
            // Implementation
        }
    }
};
```

### 2. Parameter Validation

Zod automatically validates parameters, but you can add custom validation:

```typescript
handler: async (params) => {
    const { email } = params;
    
    // Additional validation
    if (!email.includes('@')) {
        throw new Error('Invalid email format');
    }
    
    // Process...
}
```

### 3. Error Recovery

```typescript
handler: async (params) => {
    try {
        return await actualOperation(params);
    } catch (error) {
        // Return helpful error information
        return {
            success: false,
            error: error.message,
            retryable: error.code === 'TIMEOUT',
            suggestion: 'Try again in a few moments'
        };
    }
}
```

## Next Steps

- Try [Multi-Provider](./multi-provider.md) setup with tools across different AI services
- Explore [Advanced Features](./session-management.md) like analytics and limits with tool calling
- Learn about [MCP Integration](./mcp-integration.md) for external tool providers 