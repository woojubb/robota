---
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-openai-compatible': patch
'@robota-sdk/agent-provider-anthropic': patch
---

Aborting a run now cancels the provider's HTTP request on every call path. The non-streaming
`chat()` request — the one a forced end-of-round summary makes — sent no `AbortSignal` on OpenAI
Chat Completions, DeepSeek, Qwen (Chat Completions) and Gemma, so an aborted run left that request
running to completion; the same held for `chatStream()` on DeepSeek, Qwen (Chat Completions), Gemma
and Anthropic. Each now hands the call's `signal` to the SDK request.
