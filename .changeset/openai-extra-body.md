---
'@robota-sdk/agent-provider-openai': patch
---

Add the `extraBody` provider option (and `options.extraBody` in provider profiles): JSON fields
merged as top-level fields into every Chat Completions and Responses request body, for
endpoint-specific options such as a gateway's upstream settings. It is copied at construction,
rejects fields the provider manages and non-JSON values before any request, and cannot be used
with an executor. Omitting it leaves requests unchanged.
