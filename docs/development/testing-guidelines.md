# Testing Guidelines

This document provides testing guidelines and best practices for the Robota project.

## Testing Philosophy

### Real Implementation First

- Use real implementations whenever possible throughout the codebase
- Reserve mock objects and test data for automated test environments only
- Example code should demonstrate actual usage patterns that users will experience

### Testing Approach

- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test component interactions and workflows
- **End-to-end Tests**: Test complete user scenarios
- **Error Path Testing**: Verify error conditions and edge cases

## Test Organization

### Directory Structure

Tests are organized using `__tests__` directories within their respective modules:

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

### File Naming

- Test files should follow the pattern `*.test.ts` or `*.spec.ts`
- Test file organization should mirror the source code structure
- Update import paths when moving files to `__tests__` directories

## Mock Usage Guidelines

### When to Use Mocks

Mocks are appropriate in these scenarios:
- Automated test environments (unit tests, integration tests)
- CI/CD pipeline testing
- Testing external API dependencies (though prefer real test environments when possible)

### When NOT to Use Mocks

- Production code in `/src` directories
- Example code in `/examples` directories  
- Documentation examples that users will reference

### Mock Implementation Examples

```typescript
// ✅ Good: Real implementation in examples
// /examples/mcp/mcp-example.ts
import { Client } from '@modelcontextprotocol/sdk';

const client = new Client(transport);
const result = await client.run(context);

// ✅ Good: Mock for testing only
// /src/__tests__/mcp-client.test.ts
import MockMCPClient from '../__mocks__/mcp-client.mock';

describe('MCP Client', () => {
  it('should handle responses correctly', async () => {
    const mockClient = new MockMCPClient();
    const result = await mockClient.run(testContext);
    expect(result).toBeDefined();
  });
});
```

## Test Coverage Requirements

### Coverage Standards

- Unit tests are required for all public APIs
- Integration tests for important user workflows
- Include tests for edge cases and error scenarios
- Maintain reasonable coverage without obsessing over 100%

### Test Quality Over Quantity

- Write meaningful tests that catch real issues
- Test behavior, not implementation details
- Include both happy path and error scenarios
- Use descriptive test names that explain the scenario

## Testing Refactored Architecture

### Manager-based Testing

Test the new manager-based architecture appropriately:

```typescript
// ✅ Test manager functionality
it('should initialize with tool providers', () => {
    expect(robota['toolProviderManager'].getProviders()).toHaveLength(1);
    expect(robota['toolProviderManager'].getAvailableTools()).toContain('getWeather');
});

// ✅ Mock providers for testing
class MockProvider implements AIProvider {
    public name = 'mock';
    public availableModels = ['mock-model'];
    
    async chat(model: string, context: Context, options?: any): Promise<ModelResponse> {
        return { content: 'Mock response' };
    }
}
```

## Testing Best Practices

### Test Environment Setup

- Use minimal logging to reduce test noise
- Capture logs for assertions when testing logging behavior
- Avoid file-based operations in tests when possible
- Clean up resources after test completion

### Test Data Management

- Use factory functions for creating test data
- Keep test data simple and focused on the scenario
- Avoid complex test data that obscures the test intent
- Use builders for complex object creation

### Async Testing

- Properly handle async operations with async/await
- Test timeout scenarios for long-running operations
- Use appropriate test timeouts for different operation types
- Clean up async resources to prevent test interference
