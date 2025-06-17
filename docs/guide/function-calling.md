---
title: Function Calling
description: Function Calling in Robota
lang: en-US
---

# Function Calling

Function calling enables AI models to interact with external systems, retrieve data, or perform calculations through predefined functions. Robota provides a powerful and type-safe tool system for implementing function calling.

## Overview

Robota's function calling system consists of:

- **Tool Providers**: Manage collections of tools that AI can use
- **Tool Definitions**: Type-safe function definitions with Zod schema validation
- **Automatic Invocation**: AI automatically determines when and how to use tools
- **Multiple Tool Types**: Support for Zod tools, MCP tools, and OpenAPI tools

## Basic Function Calling

Here's how to set up basic function calling with Zod-based tools:

```typescript
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    // Create OpenAI client
    const openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });

    // Create OpenAI Provider
    const openaiProvider = new OpenAIProvider({
        client: openaiClient,
        model: 'gpt-4'
    });

    // Define calculator tool
    const calculatorTool = {
        name: 'calculate',
        description: 'Performs mathematical calculations',
        parameters: z.object({
            operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('Operation to perform'),
            a: z.number().describe('First number'),
            b: z.number().describe('Second number')
        }),
        handler: async (params) => {
            const { operation, a, b } = params;
            console.log(`[Tool] Calculating: ${a} ${operation} ${b}`);
            
            let result;
            switch (operation) {
                case 'add': result = { result: a + b }; break;
                case 'subtract': result = { result: a - b }; break;
                case 'multiply': result = { result: a * b }; break;
                case 'divide': result = b !== 0 ? { result: a / b } : { error: 'Cannot divide by zero' }; break;
            }
            
            console.log(`[Tool] Result:`, result);
            return result;
        }
    };

    // Create tool provider
    const toolProvider = createZodFunctionToolProvider({
        tools: {
            calculate: calculatorTool
        }
    });

    // Create Robota instance with tools
    const robota = new Robota({
        aiProviders: {
            'openai': openaiProvider
        },
        currentProvider: 'openai',
        currentModel: 'gpt-4',
        toolProviders: [toolProvider],
        systemPrompt: 'You are a helpful AI assistant. Use the calculate tool for mathematical operations.',
        debug: true  // Enable tool call logging
    });

    // AI will automatically use the calculator tool
    const response = await robota.run('Please calculate 15 multiplied by 7 using the calculator tool.');
    console.log('Response:', response);
    
    // Clean up resources
    await robota.close();
}

main().catch(console.error);
```

## Complex Tool Examples

### Weather Tool with Validation

```typescript
const weatherTool = {
    name: 'getWeather',
    description: 'Get current weather information for a location',
    parameters: z.object({
        location: z.string().min(1).describe('City name or location'),
        unit: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('Temperature unit'),
        includeHumidity: z.boolean().default(false).describe('Include humidity information')
    }),
    handler: async ({ location, unit, includeHumidity }) => {
        console.log(`[Weather Tool] Fetching weather for ${location} in ${unit}`);
        
        // Simulate API call
        const weatherData = {
            location,
            temperature: unit === 'celsius' ? 22 : 72,
            condition: 'sunny',
            unit: unit === 'celsius' ? 'C' : 'F'
        };

        if (includeHumidity) {
            weatherData.humidity = 65;
        }

        return weatherData;
    }
};
```

### Email Tool with Complex Schema

```typescript
const emailTool = {
    name: 'sendEmail',
    description: 'Send an email to specified recipients',
    parameters: z.object({
        to: z.array(z.string().email()).min(1).describe('Email recipients'),
        subject: z.string().min(1).describe('Email subject'),
        body: z.string().min(1).describe('Email body content'),
        cc: z.array(z.string().email()).optional().describe('CC recipients'),
        bcc: z.array(z.string().email()).optional().describe('BCC recipients'),
        priority: z.enum(['low', 'normal', 'high']).default('normal').describe('Email priority')
    }),
    handler: async ({ to, subject, body, cc, bcc, priority }) => {
        console.log(`[Email Tool] Sending email: ${subject}`);
        console.log(`To: ${to.join(', ')}`);
        if (cc?.length) console.log(`CC: ${cc.join(', ')}`);
        if (bcc?.length) console.log(`BCC: ${bcc.join(', ')}`);
        
        // Simulate email sending
        return {
            status: 'sent',
            messageId: `msg-${Date.now()}`,
            timestamp: new Date().toISOString()
        };
    }
};
```

## Multiple Tools Example

Create a comprehensive tool provider with multiple tools:

```typescript
// Define multiple tools
const tools = {
    calculate: {
        name: 'calculate',
        description: 'Perform mathematical calculations',
        parameters: z.object({
            operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
            a: z.number(),
            b: z.number()
        }),
        handler: async ({ operation, a, b }) => {
            const operations = {
                add: a + b,
                subtract: a - b,
                multiply: a * b,
                divide: b !== 0 ? a / b : null
            };
            return { result: operations[operation] };
        }
    },

    getWeather: {
        name: 'getWeather',
        description: 'Get weather information',
        parameters: z.object({
            location: z.string().describe('City name'),
            unit: z.enum(['celsius', 'fahrenheit']).default('celsius')
        }),
        handler: async ({ location, unit }) => {
            // Simulate weather API
            return {
                location,
                temperature: unit === 'celsius' ? 22 : 72,
                condition: 'sunny',
                humidity: 65
            };
        }
    },

    getCurrentTime: {
        name: 'getCurrentTime',
        description: 'Get current time in specified timezone',
        parameters: z.object({
            timezone: z.string().default('UTC').describe('Timezone (e.g., America/New_York)')
        }),
        handler: async ({ timezone }) => {
            return {
                time: new Date().toLocaleString('en-US', { timeZone: timezone }),
                timezone,
                timestamp: Date.now()
            };
        }
    }
};

// Create tool provider with multiple tools
const multiToolProvider = createZodFunctionToolProvider({ tools });

const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    toolProviders: [multiToolProvider],
    systemPrompt: 'You are a helpful assistant with access to calculator, weather, and time tools.'
});

// AI can use multiple tools in a single conversation
const response = await robota.run(
    'What is 25 * 4, what is the weather in Tokyo, and what time is it in Japan?'
);
```

## Tool Provider Without AI

You can also use tool providers independently without AI:

```typescript
const toolOnlyRobota = new Robota({
    toolProviders: [toolProvider],
    systemPrompt: 'You process requests using available tools.'
});

// Direct tool usage without AI provider
const queries = [
    'Calculate 10 + 5',
    'What is the weather in Seoul?',
    'What time is it in New York?'
];

for (const query of queries) {
    console.log(`\nUser: ${query}`);
    const response = await toolOnlyRobota.run(query);
    console.log(`Assistant: ${response}`);
}
```

## Available Tool Information

Check what tools are available to your AI:

```typescript
// Get available tools
const availableTools = robota.getAvailableTools();
console.log('Available tools:', availableTools.map(tool => tool.name));

// Print tool schemas
console.log('Tool schemas:', JSON.stringify(availableTools, null, 2));
```

## Error Handling in Tools

Implement proper error handling in your tool handlers:

```typescript
const robustCalculatorTool = {
    name: 'robustCalculate',
    description: 'Perform calculations with error handling',
    parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number(),
        b: z.number()
    }),
    handler: async ({ operation, a, b }) => {
        try {
            console.log(`Calculating: ${a} ${operation} ${b}`);
            
            if (operation === 'divide' && b === 0) {
                return { 
                    error: 'Cannot divide by zero',
                    code: 'DIVISION_BY_ZERO' 
                };
            }

            const operations = {
                add: a + b,
                subtract: a - b,
                multiply: a * b,
                divide: a / b
            };

            const result = operations[operation];
            
            // Validate result
            if (!isFinite(result)) {
                return { 
                    error: 'Result is not a finite number',
                    code: 'INVALID_RESULT' 
                };
            }

            return { 
                result,
                operation: `${a} ${operation} ${b} = ${result}`
            };

        } catch (error) {
            return { 
                error: 'Calculation failed',
                code: 'CALCULATION_ERROR',
                details: error.message 
            };
        }
    }
};
```

## Debugging Tools

Enable debugging to see tool execution details:

```typescript
const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    toolProviders: [toolProvider],
    debug: true,  // Enable debugging
    logger: {
        info: (msg, ...args) => console.log(`ℹ️ ${msg}`, ...args),
        debug: (msg, ...args) => console.log(`🐛 ${msg}`, ...args),
        warn: (msg, ...args) => console.warn(`⚠️ ${msg}`, ...args),
        error: (msg, ...args) => console.error(`❌ ${msg}`, ...args)
    }
});
```

## Next Steps

- Learn about [Building Agents](./building-agents.md) for more complex AI workflows
- Explore [AI Providers](../providers.md) for different AI model integrations
- Check out the complete examples in the `apps/examples` directory
- Read about [Core Concepts](./core-concepts.md) to understand Robota's architecture