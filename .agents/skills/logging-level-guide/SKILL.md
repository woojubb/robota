---
name: logging-level-guide
description: Defines when to use each log level (error, warn, info, debug) and common logging anti-patterns. Use when adding or reviewing log statements in production code.
---

# Logging Level Guide

## Rule Anchor
- `AGENTS.md` > "Development Patterns" (DI for logging, no console.*)

## Use This Skill When
- Adding log statements to production code.
- Reviewing log level choices in code review.
- Debugging noisy or insufficient logging.

## Log Level Definitions

| Level | When to Use | Example |
|-------|-------------|---------|
| **error** | Immediate attention required. The operation failed and cannot recover. | Database connection lost, unhandled exception, data corruption detected |
| **warn** | Abnormal but recoverable. The system continues but something unexpected happened. | Retry succeeded after transient failure, deprecated API used, rate limit approaching |
| **info** | Major business events. Start/complete of significant operations. | Server started, request processed, job completed, configuration loaded |
| **debug** | Development diagnostics. Detailed internal state for troubleshooting. | Function entry/exit, intermediate calculation values, cache hit/miss |

## Decision Rules

1. **Would on-call be paged?** → `error`
2. **Could this become an error if it keeps happening?** → `warn`
3. **Would an operator want to see this in production logs?** → `info`
4. **Is this only useful when actively debugging?** → `debug`

## What to Log

- **Always log:** operation start/complete with duration, external API calls, authentication events, configuration changes.
- **Never log:** passwords, tokens, PII, full request/response bodies in production, high-frequency loop iterations.

## Structured Context

Always include structured context rather than string interpolation:

```ts
// Good
logger.info('Order processed', { orderId, duration, itemCount });

// Bad
logger.info(`Order ${orderId} processed in ${duration}ms with ${itemCount} items`);
```

## Anti-Patterns

- Logging at `error` level for expected failures (validation errors, not found).
- Using `info` for high-frequency events that flood production logs.
- Logging sensitive data (tokens, passwords, PII) at any level.
- Missing context: logging a message without enough data to diagnose the issue.
- Inconsistent level choices across similar operations in the same service.

## Checklist
- [ ] Each log statement has an appropriate level per the definitions above.
- [ ] Structured context is provided (not string interpolation).
- [ ] No sensitive data is logged.
- [ ] Error logs include enough context to diagnose without reproducing.
- [ ] Debug logs are not excessive (would not flood logs if accidentally enabled).
