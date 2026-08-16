---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-gemini': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-openai-compatible': patch
'@robota-sdk/agent-tools': patch
---

Make the universal JSON-schema subset able to express an object, so a nested `z.object()` keeps its
properties and required fields instead of reaching the model as `{ "type": "object" }`. Tools and
structured-output schemas with one level of nesting are now advertised in full and enforced on the
tool-input path; `z.union` / `z.discriminatedUnion` / `z.literal` are supported and map to `anyOf`
and single-value enums; `.nullable()` keeps its null branch; and Zod's `strip`, `strict` and
`passthrough` modes stop collapsing into two `additionalProperties` emissions. Fixes the shipped
`Computer` and `AskUserQuestion` built-ins, whose action and question fields were being dropped
entirely.

`agent-core` is **minor**, not patch: `IObjectParameterSchema` is a new export, and
`IParameterSchema.type` became optional (a union node carries `anyOf` instead of a type), which is a
consumer-visible type change — two call sites in this repo needed editing to keep compiling.
`additionalProperties` also widened to `boolean | IParameterSchema`, and `required` and `anyOf` are
new members. The provider packages are **patch**: each adapts to the widened subset without changing
its own public surface.
