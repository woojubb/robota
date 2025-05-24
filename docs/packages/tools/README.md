# @robota-sdk/tools

Tools and utilities package for Robota SDK.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/tools @robota-sdk/core
```

## Overview

`@robota-sdk/tools` provides a comprehensive collection of tools and utilities for building AI agents with Robota SDK. This package includes:

- **Modern Tool Architecture**: Inheritance-based tool system with type-safe validation
- **Function Creation Utilities**: Zod-based function tools with automatic schema conversion
- **Tool Providers**: Pre-built providers for MCP, OpenAPI, and custom tools
- **Schema Validation**: Type-safe parameter validation and JSON schema conversion

## Modern Tool System

The package provides a modular tool architecture with abstract base classes and specific implementations:

### BaseTool Abstract Class

```typescript
import { BaseTool } from '@robota-sdk/tools';
import { z } from 'zod';

class CustomTool extends BaseTool<{ input: string }, string> {
  name = 'customTool';
  description = 'A custom tool example';
  
  // Define parameter schema
  protected defineParametersSchema() {
    return z.object({
      input: z.string().describe('Input text to process')
    });
  }
  
  // Implement execution logic
  protected async executeImplementation(params: { input: string }): Promise<string> {
    return `Processed: ${params.input}`;
  }
  
  // Convert to JSON schema
  toJsonSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input text to process' }
        },
        required: ['input']
      }
    };
  }
}
```

### ZodTool for Schema Validation

```typescript
import { ZodTool } from '@robota-sdk/tools';
import { z } from 'zod';

const weatherTool = new ZodTool({
  name: 'getWeather',
  description: 'Get weather information for a location',
  parameters: z.object({
    location: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius')
  }),
  execute: async (params) => {
    const { location, unit } = params;
    // Weather API call logic
    return { temperature: 22, condition: 'Sunny', unit };
  }
});

// Convert to JSON schema automatically
const schema = weatherTool.toJsonSchema();
```

### Tool Providers

Create tool providers for different schema types:

```typescript
import { Robota } from '@robota-sdk/core';
import { 
  createZodFunctionToolProvider, 
  createMcpToolProvider,
  createOpenAPIToolProvider 
} from '@robota-sdk/tools';
import { z } from 'zod';

// Zod-based function tools
const zodProvider = createZodFunctionToolProvider({
  tools: {
    calculate: {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number(),
        b: z.number()
      }),
      handler: async ({ operation, a, b }) => {
        switch (operation) {
          case 'add': return a + b;
          case 'subtract': return a - b;
          case 'multiply': return a * b;
          case 'divide': return a / b;
        }
      }
    }
  }
});

// MCP (Model Context Protocol) tools
const mcpProvider = createMcpToolProvider({
  serverUrl: 'http://localhost:3001',
  capabilities: ['tools']
});

// OpenAPI-based tools
const openApiProvider = createOpenAPIToolProvider({
  spec: './api-spec.json',
  baseURL: 'https://api.example.com'
});

// Use with Robota
const robota = new Robota({
  aiProviders: { /* AI providers */ },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [zodProvider, mcpProvider, openApiProvider]
});
```

## Function Creation Utilities

Create functions that AI can invoke with automatic parameter validation:

```typescript
import { createFunction, functionFromCallback } from '@robota-sdk/tools';
import { z } from 'zod';

// Create a function with Zod schema
const addFunction = createFunction({
  name: 'add',
  description: 'Add two numbers',
  parameters: z.object({
    a: z.number().describe('First number'),
    b: z.number().describe('Second number')
  }),
  execute: async (params) => {
    return { result: params.a + params.b };
  }
});

// Convert existing callback to Function
const multiplyFunction = functionFromCallback(
  'multiply',
  (a: number, b: number) => a * b,
  'Multiply two numbers'
);

// Function registry for management
import { FunctionRegistry } from '@robota-sdk/tools';

const registry = new FunctionRegistry();
registry.register(addFunction.schema, (args) => addFunction.execute(args));
registry.register(multiplyFunction.schema, (args) => multiplyFunction.execute(args));
```

## Schema Validation

Type-safe validation with detailed error handling:

```typescript
import { createFunctionSchema } from '@robota-sdk/tools';
import { z } from 'zod';

// Convert function definition to Zod schema
const schema = createFunctionSchema({
  name: 'processData',
  parameters: {
    type: 'object',
    properties: {
      data: { type: 'string' },
      options: { type: 'object' }
    },
    required: ['data']
  }
});

// Validate parameters
try {
  const validatedParams = schema.parse({ data: 'test', options: {} });
  // Use validated parameters
} catch (error) {
  // Handle validation errors
  console.error('Validation failed:', error);
}
```

## Available Tool Types

- **ZodTool**: For Zod schema-based validation and JSON schema conversion
- **McpTool**: For Model Context Protocol integration
- **OpenApiTool**: For OpenAPI specification-based tools
- **BaseTool**: Abstract base class for custom tool implementations

## Key Features

- **Type Safety**: Full TypeScript support with generic types
- **Automatic Schema Conversion**: Zod to JSON schema transformation
- **Parameter Validation**: Runtime validation with detailed error messages
- **Modular Architecture**: Inheritance-based design for extensibility
- **Multiple Protocols**: Support for MCP, OpenAPI, and custom schemas
- **Error Handling**: Standardized error handling across all tools
- **Tool Registry**: Centralized tool management and execution

## Migration from Core

Tool and function functionality has been moved from `@robota-sdk/core` to this package. The core package now re-exports these utilities for backward compatibility:

```typescript
// These imports work the same way
import { createFunction, FunctionRegistry } from '@robota-sdk/core';
import { createFunction, FunctionRegistry } from '@robota-sdk/tools';
```

## License

MIT 