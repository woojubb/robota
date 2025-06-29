# @robota-sdk/agents Development Guide

## 🎯 Development Phases Completed

### ✅ Phase 7: ESLint Setup and Code Quality (Completed)
**🎉 100% Success Achievement!**

**Core Achievements:**
- ✅ **ESLint Warnings**: 126 → 0 (100% improvement)
- ✅ **TypeScript Build**: Complete success (all type errors resolved)
- ✅ **Facade Pattern**: Successfully applied to webhook, function-tool, error-handling plugins
- ✅ **Logger Design Innovation**: Record<string, unknown> for complete flexibility
- ✅ **Type Ownership System**: Eliminated duplicate definitions, responsibility separation complete
- ✅ **Rule-based Type Improvement**: 12 alternative review obligation completed

### ✅ Phase 8: Test Failure Fixes (Completed)
- ✅ All tests passing (76 tests, 100% success rate)

### ✅ Phase 9: Complete any/unknown Type Removal (Completed)
**🎉 December 29, 2024 Completed! Perfect Type Safety Achieved!**

**Core Achievements:**
- ✅ **any/unknown warnings**: 18 → 0 (100% removal achieved!)
- ✅ **TypeScript Build**: Complete success
- ✅ **Tests**: 76/76 passing (100% success rate)
- ✅ **Type Safety**: Maintained strict TypeScript settings

**Major Improvements:**
- ✅ **Centralized Type System**: src/interfaces/types.ts completed
- ✅ **Plugin System Type Safety**: All plugins any/unknown removed
- ✅ **Storage System Compatibility**: Complex object structure type support
- ✅ **Configuration System**: Unified with ConfigData type
- ✅ **Type Utility Functions**: Date and complex object structure support

### ✅ Phase 10: Type Parameters and Advanced Facade Patterns (Completed)
**🎉 December 29, 2024 Completed! Type Parameter System Fully Built!**

**Goal**: Maximize code reusability and flexibility while maintaining type safety

**Core Achievements:**
- ✅ **All Base Classes Type Parameterized**: BaseAgent, BaseAIProvider, BaseTool, BasePlugin
- ✅ **Dynamic Provider Support**: Runtime provider registration and type safety guarantee
- ✅ **Backward Compatibility Maintained**: Legacy class compatibility through Legacy classes
- ✅ **Plugin-Specific Type**: Unique Options/Stats type system for each plugin
- ✅ **ExtendedRunContext**: Provider-agnostic design with dynamic option support

## 🔧 Development Setup

### Prerequisites
- Node.js 18+ 
- pnpm (recommended) or npm
- TypeScript 5.0+

### Installation
```bash
# Clone the repository
git clone https://github.com/robota-ai/robota.git
cd robota

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### Package-Specific Development
```bash
# Navigate to agents package
cd packages/agents

# Install dependencies
pnpm install

# Development build (watch mode)
pnpm build:watch

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Lint code
pnpm lint

# Fix linting issues
pnpm lint:fix
```

## 🏗️ Development Principles

### 1. Type Safety First
- **No any/unknown**: Strict TypeScript enforcement with ESLint rules
- **Generic Type Parameters**: Use type parameters for reusability
- **Runtime Validation**: Complement compile-time types with runtime checks

### 2. Modular Architecture
- **Single Responsibility**: Each module has one clear purpose
- **Facade Pattern**: Complex subsystems hidden behind simple interfaces
- **Plugin Architecture**: Extensible functionality through plugins

### 3. Testing Strategy
- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test component interactions
- **Type Tests**: Ensure TypeScript compilation works correctly
- **Test Coverage**: Maintain high coverage (currently 76/76 tests passing)

### 4. Code Quality
- **ESLint**: Strict linting rules (0 warnings policy)
- **Prettier**: Consistent code formatting
- **TypeScript**: Strict configuration with exactOptionalPropertyTypes

## 🔌 Plugin Development

### Creating a New Plugin

1. **Create Plugin Directory**
```bash
mkdir packages/agents/src/plugins/my-plugin
cd packages/agents/src/plugins/my-plugin
```

2. **Define Types**
```typescript
// types.ts
export interface MyPluginOptions {
  enabled: boolean;
  customSetting: string;
}

export interface MyPluginStats {
  operationsCount: number;
  lastOperation: Date;
}
```

3. **Implement Plugin**
```typescript
// my-plugin.ts
import { BasePlugin } from '../../abstracts/base-plugin.js';
import { MyPluginOptions, MyPluginStats } from './types.js';

export class MyPlugin extends BasePlugin<MyPluginOptions, MyPluginStats> {
  constructor(options: MyPluginOptions) {
    super(options);
  }

  async initialize(): Promise<void> {
    // Plugin initialization logic
  }

  async shutdown(): Promise<void> {
    // Plugin cleanup logic
  }

  getStats(): MyPluginStats {
    return {
      operationsCount: this.operationsCount,
      lastOperation: this.lastOperation
    };
  }
}
```

4. **Export Plugin**
```typescript
// index.ts
export { MyPlugin } from './my-plugin.js';
export type { MyPluginOptions, MyPluginStats } from './types.js';
```

### Plugin Best Practices
- **Type Safety**: Always define specific Options and Stats interfaces
- **Error Handling**: Implement robust error handling and recovery
- **Resource Management**: Properly clean up resources in shutdown()
- **Statistics**: Provide meaningful statistics for monitoring
- **Testing**: Write comprehensive tests for plugin functionality

## 🛠️ Tool Development

### Creating a Function Tool

```typescript
import { z } from 'zod';
import { FunctionTool } from '@robota-sdk/agents';

const MyToolSchema = z.object({
  input: z.string().describe('Input text to process'),
  options: z.object({
    format: z.enum(['json', 'text']).optional()
  }).optional()
});

const myTool = new FunctionTool({
  name: 'my_tool',
  description: 'Processes text input',
  schema: MyToolSchema,
  execute: async (params) => {
    const { input, options } = params;
    // Tool implementation
    return { result: `Processed: ${input}` };
  }
});
```

### Tool Best Practices
- **Schema-First**: Define Zod schemas for type safety
- **Clear Descriptions**: Provide helpful descriptions for AI models
- **Error Handling**: Handle and report errors gracefully
- **Performance**: Optimize for the expected usage patterns
- **Testing**: Test with various input combinations

## 🔄 Provider Integration

### Implementing a New Provider

1. **Extend BaseAIProvider**
```typescript
import { BaseAIProvider } from '@robota-sdk/agents';
import { UniversalMessage } from '@robota-sdk/agents';

export class MyProvider extends BaseAIProvider<MyProviderOptions, UniversalMessage, MyResponse> {
  async run(messages: UniversalMessage[], options?: RunOptions): Promise<UniversalMessage> {
    // Implementation
  }

  async runStream(messages: UniversalMessage[], options?: RunOptions): AsyncGenerator<UniversalMessage> {
    // Streaming implementation
  }
}
```

2. **Message Conversion**
```typescript
export class MyProviderAdapter {
  static convertToProvider(messages: UniversalMessage[]): MyProviderMessage[] {
    // Convert from UniversalMessage to provider format
  }

  static convertFromProvider(response: MyProviderResponse): UniversalMessage {
    // Convert from provider format to UniversalMessage
  }
}
```

### Provider Best Practices
- **UniversalMessage Standard**: Always convert to/from UniversalMessage
- **Streaming Support**: Implement real-time streaming responses
- **Error Handling**: Provide clear error messages and recovery
- **Tool Integration**: Support tool calling if available
- **Testing**: Test with real API calls and mocked responses

## 🧪 Testing Guidelines

### Test Structure
```
packages/agents/src/
├── agents/
│   ├── robota.test.ts          # Main agent tests
├── managers/
│   ├── agent-factory.test.ts   # Factory tests
├── services/
│   ├── execution-service.test.ts # Service tests
└── __tests__/
    ├── fixtures/               # Test data
    ├── helpers/               # Test utilities
    └── integration/           # Integration tests
```

### Writing Tests
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { Robota } from '../agents/robota.js';

describe('Robota', () => {
  let agent: Robota;

  beforeEach(() => {
    agent = new Robota({
      name: 'Test Agent',
      // ... configuration
    });
  });

  it('should initialize correctly', () => {
    expect(agent.name).toBe('Test Agent');
  });

  it('should handle basic conversation', async () => {
    const response = await agent.run('Hello');
    expect(response).toBeDefined();
  });
});
```

### Test Best Practices
- **Isolation**: Each test should be independent
- **Mock External Services**: Use mocks for external API calls
- **Edge Cases**: Test error conditions and edge cases
- **Performance**: Include performance-related tests
- **Type Safety**: Verify TypeScript compilation in tests

## 📊 Performance Optimization

### Profiling
```bash
# Run performance tests
pnpm test:performance

# Profile memory usage
node --inspect packages/agents/src/agents/robota.ts

# Analyze bundle size
pnpm build:analyze
```

### Optimization Strategies
- **Lazy Loading**: Load components only when needed
- **Connection Pooling**: Reuse HTTP connections for providers
- **Caching**: Cache expensive operations and results
- **Streaming**: Use streaming for real-time responses
- **Parallel Execution**: Execute independent operations concurrently

## 🔍 Debugging

### Debug Configuration
```typescript
// Enable debug logging
const agent = new Robota({
  name: 'Debug Agent',
  plugins: {
    logging: new LoggingPlugin({
      level: 'debug',
      storage: new ConsoleStorage()
    })
  }
});
```

### Debugging Tools
- **TypeScript Compiler**: `tsc --noEmit` for type checking
- **ESLint**: `pnpm lint` for code quality issues
- **VS Code Debugger**: Integrated debugging support
- **Node Inspector**: For runtime debugging

### Common Issues
1. **Type Errors**: Check generic type parameter constraints
2. **Plugin Conflicts**: Verify plugin initialization order
3. **Provider Issues**: Test with minimal provider configuration
4. **Memory Leaks**: Monitor resource cleanup in plugins

## 📚 Documentation

### Code Documentation
- **TSDoc Comments**: Document all public APIs
- **Type Annotations**: Provide clear type information
- **Examples**: Include usage examples in comments
- **Architecture Decisions**: Document design choices

### Documentation Updates
```bash
# Generate API documentation
pnpm docs:generate

# Update README files
pnpm docs:update

# Copy documentation to apps/docs
cd ../../apps/docs && pnpm copy
```

## 🚀 Release Process

### Pre-Release Checklist
- [ ] All tests passing
- [ ] No ESLint warnings
- [ ] Documentation updated
- [ ] Version bumped in package.json
- [ ] CHANGELOG.md updated

### Release Commands
```bash
# Build all packages
pnpm build

# Run all tests
pnpm test

# Publish to npm
pnpm publish
```

## 🤝 Contributing

### Workflow
1. **Fork Repository**: Create your own fork
2. **Create Branch**: `git checkout -b feature/my-feature`
3. **Make Changes**: Follow development principles
4. **Add Tests**: Ensure new functionality is tested
5. **Run Tests**: `pnpm test` and `pnpm lint`
6. **Submit PR**: Create pull request with clear description

### Code Review
- **Type Safety**: Verify no any/unknown types introduced
- **Test Coverage**: Ensure adequate test coverage
- **Documentation**: Check for proper documentation
- **Performance**: Consider performance implications
- **Breaking Changes**: Identify potential breaking changes

## 📈 Roadmap

### Future Development
- **Additional Providers**: Support for more AI providers
- **Advanced Tools**: More sophisticated tool implementations
- **Performance Optimizations**: Further performance improvements
- **Plugin Ecosystem**: Expand plugin capabilities
- **Developer Tools**: Enhanced development tooling 