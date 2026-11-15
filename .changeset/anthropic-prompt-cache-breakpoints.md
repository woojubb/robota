---
'@robota-sdk/agent-provider': patch
---

The Anthropic provider now asks the API to cache the prompt of an agent loop. A call marks the end of the system prompt (which also covers the tools before it) and the end of the history, so each call of a session reads what the previous one wrote instead of paying full price for the whole prompt again. The markers are sent only to the vendor endpoint, never to a configured `baseURL` gateway, and the text the model is shown does not change. A prefix below the model's minimum silently does not cache. The first call that writes a cache entry costs more than an uncached one, so a one-call run pays slightly more and a multi-call session pays much less.
