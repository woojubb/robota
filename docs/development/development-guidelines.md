# Development Guidelines

This document provides essential development guidelines for the Robota project architecture and coding standards.

> **📖 Additional References**: 
> - [Testing Guidelines](./testing-guidelines.md) - Mock usage, test organization, and coverage requirements
> - [Build and Deployment](./build-and-deployment.md) - Build configuration and deployment processes  
> - [Code Quality Standards](./code-quality-standards.md) - Linting rules and console output guidelines
> - [Code Improvements](./code-improvements.md) - Detailed implementation patterns and refactoring strategies
> - [Error Handling Guidelines](./error-handling-guidelines.md) - Comprehensive error handling strategies and patterns

## Core Principles

### Module Separation

- Each feature should be implemented as clearly separated modules
- Dependencies between modules should be minimized and explicitly managed
- Core modules should not depend on specific implementations
- **Package Independence**: Each @robota-sdk package should be independently usable without requiring other SDK packages

### Interface Design

- Clear interface definitions with comprehensive TypeScript types
- Design considering extensibility and backward compatibility
- Consistent naming conventions across all packages
- **Interface-first approach**: Define interfaces before implementations

### Error Handling Strategy

- Use typed errors with clear error codes and messages
- Implement graceful degradation for non-critical failures  
- Provide meaningful error context for debugging
- Log errors at appropriate levels with structured data

## Architecture Patterns

### Manager Pattern
- Organize manager classes by functionality to adhere to the Single Responsibility Principle
- Each manager handles the state and behavior of a specific domain
- Examples: `AIProviderManager`, `ToolProviderManager`, `SystemMessageManager`
- **Lifecycle Management**: Managers should implement proper initialization and cleanup

### Service Layer
- Business logic is separated into service classes
- Complex business processes are handled by combining managers
- Example: `ConversationService`
- **Stateless Services**: Services should be stateless and reusable

### Plugin Architecture
- Core functionality extended through plugin system
- Plugins implement lifecycle hooks for cross-cutting concerns
- Plugin registration and management through unified interface
- **Plugin Isolation**: Plugins should not directly depend on each other

### Dependency Injection and Delegation
- The main class is configured with managers through dependency injection
- Public APIs are implemented by delegating to appropriate managers
- **Constructor Injection**: Prefer constructor injection over setter injection

## Documentation Standards

### Code Documentation

- Include JSDoc comments for all public APIs
- Add inline comments for complex algorithms or business logic
- **Smart Example Generation**: Create examples when they add value to understanding
- **All code comments must be written in English**: JSDoc comments, inline comments, etc.
- **All log messages and error messages must be written in English**: Logger messages, error messages, console output, etc.

### JSDoc Comment Format

```typescript
/**
 * Main agent class for AI conversation management
 * Provides unified interface for multiple AI providers with tool support
 * 
 * @example Basic usage
 * ```ts
 * const agent = new Agent({
 *   aiProviders: { openai: openaiProvider },
 *   currentProvider: 'openai',
 *   currentModel: 'gpt-4'
 * });
 * 
 * const response = await agent.run('Hello!');
 * ```
 * 
 * @example With tools and plugins
 * ```ts
 * const agent = new Agent({
 *   aiProviders: { openai: openaiProvider },
 *   currentProvider: 'openai', 
 *   currentModel: 'gpt-4',
 *   tools: [weatherTool, calculatorTool],
 *   plugins: [new LoggingPlugin(), new UsagePlugin()]
 * });
 * ```
 */
export class Agent {
    /**
     * Create an agent instance
     * 
     * @param config - Agent configuration options
     * @throws {AgentConfigError} When configuration is invalid
     */
    constructor(config: AgentConfig) {
        // Implementation
    }
}
```

### Example Code Guidelines

- **Value-driven Examples**: Create examples when they significantly improve API understanding
- **Real-world Scenarios**: Use realistic use cases rather than trivial examples
- **Complete and Executable**: Examples should be complete and immediately runnable
- **Progressive Complexity**: Start with basic examples, then show advanced usage
- **Error Handling**: Include error handling in examples when relevant

### API Documentation Standards

- Document all parameters with types and constraints
- Include return type documentation
- Specify when methods throw exceptions
- Document side effects and state changes
- **Version Compatibility**: Document breaking changes and migration paths

## Quality Standards

### Performance Considerations

- **Async-first Design**: Use async/await for all I/O operations
- **Memory Management**: Implement proper cleanup for resources
- **Batching**: Batch similar operations when possible
- **Caching**: Cache expensive computations with appropriate invalidation
- **Streaming**: Support streaming for large data operations

### Security Considerations

- **Input Validation**: Validate and sanitize all external input
- **API Key Protection**: Never log or expose API keys in error messages
- **Dependency Security**: Regularly audit and update dependencies
- **Error Information**: Limit sensitive information in error messages

### Accessibility and Developer Experience

- **Clear Error Messages**: Provide actionable error messages with suggestions
- **Progressive Enhancement**: Core functionality should work without optional features
- **Debug Support**: Include debug modes and detailed logging options
- **IDE Integration**: Provide excellent TypeScript support for autocomplete

### Testing Strategy

- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test component interactions
- **End-to-end Tests**: Test complete user workflows
- **Error Path Testing**: Test error conditions and edge cases

## Package-Specific Guidelines

### @robota-sdk/agents Package

- Must not depend on @robota-sdk/core or @robota-sdk/tools
- Should be the primary entry point for new users
- Implement all functionality independently
- Maintain compatibility with existing provider packages

### Provider Packages (@robota-sdk/openai, anthropic, google)

- Should remain lightweight and focused
- Implement only provider-specific logic
- Maintain backward compatibility
- Support both core and agents packages

### Deprecation Strategy

- **Gradual Migration**: Provide clear migration paths for deprecated features
- **Timing**: Maintain deprecated features for at least 2 major versions
- **Documentation**: Clear deprecation warnings with replacement suggestions
- **Breaking Changes**: Only in major version releases

## External Documentation

- Update relevant documentation for new features
- Reflect API changes in documentation immediately
- Update CHANGELOG.md for all user-facing changes
- **Documentation-driven Development**: Write documentation before implementation for major features
