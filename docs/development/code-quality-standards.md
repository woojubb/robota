# Code Quality Standards

This document defines code quality standards and linting practices for the Robota project.

## Console Output and Logging Rules

- **Prohibit Direct console.log Usage**: Direct calls to `console.log` are not allowed in library code within `./packages/`
- **Use Package-specific Logger**: Each package should implement its own logger utility or use a shared logging interface
- **Exception Paths**: `console.log` usage is allowed in `./apps/examples/`, `./scripts/`, and development/debug code
- **Structured Logging**: Use structured logging with appropriate log levels (debug, info, warn, error)

### Logger Implementation Examples

```typescript
// For @robota-sdk/agents package
import { createLogger } from './utils/logger';
const logger = createLogger('agents');
logger.info('Information message');
logger.warn('Warning message');
logger.error('Error message', { context: additionalData });

// For packages that use @robota-sdk/core
import { logger } from '@robota-sdk/core/utils';
logger.info('Information message');
```

### Debug vs Production Logging

- **Development**: More verbose logging for debugging
- **Production**: Essential logging only, avoid performance impact
- **Conditional Logging**: Use log levels and conditional statements for expensive log operations

```typescript
// Good: Conditional expensive logging
if (logger.isDebugEnabled()) {
    logger.debug('Complex operation result', JSON.stringify(complexObject));
}

// Better: Use logger built-in support
logger.debug('Complex operation result', () => JSON.stringify(complexObject));
```

## Code Quality and Linting Rules

### Pragmatic Lint Strategy

- **Iterative Improvement**: Fix lint issues progressively, not all at once
- **Context-aware Decisions**: Some lint rules may be overridden with good reason
- **Team Consistency**: Maintain consistent code style across the project
- **Tool-assisted**: Use automated tools where possible, manual review where needed

### Lint Workflow Best Practices

1. **Development Phase**: 
   - Fix critical errors immediately (syntax, type errors)
   - Address warnings that affect functionality
   - Defer style-only warnings to review phase
   - Use `// eslint-disable-next-line` sparingly with comments explaining why

2. **Review Phase**: 
   - Run `pnpm run lint:fix` to auto-fix issues
   - Address remaining warnings with context consideration
   - Document any intentional rule overrides

3. **Pre-commit Phase**: 
   - Ensure no critical errors remain
   - All auto-fixable issues should be resolved
   - Document any remaining warnings in PR description

### Available Lint Commands

```bash
# Check lint issues across all packages
pnpm run lint

# Fix auto-fixable lint issues across all packages
pnpm run lint:fix

# Package-specific linting
pnpm --filter @robota-sdk/agents run lint:fix
pnpm --filter @robota-sdk/core run lint:fix
pnpm --filter @robota-sdk/openai run lint:fix

# Examples and apps
pnpm --filter robota-examples run lint:fix
```

### Lint Rule Categories

#### Critical Issues (Fix Immediately)
- **Syntax Errors**: Break compilation/runtime
- **Type Errors**: Cause runtime failures
- **Security Issues**: Potential vulnerabilities
- **Logic Errors**: Incorrect program behavior

#### Important Issues (Address in Review)
- **Unused Variables**: May indicate incomplete code
- **Missing Error Handling**: Potential runtime issues
- **Performance Issues**: Inefficient patterns
- **Accessibility Issues**: User experience impacts

#### Style Issues (Batch Fix)
- **Import Ordering**: Can be auto-fixed
- **Formatting**: Should be handled by prettier
- **Naming Conventions**: Consistency improvements
- **Comment Style**: Documentation improvements

### Acceptable Temporary Overrides

```typescript
// Acceptable: External library without types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const externalLibResult: any = untypedLibrary.method();

// Acceptable: Intentional any for generic utility
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepClone<T = any>(obj: T): T {
    // Implementation needs any for JSON serialization
}

// NOT acceptable: Lazy typing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processData(data: any): any { // Should define proper types
```

### IDE Configuration Recommendations

```json
// VSCode settings.json example
{
    "editor.codeActionsOnSave": {
        "source.fixAll.eslint": true,
        "source.organizeImports": true
    },
    "editor.formatOnSave": true,
    "typescript.preferences.importModuleSpecifier": "relative"
}
```

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

## Legacy Code Management Rules

### Pragmatic Legacy Handling

- **Deprecation with Purpose**: Deprecate when there's a clear better alternative
- **Migration Support**: Provide migration tools and documentation
- **Compatibility Windows**: Support deprecated features for reasonable time periods
- **User Communication**: Clear communication about deprecations and timelines

### Refactoring Strategy

- **Incremental Changes**: Large refactors should be broken into smaller, reviewable changes
- **Backward Compatibility**: Maintain API compatibility during refactoring
- **Feature Flags**: Use feature flags for major changes
- **Testing**: Comprehensive testing during refactoring

### Technical Debt Management

- **Documentation**: Document known technical debt and its impact
- **Prioritization**: Address technical debt based on user impact and development velocity
- **Boy Scout Rule**: Leave code better than you found it
- **Regular Reviews**: Periodic technical debt assessment and planning 