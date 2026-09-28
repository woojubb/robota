---
title: Error Handling
description: How Robota SDK surfaces errors and how to handle them reliably in your application.
---

# Error Handling

Robota uses a typed error hierarchy. Errors thrown by the SDK extend `RobotaError`, which carries a
`code`, a `category` and a `recoverable` flag, so you can handle kinds of errors instead of matching
message text. All the classes below are exported from `@robota-sdk/agent-core`.

---

## Error class reference

| Class                     | Code                      | Category   | Recoverable | Where it comes from                                                                                         |
| ------------------------- | ------------------------- | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `ConfigurationError`      | `CONFIGURATION_ERROR`     | `user`     | No          | Invalid or missing configuration, e.g. a provider created without an API key                                |
| `ValidationError`         | `VALIDATION_ERROR`        | `user`     | No          | Invalid input, e.g. tool arguments that fail the tool's Zod schema                                          |
| `AuthenticationError`     | `AUTHENTICATION_ERROR`    | `user`     | No          | The provider rejected the API key (HTTP 401 or 403, or an authentication error type)                        |
| `ModelNotAvailableError`  | `MODEL_NOT_AVAILABLE`     | `user`     | No          | The provider says the requested model does not exist or is not served                                       |
| `ProviderError`           | `PROVIDER_ERROR`          | `provider` | Yes         | A provider call failed for any reason the other provider errors do not cover                                |
| `RateLimitError`          | `RATE_LIMIT_ERROR`        | `provider` | Yes         | The provider reported a rate limit (HTTP 429); `retryAfter` holds the seconds it asked to wait              |
| `StructuredOutputError`   | `STRUCTURED_OUTPUT_ERROR` | `provider` | Yes         | `run(prompt, { output })` got no valid object after all retries                                             |
| `NetworkError`            | `NETWORK_ERROR`           | `system`   | Yes         | The request to the provider got no response: a refused or reset connection, DNS, a timeout                  |
| `ToolExecutionError`      | `TOOL_EXECUTION_ERROR`    | `system`   | No          | A tool failed. During a run the failure goes back to the model as the tool's result instead of being thrown |
| `SameToolInputLoopError`  | `SAME_TOOL_INPUT_LOOP`    | `system`   | Yes         | A tool was called with identical input more often than `maxSameToolInputs` allows                           |
| `CircuitBreakerOpenError` | `CIRCUIT_BREAKER_OPEN`    | `system`   | Yes         | For your own circuit breakers; the built-in packages do not throw it                                        |
| `PluginError`             | `PLUGIN_ERROR`            | `system`   | No          | A plugin is misconfigured or could not be found                                                             |
| `StorageError`            | `STORAGE_ERROR`           | `system`   | Yes         | A plugin's storage backend (conversation history, usage) failed to read or write                            |
| `CacheIntegrityError`     | `CACHE_INTEGRITY_ERROR`   | `system`   | No          | A cached execution result failed its integrity check                                                        |

**Categories:**

- `user` — caused by configuration or input; fix the code or settings before trying again
- `provider` — caused by the AI provider; the same call may succeed later
- `system` — caused by the local runtime (tools, plugins, storage, timeouts)

**Recoverable:** when `true`, retrying or falling back can make sense. `ErrorUtils.isRecoverable()`
and `ErrorUtils.getErrorCode()` read these fields from any error (`false` and `'UNKNOWN_ERROR'` for
an error that is not a `RobotaError`).

```typescript
import { ErrorUtils } from '@robota-sdk/agent-core';

function describe(error: Error): string {
  return `${ErrorUtils.getErrorCode(error)} (recoverable: ${ErrorUtils.isRecoverable(error)})`;
}
```

---

## Provider failures

Every built-in chat provider turns a failed API call into one of these errors:

- `RateLimitError` when the vendor reports a rate limit (HTTP 429 or a rate-limit error type).
  `retryAfter` is the number of seconds from the vendor's `retry-after` header, when it sent one; the
  Gemini SDK exposes no headers, so it is always undefined there.
- `AuthenticationError` when the key is rejected (HTTP 401 or 403, or an authentication or permission
  error type).
- `ModelNotAvailableError` when the vendor names the model as the problem, in a `model_not_found`
  code or in its message, on a 400, a 404 or a failure with no HTTP status (such as one reported
  mid-stream).
- `NetworkError` when the request got no response at all.
- `ProviderError` for everything else. It carries `provider`, the HTTP `status` and the vendor's
  error `type` when the vendor sent them, and the underlying error as `originalError`.

Each keeps the vendor's own message, with anything that looks like a credential removed. A rejected
key and an unavailable model are not recoverable; the others are, so `recoverable` alone cannot tell
a temporary outage from a request that is wrong for this vendor.

To decide what to do, use `classifyProviderFailure(error)`. It reads the status and type, follows
wrapped errors (`originalError` and `cause`), and returns `{ switchable, reason }`:

| `reason`                                                  | Meaning                                                   |
| --------------------------------------------------------- | --------------------------------------------------------- |
| `'rate-limit'`                                            | Too many requests; wait and retry                         |
| `'overloaded'`, `'service-unavailable'`, `'server-error'` | The vendor is struggling (529, 503, 500/502/504)          |
| `'network'`                                               | The connection failed                                     |
| `'authentication'`                                        | The key was rejected (401, 403)                           |
| `'billing'`                                               | Payment required (402)                                    |
| `'model-unavailable'`                                     | The vendor does not serve this model                      |
| `'invalid-request'`                                       | The vendor rejected the request as malformed or too large |
| `'aborted'`                                               | The call was cancelled                                    |
| `'unknown'`                                               | Anything else                                             |

`switchable` is `true` when a different model could plausibly serve the same request (overload,
outages, an unavailable model).

The Robota run loop does not retry a failed provider call itself. The Anthropic and OpenAI provider
packages create their vendor SDK clients with the SDK's default retry settings; to change those,
construct the SDK client yourself and pass it as the provider's `client` option.

---

## Handling errors with createQuery()

A query function returns a promise; a failed turn rejects it.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { RobotaError, classifyProviderFailure } from '@robota-sdk/agent-core';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

try {
  console.log(await query('Explain dependency injection.'));
} catch (error) {
  const { reason } = classifyProviderFailure(error);
  if (reason === 'authentication') {
    console.error('The API key was rejected — check ANTHROPIC_API_KEY.');
  } else if (reason === 'rate-limit') {
    console.error('Rate limited — try again later.');
  } else if (error instanceof RobotaError) {
    console.error(`[${error.code}] ${error.message}`, error.context);
  } else {
    throw error;
  }
}
```

---

## Handling errors with InteractiveSession

A failed turn is reported in two ways: the session emits `error` with the error object, and that
turn's `completed` promise rejects with the same error. `submit()` itself rejects only when the
prompt is not accepted or its turn fails before it starts running — for example after `shutdown()`.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { classifyProviderFailure } from '@robota-sdk/agent-core';

const session = new InteractiveSession({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

session.on('text_delta', (delta) => process.stdout.write(delta));

try {
  const handle = await session.submit('Refactor this file.');
  const result = await handle.completed;
  console.log('\n[done]', result.response.length, 'chars');
} catch (error) {
  const { reason } = classifyProviderFailure(error);
  console.error(`Turn failed (${reason}):`, error instanceof Error ? error.message : error);
}
```

The `error` event also reports failures outside a turn, such as background work, so a long-lived
application should listen for it:

```typescript
import type { InteractiveSession } from '@robota-sdk/agent-framework';

declare const session: InteractiveSession;

session.on('error', (error) => {
  console.error('Session error:', error.message);
});
```

`InteractiveSession` keeps its own listener list; it is not a Node.js `EventEmitter`, so an `error`
event with no listener does not throw or crash the process. Events are not replayed, so attach
listeners before you call `submit()` if you want every event of the turn.

After a failure the session stays usable: submit the next prompt as usual. An aborted turn is not an
error — `completed` resolves with `interrupted: true` and the session emits `interrupted`.

---

## Retrying provider failures

Retry the failures that can clear up on their own — rate limits, overload, outages and network
errors — with exponential back-off and jitter, and wait at least as long as a rate limit's
`retryAfter` asks. Do not retry authentication, billing or invalid requests.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { RateLimitError, classifyProviderFailure } from '@robota-sdk/agent-core';
import type { TProviderFailureReason } from '@robota-sdk/agent-core';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });

const RETRYABLE = new Set<TProviderFailureReason>([
  'rate-limit',
  'overloaded',
  'service-unavailable',
  'server-error',
  'network',
]);

async function queryWithRetry(prompt: string, maxAttempts = 5): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    // A fresh query per attempt, so a failed attempt does not stay in the conversation.
    const query = createQuery({ provider });
    try {
      return await query(prompt);
    } catch (error) {
      const { reason } = classifyProviderFailure(error);
      if (attempt >= maxAttempts || !RETRYABLE.has(reason)) throw error;

      const backoff = Math.min(1000 * 2 ** attempt, 30_000) + Math.random() * 1000;
      const asked = error instanceof RateLimitError ? (error.retryAfter ?? 0) * 1000 : 0;
      const delay = Math.max(backoff, asked);
      console.warn(
        `Attempt ${attempt} failed (${reason}); retrying in ${(delay / 1000).toFixed(1)}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

const answer = await queryWithRetry('Summarize this codebase.');
```

---

## Failing fast on credentials

Check that a key is present when your application starts, rather than at the first request:

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY is not set.');
}

const query = createQuery({ provider: new AnthropicProvider({ apiKey }) });
```

Creating `AnthropicProvider` with no `apiKey`, `client` or `executor` throws a `ConfigurationError`
immediately. A key that is present but wrong (revoked, rotated, wrong account) is only detected on
the first call, as an `AuthenticationError`, which `classifyProviderFailure` reports as
`'authentication'`.

---

## What the robota CLI shows

In the interactive terminal UI, a failed turn is shown and the session carries on:

- Any partially streamed answer stays visible, marked _(interrupted)_ — it is added to the history
  before the stream is cleared.
- The failure appears as a styled error block with a plain-language message, plus a note that the
  session is still alive; the prompt is ready for the next input.
- If the provider goes silent mid-turn, the status area suggests after about 15 seconds that the
  connection may be stalled (Esc interrupts); a 120-second provider idle timeout is the hard stop.
- Errors outside a turn (background tasks, stray promise rejections) are reported the same way; the
  interactive process does not exit because of them.

---

## Related

- [Embedding agent-framework](./embedding.md) — server and serverless session patterns
- [Providers Reference](./providers.md) — provider options
- [Getting Started](../getting-started/README.md) — quick-start examples
