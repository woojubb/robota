# @robota-sdk/mcp

Model Context Protocol (MCP) integration package for Robota SDK.

## Installation

```bash
npm install @robota-sdk/mcp @robota-sdk/core @modelcontextprotocol/sdk
```

## Overview

`@robota-sdk/mcp` provides integration with the Model Context Protocol (MCP) for Robota SDK. This package allows you to use any MCP-compatible AI model provider within the Robota framework.

## What is MCP?

The Model Context Protocol (MCP) is a standardized interface for interacting with different AI models. By implementing the MCP interface, Robota can seamlessly work with any provider that supports this protocol.

## Basic Usage

```typescript
import { Robota } from '@robota-sdk/core';
import { MCPProvider } from '@robota-sdk/mcp';
import { createMCPClient } from '@modelcontextprotocol/sdk';

// Create an MCP client
const mcpClient = createMCPClient({
  // Configuration for your MCP-compatible model provider
  apiKey: process.env.MCP_API_KEY,
  baseUrl: 'https://your-mcp-provider.com/api'
});

// Create MCP provider
const provider = new MCPProvider({
  model: 'your-model-name',
  client: mcpClient
});

// Create Robota instance with MCP provider
const robota = new Robota({
  provider,
  systemPrompt: 'You are a helpful AI assistant.'
});

// Run a simple conversation
const response = await robota.run('What are the benefits of using a standardized protocol?');
console.log(response);
```

## Function Calling

MCP provider supports function calling capabilities when available in the underlying model:

```typescript
import { Robota } from '@robota-sdk/core';
import { MCPProvider } from '@robota-sdk/mcp';
import { createMCPClient } from '@modelcontextprotocol/sdk';
import { z } from 'zod';

// Initialize provider with tools
const provider = new MCPProvider({
  model: 'your-model-name',
  client: createMCPClient({ /* config */ }),
  tools: [
    {
      name: 'searchDatabase',
      description: 'Search a database for information',
      parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Maximum number of results')
      }),
      execute: async (params) => {
        // Implement database search logic
        return { results: ['Result 1', 'Result 2'] };
      }
    }
  ]
});

const robota = new Robota({ provider });
const response = await robota.run('Search for information about neural networks');
```

## Benefits

- **Interoperability**: Use any MCP-compatible model with Robota
- **Standardization**: Consistent interface across different model providers
- **Future-proof**: Easily integrate new model providers as they become available

## License

MIT 