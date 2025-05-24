# Development Guidelines

This document provides guidelines to follow when developing the Robota project.

> **📖 Additional Reference**: For detailed code improvement strategies, implementation patterns, and refactoring guidelines, please refer to [code-improvements.md](./code-improvements.md).

## Code Structure Principles

### Module Separation

- Each feature should be implemented as clearly separated modules
- Dependencies between modules should be minimized and explicitly managed
- Core modules should not depend on specific implementations

### Interface Design

- Clear interface definitions
- Design considering extensibility
- Consistent naming conventions

### Architecture Patterns

#### Manager Pattern
- Organize manager classes by functionality to adhere to the Single Responsibility Principle
- Each manager handles the state and behavior of a specific domain
- Examples: `AIProviderManager`, `ToolProviderManager`, `SystemMessageManager`

#### Service Layer
- Business logic is separated into service classes
- Complex business processes are handled by combining managers
- Example: `ConversationService`

#### Dependency Injection and Delegation
- The main class is configured with managers through dependency injection
- Public APIs are implemented by delegating to appropriate managers

## Build System Rules

### Test File Separation

- **Production Build**: Test files should be excluded from production builds
- **TypeScript Configuration**: Include test files in `exclude` in `tsconfig.json`
- **Test Configuration**: Use separate `tsconfig.test.json` to include test files only during test execution

```json
// tsconfig.json - For production build
{
  "exclude": [
    "src/**/__tests__/**/*",
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

### Type System Management

- **Type Location**: Define types in the most appropriate location to prevent circular dependencies
- **Type Reuse**: Export common types from appropriate modules for reuse
- **Naming Conflict Prevention**: Avoid naming conflicts between `.d.ts` and `.ts` files

### Build Tool Configuration

- **vitest Configuration**: Specify TypeScript configuration file for testing
- **Build Cache**: Clear cache and retry when build issues occur
- **Type Check**: Pre-validate type errors with `tsc --noEmit`

## Runtime and Execution Environment

### TypeScript Execution

- **Use bun**: Use bun instead of ts-node for TypeScript code execution
- **Example**: Execute scripts in `bun run script.ts` format
- Use the same runtime throughout the project for performance and consistency

### Development Environment Setup

- Manage development dependencies using bun
- Use bun for script execution and testing
- Recommend using bun for production builds as well

## Mock and Test Data Usage Rules

### Basic Principles

- **Prioritize Real Implementation**: Prefer real implementation over Mock or dummy data throughout the codebase
- **Use Mock Only in Test Code**: Mock objects and dummy data should only be used in automated test code
- **Example Code Uses Real Implementation**: Example code should use real implementation in the same way actual users would

### Mock Implementation Restrictions

- `/tests` directory: Place Mock implementations for testing - used only during test execution
- Do not include Mock implementations or dummy data in `/src` and `/examples` directories
- Example code uses simplified real implementation to provide an environment similar to actual situations

### When Mock Usage is Allowed

- When running automated tests (unit tests, integration tests)
- When conducting tests that depend on external APIs (preferably use real test API keys even in this case)
- When running tests in CI/CD pipelines

### Examples

```typescript
// ✅ Good example: Using real implementation
// /examples/mcp/mcp-example.ts
import { Client } from '@modelcontextprotocol/sdk';

const client = new Client(transport);
const result = await client.run(context);

// ❌ Bad example: Using Mock in examples
// /examples/mcp/mcp-example.ts
import MockMCPClient from './__mocks__/mcp-client.mock';

const mockClient = new MockMCPClient();
const result = await mockClient.run(context);
```

### Example Code Creation Rules

- **Never create examples automatically**: Do not automatically create example code after completing development work, regardless of the feature complexity or importance
- **Create examples only when explicitly requested by users**: Example code should only be created when users specifically ask for examples, demonstrations, or usage patterns
- **No preemptive example creation**: Even if you think an example would be helpful, do not create one unless the user requests it
- **Real implementation preferred**: When examples are created (upon user request), use real implementations rather than mock or dummy data
- **Complete and executable**: Examples should be complete and immediately executable when created
- **User-focused**: Examples should demonstrate actual usage patterns that users would employ
- **Ask before creating**: If you believe an example would be beneficial, ask the user if they would like you to create one rather than creating it proactively

## Test Rules

### Test Coverage

- Unit tests are required for all public APIs
- Integration tests are recommended for important features
- Include tests for edge cases and error handling

### Test Structure

- Write tests for each file
- Group related tests logically
- Tests should be able to run independently

### Test File Organization

- **Use `__tests__` directories**: All test files should be placed in `__tests__` directories within their respective modules
- **Mirror source structure**: Test file organization should mirror the source code structure
- **Naming convention**: Test files should follow the pattern `*.test.ts` or `*.spec.ts`

```
src/
├── __tests__/                    # Main module tests
│   ├── robota.test.ts
│   ├── conversation-history.test.ts
│   └── adapter-integration.test.ts
├── managers/
│   ├── __tests__/                # Manager-specific tests
│   │   ├── analytics-manager.test.ts
│   │   └── request-limit-manager.test.ts
│   ├── analytics-manager.ts
│   └── request-limit-manager.ts
└── analyzers/
    ├── __tests__/                # Analyzer-specific tests
    │   └── token-analyzer.test.ts
    └── token-analyzer.ts
```

- **Import path adjustments**: When moving test files to `__tests__` directories, update import paths to use relative paths (`../` for parent directory)
- **Test discovery**: Test runners (vitest) automatically discover test files in `__tests__` directories

### Testing Refactored Structure

- **Manager-based Testing**: Write tests according to the refactored manager structure
- **Mock Provider Implementation**: Write Mock Providers that match the new interfaces
- **Internal Property Access**: Verify internal state through managers

```typescript
// ✅ Manager-based test example
it('should initialize with function call configuration', () => {
    expect(customRobota['functionCallManager'].getDefaultMode()).toBe('auto');
    expect(customRobota['functionCallManager'].getMaxCalls()).toBe(5);
});

// ✅ Mock Provider matching new structure
class MockProvider implements AIProvider {
    public name = 'mock';
    public availableModels = ['mock-model'];
    
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        // Mock implementation
    }
}
```

## Documentation Rules

### Code Documentation

- Include JSDoc comments for all public APIs
- Add inline comments for complex algorithms or business logic
- Provide example code
- **All code comments must be written in English**: JSDoc comments, inline comments, etc., all code comments must be written in English
- **All log messages and error messages must be written in English**: Logger messages, error messages, console output, etc., must be written in English
- JSDoc comments should follow standard rules and include parameters, return values, examples, etc.

### Comment Writing Examples

```typescript
/**
 * Main Robota class
 * Provides an interface for initializing and running agents
 * 
 * @example
 * ```ts
 * const robota = new Robota({
 *   aiProviders: { openai: openaiProvider },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4',
 *   systemPrompt: 'You are a helpful AI assistant.'
 * });
 * 
 * const response = await robota.run('Hello!');
 * ```
 */
export class Robota {
    /**
     * Create a Robota instance
     * 
     * @param options - Robota initialization options
     */
    constructor(options: RobotaOptions) {
        // Implementation
    }
}
```

### Legacy Code Management Rules

- **No legacy compatibility unless explicitly requested**: Do not maintain legacy code for backward compatibility unless specifically requested by users
- **Clean refactoring preferred**: When refactoring code, prefer clean implementation over maintaining old interfaces
- **Clear deprecation path**: If legacy code must be maintained, provide clear deprecation warnings and migration paths
- **Remove deprecated code**: Regularly remove deprecated code that has been superseded by better implementations

### External Documentation

- Update relevant documentation for new features
- Reflect API changes in documentation
- Update CHANGELOG.md for important changes

## Performance Considerations

- Identify and optimize performance-sensitive code paths
- Minimize unnecessary API calls
- Monitor and optimize memory usage

## Security Considerations

- Validate user input
- Protect sensitive information like API keys
- Regularly update dependencies

## Accessibility Considerations

- Clear error messages
- Logging and debugging support
- Support for various user scenarios

## Console Output and Logging Rules

- **Prohibit Direct console.log Usage**: Direct calls to `console.log` are not allowed in all TypeScript (.ts) files within `./packages/`.
- **Use logger Utility**: When logging is needed, you must use the provided `logger` utility (`info`, `warn`, `error` methods).
- **Exception Paths**: `console.log` usage is allowed in code within `./apps/examples/` and `./scripts/` paths.
- **Documentation and Examples**: Code that violates the above rules must be fixed during PR review, and all logs except examples and scripts must be output through the logger.
- **logger Examples**:

```typescript
import { logger } from '@robota-sdk/core/src/utils';
logger.info('Information message');
logger.warn('Warning message');
logger.error('Error message');
```

## Code Quality and Linting Rules

### Lint Execution Strategy

- **Focus on Development First**: During active development and code writing, focus on implementing functionality and logic rather than fixing lint warnings
- **Batch Lint Fixes**: Fix lint issues in batches after completing a logical code section or feature implementation
- **Pre-commit Linting**: Always run `pnpm run lint:fix` before committing code to ensure code quality standards
- **End-of-Session Cleanup**: At the end of each development session, run lint:fix to clean up accumulated warnings

### Lint Workflow Best Practices

1. **Development Phase**: 
   - Write code without interrupting flow for minor lint warnings
   - Focus on logic, functionality, and architecture
   - Ignore non-critical lint warnings during active coding

2. **Review Phase**: 
   - Run `pnpm run lint:fix` when ready to review your work
   - Fix remaining lint issues that couldn't be auto-fixed
   - Address any critical warnings or errors

3. **Pre-commit Phase**: 
   - Always run `pnpm run lint:fix` before final commit
   - Ensure all auto-fixable issues are resolved
   - Review and address any remaining warnings

### Available Lint Commands

```bash
# Check lint issues across all packages
pnpm run lint

# Fix auto-fixable lint issues across all packages
pnpm run lint:fix

# Fix lint issues in specific package
pnpm --filter @robota-sdk/core run lint:fix
pnpm --filter @robota-sdk/openai run lint:fix
pnpm --filter @robota-sdk/tools run lint:fix

# Fix lint issues in examples
pnpm --filter robota-examples run lint:fix
```

### Acceptable Lint Warnings During Development

- **Type-related warnings**: `@typescript-eslint/no-explicit-any` warnings can be addressed later
- **Unused variable warnings**: Variables that will be used later in development
- **Import order warnings**: Can be auto-fixed during cleanup phase

### Lint Warnings That Should Be Addressed Immediately

- **Syntax errors**: Fix immediately as they break functionality
- **Type errors**: Critical type mismatches that affect functionality
- **Security-related warnings**: Address immediately for security reasons

### IDE Configuration Recommendations

- Configure your IDE to show lint warnings without disrupting development flow
- Use lint auto-fix on save for critical issues only
- Set up pre-commit hooks to run `lint:fix` automatically

## Deployment and Release Rules

### Package Publishing Requirements

- **Mandatory Deployment Script**: Always use the `publish-packages` script for npm deployments
  ```bash
  pnpm publish-packages
  ```
- **Never use direct changeset publish**: Do not use `pnpm changeset publish` directly
- **Required Pre-deployment Steps**: The `publish-packages` script ensures:
  - Documentation generation (`docs:generate`)
  - README file copying (`copy-readme`) 
  - Proper npm publishing (`changeset publish`)
  - Git tag pushing (`push-tags`)
  - Cleanup of temporary files (`cleanup-readme`)

### Deployment Workflow

```bash
# ✅ Correct deployment process
pnpm changeset                    # Create changeset
pnpm publish-packages            # Complete deployment

# ❌ Incorrect - missing steps
pnpm changeset publish           # Direct publish (missing README, docs, etc.)
```

### Version Management

- Use semantic versioning (semver) principles
- Breaking changes require minor version bumps for pre-1.0 releases
- Patch releases for bug fixes and non-breaking improvements
- Always create changesets with clear, concise descriptions

## Commit and Changeset Message Guidelines

### Message Length Requirements

- **Maximum 80 characters**: All commit messages and changeset descriptions must be 80 characters or less
- **Concise and clear**: Focus on essential information only
- **No detailed explanations**: Save detailed explanations for PR descriptions or documentation

### Good Examples

```bash
# ✅ Good commit messages (under 80 chars)
"Remove tools re-exports from core package"
"Add README files to packages for npm"
"Fix circular dependency in tools config"
"Update build scripts for proper deployment"

# ✅ Good changeset descriptions
"Remove tools re-exports from core. Import from @robota-sdk/tools instead."
"Add README.md files to packages for better npm documentation."
"Fix circular dependency between core and tools packages."
```

### Bad Examples

```bash
# ❌ Too long and verbose
"Remove re-export functionality from @robota-sdk/core package because it was creating confusion and circular dependencies with @robota-sdk/tools package, which violates our architectural principles"

# ❌ Too detailed for changeset
"This commit fixes the architectural issue where @robota-sdk/core was incorrectly re-exporting functionality from @robota-sdk/tools, creating confusion and circular dependencies. The change improves module separation and follows development guidelines."
```

### Changeset Creation Guidelines

1. **Be specific but brief**: Mention what changed, not why
2. **Use imperative mood**: "Add", "Remove", "Fix", "Update"
3. **Focus on user impact**: What users need to know or do
4. **One line preferred**: Avoid multi-line descriptions unless absolutely necessary

### Commit Message Format

```bash
# Format: <action>: <brief description>
git commit -m "feat: add README files to npm packages"
git commit -m "fix: remove circular dependency in tools"
git commit -m "refactor: simplify deployment workflow"
``` 