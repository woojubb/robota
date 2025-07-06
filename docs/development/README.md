# Development Documentation

Comprehensive development guides for the Robota SDK v2.0.

## Project Overview

The Robota SDK v2.0 is a unified TypeScript library for building AI agents with:

- **🔥 Unified Architecture**: Everything consolidated in `@robota-sdk/agents`
- **⚡ Type-Safe Design**: Zero `any` types, complete TypeScript safety
- **🔌 Multi-Provider Support**: OpenAI, Anthropic, Google AI with seamless switching
- **📊 Built-in Analytics**: Performance monitoring and usage tracking
- **🛠️ Advanced Tools**: Type-safe function calling and tool integration

## Quick Navigation

### 🚀 Getting Started
- **[Development Principles](./development-principles.md)** - Core principles and architecture
- **[TypeScript Standards](./typescript-standards.md)** - Type safety standards and zero any policy

### 🏗️ Development Process
- **[Development Workflow](./development-workflow.md)** - Code quality processes and guidelines
- **[Testing Guidelines](./testing-guidelines.md)** - Testing strategies and best practices
- **[Build and Deployment](./build-and-deployment.md)** - Build configuration and deployment

### 📚 Standards & Guidelines
- **[Documentation Guidelines](./documentation-guidelines.md)** - Documentation standards
- **[Error Handling Guidelines](./error-handling-guidelines.md)** - Error handling strategies
- **[Logging Configuration](./logging-configuration.md)** - Logging setup and practices

### ⚡ Performance & Architecture
- **[Performance Optimization](./performance-optimization.md)** - Performance best practices
- **[Code Improvements](./code-improvements.md)** - Architecture patterns and refactoring

### 🚢 Infrastructure
- **[Package Publishing](./package-publishing.md)** - Release workflow and guidelines
- **[Documentation Site Setup](./documentation-site-setup.md)** - Documentation site management

## Development Workflow

### 1. Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/jungyoun-organisation/robota.git
cd robota

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test
```

### 2. Development Commands

```bash
# Development mode (watch for changes)
pnpm dev

# Type checking
pnpm type-check

# Linting
pnpm lint

# Format code
pnpm format

# Run examples
cd apps/examples
pnpm dev
```

### 3. Testing

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run specific package tests
cd packages/agents
pnpm test
```

## Architecture Overview

### Unified Package Structure

```
@robota-sdk/agents (Core Package)
├── 🤖 BaseAgent           # Foundation for all agents
├── 🔌 BaseAIProvider      # Multi-provider abstraction
├── 🛠️ BaseTool            # Tool system foundation
├── 📊 Plugin System       # Extensible plugin architecture
├── 🏭 AgentFactory        # Agent creation and templates
├── 📈 Analytics           # Performance and usage tracking
└── 🔧 Utilities           # Type-safe utilities
```

### Supporting Packages

```
@robota-sdk/openai         # OpenAI provider implementation
@robota-sdk/anthropic      # Anthropic provider implementation
@robota-sdk/google         # Google AI provider implementation
@robota-sdk/team           # Multi-agent collaboration
@robota-sdk/sessions       # Session management
```

## Key Development Principles

### 1. Type Safety First

**Zero Any/Unknown Policy**: Complete elimination of `any` and unsafe `unknown` types

```typescript
// ✅ Good: Fully typed
interface AgentConfig {
    name: string;
    model: string;
    provider: 'openai' | 'anthropic' | 'google';
    aiProviders: Record<string, BaseAIProvider>;
}

// ❌ Bad: Any types (forbidden)
interface BadConfig {
    providers: any; // Never allowed
    options: any;   // Always type explicitly
}
```

### 2. Plugin-First Architecture

```typescript
// Extensible through plugins
const agent = new Robota({
    plugins: [
        new ExecutionAnalyticsPlugin(),
        new ConversationHistoryPlugin(),
        new LoggingPlugin()
    ]
});
```

### 3. Provider Agnostic Design

```typescript
// Seamless provider switching
await agent.switchProvider('openai', 'gpt-4');
await agent.switchProvider('anthropic', 'claude-3-sonnet');
await agent.switchProvider('google', 'gemini-1.5-flash');
```

## Contribution Guidelines

### 1. Code Quality Standards

- **TypeScript**: Use strict TypeScript configuration
- **No Any Types**: Zero `any` types policy enforced
- **Testing**: Comprehensive test coverage required
- **Documentation**: Document all public APIs

### 2. Pull Request Process

1. **Fork** the repository
2. **Create** feature branch from `main`
3. **Implement** changes with tests
4. **Update** documentation if needed
5. **Submit** pull request with clear description

### 3. Commit Message Format

```
type(scope): description

feat(agents): add streaming support to BaseAgent
fix(openai): resolve token count calculation
docs(examples): update getting started guide
test(agents): add unit tests for plugin system
```

## Testing Strategy

### Unit Tests

```typescript
// Example test structure
describe('Robota Agent', () => {
    let agent: Robota;
    
    beforeEach(() => {
        agent = createTestAgent();
    });
    
    afterEach(async () => {
        await agent.destroy();
    });
    
    it('should handle basic conversation', async () => {
        const response = await agent.run('Hello');
        expect(response).toBeDefined();
        expect(typeof response).toBe('string');
    });
});
```

### Integration Tests

```typescript
// Test real provider integration
describe('Provider Integration', () => {
    it('should work with OpenAI provider', async () => {
        const provider = new OpenAIProvider({ client: mockClient });
        const agent = new Robota({
            aiProviders: { openai: provider },
            currentProvider: 'openai'
        });
        
        const response = await agent.run('Test message');
        expect(response).toBeTruthy();
    });
});
```

## Release Process

### 1. Version Bumping

```bash
# Create changeset
pnpm changeset

# Version packages
pnpm changeset version

# Publish packages
pnpm changeset publish
```

### 2. Documentation Updates

- Update API documentation
- Update examples
- Update migration guides
- Test documentation site

## Troubleshooting

### Common Issues

1. **Build Failures**: Check TypeScript configuration
2. **Test Failures**: Verify mock setup and cleanup
3. **Type Errors**: Ensure no `any` types used
4. **Package Conflicts**: Clear `node_modules` and reinstall

### Debug Commands

```bash
# Clean build
pnpm clean && pnpm build

# Verbose test output
pnpm test --verbose

# Type check specific package
cd packages/agents && pnpm type-check
```

## Resources

### Documentation
- **[Getting Started](../getting-started/README.md)** - User-facing quick start
- **[Core Concepts](../guide/core-concepts.md)** - Architecture overview
- **[API Reference](../api-reference/README.md)** - Complete API documentation

### Development Tools
- **TypeScript**: Type safety and IntelliSense
- **Vitest**: Fast unit test runner
- **ESLint**: Code quality and style enforcement
- **Prettier**: Code formatting
- **Changeset**: Version management and changelogs

### Community
- **GitHub Issues**: Bug reports and feature requests
- **Discussions**: Community support and questions
- **Examples**: Real-world usage patterns in `/apps/examples`

## Migration from v1.x

### Major Changes in v2.0

1. **Unified Package**: Everything moved to `@robota-sdk/agents`
2. **API Changes**: `systemPrompt` → `systemMessage`, `close()` → `destroy()`
3. **Type Safety**: Complete removal of `any` types
4. **Plugin System**: New extensible architecture

See **[Code Improvements](./code-improvements.md)** for detailed migration guide. 