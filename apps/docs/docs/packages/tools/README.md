# @robota-sdk/tools

Tools and utilities package for Robota SDK.

## Installation

```bash
npm install @robota-sdk/tools @robota-sdk/core
```

## Overview

`@robota-sdk/tools` provides a collection of useful tools and utilities for building AI agents with Robota SDK. This package includes function tools, formatters, validators, and other utilities that streamline the process of creating complex AI agents.

## Function Tools

Create and manage function tools for AI agents:

```typescript
import { Robota } from '@robota-sdk/core';
import { createZodFunctionToolProvider, type ZodFunctionTool } from '@robota-sdk/tools';
import { z } from 'zod';

// Define function tools with Zod schemas
const toolSchemas = {
  add: {
    name: 'add',
    description: 'Add two numbers and return the result',
    parameters: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number')
    }),
    handler: async (params) => {
      const { a, b } = params as { a: number; b: number };
      return { result: a + b };
    }
  },
  
  getWeather: {
    name: 'getWeather',
    description: 'Get weather information for a location',
    parameters: z.object({
      location: z.string().describe('City name'),
      unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius')
    }),
    handler: async (params) => {
      // Implement weather lookup logic
      return { temperature: 22, condition: 'Sunny' };
    }
  }
};

// Create function tool provider
const provider = createZodFunctionToolProvider({
  model: 'function-model',
  tools: toolSchemas
});

// Use with Robota
const robota = new Robota({ provider });
const response = await robota.run('What is 5 + 7?');
```

## Utilities

### Schema Validation

Validate function parameters and ensure type safety:

```typescript
import { validateSchema } from '@robota-sdk/tools';
import { z } from 'zod';

const schema = z.object({
  name: z.string(),
  age: z.number().min(0)
});

// Validate data against schema
const result = validateSchema(schema, { name: 'John', age: 30 });
if (result.success) {
  // Use validated data
  console.log(result.data.name);
} else {
  // Handle validation errors
  console.error(result.error);
}
```

## Features

- Zod-based function tool creation
- Type-safe function calling
- Standardized error handling
- Parameter validation
- Custom tool providers

## License

MIT 