---
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-openai-compatible': patch
---

`OpenAIProvider({ strictTools: true })` now requests strict function calling on the Chat Completions
surface too (each tool is sent with `function.strict: true`), not only on the Responses surface. This
matters for every provider created with a `baseURL`, which defaults to Chat Completions. With
`strictTools` off the request is unchanged. `convertToOpenAICompatibleTools` accepts an optional
`{ strict }` argument.
