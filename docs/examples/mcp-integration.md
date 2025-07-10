# MCP Integration (Model Context Protocol)

This example demonstrates how to integrate Robota with MCP (Model Context Protocol) servers, enabling powerful tool and context sharing capabilities.

## Overview

The MCP integration example shows how to:
- Set up MCP client connections to external servers
- Use MCP tools within Robota conversations
- Handle MCP server communication and protocols
- Integrate MCP with AI providers for enhanced capabilities
- Manage MCP server lifecycle and error handling

## Source Code

**Location**: `apps/examples/03-integrations/01-mcp-client.ts`

## Key Concepts

### 1. MCP Client Setup
```typescript
import { Client } from "@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import { createMcpToolProvider } from "@robota-sdk/agents";
import { Robota } from "@robota-sdk/agents";
import { OpenAIProvider } from "@robota-sdk/openai";

// Create MCP transport to communicate with server
const transport = new StdioClientTransport({
    command: 'npx',
    args: ['ts-node', serverPath], // Path to your MCP server
});

// Create MCP client
const mcpClient = new Client({
    name: 'robota-mcp-client',
    version: '1.0.0',
});

// Connect to MCP server
await mcpClient.connect(transport);
```

### 2. MCP Tool Provider Integration
```typescript
// Create MCP tool provider from connected client
const mcpProvider = createMcpToolProvider(mcpClient);

// Create Robota with both AI and MCP providers
const robota = new Robota({
    aiProviders: {
        'openai': openaiProvider
    },
    currentModel: 'gpt-3.5-turbo',
    toolProviders: [mcpProvider],
    systemPrompt: 'You are an assistant with access to MCP tools and services.'
});
```

### 3. Using MCP Tools in Conversations
```typescript
// The AI can automatically discover and use MCP tools
const response1 = await robota.run('Please calculate 15 + 25 using available tools');

// MCP tools are called transparently
const response2 = await robota.run('What\'s the weather like in Seoul?');

// Complex operations using multiple MCP tools
const response3 = await robota.run('Calculate the average temperature for the cities: Seoul, Busan, Jeju');
```

## Running the Example

### Prerequisites

1. **MCP Server Setup**: You need a running MCP server. The example assumes a server at `../../services/mcp-server.ts`

2. **Environment Configuration**:
   ```env
   OPENAI_API_KEY=your_openai_key_here
   ```

### Execution Steps

1. **Ensure MCP server is available**:
   ```bash
   # Make sure your MCP server script exists and is executable
   ls -la apps/services/mcp-server.ts
   ```

2. **Navigate to examples directory**:
   ```bash
   cd apps/examples
   ```

3. **Run the MCP integration example**:
   ```bash
   # Using bun (recommended)
   bun run 03-integrations/01-mcp-client.ts
   
   # Using pnpm + tsx
   pnpm tsx 03-integrations/01-mcp-client.ts
   ```

## Expected Output

```
Starting MCP agent example...
MCP server path: /path/to/apps/services/mcp-server.ts

1. Creating MCP transport...
2. Creating MCP client...
3. Creating MCP tool provider...
4. Creating OpenAI client...
5. Creating OpenAI provider...
6. Creating Robota agent instance...

----- Calculation Tool Call Example -----
User: Please add 5 and 7.
[MCP Tool] Calculator called: add(5, 7)
Response: I've calculated 5 + 7 using the calculator tool, and the result is 12.

----- Weather Information Request Example -----
User: Please tell me the current weather in Seoul.
[MCP Tool] Weather service called: getWeather("Seoul", "celsius")
Response: Here's the current weather information for Seoul:
- Temperature: 22°C
- Condition: Clear
- Humidity: 65%

----- Additional Weather Information Request Example (Fahrenheit) -----
User: Please tell me the weather in Jeju in Fahrenheit.
[MCP Tool] Weather service called: getWeather("Jeju", "fahrenheit") 
Response: Here's the weather information for Jeju in Fahrenheit:
- Temperature: 79°F
- Condition: Cloudy
- Humidity: 75%

Closing connection...
Robota instance has been closed.

===== MCP Client Example Completed =====
```

## Advanced MCP Patterns

### 1. Custom MCP Server Creation
```typescript
// Example MCP server implementation
import { Server } from "@modelcontextprotocol/sdk/dist/esm/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/dist/esm/server/stdio.js";

class CustomMCPServer {
    private server: Server;
    
    constructor() {
        this.server = new Server({
            name: "custom-mcp-server",
            version: "1.0.0"
        }, {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {}
            }
        });
        
        this.setupTools();
        this.setupResources();
    }
    
    private setupTools() {
        // Register calculator tool
        this.server.setRequestHandler("tools/list", async () => ({
            tools: [
                {
                    name: "calculate",
                    description: "Perform mathematical calculations",
                    inputSchema: {
                        type: "object",
                        properties: {
                            operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
                            a: { type: "number" },
                            b: { type: "number" }
                        },
                        required: ["operation", "a", "b"]
                    }
                },
                {
                    name: "weather",
                    description: "Get weather information",
                    inputSchema: {
                        type: "object",
                        properties: {
                            city: { type: "string" },
                            units: { type: "string", enum: ["celsius", "fahrenheit"], default: "celsius" }
                        },
                        required: ["city"]
                    }
                }
            ]
        }));
        
        // Handle tool calls
        this.server.setRequestHandler("tools/call", async (request) => {
            const { name, arguments: args } = request.params;
            
            switch (name) {
                case "calculate":
                    return this.handleCalculation(args);
                case "weather":
                    return this.handleWeather(args);
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }
        });
    }
    
    private async handleCalculation(args: any) {
        const { operation, a, b } = args;
        let result: number;
        
        switch (operation) {
            case "add": result = a + b; break;
            case "subtract": result = a - b; break;
            case "multiply": result = a * b; break;
            case "divide": 
                if (b === 0) throw new Error("Division by zero");
                result = a / b; 
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }
        
        return {
            content: [
                {
                    type: "text",
                    text: `Calculation result: ${a} ${operation} ${b} = ${result}`
                }
            ]
        };
    }
    
    private async handleWeather(args: any) {
        const { city, units = "celsius" } = args;
        
        // Mock weather data
        const weatherData = {
            'Seoul': { temp: 22, condition: 'Clear', humidity: 65 },
            'Busan': { temp: 24, condition: 'Partly Cloudy', humidity: 70 },
            'Jeju': { temp: 26, condition: 'Cloudy', humidity: 75 }
        };
        
        const data = weatherData[city];
        if (!data) {
            throw new Error(`Weather data not available for ${city}`);
        }
        
        const temperature = units === "fahrenheit" 
            ? Math.round(data.temp * 9/5 + 32)
            : data.temp;
        
        return {
            content: [
                {
                    type: "text",
                    text: `Weather in ${city}: ${temperature}°${units === "celsius" ? "C" : "F"}, ${data.condition}, Humidity: ${data.humidity}%`
                }
            ]
        };
    }
    
    private setupResources() {
        // Register available resources
        this.server.setRequestHandler("resources/list", async () => ({
            resources: [
                {
                    uri: "weather://current",
                    name: "Current Weather Data",
                    mimeType: "application/json"
                }
            ]
        }));
        
        // Handle resource requests
        this.server.setRequestHandler("resources/read", async (request) => {
            const { uri } = request.params;
            
            if (uri === "weather://current") {
                return {
                    contents: [
                        {
                            uri: "weather://current",
                            mimeType: "application/json",
                            text: JSON.stringify({
                                lastUpdated: new Date().toISOString(),
                                cities: ["Seoul", "Busan", "Jeju"],
                                source: "Mock Weather API"
                            })
                        }
                    ]
                };
            }
            
            throw new Error(`Resource not found: ${uri}`);
        });
    }
    
    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
    }
}

// Start server
if (require.main === module) {
    const server = new CustomMCPServer();
    server.run().catch(console.error);
}
```

### 2. Multi-Server MCP Management
```typescript
class MCPServerManager {
    private clients: Map<string, Client> = new Map();
    private providers: Map<string, any> = new Map();
    
    async addServer(name: string, config: MCPServerConfig) {
        try {
            // Create transport based on config
            const transport = this.createTransport(config);
            
            // Create and connect client
            const client = new Client({
                name: `robota-client-${name}`,
                version: '1.0.0'
            });
            
            await client.connect(transport);
            
            // Create tool provider
            const provider = createMcpToolProvider(client);
            
            // Store references
            this.clients.set(name, client);
            this.providers.set(name, provider);
            
            console.log(`✓ Connected to MCP server: ${name}`);
            return provider;
            
        } catch (error) {
            console.error(`✗ Failed to connect to MCP server ${name}:`, error);
            throw error;
        }
    }
    
    private createTransport(config: MCPServerConfig) {
        switch (config.type) {
            case 'stdio':
                return new StdioClientTransport({
                    command: config.command,
                    args: config.args || []
                });
            
            case 'sse':
                // Server-Sent Events transport (if available)
                throw new Error('SSE transport not implemented');
                
            default:
                throw new Error(`Unknown transport type: ${config.type}`);
        }
    }
    
    async removeServer(name: string) {
        const client = this.clients.get(name);
        if (client) {
            await client.close();
            this.clients.delete(name);
            this.providers.delete(name);
            console.log(`✓ Disconnected from MCP server: ${name}`);
        }
    }
    
    getProvider(name: string) {
        return this.providers.get(name);
    }
    
    getAllProviders() {
        return Array.from(this.providers.values());
    }
    
    async listServerCapabilities(name: string) {
        const client = this.clients.get(name);
        if (!client) throw new Error(`Server ${name} not found`);
        
        try {
            const tools = await client.request("tools/list", {});
            const resources = await client.request("resources/list", {});
            const prompts = await client.request("prompts/list", {});
            
            return { tools, resources, prompts };
        } catch (error) {
            console.error(`Failed to get capabilities for ${name}:`, error);
            return null;
        }
    }
    
    async shutdown() {
        const disconnectPromises = Array.from(this.clients.entries()).map(
            ([name, client]) => this.removeServer(name)
        );
        
        await Promise.all(disconnectPromises);
        console.log('All MCP servers disconnected');
    }
}

interface MCPServerConfig {
    type: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
    headers?: Record<string, string>;
}

// Usage example
async function setupMultiServerMCP() {
    const mcpManager = new MCPServerManager();
    
    // Add multiple MCP servers
    await mcpManager.addServer('calculator', {
        type: 'stdio',
        command: 'node',
        args: ['servers/calculator-server.js']
    });
    
    await mcpManager.addServer('weather', {
        type: 'stdio', 
        command: 'python',
        args: ['servers/weather-server.py']
    });
    
    // Create Robota with all MCP providers
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentModel: 'gpt-3.5-turbo',
        toolProviders: mcpManager.getAllProviders(),
        systemPrompt: 'You have access to calculator and weather services via MCP.'
    });
    
    return { robota, mcpManager };
}
```

### 3. MCP Resource Management
```typescript
class MCPResourceManager {
    private client: Client;
    private resourceCache: Map<string, any> = new Map();
    private cacheTTL: number = 5 * 60 * 1000; // 5 minutes
    
    constructor(client: Client) {
        this.client = client;
    }
    
    async getResource(uri: string, useCache: boolean = true): Promise<any> {
        // Check cache first
        if (useCache) {
            const cached = this.resourceCache.get(uri);
            if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
                return cached.data;
            }
        }
        
        try {
            const response = await this.client.request("resources/read", { uri });
            
            // Cache the response
            this.resourceCache.set(uri, {
                data: response,
                timestamp: Date.now()
            });
            
            return response;
        } catch (error) {
            console.error(`Failed to read resource ${uri}:`, error);
            throw error;
        }
    }
    
    async listResources(): Promise<any> {
        try {
            return await this.client.request("resources/list", {});
        } catch (error) {
            console.error('Failed to list resources:', error);
            throw error;
        }
    }
    
    async subscribeToResource(uri: string, callback: (data: any) => void) {
        // Subscribe to resource changes (if server supports it)
        try {
            await this.client.request("resources/subscribe", { uri });
            
            // Set up notification handler
            this.client.setNotificationHandler("resources/updated", (notification) => {
                if (notification.params.uri === uri) {
                    // Invalidate cache
                    this.resourceCache.delete(uri);
                    // Notify callback
                    callback(notification.params);
                }
            });
            
        } catch (error) {
            console.error(`Failed to subscribe to resource ${uri}:`, error);
        }
    }
    
    clearCache() {
        this.resourceCache.clear();
    }
    
    getCacheStats() {
        const entries = Array.from(this.resourceCache.entries());
        const now = Date.now();
        
        return {
            totalEntries: entries.length,
            validEntries: entries.filter(([_, v]) => now - v.timestamp < this.cacheTTL).length,
            oldestEntry: entries.length > 0 ? Math.min(...entries.map(([_, v]) => v.timestamp)) : null,
            cacheSize: JSON.stringify(entries).length
        };
    }
}
```

## Error Handling and Resilience

### 1. Connection Management
```typescript
class ResilientMCPClient {
    private client: Client;
    private transport: any;
    private config: MCPServerConfig;
    private isConnected: boolean = false;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 5;
    private reconnectDelay: number = 1000;
    
    constructor(config: MCPServerConfig) {
        this.config = config;
    }
    
    async connect(): Promise<void> {
        try {
            this.transport = this.createTransport();
            this.client = new Client({
                name: 'resilient-mcp-client',
                version: '1.0.0'
            });
            
            await this.client.connect(this.transport);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            // Set up error handlers
            this.setupErrorHandlers();
            
            console.log('✓ MCP client connected successfully');
        } catch (error) {
            console.error('✗ MCP connection failed:', error);
            await this.handleConnectionError();
        }
    }
    
    private setupErrorHandlers() {
        // Handle connection errors
        this.transport.onError = async (error: Error) => {
            console.error('MCP transport error:', error);
            this.isConnected = false;
            await this.handleConnectionError();
        };
        
        // Handle connection close
        this.transport.onClose = async () => {
            console.warn('MCP connection closed');
            this.isConnected = false;
            await this.handleConnectionError();
        };
    }
    
    private async handleConnectionError() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnection attempts reached, giving up');
            return;
        }
        
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }
    
    async safeRequest(method: string, params: any): Promise<any> {
        if (!this.isConnected) {
            throw new Error('MCP client not connected');
        }
        
        try {
            return await this.client.request(method, params);
        } catch (error) {
            console.error(`MCP request failed: ${method}`, error);
            
            // Try to reconnect if it's a connection error
            if (error.code === 'CONNECTION_ERROR') {
                this.isConnected = false;
                await this.handleConnectionError();
            }
            
            throw error;
        }
    }
    
    private createTransport() {
        switch (this.config.type) {
            case 'stdio':
                return new StdioClientTransport({
                    command: this.config.command!,
                    args: this.config.args || []
                });
            default:
                throw new Error(`Unsupported transport type: ${this.config.type}`);
        }
    }
    
    async close() {
        if (this.client) {
            await this.client.close();
            this.isConnected = false;
        }
    }
}
```

### 2. Tool Call Resilience
```typescript
class ResilientMCPToolProvider {
    private mcpClient: ResilientMCPClient;
    private fallbackResponses: Map<string, any> = new Map();
    
    constructor(mcpClient: ResilientMCPClient) {
        this.mcpClient = mcpClient;
        this.setupFallbacks();
    }
    
    private setupFallbacks() {
        // Define fallback responses for common tools
        this.fallbackResponses.set('calculate', {
            name: 'calculate',
            handler: async (args: any) => {
                // Local calculation fallback
                const { operation, a, b } = args;
                switch (operation) {
                    case 'add': return { result: a + b };
                    case 'subtract': return { result: a - b };
                    case 'multiply': return { result: a * b };
                    case 'divide': return { result: b !== 0 ? a / b : 'Error: Division by zero' };
                    default: return { error: 'Unknown operation' };
                }
            }
        });
    }
    
    async callTool(name: string, args: any): Promise<any> {
        try {
            // Try MCP server first
            return await this.mcpClient.safeRequest('tools/call', { name, arguments: args });
        } catch (error) {
            console.warn(`MCP tool call failed for ${name}, trying fallback:`, error.message);
            
            // Try fallback
            const fallback = this.fallbackResponses.get(name);
            if (fallback && fallback.handler) {
                return await fallback.handler(args);
            }
            
            // No fallback available
            throw new Error(`Tool ${name} unavailable and no fallback defined`);
        }
    }
    
    async listTools(): Promise<any> {
        try {
            const mcpTools = await this.mcpClient.safeRequest('tools/list', {});
            return mcpTools;
        } catch (error) {
            console.warn('Failed to list MCP tools, returning fallback tools:', error.message);
            
            // Return fallback tools
            return {
                tools: Array.from(this.fallbackResponses.keys()).map(name => ({
                    name,
                    description: `Fallback ${name} tool`,
                    inputSchema: { type: 'object' }
                }))
            };
        }
    }
}
```

## Best Practices

### 1. Server Discovery and Health Checks
```typescript
async function discoverMCPServers(): Promise<MCPServerConfig[]> {
    const possibleServers = [
        { name: 'calculator', type: 'stdio', command: 'node', args: ['servers/calc.js'] },
        { name: 'weather', type: 'stdio', command: 'python', args: ['servers/weather.py'] },
        { name: 'database', type: 'stdio', command: 'deno', args: ['run', 'servers/db.ts'] }
    ];
    
    const availableServers = [];
    
    for (const config of possibleServers) {
        try {
            const client = new Client({ name: 'discovery', version: '1.0.0' });
            const transport = new StdioClientTransport({
                command: config.command,
                args: config.args
            });
            
            await client.connect(transport);
            await client.close();
            
            availableServers.push(config);
            console.log(`✓ Server available: ${config.name}`);
        } catch (error) {
            console.log(`✗ Server unavailable: ${config.name}`);
        }
    }
    
    return availableServers;
}
```

### 2. Performance Optimization
```typescript
// Tool call caching for expensive operations
class CachedMCPProvider {
    private provider: any;
    private cache: Map<string, { result: any, timestamp: number }> = new Map();
    private cacheTTL: number = 30000; // 30 seconds
    
    constructor(provider: any) {
        this.provider = provider;
    }
    
    async callTool(name: string, args: any): Promise<any> {
        const cacheKey = `${name}:${JSON.stringify(args)}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            console.log(`Cache hit for ${name}`);
            return cached.result;
        }
        
        const result = await this.provider.callTool(name, args);
        
        // Cache the result
        this.cache.set(cacheKey, {
            result,
            timestamp: Date.now()
        });
        
        return result;
    }
}
```

## Next Steps

After mastering MCP integration, explore:

1. [**OpenAI Functions**](./openai-functions.md) - Direct OpenAI Functions integration
2. [**API Integration**](./api-integration.md) - External API integration patterns
3. [**Custom Function Providers**](./custom-function-providers.md) - Building custom tool providers

## Troubleshooting

### Connection Issues
- Verify MCP server is running and accessible
- Check server path and command syntax
- Ensure proper permissions for server execution
- Monitor server logs for errors

### Tool Call Failures
- Verify tool schemas match server expectations
- Check parameter validation and types
- Monitor network connectivity to server
- Implement proper error handling and fallbacks

### Performance Problems
- Implement tool call caching
- Monitor server response times
- Consider connection pooling for multiple servers
- Use health checks to detect server issues 