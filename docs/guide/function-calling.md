---
title: Function Calling
description: Function Calling in Robota
lang: en-US
---

# Function Calling

Advanced tool integration and function calling with the Robota SDK.

## Overview

The Robota SDK provides a powerful, type-safe function calling system that allows AI agents to interact with external tools, APIs, and services. The system is built around JSON Schema validation and automatic schema conversion.

### Key Features

- **Type-Safe Tool Creation**: Built-in TypeScript safety
- **JSON Schema Validation**: Automatic parameter validation
- **Cross-Provider Support**: Works with OpenAI, Anthropic, and Google AI
- **Automatic Schema Conversion**: JSON Schema → Function call schemas
- **Error Handling**: Robust error handling and recovery

## Basic Function Calling

### Creating Your First Tool

```typescript
import { Robota, createFunctionTool } from '@robota-sdk/agents';

// Create a simple calculator tool
const calculatorTool = createFunctionTool(
    'calculate',
    'Performs mathematical calculations',
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
        
            switch (operation) {
            case 'add':
                return { result: a + b };
            case 'subtract':
                return { result: a - b };
            case 'multiply':
                return { result: a * b };
            case 'divide':
                if (b === 0) {
                    return { error: 'Cannot divide by zero' };
                }
                return { result: a / b };
            default:
                return { error: 'Unknown operation' };
        }
    }
);

// Create agent with the tool
const agent = new Robota({
    name: 'CalculatorAgent',
    model: 'gpt-3.5-turbo',
    provider: 'openai',
    aiProviders: { openai: openaiProvider },
    tools: [calculatorTool],
    systemMessage: 'You are a helpful assistant with calculation abilities.'
});

// Use the agent - it will automatically call the tool when needed
const response = await agent.run('What is 25 multiplied by 7?');
console.log(response); // The AI will use the calculator tool
```

## Advanced Tool Patterns

### Weather Information Tool

```typescript
const weatherTool = createFunctionTool(
    'getWeather',
    'Get current weather information for a location',
    {
        type: 'object',
        properties: {
            location: {
                type: 'string',
                description: 'City name or coordinates'
            },
            units: {
                type: 'string',
                enum: ['celsius', 'fahrenheit', 'kelvin'],
                default: 'celsius',
                description: 'Temperature units'
            }
        },
        required: ['location']
    },
    async (params) => {
        // In a real implementation, you'd call a weather API
        const { location, units = 'celsius' } = params;
        
        try {
        // Simulate API call
            const weatherData = await fetchWeatherAPI(location, units);
            
            return {
            location,
                temperature: weatherData.temperature,
                condition: weatherData.condition,
                humidity: weatherData.humidity,
                units
            };
        } catch (error) {
            return {
                error: `Failed to get weather for ${location}: ${error.message}`
            };
    }
    }
);
```

### Database Query Tool

```typescript
const databaseTool = createFunctionTool(
    'queryDatabase',
    'Query the database for information',
    {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'SQL query to execute'
            },
            table: {
                type: 'string',
                enum: ['users', 'products', 'orders'],
                description: 'Table to query'
            },
            limit: {
                type: 'number',
                minimum: 1,
                maximum: 100,
                default: 10,
                description: 'Maximum number of results'
            }
        },
        required: ['query', 'table']
    },
    async (params) => {
        const { query, table, limit = 10 } = params;
        
        // Validate query for security
        if (!isValidQuery(query, table)) {
        return {
                error: 'Invalid or unsafe query'
            };
        }
        
        try {
            const results = await executeQuery(query, { table, limit });
            return {
                results,
                count: results.length,
                table
            };
        } catch (error) {
            return {
                error: `Database query failed: ${error.message}`
        };
    }
    }
);
```

### File System Tool

```typescript
const fileTool = createFunctionTool(
    'fileOperations',
    'Perform file system operations',
    {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['read', 'write', 'list', 'delete'],
                description: 'File operation to perform'
            },
            path: {
                type: 'string',
                description: 'File or directory path'
            },
            content: {
                type: 'string',
                description: 'Content to write (for write operation)'
            },
            encoding: {
                type: 'string',
                enum: ['utf8', 'base64', 'binary'],
                default: 'utf8',
                description: 'File encoding'
            }
        },
        required: ['operation', 'path']
    },
    async (params) => {
        const { operation, path, content, encoding = 'utf8' } = params;
        
        // Security check - only allow operations in allowed directories
        if (!isAllowedPath(path)) {
            return {
                error: 'Access denied: path not allowed'
            };
        }
        
        try {
            switch (operation) {
                case 'read':
                    const fileContent = await fs.readFile(path, encoding);
                    return { content: fileContent, path, encoding };
                    
                case 'write':
                    if (!content) {
                        return { error: 'Content required for write operation' };
                    }
                    await fs.writeFile(path, content, encoding);
                    return { success: true, path, bytesWritten: content.length };
                    
                case 'list':
                    const files = await fs.readdir(path);
                    return { files, path, count: files.length };
                    
                case 'delete':
                    await fs.unlink(path);
                    return { success: true, path, deleted: true };
                    
                default:
                    return { error: `Unknown operation: ${operation}` };
            }
        } catch (error) {
            return {
                error: `File operation failed: ${error.message}`,
                operation,
                path
            };
        }
    }
);
```

## Multi-Tool Agents

### Combining Multiple Tools

```typescript
// Create a comprehensive agent with multiple tools
const multiToolAgent = new Robota({
    name: 'MultiToolAgent',
    model: 'gpt-4',
    provider: 'openai',
    aiProviders: { openai: openaiProvider },
    tools: [
        calculatorTool,
        weatherTool,
        databaseTool,
        fileTool
    ],
    systemMessage: `You are a helpful assistant with access to multiple tools:
    - Calculator for mathematical operations
    - Weather information for any location
    - Database queries for data retrieval
    - File system operations for file management
    
    Use these tools when appropriate to help users with their requests.`
});

// Complex multi-step task
const response = await multiToolAgent.run(`
    Please help me with the following tasks:
    1. Calculate the average temperature if it's 23°C in London and 18°C in Paris
    2. Save this result to a file called "temp-analysis.txt"
    3. Query the database for all users in the "users" table
`);
```

### Tool-Specific Error Handling

```typescript
const robustTool = createFunctionTool(
    'robustOperation',
    'A tool with comprehensive error handling',
    {
        type: 'object',
        properties: {
            action: { type: 'string', description: 'Action to perform' },
            data: { type: 'object', description: 'Input data' }
        },
        required: ['action']
    },
    async (params) => {
        const { action, data } = params;
        
        try {
            // Validate input
            if (!isValidAction(action)) {
                return {
                    error: 'Invalid action',
                    code: 'INVALID_ACTION',
                    details: { validActions: getValidActions() }
                };
            }
            
            // Perform operation with timeout
            const result = await Promise.race([
                performOperation(action, data),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Operation timeout')), 30000)
                )
            ]);
            
            return {
                success: true,
                result,
                action,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            return {
                error: error.message,
                code: 'OPERATION_FAILED',
                action,
                timestamp: new Date().toISOString(),
                details: {
                    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
                }
            };
        }
    }
);
```

## Streaming with Tools

### Real-time Tool Execution

```typescript
const agent = new Robota({
    name: 'StreamingToolAgent',
    model: 'gpt-3.5-turbo',
    provider: 'openai',
    aiProviders: { openai: openaiProvider },
    tools: [calculatorTool, weatherTool],
    systemMessage: 'You are a helpful assistant. Use tools when needed.'
});

// Stream responses while tools are being executed
const stream = await agent.stream('What\'s the weather in Tokyo and what\'s 15 * 8?');

for await (const chunk of stream) {
    if (chunk.type === 'content') {
        process.stdout.write(chunk.content);
    } else if (chunk.type === 'tool_call') {
        console.log(`\n[Tool Call] ${chunk.toolName}: ${JSON.stringify(chunk.parameters)}`);
    } else if (chunk.type === 'tool_result') {
        console.log(`[Tool Result] ${JSON.stringify(chunk.result)}\n`);
    }
}
```

## Advanced Patterns

### Tool Registry

```typescript
import { ToolRegistry } from '@robota-sdk/agents';

// Create a tool registry
const toolRegistry = new ToolRegistry();

// Register tools
toolRegistry.register('calculator', calculatorTool);
toolRegistry.register('weather', weatherTool);
toolRegistry.register('database', databaseTool);

// Create agent with registry
const agent = new Robota({
    name: 'RegistryAgent',
    model: 'gpt-3.5-turbo',
    provider: 'openai',
    aiProviders: { openai: openaiProvider },
    tools: toolRegistry.getAllTools(),
    systemMessage: 'You have access to various tools through the registry.'
});

// Dynamically add tools
toolRegistry.register('newTool', createNewTool());
```

### Conditional Tools

```typescript
// Tools that are only available under certain conditions
const conditionalAgent = new Robota({
    name: 'ConditionalAgent',
    model: 'gpt-3.5-turbo',
    provider: 'openai',
    aiProviders: { openai: openaiProvider },
    tools: [
        // Always available
        calculatorTool,
        
        // Only available if user has permission
        ...(userHasPermission ? [databaseTool] : []),
        
        // Only available in development
        ...(process.env.NODE_ENV === 'development' ? [debugTool] : [])
    ],
    systemMessage: 'You are a helpful assistant with context-specific tools.'
});
```

### Tool Composition

```typescript
// Compose complex tools from simpler ones
const compositeWorkflowTool = createFunctionTool(
    'dataAnalysisWorkflow',
    'Perform complete data analysis workflow',
    {
        type: 'object',
        properties: {
            dataSource: { type: 'string', description: 'Data source identifier' },
            analysisType: { 
                type: 'string', 
                enum: ['summary', 'trend', 'comparison'],
                description: 'Type of analysis to perform'
            }
        },
        required: ['dataSource', 'analysisType']
    },
    async (params) => {
        const { dataSource, analysisType } = params;
        
        try {
            // Step 1: Fetch data
            const data = await fetchData(dataSource);
            
            // Step 2: Process data
            const processedData = await processData(data, analysisType);
            
            // Step 3: Generate insights
            const insights = await generateInsights(processedData);
            
            // Step 4: Create visualization
            const visualization = await createVisualization(insights);

            return { 
                success: true,
                dataSource,
                analysisType,
                insights,
                visualization,
                summary: generateSummary(insights)
            };

        } catch (error) {
            return { 
                error: `Workflow failed: ${error.message}`,
                dataSource,
                analysisType,
                step: error.step || 'unknown'
            };
        }
    }
);
```

## Best Practices

### ✅ Do

1. **Use descriptive names**: Tool names should be clear and specific
2. **Validate inputs**: Always validate parameters before processing
3. **Handle errors gracefully**: Return error objects instead of throwing
4. **Provide detailed schemas**: Include descriptions for all parameters
5. **Use enums for limited options**: Constrain parameter values when possible
6. **Implement timeouts**: Prevent tools from hanging indefinitely
7. **Log tool usage**: Track tool calls for debugging and analytics

### ❌ Don't

1. **Expose sensitive operations**: Don't allow dangerous file system operations
2. **Skip input validation**: Always validate parameters
3. **Return undefined**: Always return a result object
4. **Use vague error messages**: Provide specific error information
5. **Ignore security**: Validate permissions and sanitize inputs
6. **Create overly complex tools**: Keep tools focused on single tasks

### Security Considerations

```typescript
// Example of secure tool implementation
const secureTool = createFunctionTool(
    'secureFileRead',
    'Securely read files with permission checks',
    {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'File path to read' }
        },
        required: ['path']
    },
    async (params) => {
        const { path } = params;
        
        // 1. Validate path
        if (!isValidPath(path)) {
            return { error: 'Invalid file path' };
        }
        
        // 2. Check permissions
        if (!hasReadPermission(path)) {
            return { error: 'Access denied' };
        }
        
        // 3. Sanitize path
        const safePath = sanitizePath(path);
        
        // 4. Perform operation
        try {
            const content = await fs.readFile(safePath, 'utf8');
            return { content, path: safePath };
        } catch (error) {
            return { error: `Failed to read file: ${error.message}` };
        }
    }
);
```

## Performance Optimization

### Tool Caching

```typescript
// Implement caching for expensive operations
const cache = new Map();

const cachedTool = createFunctionTool(
    'expensiveOperation',
    'Perform expensive operation with caching',
    {
        type: 'object',
        properties: {
            input: { type: 'string', description: 'Input data' }
        },
        required: ['input']
    },
    async (params) => {
        const { input } = params;
        const cacheKey = `expensive-${input}`;
        
        // Check cache first
        if (cache.has(cacheKey)) {
            return {
                result: cache.get(cacheKey),
                cached: true,
                timestamp: new Date().toISOString()
            };
        }
        
        // Perform expensive operation
        const result = await expensiveOperation(input);
        
        // Cache result
        cache.set(cacheKey, result);
        
        return {
            result,
            cached: false,
            timestamp: new Date().toISOString()
        };
    }
);
```

## Next Steps

- **[Building Agents](./building-agents.md)** - Learn advanced agent patterns
- **[Examples](../examples/README.md)** - See complete working examples
- **[Performance Optimization](../development/performance-optimization.md)** - Optimize tool performance