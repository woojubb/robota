# TypeScript Standards

This document defines TypeScript type safety standards for the Robota project.

## Type Safety Standards

### TypeScript Configuration

- **Strict Mode**: Enable all strict TypeScript checks
- **No Implicit Any**: Require explicit typing
- **Exact Optional Properties**: Use strict property checking
- **No Unused Locals**: Detect unused variables

### Type Definition Standards

```typescript
// Good: Comprehensive interface
interface AgentConfig {
    readonly aiProviders: Record<string, AIProvider>;
    readonly currentProvider: string;
    readonly currentModel: string;
    readonly systemMessage?: string;
    readonly tools?: readonly ToolSchema[];
    readonly plugins?: readonly BasePlugin[];
    readonly options?: Readonly<{
        temperature?: number;
        maxTokens?: number;
    }>;
}

// Good: Branded types for better safety
type ModelName = string & { readonly __brand: 'ModelName' };
type ProviderName = string & { readonly __brand: 'ProviderName' };

// Good: Discriminated unions
type ToolResult = 
    | { success: true; data: unknown }
    | { success: false; error: string };
```

## TypeScript Best Practices

### Interface Design

- Use readonly properties where immutability is expected
- Prefer specific types over generic `any` or `unknown`
- Use discriminated unions for type safety
- Implement branded types for domain-specific values

### Generic Type Usage

```typescript
// Good: Proper generic constraints
interface Repository<T extends { id: string }> {
    findById(id: string): Promise<T | null>;
    save(entity: T): Promise<T>;
}

// Good: Conditional types for flexibility
type ApiResponse<T> = T extends string 
    ? { message: T } 
    : { data: T };
```

### Error Type Safety

```typescript
// Good: Typed error handling
type Result<T, E = Error> = 
    | { success: true; data: T }
    | { success: false; error: E };

async function safeOperation(): Promise<Result<string, ValidationError>> {
    try {
        const result = await riskyOperation();
        return { success: true, data: result };
    } catch (error) {
        if (error instanceof ValidationError) {
            return { success: false, error };
        }
        throw error; // Re-throw unexpected errors
    }
}
```

## Type Documentation

### JSDoc Integration

```typescript
/**
 * Configuration for AI provider setup
 * @template T - The provider-specific options type
 */
interface ProviderConfig<T = Record<string, unknown>> {
    /** Provider name identifier */
    name: string;
    /** Provider-specific configuration options */
    options: T;
    /** Enable debug mode for this provider */
    debug?: boolean;
}
```

### Type Utility Functions

```typescript
// Utility types for common patterns
type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

// Example usage
type PartialAgentConfig = Optional<AgentConfig, 'systemMessage' | 'tools'>;
``` 