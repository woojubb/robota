# AI with Tools

This example demonstrates how to integrate AI with function tools, enabling the AI to perform specific actions and computations through tool calls.

## Overview

The AI with tools example shows how to:
- Create function tools with Zod schema validation
- Set up tool providers with `createZodFunctionToolProvider`
- Enable AI to automatically call tools when needed
- Implement custom logging and debug modes
- Handle complex multi-step tool operations

## Source Code

**Location**: `apps/examples/01-basic/02-ai-with-tools.ts`

## Key Concepts

### 1. Tool Definition with Zod
```typescript
import { z } from 'zod';

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
        switch (operation) {
            case 'add': return { result: a + b };
            case 'subtract': return { result: a - b };
            case 'multiply': return { result: a * b };
            case 'divide': return b !== 0 ? { result: a / b } : { error: 'Cannot divide by zero' };
        }
    }
};
```

### 2. Tool Provider Creation
```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';

const toolProvider = createZodFunctionToolProvider({
    tools: {
        calculate: calculatorTool
    }
});
```

### 3. Custom Logger Setup
```typescript
import chalk from 'chalk';
import type { Logger } from '@robota-sdk/core';

const customLogger: Logger = {
    info: (message: string, ...args: any[]) => console.log(chalk.blue('ℹ️'), message, ...args),
    debug: (message: string, ...args: any[]) => console.log(chalk.gray('🐛'), message, ...args),
    warn: (message: string, ...args: any[]) => console.warn(chalk.yellow('⚠️'), message, ...args),
    error: (message: string, ...args: any[]) => console.error(chalk.red('❌'), message, ...args)
};
```

### 4. Robota with Tools Integration
```typescript
const robota = new Robota({
    aiProviders: {
        'openai': openaiProvider
    },
    currentProvider: 'openai',
    currentModel: 'gpt-3.5-turbo',
    toolProviders: [toolProvider],
    systemPrompt: 'You are a helpful AI assistant. When mathematical calculations are needed, you must use the calculate tool. Do not calculate directly.',
    debug: true,
    logger: customLogger
});
```

## Running the Example

1. **Ensure setup is complete** (see [Setup Guide](./setup.md))

2. **Navigate to examples directory**:
   ```bash
   cd apps/examples
   ```

3. **Run the example**:
   ```bash
   # Using bun (recommended)
   bun run 01-basic/02-ai-with-tools.ts
   
   # Using pnpm + tsx
   pnpm tsx 01-basic/02-ai-with-tools.ts
   ```

## Expected Output

```
Tool Provider: [Object containing tool provider details]
Tool Provider functions: [Array of function definitions]
Functions count: 1

===== Available Tools =====
Registered tools: ['calculate']
Tool schemas: [
  {
    "name": "calculate",
    "description": "Performs mathematical calculations",
    "parameters": {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "enum": ["add", "subtract", "multiply", "divide"]
        },
        "a": { "type": "number" },
        "b": { "type": "number" }
      }
    }
  }
]

===== General Conversation Example =====
Response: Hello! I'm doing well, thank you for asking. However, I don't have access to current weather information...

===== Tool Usage Example =====
🐛 Tool call requested: calculate
🐛 Tool parameters: {"operation":"multiply","a":5,"b":7}
[Tool Handler] Performing calculation: 5 multiply 7
[Tool Handler] Calculation result: { result: 35 }
ℹ️ Tool call completed: calculate
Response: I used the calculation tool to multiply 5 and 7, and the result is 35.

===== Complex Calculation Example =====
🐛 Tool call requested: calculate
🐛 Tool parameters: {"operation":"divide","a":100,"b":25}
[Tool Handler] Performing calculation: 100 divide 25
[Tool Handler] Calculation result: { result: 4 }
🐛 Tool call requested: calculate
🐛 Tool parameters: {"operation":"add","a":4,"b":3}
[Tool Handler] Performing calculation: 4 add 3
[Tool Handler] Calculation result: { result: 7 }
ℹ️ Tool call completed: calculate
Response: I'll help you with that calculation step by step:
1. First, I divided 100 by 25, which equals 4
2. Then, I added 3 to that result
The final answer is 7.
```

## Tool Development Patterns

### 1. Simple Calculator Tool
```typescript
const basicMathTool = {
    name: 'math',
    description: 'Performs basic mathematical operations',
    parameters: z.object({
        expression: z.string().describe('Mathematical expression to evaluate')
    }),
    handler: async ({ expression }) => {
        try {
            // Safe evaluation (implement proper parser in production)
            const result = eval(expression);
            return { result, expression };
        } catch (error) {
            return { error: 'Invalid mathematical expression' };
        }
    }
};
```

### 2. Data Lookup Tool
```typescript
const weatherTool = {
    name: 'getWeather',
    description: 'Gets current weather information',
    parameters: z.object({
        city: z.string().describe('City name'),
        units: z.enum(['metric', 'imperial']).optional().default('metric')
    }),
    handler: async ({ city, units }) => {
        // In real implementation, call weather API
        const mockData = {
            temperature: units === 'metric' ? 22 : 72,
            condition: 'sunny',
            humidity: 65
        };
        return { city, ...mockData, units };
    }
};
```

### 3. Complex Processing Tool
```typescript
const dataProcessingTool = {
    name: 'processData',
    description: 'Processes and analyzes data arrays',
    parameters: z.object({
        data: z.array(z.number()).describe('Array of numbers to process'),
        operation: z.enum(['sum', 'average', 'max', 'min']).describe('Operation to perform')
    }),
    handler: async ({ data, operation }) => {
        switch (operation) {
            case 'sum': return { result: data.reduce((a, b) => a + b, 0) };
            case 'average': return { result: data.reduce((a, b) => a + b, 0) / data.length };
            case 'max': return { result: Math.max(...data) };
            case 'min': return { result: Math.min(...data) };
        }
    }
};
```

## Advanced Features

### 1. Tool Validation and Error Handling
```typescript
const robustTool = {
    name: 'robustCalculation',
    description: 'Calculation with comprehensive error handling',
    parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number().min(-1000000).max(1000000),
        b: z.number().min(-1000000).max(1000000)
    }),
    handler: async (params) => {
        try {
            // Input validation
            if (!isFinite(params.a) || !isFinite(params.b)) {
                return { error: 'Numbers must be finite' };
            }
            
            // Operation logic with error handling
            const { operation, a, b } = params;
            let result;
            
            switch (operation) {
                case 'divide':
                    if (b === 0) return { error: 'Division by zero' };
                    result = a / b;
                    break;
                case 'add':
                    result = a + b;
                    break;
                default:
                    return { error: 'Unsupported operation' };
            }
            
            // Result validation
            if (!isFinite(result)) {
                return { error: 'Result is not a finite number' };
            }
            
            return { result, operation, inputs: { a, b } };
        } catch (error) {
            return { error: `Calculation failed: ${error.message}` };
        }
    }
};
```

### 2. Debugging and Monitoring
```typescript
const monitoredTool = {
    name: 'monitoredOperation',
    description: 'Tool with comprehensive monitoring',
    parameters: z.object({
        input: z.string()
    }),
    handler: async (params, context) => {
        const startTime = Date.now();
        
        try {
            console.log(`[${new Date().toISOString()}] Tool called with:`, params);
            
            // Simulate processing
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const result = { processed: params.input.toUpperCase() };
            const duration = Date.now() - startTime;
            
            console.log(`[${new Date().toISOString()}] Tool completed in ${duration}ms:`, result);
            
            return result;
        } catch (error) {
            const duration = Date.now() - startTime;
            console.error(`[${new Date().toISOString()}] Tool failed after ${duration}ms:`, error);
            return { error: error.message };
        }
    }
};
```

## Configuration Options

### Debug Mode Options
```typescript
const robota = new Robota({
    // ... other config
    debug: true,                    // Enable debug logging
    logger: customLogger,           // Custom logger implementation
    toolCallTimeout: 30000,         // Tool call timeout in ms
    maxToolCalls: 10               // Maximum tool calls per conversation
});
```

### Tool Provider Options
```typescript
const toolProvider = createZodFunctionToolProvider({
    tools: toolsMap,
    timeout: 30000,                 // Default tool timeout
    retries: 3,                     // Retry attempts for failed tools
    validateInputs: true,           // Enable input validation
    validateOutputs: false          // Enable output validation
});
```

## Best Practices

### 1. Tool Design
- **Keep tools focused**: Each tool should have a single, clear purpose
- **Use descriptive names**: Tool and parameter names should be self-explanatory
- **Provide good descriptions**: Help the AI understand when and how to use tools
- **Validate inputs**: Use Zod schemas for type safety and validation

### 2. Error Handling
```typescript
const handler = async (params) => {
    try {
        // Tool logic
        return { result: processedData };
    } catch (error) {
        // Return error in a structured format
        return { 
            error: error.message,
            code: error.code || 'UNKNOWN_ERROR',
            recoverable: true 
        };
    }
};
```

### 3. Performance Optimization
```typescript
// Use timeouts for long-running operations
const handler = async (params) => {
    return Promise.race([
        actualOperation(params),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Operation timeout')), 10000)
        )
    ]);
};
```

## Common Patterns

### Tool Chaining
AI can automatically chain tool calls for complex operations:
```
User: "Calculate 15 * 3, then add 20 to the result"
AI: 
1. Calls calculate(multiply, 15, 3) → 45
2. Calls calculate(add, 45, 20) → 65
Response: "The result is 65"
```

### Conditional Tool Usage
```typescript
const conditionalTool = {
    name: 'smartCalculation',
    parameters: z.object({
        numbers: z.array(z.number()),
        operation: z.string()
    }),
    handler: async ({ numbers, operation }) => {
        if (numbers.length === 0) {
            return { error: 'No numbers provided' };
        }
        
        switch (operation.toLowerCase()) {
            case 'sum':
                return { result: numbers.reduce((a, b) => a + b, 0) };
            case 'product':
                return { result: numbers.reduce((a, b) => a * b, 1) };
            default:
                return { error: 'Unsupported operation', supportedOps: ['sum', 'product'] };
        }
    }
};
```

## Next Steps

After mastering AI with tools, explore:

1. [**Zod Function Tools**](./zod-function-tools.md) - Advanced function tool patterns
2. [**Custom Function Providers**](./custom-function-providers.md) - Building custom providers
3. [**Multi-Provider Setup**](./multi-provider.md) - Using tools with multiple AI providers

## Troubleshooting

### Tool Not Found
- Verify tool is properly registered in the tool provider
- Check tool name matches exactly (case-sensitive)
- Ensure `getAvailableTools()` returns your tool

### Tool Call Failures
- Enable debug mode to see tool call details
- Check parameter validation with Zod schemas
- Verify tool handler returns proper format

### Performance Issues
- Implement tool timeouts
- Monitor tool execution time
- Consider async operations for I/O bound tools 