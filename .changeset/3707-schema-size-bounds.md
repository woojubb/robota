---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-session': minor
'@robota-sdk/agent-mcp': minor
'@robota-sdk/agent-provider-gemini': minor
'@robota-sdk/agent-provider-anthropic': minor
---

The universal parameter-schema subset gains size bounds: `minLength`, `maxLength`, `minItems`, `maxItems`, `minProperties` and `maxProperties`. They are enforced by `validateAgainstJsonSchema` and by `FunctionTool` (at the root too), persisted and reloaded in session records, and kept by MCP schema narrowing, so a server such as Exa no longer prints an unenforceable-schema diagnostic for them. A bound that is not a non-negative integer is dropped and reported. Per provider: OpenAI strict mode keeps `minItems`/`maxItems` and leaves the others off the wire with a Schema note, Gemini carries all six, standard JSON Schema surfaces carry them unchanged, and Anthropic's `output_config.format` omits them along with `minimum`/`maximum`, which it answers with a 400. `ISchemaClosureOptions` gains `omitKeywords`.
