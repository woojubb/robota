# OpenAI Provider Development Guide

## Overview

The `@robota-sdk/openai` package implements a complete type-safe integration with OpenAI's API, following the Zero Any Policy and modern TypeScript patterns established in the Robota SDK ecosystem.

## Architecture

### Class Hierarchy

```typescript
BaseAIProvider<TConfig, TMessage, TResponse>
  ↓
OpenAIProvider extends BaseAIProvider<
  OpenAIProviderOptions,
  UniversalMessage, 
  UniversalMessage
>
```

### Module Structure

```
packages/openai/src/
├── provider.ts              # Main OpenAIProvider class
├── types.ts                 # Provider options and interfaces
├── types/
│   └── api-types.ts        # OpenAI API-specific type definitions
├── parsers/
│   └── response-parser.ts  # Response parsing utilities
├── streaming/
│   └── stream-handler.ts   # Streaming implementation
├── payload-logger.ts       # Request/response logging
└── index.ts               # Public API exports
```

## Type Safety Implementation

### Zero Any Policy Compliance

The OpenAI Provider strictly adheres to the Zero Any Policy:

- **No `any` types**: All types are explicitly defined
- **Error handling**: Uses `instanceof Error` checks instead of any casting
- **OpenAI SDK compatibility**: Uses official SDK types directly
- **Generic constraints**: Proper type parameter constraints throughout

### Key Type Patterns

#### 1. Provider Integration
```typescript
export class OpenAIProvider extends BaseAIProvider<
  OpenAIProviderOptions,    // Configuration type
  UniversalMessage,         // Input message type
  UniversalMessage          // Output message type
> {
  // Type-safe implementation
}
```

#### 2. API Type Conversion
```typescript
// Internal: OpenAI SDK types
private convertToOpenAIMessages(
  messages: UniversalMessage[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  // Type-safe conversion
}

// External: Universal types only
async chat(
  messages: UniversalMessage[]
): Promise<UniversalMessage> {
  // Provider-agnostic interface
}
```

#### 3. Error Handling
```typescript
} catch (error) {
  const errorMessage = error instanceof Error 
    ? error.message 
    : 'Unknown error';
  throw new Error(`OpenAI chat failed: ${errorMessage}`);
}
```

## Development Guidelines

### Adding New Features

1. **Type First**: Define types in `types/api-types.ts` before implementation
2. **Test Coverage**: Add comprehensive tests for new functionality
3. **Documentation**: Update README and JSDoc comments
4. **Compatibility**: Ensure backward compatibility with existing APIs

### Message Flow

```mermaid
graph LR
    A[UniversalMessage] --> B[convertToOpenAIMessages]
    B --> C[OpenAI API]
    C --> D[OpenAI Response]
    D --> E[convertFromOpenAIResponse]
    E --> F[UniversalMessage]
```

### Streaming Implementation

The streaming system uses OpenAI's native streaming with proper type safety:

```typescript
async *chatStream(
  messages: UniversalMessage[]
): AsyncIterable<UniversalMessage> {
  const streamParams: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
    // Type-safe parameters
  };
  
  const stream = await this.client.chat.completions.create(streamParams);
  
  for await (const chunk of stream) {
    const parsed = this.parseStreamingChunk(chunk);
    if (parsed) yield parsed;
  }
}
```

## Testing Strategy

### Unit Tests
- Provider configuration validation
- Message conversion accuracy
- Error handling scenarios
- Tool calling integration

### Integration Tests
- Full conversation flows
- Streaming response handling
- Multi-provider compatibility
- Real OpenAI API interaction

### Type Tests
- Generic type parameter validation
- Interface compatibility verification
- No any/unknown type leakage

## Build and Development

### Development Setup

```bash
# Install dependencies
pnpm install

# Build the package
pnpm run build

# Run tests
pnpm run test

# Type checking
pnpm run type-check

# Linting
pnpm run lint
```

### Build Output

The build process generates:
- **ESM**: `dist/index.js` - ES module build
- **CJS**: `dist/index.cjs` - CommonJS build  
- **Types**: `dist/index.d.ts` - TypeScript declarations

## API Design Principles

### 1. Provider Agnostic
The public API should not expose OpenAI-specific details:

```typescript
// ✅ Good: Universal interface
async chat(messages: UniversalMessage[]): Promise<UniversalMessage>

// ❌ Bad: OpenAI-specific
async chat(messages: OpenAI.Chat.ChatCompletionMessage[]): Promise<OpenAI.Chat.ChatCompletion>
```

### 2. Type Safety
All public methods use proper TypeScript types:

```typescript
// ✅ Good: Explicit types
async configure(config: OpenAIProviderOptions): Promise<void>

// ❌ Bad: Any types
async configure(config: any): Promise<void>
```

### 3. Error Transparency
Errors are properly typed and informative:

```typescript
// ✅ Good: Meaningful error messages
throw new Error(`OpenAI chat failed: ${errorMessage}`);

// ❌ Bad: Generic errors
throw error;
```

## Performance Considerations

### Memory Management
- Dispose of resources properly in `dispose()` method
- Avoid memory leaks in streaming operations
- Clean up event listeners and timers

### Request Optimization
- Batch multiple requests when possible
- Implement proper timeout handling
- Use appropriate model selection

### Token Management
- Provide token counting utilities
- Implement max token limits
- Monitor token usage for cost control

## Debugging and Logging

### Payload Logging
Optional detailed request/response logging:

```typescript
const provider = new OpenAIProvider({
  enablePayloadLogging: true,
  payloadLogDir: './logs/openai',
  // ... other options
});
```

### Debug Information
- Request parameters
- Response metadata
- Timing information
- Error details

## Release Process

### Version Management
- Follow semantic versioning
- Update CHANGELOG.md
- Tag releases appropriately

### Publishing
```bash
# Build and test
pnpm run build
pnpm run test

# Publish to npm
pnpm publish
```

### Documentation Updates
- Update README.md
- Regenerate API documentation
- Update examples and guides

## Contributing Guidelines

### Code Style
- Use TypeScript strict mode
- Follow existing naming conventions
- Add comprehensive JSDoc comments
- Maintain consistent formatting

### Pull Request Process
1. Fork the repository
2. Create a feature branch
3. Implement changes with tests
4. Update documentation
5. Submit pull request

### Review Criteria
- Type safety compliance
- Test coverage
- Documentation completeness
- Performance impact
- Breaking change analysis

## Migration Guide

### From Legacy OpenAI Integration

```typescript
// Old approach
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: '...' });

// New approach
import { OpenAIProvider } from '@robota-sdk/openai';
import { Robota } from '@robota-sdk/agents';

const provider = new OpenAIProvider({
  client: new OpenAI({ apiKey: '...' }),
  model: 'gpt-4'
});

const agent = new Robota({
  aiProviders: { openai: provider },
});
```

## Security Considerations

### API Key Management
- Never hardcode API keys
- Use environment variables
- Implement key rotation support

### Data Privacy
- Handle sensitive data appropriately
- Implement data retention policies
- Support data deletion requests

### Network Security
- Use HTTPS for all requests
- Implement proper timeout handling
- Validate SSL certificates

## Future Roadmap

### Planned Features
- Enhanced function calling support
- Vision model integration
- Advanced streaming capabilities
- Performance optimizations

### Breaking Changes
- Major version updates will follow semantic versioning
- Migration guides will be provided
- Deprecation notices for removed features

---

For questions or support, please refer to the main Robota SDK documentation or open an issue on GitHub. 