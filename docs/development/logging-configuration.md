# Logging Configuration

This document covers logging configuration and best practices for the Robota project.

## Debug vs Production Logging

- **Development**: More verbose logging for debugging
- **Production**: Essential logging only, avoid performance impact
- **Conditional Logging**: Use log levels and conditional statements for expensive log operations

### Conditional Logging Examples

```typescript
// Good: Conditional expensive logging
if (logger.isDebugEnabled()) {
    logger.debug('Complex operation result', JSON.stringify(complexObject));
}

// Better: Use logger built-in support
logger.debug('Complex operation result', () => JSON.stringify(complexObject));
```

## Logging Architecture

### Package-specific Loggers

Each package should implement its own logger utility or use a shared logging interface. The logging system should be structured and use appropriate log levels (debug, info, warn, error).

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

## Environment-specific Configuration

### Development Environment

- Enable debug-level logging
- Log to console for immediate feedback
- Include detailed context information
- Use colored output for better readability

### Production Environment

- Limit to info, warn, and error levels
- Log to structured formats (JSON)
- Include correlation IDs for request tracking
- Implement log rotation and retention policies

### Testing Environment

- Use minimal logging to reduce test noise
- Capture logs for assertion in tests
- Mock logger calls when testing logging behavior
- Avoid file-based logging in tests

## Best Practices

### Structured Logging

- Use consistent log formats across packages
- Include relevant context information
- Use correlation IDs for request tracing
- Implement proper error logging with stack traces

### Performance Considerations

- Use lazy evaluation for expensive log operations
- Implement log level checking before expensive computations
- Consider async logging for high-throughput scenarios
- Monitor logging overhead in production

### Security Considerations

- Never log sensitive information (API keys, passwords, tokens)
- Sanitize user input in log messages
- Implement log scrubbing for known sensitive patterns
- Use separate audit logs for security events 