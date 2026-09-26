---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-openai-compatible': patch
---

Cached input tokens are no longer dropped (#3209 R3). The OpenAI and OpenAI-compatible adapters read
`prompt_tokens_details.cached_tokens` (Chat Completions, including the final streamed usage chunk) and
`input_tokens_details.cached_tokens` (Responses, OpenAI and Qwen) into `cacheReadTokens` on the message
usage: the part of the prompt served from the provider's prompt cache, present only when reported.
It reaches the committed assistant message, `readTokenUsageFromMessage()`, and the
`provider_call_completed` execution event, so a consumer can apply the cache discount.

New `sumMessagesUsage(messages)` sums the usage on assistant messages (with `cacheReadTokens` when any
reported it), so one run's usage is `sumMessagesUsage(agent.getHistory().slice(before))` without
converting through `messageToHistoryEntry` (#3209 S1). `sumHistoryUsage` returns the same triple as before.

A forced-summary reply now keeps the usage its provider reported the same way a tool round's reply
does: an endpoint that omits `total_tokens` no longer loses exactly the summary call's usage (#3209 N3). Counts
the adapter could not attest as a consistent total are recorded with `usageProvenance: 'partial'`.
