---
'@robota-sdk/agent-core': major
---

**`@robota-sdk/agent-core` removes `IMCPToolConfig` and `IToolFactory.createMCPTool()` with no compatibility facade.**

Both were exported with no producer and no consumer. `IToolFactory` had no implementation anywhere in
this repository — `grep -rn 'IToolFactory' packages/*/src apps/*/src` returned only the declaration
and its export line — and nothing constructed an `IMCPToolConfig`. An MCP server definition is now
owned by `@robota-sdk/agent-mcp` (MCP-001), which also absorbs the raw/validated/resolved
forms, source provenance and shadow metadata, strict foreign `mcpServers` decoding, environment
templates, whole-entry precedence, reversible disable overlays, redacted management projections and
activation identity.

`major` because an exported type and an interface member are gone. An external implementer of
`IToolFactory` — there is none in this repository — stops compiling until it removes its
`createMCPTool` member; a caller of the removed type must take the `agent-mcp` definition contract
instead. No facade is retained deliberately: keeping a deprecated alias would re-create the state
this change exists to end, two MCP contracts with one of them dead.

`@robota-sdk/agent-mcp` is the same workspace package previously named `@robota-sdk/agent-tool-mcp`,
renamed in place. It stays `private`, so the rename publishes nothing; MCP-002 owns its publication
together with the official MCP TypeScript SDK client and the first product-reachable slice.
