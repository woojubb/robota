---
title: 'REL-020: Write public error handling guide'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: low
urgency: post-launch
area: content/guide/
depends_on: [REL-016]
---

## Background

The SDK exports a rich error taxonomy from `@robota-sdk/agent-core`:
`RateLimitError`, `AuthenticationError`, `ProviderError`, `NetworkError`,
`ToolExecutionError`, `ModelNotAvailableError`, `ConfigurationError`.

There is no public-facing guide explaining:

- What each error means
- When it is thrown
- How to handle it in application code (retry logic, fallback, user-facing messages)

The only error documentation is the auto-generated API reference, which lists the class
but gives no usage guidance.

Depends on REL-016 first so that `RateLimitError` actually works for Anthropic/OpenAI.

Source: pre-release PM audit P3, L2 (2026-05-25).

## Change Required

Create `content/guide/error-handling.md` covering:

1. **Error class table**: name | when thrown | recoverable?
2. **Retry pattern** for `RateLimitError` with exponential backoff example
3. **Auth error** detection and user-friendly messaging
4. **Tool execution errors**: how to surface them in the UI
5. **Unhandled EventEmitter error** footgun (`session.submit()` without `'error'` listener)

## Acceptance Criteria

- `content/guide/error-handling.md` exists with all error classes documented
- Code examples are correct against the current API
