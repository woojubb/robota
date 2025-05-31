# Development Guidelines

This document provides essential development guidelines for the Robota project architecture and coding standards.

> **📖 Additional References**: 
> - [Testing Guidelines](./testing-guidelines.md) - Mock usage, test organization, and coverage requirements
> - [Build and Deployment](./build-and-deployment.md) - Build configuration and deployment processes  
> - [Code Quality Standards](./code-quality-standards.md) - Linting rules and console output guidelines
> - [Code Improvements](./code-improvements.md) - Detailed implementation patterns and refactoring strategies

## Core Principles

### Module Separation

- Each feature should be implemented as clearly separated modules
- Dependencies between modules should be minimized and explicitly managed
- Core modules should not depend on specific implementations

### Interface Design

- Clear interface definitions
- Design considering extensibility
- Consistent naming conventions

## Architecture Patterns

### Manager Pattern
- Organize manager classes by functionality to adhere to the Single Responsibility Principle
- Each manager handles the state and behavior of a specific domain
- Examples: `AIProviderManager`, `ToolProviderManager`, `SystemMessageManager`

### Service Layer
- Business logic is separated into service classes
- Complex business processes are handled by combining managers
- Example: `ConversationService`

### Dependency Injection and Delegation
- The main class is configured with managers through dependency injection
- Public APIs are implemented by delegating to appropriate managers

## Documentation Standards

### Code Documentation

- Include JSDoc comments for all public APIs
- Add inline comments for complex algorithms or business logic
- Provide example code
- **All code comments must be written in English**: JSDoc comments, inline comments, etc.
- **All log messages and error messages must be written in English**: Logger messages, error messages, console output, etc.

### JSDoc Comment Format

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

### Example Code Creation Rules

- **Never create examples automatically**: Do not automatically create example code after completing development work
- **Create examples only when explicitly requested by users**: Example code should only be created when users specifically ask for examples, demonstrations, or usage patterns
- **Real implementation preferred**: When examples are created (upon user request), use real implementations rather than mock or dummy data
- **Complete and executable**: Examples should be complete and immediately executable when created

## Quality Standards

### Performance Considerations

- Identify and optimize performance-sensitive code paths
- Minimize unnecessary API calls
- Monitor and optimize memory usage

### Security Considerations

- Validate user input
- Protect sensitive information like API keys
- Regularly update dependencies

### Accessibility Considerations

- Clear error messages
- Logging and debugging support
- Support for various user scenarios

## External Documentation

- Update relevant documentation for new features
- Reflect API changes in documentation
- Update CHANGELOG.md for important changes
