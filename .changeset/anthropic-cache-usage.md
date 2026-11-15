---
'@robota-sdk/agent-provider': patch
---

The Anthropic provider now records prompt-cache usage. The API reports `input_tokens` as the uncached remainder of the prompt and the cache read and cache write beside it, and the adapter dropped both. It now records the whole prompt as the input and the cache read as a subset of it (`cacheReadTokens`), on the streamed, the cut-short and the non-streaming paths, matching the other adapters that report cached tokens. A call that reports no cache fields records exactly what it did before.
