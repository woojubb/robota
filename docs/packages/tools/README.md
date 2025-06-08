# @robota-sdk/tools

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Ftools.svg)](https://www.npmjs.com/package/@robota-sdk/tools)

Tools and utilities package for Robota SDK - Type-safe function calling with Zod schema validation and OpenAPI integration.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/tools @robota-sdk/core zod
```

## Overview

`@robota-sdk/tools` provides a comprehensive collection of tools and utilities for building AI agents with Robota SDK. This package includes type-safe function calling, OpenAPI integration, and a modern tool architecture for extending AI capabilities.

## Key Features & Advantages

### 🛠️ **Type-Safe Function Calling**
- Zod schema-based type-safe function definitions
- Automatic parameter validation and type inference
- Extensible tool system architecture
- Runtime validation with detailed error messages

### 🔧 **OpenAPI Integration**
- Automatic tool generation from Swagger/OpenAPI specifications
- Quick AI agent integration with existing REST APIs
- Type-safe API client generation
- Dynamic API discovery and tool creation

### 🏗️ **Modern Tool Architecture**
- Inheritance-based tool system with abstract base classes
- Modular design for maximum extensibility
- Plugin-style tool and provider system
- Multiple protocol support (MCP, OpenAPI, custom schemas)

### 📊 **Schema Validation & Conversion**
- Automatic Zod to JSON schema transformation
- Type-safe parameter validation
- Comprehensive error handling
- Tool registry for centralized management

## Modern Tool System

The package provides a modular tool architecture with abstract base classes and specific implementations:

### Type-Safe Function Tools with Zod

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { Robota } from '@robota-sdk/core';
import { z } from 'zod';

// Create advanced calculator tool
const calculatorTool = createZodFunctionToolProvider({
  tools: {
    calculate: {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
        a: z.number().describe('First number'),
        b: z.number().describe('Second number')
      }),
      handler: async ({ operation, a, b }) => {
        switch (operation) {
          case 'add': return { result: a + b };
          case 'subtract': return { result: a - b };
          case 'multiply': return { result: a * b };
          case 'divide': return { result: a / b };
        }
      }
    },
    getWeather: {
      name: 'getWeather',
      description: 'Get weather information for a location',
      parameters: z.object({
        location: z.string().describe('City name'),
        unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius'),
        includeForecast: z.boolean().optional().default(false)
      }),
      handler: async ({ location, unit, includeForecast }) => {
        // Weather API integration
        const result = {
          location,
          temperature: 22,
          condition: 'Sunny',
          unit
        };
        
        if (includeForecast) {
          result.forecast = [
            { day: 'Tomorrow', temp: 24, condition: 'Partly Cloudy' },
            { day: 'Day After', temp: 20, condition: 'Rainy' }
          ];
        }
        
        return result;
      }
    }
  }
});

// Use with Robota
const robota = new Robota({
  aiProviders: { /* AI providers */ },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [calculatorTool],
  systemPrompt: 'Use the calculator and weather tools to help users.'
});

const response = await robota.run('Calculate 15 * 7 and get weather for Seoul with forecast');
```

### OpenAPI Integration

Automatically generate tools from OpenAPI specifications:

```typescript
import { createOpenAPIToolProvider } from '@robota-sdk/tools';

// Create tools from OpenAPI specification
const apiToolProvider = createOpenAPIToolProvider({
  spec: './api-spec.json', // Path to OpenAPI spec
  baseURL: 'https://api.example.com',
  authentication: {
    type: 'bearer',
    token: process.env.API_TOKEN
  },
  includeOperations: ['getUserProfile', 'updateUserData', 'searchProducts'], // Optional: filter operations
  customHeaders: {
    'User-Agent': 'Robota-SDK/1.0'
  }
});

// Alternative: Load from URL
const remoteApiProvider = createOpenAPIToolProvider({
  specUrl: 'https://api.example.com/openapi.json',
  baseURL: 'https://api.example.com'
});

const robota = new Robota({
  aiProviders: { /* AI providers */ },
  currentProvider: 'openai',
  currentModel: 'gpt-4',
  toolProviders: [apiToolProvider],
  systemPrompt: 'You can access user data and search products using the API tools.'
});

const response = await robota.run('Get my user profile and search for laptops under $1000');
```

### BaseTool Abstract Class

Create custom tools with the modern architecture:

```typescript
import { BaseTool } from '@robota-sdk/tools';
import { z } from 'zod';

class WebScrapingTool extends BaseTool<{ url: string; selector?: string }, { content: string; title: string }> {
  name = 'scrapeWebPage';
  description = 'Scrape content from a web page';
  
  // Define parameter schema
  protected defineParametersSchema() {
    return z.object({
      url: z.string().url().describe('URL to scrape'),
      selector: z.string().optional().describe('CSS selector for specific content')
    });
  }
  
  // Implement execution logic
  protected async executeImplementation(params: { url: string; selector?: string }) {
    // Web scraping implementation
    const content = `Scraped content from ${params.url}`;
    const title = 'Page Title';
    
    if (params.selector) {
      // Apply CSS selector logic
    }
    
    return { content, title };
  }
  
  // Convert to JSON schema automatically
  toJsonSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri', description: 'URL to scrape' },
          selector: { type: 'string', description: 'CSS selector for specific content' }
        },
        required: ['url']
      }
    };
  }
}

// Use custom tool
const webTool = new WebScrapingTool();
const customToolProvider = createZodFunctionToolProvider({
  tools: { scrapeWeb: webTool }
});
```

### ZodTool for Advanced Validation

```typescript
import { ZodTool } from '@robota-sdk/tools';
import { z } from 'zod';

const advancedAnalysisTool = new ZodTool({
  name: 'analyzeData',
  description: 'Perform advanced data analysis',
  parameters: z.object({
    data: z.array(z.number()).describe('Array of numerical data'),
    analysisType: z.enum(['mean', 'median', 'mode', 'regression']).default('mean'),
    options: z.object({
      precision: z.number().min(1).max(10).default(2),
      includeVisualization: z.boolean().default(false)
    }).optional()
  }),
  execute: async (params) => {
    const { data, analysisType, options = {} } = params;
    
    let result: number;
    switch (analysisType) {
      case 'mean':
        result = data.reduce((a, b) => a + b, 0) / data.length;
        break;
      case 'median':
        const sorted = data.sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        result = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        break;
      // ... other analysis types
    }
    
    return {
      analysisType,
      result: Number(result.toFixed(options.precision || 2)),
      dataPoints: data.length,
      visualization: options.includeVisualization ? 'Chart generated' : null
    };
  }
});

// Convert to JSON schema automatically
const schema = advancedAnalysisTool.toJsonSchema();
```

## Available Tool Types

- **ZodTool**: For Zod schema-based validation and JSON schema conversion
- **McpTool**: For Model Context Protocol integration
- **OpenApiTool**: For OpenAPI specification-based tools
- **BaseTool**: Abstract base class for custom tool implementations

## Performance Optimization

`@robota-sdk/tools` includes comprehensive performance optimization features to ensure efficient tool execution and memory management:

### 🚀 **Caching System**

Automatic caching of function schemas and tool definitions to prevent redundant transformations:

```typescript
import { 
  createZodFunctionToolProvider, 
  globalFunctionSchemaCache,
  CacheManager 
} from '@robota-sdk/tools';

// Automatic caching enabled by default
const toolProvider = createZodFunctionToolProvider({
  tools: { /* your tools */ },
  enableCache: true // Default: true
});

// Custom cache configuration
const customCache = new CacheManager({
  maxSize: 1000,
  defaultTTL: 30 * 60 * 1000 // 30 minutes
});

const optimizedProvider = createZodFunctionToolProvider({
  tools: { /* your tools */ },
  cacheManager: customCache
});

// Cache statistics
const stats = toolProvider.getCacheStats();
console.log(`Cache hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
```

### ⚡ **Lazy Loading**

Tools and resources are loaded only when needed, reducing initial memory footprint:

```typescript
import { LazyLoader, globalToolLazyLoader } from '@robota-sdk/tools';

// Register tools for lazy loading
globalToolLazyLoader.registerTool('heavyTool', heavyToolDefinition, 1); // priority: 1 (high)
globalToolLazyLoader.registerTool('lightTool', lightToolDefinition, 10); // priority: 10 (low)

// Load on demand
const tool = await globalToolLazyLoader.load('heavyTool');

// Preload high-priority tools
await globalToolLazyLoader.preload(5); // Load top 5 priority tools
```

### 🧹 **Memory Management**

Automatic resource cleanup and memory leak prevention:

```typescript
import { globalResourceManager } from '@robota-sdk/tools';

// Resources are automatically managed
// Manual cleanup if needed
await globalResourceManager.cleanupOld(); // Clean old resources
await globalResourceManager.cleanupAll(); // Clean all resources

// Resource statistics
const stats = globalResourceManager.getStats();
console.log(`Memory usage: ${(stats.estimatedMemoryUsage / 1024 / 1024).toFixed(2)}MB`);
```

### 📊 **Performance Monitoring**

Real-time performance tracking and metrics:

```typescript
import { globalPerformanceMonitor } from '@robota-sdk/tools';

// Performance monitoring is automatic
// Access metrics
const metrics = globalPerformanceMonitor.getMetrics();
console.log(`Average call time: ${metrics.averageCallTime.toFixed(2)}ms`);
console.log(`Success rate: ${(metrics.successRate * 100).toFixed(2)}%`);
console.log(`Throughput: ${metrics.throughput.toFixed(2)} TPS`);

// Tool-specific metrics
const toolMetrics = globalPerformanceMonitor.getToolMetrics('myTool');

// Generate performance report
const report = globalPerformanceMonitor.generateReport();
console.log(report);

// Event listeners for real-time monitoring
globalPerformanceMonitor.addEventListener((metrics) => {
  if (metrics.averageCallTime > 1000) {
    console.warn('Tool performance degraded');
  }
});
```

### 🎛️ **Configuration Options**

Fine-tune performance settings:

```typescript
import { 
  CacheManager, 
  LazyLoader, 
  ResourceManager,
  PerformanceMonitor 
} from '@robota-sdk/tools';

// Cache configuration
const cache = new CacheManager({
  maxSize: 500,           // Maximum cache entries
  defaultTTL: 3600000     // 1 hour TTL
});

// Lazy loader configuration
const loader = new LazyLoader({
  maxConcurrentLoads: 3,  // Limit concurrent loading
  cache: cache            // Use custom cache
});

// Resource manager configuration
const resourceManager = new ResourceManager({
  maxAge: 1800000,        // 30 minutes max age
  maxMemoryUsage: 100 * 1024 * 1024, // 100MB limit
  cleanupIntervalMs: 300000 // 5 minutes cleanup interval
});

// Performance monitor configuration
const perfMonitor = new PerformanceMonitor({
  maxRecords: 5000,       // Keep 5000 call records
  monitoringIntervalMs: 10000 // Report every 10 seconds
});
```

## Key Features

- **Type Safety**: Full TypeScript support with generic types
- **Automatic Schema Conversion**: Zod to JSON schema transformation
- **Parameter Validation**: Runtime validation with detailed error messages
- **Modular Architecture**: Inheritance-based design for extensibility
- **Multiple Protocols**: Support for MCP, OpenAPI, and custom schemas
- **Error Handling**: Standardized error handling across all tools
- **Tool Registry**: Centralized tool management and execution
- **Performance Optimization**: Caching, lazy loading, and resource management
- **Real-time Monitoring**: Performance metrics and automatic optimization

## Package Architecture

`@robota-sdk/tools` is designed as a standalone package that provides all tool-related functionality. The `@robota-sdk/core` package uses tools from this package but does not re-export them to maintain clear module separation.

To use tools functionality, import directly from `@robota-sdk/tools`:

```typescript
// ✅ Correct - Import from tools package
import { createFunction, ZodTool, FunctionRegistry } from '@robota-sdk/tools';

// ❌ Incorrect - Don't import tools from core package
// import { createFunction } from '@robota-sdk/core';
```

## License

MIT 