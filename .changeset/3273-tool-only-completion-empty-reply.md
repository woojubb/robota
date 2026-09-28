---
'@robota-sdk/agent-core': patch
---

Fixed `run(input, { allowToolOnlyCompletion: true })` throwing an internal `[STRICT-POLICY]` error
when a round produced neither a tool call nor any text — for example a tool-calling decision agent
whose model answered with nothing at all. `allowToolOnlyCompletion` only widens what counts as a
finished turn (a tool call alone, with no final text); an ordinary text-only reply already completes
normally and is unaffected, and a turn that ends in tool results still resolves with `''`. A turn
that ends with neither text nor a tool result now rejects with a new, catchable `EmptyCompletionError`
(`code: 'EMPTY_COMPLETION'`) instead of the internal invariant message; `resume()` of such an
execution raises the same error.
