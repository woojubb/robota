# Testing Guidelines

This document provides comprehensive testing guidelines for the Robota project.

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

## Test File Organization

### Directory Structure

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

## Test Coverage Requirements

### Coverage Standards

- Unit tests are required for all public APIs
- Integration tests are recommended for important features
- Include tests for edge cases and error handling

### Test Structure

- Write tests for each file
- Group related tests logically
- Tests should be able to run independently

## Testing Refactored Structure

### Manager-based Testing

- **Manager-based Testing**: Write tests according to the refactored manager structure
- **Mock Provider Implementation**: Write Mock Providers that match the new interfaces
- **Internal Property Access**: Verify internal state through managers

```typescript
// ✅ Manager-based test example
it('should initialize with tool providers', () => {
    expect(customRobota['toolProviderManager'].getProviders()).toHaveLength(1);
    expect(customRobota['toolProviderManager'].getAvailableTools()).toContain('getWeather');
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