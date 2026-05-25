---
title: 'REL-016: Map Anthropic and OpenAI HTTP 429 responses to RateLimitError'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: medium
urgency: before-stable
area: packages/agent-provider/src/anthropic, packages/agent-provider/src/openai
depends_on: []
---

## Background

`packages/agent-core/src/utils/errors.ts` exports `RateLimitError`. It is exported
through `packages/agent-core/src/index.ts` and is part of the public API.

However, Anthropic and OpenAI providers do not catch HTTP 429 and rethrow as
`new RateLimitError(...)`. The raw SDK error passes through.

Only the Bytedance HTTP client maps it correctly (`bytedance/http-client.ts:139`).

External consumers who write:

```typescript
import { RateLimitError } from '@robota-sdk/agent-core';
try {
  await query('...');
} catch (e) {
  if (e instanceof RateLimitError) {
    /* retry logic */
  }
}
```

...will never catch Anthropic or OpenAI rate limit errors. The exported error class
is essentially broken for the two most common providers.

Source: pre-release dev audit §8d (2026-05-25).

## Change Required

In the Anthropic provider error handler, add 429 detection:

```typescript
if (error?.status === 429 || error?.message?.includes('rate_limit')) {
  throw new RateLimitError(error.message, { cause: error });
}
```

Same pattern for the OpenAI provider.

Reference: how Bytedance does it in `packages/agent-provider/src/bytedance/http-client.ts:139`.

## Acceptance Criteria

- Anthropic HTTP 429 response → `instanceof RateLimitError` returns `true`
- OpenAI HTTP 429 response → `instanceof RateLimitError` returns `true`
- Unit tests added for both providers' rate limit error mapping
