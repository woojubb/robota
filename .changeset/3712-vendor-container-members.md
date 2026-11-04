---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-gemini': patch
---

Stop sending OpenAI and Gemini the schemas they refuse. Projection now declares `items` on a bare array for both vendors and `properties` on a bare object for OpenAI, on the wire only; local validation keeps the declared schema. Gemini also receives a union's null branch as `nullable` instead of an empty schema.
