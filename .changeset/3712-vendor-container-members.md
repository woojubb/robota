---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-gemini': patch
---

Stop sending OpenAI and Gemini the schemas they refuse. Projection now declares `items` on a bare array for both vendors and `properties` on a bare object for OpenAI, on the wire only; local validation keeps the declared schema. Gemini also receives a null type as `nullable` instead of an empty schema, only the `required` names that `properties` declares, and no `parameters` for a tool with none. Strict OpenAI no longer receives `default` or a schema-valued `additionalProperties`. Dropping `additionalProperties: true` no longer adds a false "constraint not shown" note to a tool's description.
