---
name: async-concurrency-patterns
description: Manages concurrent async operations with execution limits, cancellation propagation, and backpressure in TypeScript. Use when running parallel tasks, coordinating multiple agents, or handling streaming responses with rate limits.
---

# Async Concurrency Patterns

## Rule Anchor
- `AGENTS.md` > "Development Patterns"
- `AGENTS.md` > "Execution Safety"

## Use This Skill When
- Running multiple async operations in parallel (tool calls, agent executions).
- Needing to limit concurrent API calls to respect rate limits.
- Implementing user-initiated cancellation across an execution chain.
- Handling streaming responses where the consumer may be slower than the producer.

## Core Principles
1. **Fixed concurrency limit**: a sliding window of at most N concurrent promises.
2. **Cancellation propagation**: AbortController signals flow from outer to inner scopes.
3. **Backpressure**: producers slow down when consumers cannot keep up.
4. **Graceful degradation**: partial results are preserved when some operations fail.

## Patterns

### 1. Concurrency Limiter
```ts
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, signal?: AbortSignal) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const results: R[] = [];
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    if (signal?.aborted) throw new Error('Aborted');

    const p = fn(item, signal).then((r) => { results.push(r); });
    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= limit) await Promise.race(executing);
  }

  await Promise.all(executing);
  return results;
}
```

### 2. Cancellation with AbortController
```ts
const controller = new AbortController();

// Pass signal to all downstream operations
await executeAgent(input, { signal: controller.signal });

// Cancel from outside
controller.abort();

// Inside operations: check signal
if (signal?.aborted) throw new Error('Operation cancelled');
```

### 3. Settled Results (partial success)
```ts
const results = await Promise.allSettled(tasks.map((t) => execute(t)));
const succeeded = results.filter((r): r is PromiseFulfilledResult<T> => r.status === 'fulfilled');
const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
```

## Checklist
- [ ] Concurrent operations have an explicit limit (not unlimited Promise.all).
- [ ] AbortSignal is passed through the entire execution chain.
- [ ] Abort errors are caught and handled separately from real errors.
- [ ] Streaming producers respect consumer readiness (backpressure).
- [ ] Partial failures are handled (allSettled or explicit error collection).
- [ ] Rate limit retries use exponential backoff, not busy-wait.
- [ ] Resources (connections, handles) are cleaned up on cancellation.

## Anti-Patterns
- `Promise.all()` on unbounded arrays (memory/rate exhaustion).
- Ignoring AbortSignal in long-running operations.
- Catching abort errors and treating them as regular failures.
- Busy-waiting or fixed-delay retries for rate limits.
- Fire-and-forget promises without error handling.
- Using `setTimeout` for backpressure instead of flow control.
