# Code Improvements

The Robota library is continuously improving code quality and developer experience through ongoing enhancements. This document provides detailed information about refactoring and code improvement work.

## Structural Improvements

### Modularization and Separation

The codebase is logically separated as follows:

```
robota/
├── packages/           # Core packages
│   ├── core/           # Core functionality
│   │   ├── managers/   # Feature-specific manager classes
│   │   ├── services/   # Business logic services
│   │   ├── interfaces/ # Type definitions and interfaces
│   │   └── utils/      # Utility functions
│   ├── openai/         # OpenAI integration
│   ├── anthropic/      # Anthropic integration
│   ├── mcp/            # MCP implementation
│   ├── tools/          # Tool system
│   └── ...
└── apps/               # Applications
    ├── docs/           # Documentation application
    └── examples/       # Example code
```

### Introduction of Manager Pattern

Core functionality is organized into manager classes separated by responsibility:

```typescript
export class Robota {
    // Managers
    private aiProviderManager: AIProviderManager;
    private toolProviderManager: ToolProviderManager;
    private systemMessageManager: SystemMessageManager;
    private conversationService: ConversationService;
    
    // Basic configuration
    private memory: Memory;
    private onToolCall?: (toolName: string, params: any, result: any) => void;
    private logger: Logger;
    private debug: boolean;
}
```

#### AIProviderManager
Handles registration, management, and selection of AI providers:

```typescript
export class AIProviderManager {
    addProvider(name: string, aiProvider: AIProvider): void;
    setModel(config: { provider: string; model: string }): void;
    getAvailableAIs(): Record<string, string[]>;
    getCurrentAI(): { provider?: string; model?: string };
    isConfigured(): boolean;
}
```

#### ToolProviderManager
Manages tool providers and tool calls:

```typescript
export class ToolProviderManager {
    addProviders(providers: ToolProvider[]): void;
    callTool(toolName: string, parameters: Record<string, any>): Promise<any>;
    getAvailableTools(): any[];
    setAllowedFunctions(functions: string[]): void;
}
```

#### SystemMessageManager
Manages system prompts and system messages:

```typescript
export class SystemMessageManager {
    setSystemPrompt(prompt: string): void;
    setSystemMessages(messages: Message[]): void;
    addSystemMessage(content: string): void;
    getSystemPrompt(): string | undefined;
    getSystemMessages(): Message[] | undefined;
}
```

#### ToolProviderManager (Enhanced)
Manages tool providers, tool calls, and tool execution:

```typescript
export class ToolProviderManager {
    addProviders(providers: ToolProvider[]): void;
    removeProvider(providerId: string): void;
    callTool(toolName: string, parameters: Record<string, any>): Promise<any>;
    getAvailableTools(): FunctionSchema[];
    getProviders(): ToolProvider[];
}
```

### Introduction of Service Layer

Business logic is separated into service classes:

#### ConversationService
Handles conversation processing with AI:

```typescript
export class ConversationService {
    prepareContext(memory: Memory, systemPrompt?: string, systemMessages?: Message[], options?: RunOptions): Context;
    generateResponse(aiProvider: AIProvider, model: string, context: Context, options: RunOptions, availableTools: any[], onToolCall?: Function): Promise<ModelResponse>;
    generateStream(aiProvider: AIProvider, model: string, context: Context, options: RunOptions, availableTools: any[]): Promise<AsyncIterable<StreamingResponseChunk>>;
}
```

This modularization provides the following benefits:

1. **Single Responsibility Principle**: Each class has clear responsibilities
2. **Code Reusability**: Common functionality is properly separated, reducing code duplication
3. **Maintainability**: Changes in one module have minimal impact on other modules
4. **Testability**: Independent modules are easy to unit test
5. **Bundle Size Optimization**: Users can import only the modules they need to optimize bundle size

### Interface Improvements

Core interfaces have been improved as follows:

1. **AIProvider**: Provides a standardized, extensible interface for communication with AI models
2. **Memory**: Defines clear contracts for conversation history management
3. **Tool**: Extensible interface for tool definition and execution

## Build System Improvements

### Test File Separation

The build system has been improved so that test files are excluded from production builds:

```json
// tsconfig.json - For production build
{
  "exclude": [
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
    "src/**/*.spec.ts",
    "src/**/*.spec.tsx"
  ]
}

// tsconfig.test.json - For testing
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*"],
  "exclude": []
}
```

### Type System Cleanup

Type definitions have been moved to appropriate locations, resolving circular dependency issues:

```typescript
// Located in managers/tool-provider-manager.ts
export interface ToolProviderConfig {
    maxCalls?: number;
    timeout?: number;
    allowedTools?: string[];
}
```

## Type System Improvements

### Introduction of Generic Types

```typescript
// Before:
interface Tool {
  name: string;
  description?: string;
  execute: (...args: any[]) => Promise<any>;
}

// Improved:
interface Tool<TInput = any, TOutput = any> {
  name: string;
  description?: string;
  parameters?: ToolParameter[];
  execute: (input: TInput) => Promise<ToolResult<TOutput>>;
}
```

### Added Explicit Type Checking

```typescript
// Function parameter validation
registerFunction(schema: FunctionSchema, fn: Function): void {
  if (!schema || !schema.name) {
    throw new Error('Valid function schema is required.');
  }
  if (typeof fn !== 'function') {
    throw new Error('Second argument must be a function.');
  }
  
  // Implementation...
}
```

## Code Readability Improvements

### Comments and Documentation

JSDoc comments are included for all major classes, methods, and properties:

```typescript
export class ToolProviderManager {
    addProvider(provider: ToolProvider): void {
        this.providers.push(provider);
    }
}
```

### Consistent Method Grouping

Related methods are grouped logically to clarify code structure:

```typescript
class Robota {
  // ============================================================
  // AI Provider Management (delegation)
  // ============================================================
  addAIProvider() { /* ... */ }
  setModel() { /* ... */ }
  getAvailableAIs() { /* ... */ }
  
  // ============================================================
  // System Message Management (delegation)
  // ============================================================
  setSystemPrompt() { /* ... */ }
  setSystemMessages() { /* ... */ }
  addSystemMessage() { /* ... */ }
  
      // ============================================================
    // Tool Provider Management (delegation)
    // ============================================================
    addToolProvider() { /* ... */ }
    removeToolProvider() { /* ... */ }
  
  // ============================================================
  // Execution Methods
  // ============================================================
  run() { /* ... */ }
  chat() { /* ... */ }
  runStream() { /* ... */ }
  
  // ============================================================
  // Internal Helper Methods
  // ============================================================
  private generateResponse() { /* ... */ }
  private generateStream() { /* ... */ }
}
```

## Error Handling Improvements

Error handling has been improved to provide more specific and useful feedback in various situations:

```typescript
async generateResponse(context: any, options: RunOptions = {}): Promise<ModelResponse> {
    if (!this.aiProviderManager.isConfigured()) {
        throw new Error('Current AI provider and model are not configured. Use setModel() method to configure.');
    }

    try {
        // Response generation...
    } catch (error) {
        logger.error('Error occurred during AI client call:', error);
        throw new Error(`Error during AI client call: ${error instanceof Error ? error.message : String(error)}`);
    }
}
```

## Test Improvements

### Test Location and Structure

Test files are placed alongside their corresponding implementation files for easier management:

```
packages/core/src/
  ├── memory.ts
  ├── memory.test.ts  // Tests for memory.ts
  ├── robota.ts
  └── robota.test.ts  // Tests for robota.ts
```

### Expanded Test Coverage

Test coverage has been improved in the following areas:

1. **Edge Cases**: Tests for abnormal inputs and boundary conditions
2. **Error Situations**: Verification that exceptions are handled properly
3. **Integration Tests**: Test scenarios where multiple components work together

### Tests for Refactored Structure

Test code has been updated to match the new manager-based structure:

```typescript
describe('Robota', () => {
    let mockProvider: MockProvider;
    let robota: Robota;

    beforeEach(() => {
        mockProvider = new MockProvider();
        robota = new Robota({ 
            aiProviders: { mock: mockProvider },
            currentProvider: 'mock',
            currentModel: 'mock-model'
        });
    });

    it('should initialize with function call configuration', () => {
        const customRobota = new Robota({
            aiProviders: { mock: mockProvider },
            currentProvider: 'mock',
            currentModel: 'mock-model',
            toolProviderConfig
        });

        expect(customRobota['toolProviderManager'].getProviders()).toHaveLength(1);
        expect(customRobota['toolProviderManager'].getAvailableTools().map(t => t.name)).toContain('getWeather');
    });
});
```

## API Design Improvements

### Consistent Naming Conventions

All APIs follow consistent naming conventions:

- Classes: PascalCase (e.g., `AIProviderManager`, `ToolProviderManager`)
- Methods: camelCase (e.g., `registerFunction`, `setSystemPrompt`)
- Constants: UPPER_SNAKE_CASE (e.g., `DEFAULT_TIMEOUT`, `MAX_TOKENS`)
- Types/Interfaces: PascalCase (e.g., `ToolResult`, `FunctionSchema`)

### Dependency Injection and Delegation Pattern

The Robota class is configured with managers through dependency injection, and public APIs are implemented by delegating to appropriate managers:

```typescript
export class Robota {
    constructor(options: RobotaOptions) {
        // Initialize managers
        this.aiProviderManager = new AIProviderManager();
        this.toolProviderManager = new ToolProviderManager(this.logger, options.toolProviderConfig?.allowedTools);
        this.systemMessageManager = new SystemMessageManager();
        this.conversationService = new ConversationService(options.temperature, options.maxTokens, this.logger, this.debug);
    }

    // Delegate AI Provider management to AIProviderManager
    addAIProvider(name: string, aiProvider: AIProvider): void {
        this.aiProviderManager.addProvider(name, aiProvider);
    }

    // Delegate system message management to SystemMessageManager
    setSystemPrompt(prompt: string): void {
        this.systemMessageManager.setSystemPrompt(prompt);
    }
}
```

### Method Chaining Support

```typescript
// Before:
toolRegistry.register(tool1);
toolRegistry.register(tool2);

// Improved:
toolRegistry
  .register(tool1)
  .register(tool2);
```

## Performance Improvements

### Memory Optimization

The memory management system has been improved to efficiently store and retrieve conversation history:

```typescript
class SimpleMemory implements Memory {
  private messages: Message[] = [];
  private maxMessages: number;
  
  constructor(options?: { maxMessages?: number }) {
    this.maxMessages = options?.maxMessages || 0;
  }
  
  addMessage(message: Message): void {
    this.messages.push(message);
    
    // Apply maximum message limit
    if (this.maxMessages > 0 && this.messages.length > this.maxMessages) {
      // Always keep system messages
      const systemMessages = this.messages.filter(m => m.role === 'system');
      const nonSystemMessages = this.messages.filter(m => m.role !== 'system');
      
      // Trim only non-system messages
      const remainingCount = this.maxMessages - systemMessages.length;
      const trimmedNonSystemMessages = nonSystemMessages.slice(-remainingCount);
      
      // Combine system messages and trimmed non-system messages
      this.messages = [...systemMessages, ...trimmedNonSystemMessages];
    }
  }
}
```

## Code Comment Improvements

### Korean JSDoc Comments Converted to English

All JSDoc comments in the library codebase have been changed from Korean to English. This is an important improvement for international usability and standard development practices.

#### Changed Files

**Core Package:**
- `index.ts`: Main class and manager export comments
- `robota.ts`: All Robota class and method comments
- `managers/`: All manager class comments
- `function.ts`: Function creation utility comments
- `interfaces/`: Interface definition comments
- `utils.ts`: Utility function comments
- `providers/`: Provider implementation comments

**OpenAI Package:**
- `index.ts`, `types.ts`: Provider options and interface comments
- `provider.ts`: OpenAI Provider implementation comments

**Anthropic Package:**
- `index.ts`, `types.ts`, `provider.ts`: All package comments

**Tools Package:**
- `types.d.ts`, `index.ts`: Tool system related comments
- `tool-provider.ts`, `mcp-tool-provider.ts`: Tool provider comments

#### Comment Change Examples

```typescript
// Before (Korean)
/**
 * Main Robota class
 * Provides interface for agent initialization and execution
 */

// After (English)
/**
 * Main Robota class
 * Provides an interface for initializing and running agents
 */
```