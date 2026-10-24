---
'@robota-sdk/agent-provider-openai': patch
---

Send the configured `parallelToolCalls` policy on Chat Completions only for requests that include
tools, so a provider with an explicit policy no longer sends the field on tool-less calls, where it
constrains nothing and a Chat Completions endpoint may reject it. The Responses surface still sends an explicit policy on every request.
