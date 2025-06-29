# TypeScript Standards

Type safety standards and best practices for the Robota SDK v2.0.

## Zero Any/Unknown Policy

The Robota SDK v2.0 enforces a **Zero Any/Unknown Policy** - complete elimination of `any` and unsafe `unknown` types for maximum type safety.

### Policy Enforcement

```typescript
// ✅ Good: Specific types
interface AgentConfig {
    name: string;
    model: string;
    provider: 'openai' | 'anthropic' | 'google';
    aiProviders: Record<string, BaseAIProvider>;
    systemMessage?: string;
    tools?: Tool[];
    plugins?: BasePlugin[];
}

// ❌ Bad: Any types (not allowed)
interface BadConfig {
    providers: any;      // Never use any
    options: any;        // Always type explicitly
    data: unknown;       // Prefer specific types
}

// ✅ Good: Type assertions with guards
function processResponse(response: unknown): string {
    if (typeof response === 'string') {
        return response;
    }
    throw new Error('Invalid response type');
}
```

## TypeScript Configuration

### Strict Configuration (tsconfig.json)

```json
{
    "compilerOptions": {
        "strict": true,
        "noImplicitAny": true,
        "strictNullChecks": true,
        "strictFunctionTypes": true,
        "strictBindCallApply": true,
        "strictPropertyInitialization": true,
        "noImplicitReturns": true,
        "noFallthroughCasesInSwitch": true,
        "noUncheckedIndexedAccess": true,
        "exactOptionalPropertyTypes": true,
        "noImplicitOverride": true,
        "noPropertyAccessFromIndexSignature": true
    }
}
```

### ESLint Rules for Type Safety

```json
{
    "rules": {
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unsafe-any": "error",
        "@typescript-eslint/no-unsafe-assignment": "error",
        "@typescript-eslint/no-unsafe-call": "error",
        "@typescript-eslint/no-unsafe-member-access": "error",
        "@typescript-eslint/no-unsafe-return": "error",
        "@typescript-eslint/prefer-unknown-to-any": "error"
    }
}
```

## Type Definition Standards

### Interface Design

```typescript
// ✅ Good: Comprehensive interface with readonly properties
interface AgentStats {
    readonly name: string;
    readonly uptime: number;
    readonly historyLength: number;
    readonly providerStats: Readonly<Record<string, ProviderStats>>;
    readonly lastInteraction?: Readonly<Date>;
}

// ✅ Good: Branded types for type safety
type ModelName = string & { readonly __brand: 'ModelName' };
type ProviderName = string & { readonly __brand: 'ProviderName' };
type AgentName = string & { readonly __brand: 'AgentName' };

// Helper functions for branded types
function createModelName(value: string): ModelName {
    return value as ModelName;
}

// ✅ Good: Discriminated unions
type ToolResult = 
    | { success: true; data: unknown; metadata?: Record<string, unknown> }
    | { success: false; error: string; code?: string };

type StreamChunk = 
    | { type: 'content'; content: string }
    | { type: 'error'; error: string }
    | { type: 'end' };
```

### Generic Type Patterns

```typescript
// ✅ Good: Proper generic constraints
interface BaseAgent<TStats extends AgentStats = AgentStats> {
    getStats(): TStats;
    run(input: string): Promise<string>;
    stream(input: string): AsyncIterable<StreamChunk>;
    destroy(): Promise<void>;
}

// ✅ Good: Conditional types for flexibility
type PluginConfig<T extends BasePlugin> = T extends ExecutionAnalyticsPlugin
    ? ExecutionAnalyticsConfig
    : T extends ConversationHistoryPlugin
    ? ConversationHistoryConfig
    : T extends LoggingPlugin
    ? LoggingConfig
    : never;

// ✅ Good: Mapped types for transformations
type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Usage examples
type PartialAgentConfig = Optional<AgentConfig, 'systemMessage' | 'tools'>;
type RequiredProviderConfig = RequiredFields<ProviderConfig, 'apiKey'>;
```

## Error Type Safety

### Result Pattern

```typescript
// ✅ Good: Type-safe result pattern
type Result<T, E extends Error = Error> = 
    | { success: true; data: T }
    | { success: false; error: E };

// Custom error types
class AgentError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly context?: Record<string, unknown>
    ) {
        super(message);
        this.name = 'AgentError';
    }
}

class ProviderError extends AgentError {
    constructor(
        message: string,
        public readonly provider: ProviderName,
        context?: Record<string, unknown>
    ) {
        super(message, 'PROVIDER_ERROR', { ...context, provider });
        this.name = 'ProviderError';
    }
}

// Usage
async function safeAgentRun(agent: Robota, input: string): Promise<Result<string, AgentError>> {
    try {
        const result = await agent.run(input);
        return { success: true, data: result };
    } catch (error) {
        if (error instanceof AgentError) {
            return { success: false, error };
        }
        // Convert unknown errors to AgentError
        return { 
            success: false, 
            error: new AgentError('Unknown error', 'UNKNOWN_ERROR', { originalError: error })
        };
    }
}
```

### Option Pattern

```typescript
// ✅ Good: Option pattern for nullable values
type Option<T> = { some: T } | { none: true };

function some<T>(value: T): Option<T> {
    return { some: value };
}

function none<T>(): Option<T> {
    return { none: true };
}

function isSome<T>(option: Option<T>): option is { some: T } {
    return 'some' in option;
}

// Usage
function findPlugin(agent: Robota, name: string): Option<BasePlugin> {
    const plugin = agent.getPlugin(name);
    return plugin ? some(plugin) : none();
}
```

## Plugin Type System

### Plugin Interface

```typescript
// ✅ Good: Generic plugin interface
export abstract class BasePlugin<TStats extends PluginStats = PluginStats> {
    abstract readonly name: string;
    abstract getStats(): TStats;
    
    // Optional lifecycle methods
    onAgentStart?(): Promise<void>;
    onAgentStop?(): Promise<void>;
    onAgentRun?(input: string): Promise<void>;
    onAgentResponse?(response: string): Promise<void>;
}

// Specific plugin stats
interface ExecutionAnalyticsStats extends PluginStats {
    readonly totalExecutions: number;
    readonly successRate: number;
    readonly averageDuration: number;
    readonly errorCount: number;
}

interface ConversationHistoryStats extends PluginStats {
    readonly messageCount: number;
    readonly oldestMessage?: Date;
    readonly newestMessage?: Date;
}

// Plugin implementations
export class ExecutionAnalyticsPlugin extends BasePlugin<ExecutionAnalyticsStats> {
    readonly name = 'ExecutionAnalyticsPlugin';
    
    getStats(): ExecutionAnalyticsStats {
        return {
            name: this.name,
            totalExecutions: this.totalExecutions,
            successRate: this.calculateSuccessRate(),
            averageDuration: this.calculateAverageDuration(),
            errorCount: this.errorCount
        };
    }
}
```

## Tool Type System

### Tool Interface

```typescript
// ✅ Good: Type-safe tool definition
interface ToolSchema {
    name: string;
    description: string;
    parameters: JSONSchema;
    handler: (params: unknown) => Promise<unknown>;
}

// Type-safe tool creation
function createFunctionTool<TParams, TResult>(
    name: string,
    description: string,
    schema: JSONSchema,
    handler: (params: TParams) => Promise<TResult>
): Tool<TParams, TResult> {
    return {
        name,
        description,
        schema,
        execute: handler
    };
}

// Usage with full type safety
const calculatorTool = createFunctionTool(
    'calculate',
    'Performs mathematical calculations',
    {
        type: 'object',
        properties: {
            operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
            a: { type: 'number' },
            b: { type: 'number' }
        },
        required: ['operation', 'a', 'b']
    } as const,
    async (params: { operation: 'add' | 'subtract' | 'multiply' | 'divide'; a: number; b: number }) => {
        switch (params.operation) {
            case 'add': return { result: params.a + params.b };
            case 'subtract': return { result: params.a - params.b };
            case 'multiply': return { result: params.a * params.b };
            case 'divide': return { result: params.a / params.b };
        }
    }
);
```

## Provider Type System

### Provider Interface

```typescript
// ✅ Good: Provider type system
export abstract class BaseAIProvider<TOptions extends ProviderOptions = ProviderOptions> {
    constructor(protected readonly options: TOptions) {}
    
    abstract generateResponse(
        messages: UniversalMessage[],
        options?: GenerationOptions
    ): Promise<string>;
    
    abstract generateStream(
        messages: UniversalMessage[],
        options?: GenerationOptions
    ): AsyncIterable<StreamChunk>;
    
    abstract getSupportedModels(): readonly ModelName[];
    abstract validateModel(model: string): model is ModelName;
}

// Provider-specific types
interface OpenAIProviderOptions extends ProviderOptions {
    readonly client: OpenAI;
    readonly organization?: string;
}

interface AnthropicProviderOptions extends ProviderOptions {
    readonly client: Anthropic;
    readonly version?: string;
}

// Provider implementations
export class OpenAIProvider extends BaseAIProvider<OpenAIProviderOptions> {
    getSupportedModels(): readonly ModelName[] {
        return [
            createModelName('gpt-3.5-turbo'),
            createModelName('gpt-4'),
            createModelName('gpt-4o-mini')
        ] as const;
    }
    
    validateModel(model: string): model is ModelName {
        return this.getSupportedModels().includes(model as ModelName);
    }
}
```

## Type Documentation

### JSDoc Integration

```typescript
/**
 * Configuration for creating a Robota agent
 * @template TStats - The agent statistics type
 */
interface AgentConfig<TStats extends AgentStats = AgentStats> {
    /** Unique identifier for the agent */
    readonly name: AgentName;
    
    /** AI model to use */
    readonly model: ModelName;
    
    /** Provider identifier */
    readonly provider: ProviderName;
    
    /**
     * Available AI providers
     * @example
     * ```typescript
     * {
     *   openai: new OpenAIProvider({ client: openaiClient }),
     *   anthropic: new AnthropicProvider({ client: anthropicClient })
     * }
     * ```
     */
    readonly aiProviders: Record<string, BaseAIProvider>;
    
    /** System message for the agent */
    readonly systemMessage?: string;
    
    /** Available tools for the agent */
    readonly tools?: readonly Tool[];
    
    /** Plugins to extend agent functionality */
    readonly plugins?: readonly BasePlugin[];
}
```

### Type Utility Documentation

```typescript
/**
 * Utility types for common patterns in the Robota SDK
 */

/** Make specific properties optional */
type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** Make specific properties required */
type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

/** Deep readonly type */
type DeepReadonly<T> = {
    readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/** Extract function parameter types */
type ParametersOf<T> = T extends (...args: infer P) => unknown ? P : never;

/** Extract function return type */
type ReturnTypeOf<T> = T extends (...args: unknown[]) => infer R ? R : never;
```

## Best Practices Summary

### ✅ Do

1. **Use specific types**: Always prefer specific types over `any` or `unknown`
2. **Leverage generics**: Use type parameters for reusable components
3. **Document types**: Add JSDoc comments for complex types
4. **Use branded types**: For domain-specific values like IDs
5. **Implement type guards**: For runtime type checking
6. **Use readonly**: For immutable data structures
7. **Prefer interfaces**: Over type aliases for object shapes

### ❌ Don't

1. **Use `any` types**: Completely forbidden in the codebase
2. **Use `unknown` unsafely**: Always use type guards
3. **Ignore TypeScript errors**: Fix all type errors
4. **Use function overloads**: Prefer union types
5. **Mutate readonly data**: Respect immutability
6. **Use index signatures**: Prefer specific property definitions

## Migration from v1.x

### Type System Changes

```typescript
// v1.x (deprecated)
interface OldConfig {
    providers: any; // ❌ Any types
    options: unknown; // ❌ Unsafe unknown
}

// v2.0 (current)
interface NewConfig {
    providers: Record<string, BaseAIProvider>; // ✅ Specific types
    options: GenerationOptions; // ✅ Well-defined interface
}
```

This type system ensures complete type safety and excellent developer experience throughout the Robota SDK. 