---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-gemini': patch
'@robota-sdk/agent-provider-openai': patch
---

Make the universal JSON-schema subset able to express an object, so a nested `z.object()` keeps its
properties and required fields instead of reaching the model as `{ "type": "object" }`. Tools and
structured-output schemas with one level of nesting are now advertised in full and enforced on the
tool-input path; `z.union` / `z.discriminatedUnion` / `z.literal` are supported and map to `anyOf`
and single-value enums; and Zod's `strip`, `strict` and `passthrough` modes stop collapsing into two
`additionalProperties` emissions. Fixes the shipped `Computer` and `AskUserQuestion` built-ins,
whose action and question fields were being dropped entirely.

`IParameterSchema.type` is now optional (a union node carries `anyOf` instead), and
`IObjectParameterSchema` is the object-root narrowing used by `IToolSchema['parameters']`.
