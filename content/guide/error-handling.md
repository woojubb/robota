---
title: Error Handling
description: How Robota SDK surfaces errors and how to handle them reliably in your application.
---

# Error Handling

Robota SDK uses a typed error hierarchy. Every error extends `RobotaError`, which carries
a `code`, a `category`, and a `recoverable` flag. This lets you handle classes of errors
rather than matching on string messages.

---

## Error Class Reference

All error classes are exported from `@robota-sdk/agent-core`.

| Class                     | Code                    | Category   | Recoverable | When thrown                                      |
| ------------------------- | ----------------------- | ---------- | ----------- | ------------------------------------------------ |
| `ConfigurationError`      | `CONFIGURATION_ERROR`   | `user`     | No          | Bad constructor options, missing required fields |
| `ValidationError`         | `VALIDATION_ERROR`      | `user`     | No          | Invalid input values (wrong type, out of range)  |
| `AuthenticationError`     | `AUTHENTICATION_ERROR`  | `user`     | No          | Invalid or missing API key                       |
| `ModelNotAvailableError`  | `MODEL_NOT_AVAILABLE`   | `user`     | No          | Requested model does not exist for the provider  |
| `ProviderError`           | `PROVIDER_ERROR`        | `provider` | Yes         | Provider API returned an unexpected error        |
| `RateLimitError`          | `RATE_LIMIT_ERROR`      | `provider` | Yes         | Provider rate limit exceeded                     |
| `NetworkError`            | `NETWORK_ERROR`         | `system`   | Yes         | Connection failure, DNS, timeout                 |
| `ToolExecutionError`      | `TOOL_EXECUTION_ERROR`  | `system`   | No          | A tool's handler threw an error                  |
| `CircuitBreakerOpenError` | `CIRCUIT_BREAKER_OPEN`  | `system`   | Yes         | Circuit breaker tripped after repeated failures  |
| `PluginError`             | `PLUGIN_ERROR`          | `system`   | No          | A registered plugin threw during its lifecycle   |
| `StorageError`            | `STORAGE_ERROR`         | `system`   | Yes         | Session store read/write failure                 |
| `CacheIntegrityError`     | `CACHE_INTEGRITY_ERROR` | `system`   | No          | Persisted cache data is corrupt                  |

**Categories:**

- `user` — caused by incorrect configuration or input; fix the code before retrying
- `provider` — caused by the upstream AI provider; may succeed on retry
- `system` — caused by the local runtime (network, filesystem, plugins)

**Recoverable:** when `true`, a retry or fallback makes sense. When `false`, the same
call will fail again without a code change.

```typescript
import { RobotaError, ErrorUtils } from '@robota-sdk/agent-core';

function shouldRetry(error: Error): boolean {
  return ErrorUtils.isRecoverable(error);
}

function getCode(error: Error): string {
  return ErrorUtils.getErrorCode(error); // returns 'UNKNOWN_ERROR' for non-RobotaError
}
```

---

## Handling Errors with createQuery()

`createQuery` returns a plain async function. Errors are thrown as rejected promises,
so you can use a standard `try/catch`.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import {
  AuthenticationError,
  RateLimitError,
  NetworkError,
  RobotaError,
} from '@robota-sdk/agent-core';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

try {
  const response = await query('Explain dependency injection.');
  console.log(response);
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.error('Invalid API key — check your ANTHROPIC_API_KEY environment variable.');
  } else if (error instanceof RateLimitError) {
    const wait = error.retryAfter ?? 60;
    console.error(`Rate limited. Retry after ${wait}s.`);
  } else if (error instanceof NetworkError) {
    console.error('Network failure:', error.message);
  } else if (error instanceof RobotaError) {
    // All other typed errors
    console.error(`[${error.code}] ${error.message}`, error.context);
  } else {
    // Unexpected errors outside the SDK
    throw error;
  }
}
```

---

## Handling Errors with InteractiveSession (event-driven)

`InteractiveSession` emits errors through its `error` event. The `submit()` method
may also reject — catch both surfaces.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { RateLimitError, AuthenticationError } from '@robota-sdk/agent-core';

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  permissionMode: 'bypassPermissions',
});

// Stream output as it arrives
session.on('text_delta', (delta) => process.stdout.write(delta));

// Handle successful completion
session.on('complete', ({ response }) => {
  console.log('\n[done]', response.length, 'chars');
});

// Handle errors emitted by the session
session.on('error', (error) => {
  if (error instanceof RateLimitError) {
    console.error(
      `Rate limited (provider: ${error.provider}). Retry after ${error.retryAfter ?? '?'}s.`,
    );
  } else if (error instanceof AuthenticationError) {
    console.error('Auth failure — check your API key.');
    process.exit(1); // non-recoverable
  } else {
    console.error('Session error:', error.message);
  }
});

// submit() itself can reject synchronously before the session emits 'error'
await session.submit('Refactor this file.').catch((err) => {
  console.error('submit() rejected:', err);
});
```

> **Important:** Always attach an `error` listener **before** calling `submit()`.
> See [The error event footgun](#the-error-event-footgun) below.

---

## Retry Pattern for RateLimitError

`RateLimitError` carries an optional `retryAfter` field (seconds) from the provider's
`Retry-After` header. Use exponential back-off with jitter when the header is absent.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { RateLimitError, NetworkError, ErrorUtils } from '@robota-sdk/agent-core';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

async function queryWithRetry(prompt: string, maxAttempts = 5): Promise<string> {
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      return await query(prompt);
    } catch (error) {
      attempt++;

      if (attempt >= maxAttempts) throw error;

      if (error instanceof RateLimitError || error instanceof NetworkError) {
        // Use provider's Retry-After if available, else exponential back-off with jitter
        const baseDelay =
          error instanceof RateLimitError && error.retryAfter
            ? error.retryAfter * 1000
            : Math.min(1000 * 2 ** attempt, 30_000);

        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;

        console.warn(
          `Attempt ${attempt} failed (${ErrorUtils.getErrorCode(error as Error)}). ` +
            `Retrying in ${(delay / 1000).toFixed(1)}s...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Non-recoverable — do not retry
        throw error;
      }
    }
  }

  throw new Error('Unreachable');
}

// Usage
const answer = await queryWithRetry('Summarise this codebase.');
console.log(answer);
```

You can use `ErrorUtils.isRecoverable(error)` instead of an `instanceof` check if you
want a single condition that covers all recoverable error classes:

```typescript
if (error instanceof Error && ErrorUtils.isRecoverable(error)) {
  // safe to retry
}
```

---

## Authentication Error Handling

`AuthenticationError` is always non-recoverable (`recoverable: false`, category `user`).
Do not retry — fix the API key first.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';
import { AuthenticationError } from '@robota-sdk/agent-core';

function buildQuery() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    // Fail fast at startup rather than at the first query
    throw new Error('ANTHROPIC_API_KEY is not set.');
  }

  return createQuery({
    provider: new AnthropicProvider({ apiKey }),
  });
}

const query = buildQuery();

try {
  const result = await query('Hello!');
  console.log(result);
} catch (error) {
  if (error instanceof AuthenticationError) {
    // The key is set but rejected by the provider (e.g. rotated, revoked, wrong region)
    console.error(
      `Authentication failed for provider "${error.provider}". ` +
        'Verify the key is valid and has not been revoked.',
    );
    process.exit(1);
  }
  throw error;
}
```

`AuthenticationError` exposes the `provider` field so you know which provider rejected
the key when multiple providers are registered.

---

## The error Event Footgun

`InteractiveSession` extends Node.js `EventEmitter`. In Node.js, an `'error'` event
with no listener throws an uncaught exception and crashes the process.

**Always attach the `error` listener before calling `submit()`:**

```typescript
// BAD — if 'error' fires before .on('error') is attached the process crashes
const session = new InteractiveSession({ ... });
await session.submit('hello');          // <-- error event could fire here
session.on('error', handleError);       // too late

// GOOD — listener is attached synchronously before submit()
const session = new InteractiveSession({ ... });
session.on('error', handleError);       // safe: listener registered first
session.on('complete', handleComplete);
await session.submit('hello');
```

With `createQuery()` this is handled for you internally — you only need to handle
the rejected promise.

### Safe session wrapper

For server use-cases where you create sessions inside request handlers, a small
wrapper guarantees the listener is always registered:

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import type { IAIProvider } from '@robota-sdk/agent-core';

function runSession(provider: IAIProvider, prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const session = new InteractiveSession({
      cwd: process.cwd(),
      provider,
      permissionMode: 'bypassPermissions',
      bare: true,
    });

    // Register error listener BEFORE submit
    session.on('error', reject);
    session.on('complete', (result) => resolve(result.response));

    session.submit(prompt).catch(reject);
  });
}
```

---

## Related

- [Embedding agent-framework](./embedding.md) — server and serverless session patterns with error handling
- [Providers Reference](./providers.md) — provider-specific error behaviour
- [Getting Started](../getting-started/README.md) — quick-start examples
