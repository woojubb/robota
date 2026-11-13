---
"@robota-sdk/agent-provider": patch
---

The OpenAI-compatible request now carries `response_format: { type: "json_object" }` for a model that declares `json_object` (such as the DeepSeek models), so what the structured-output guard reports as sent is what the request carries.
