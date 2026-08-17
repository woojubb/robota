---
'@robota-sdk/agent-tool-mcp': patch
---

CORE-040: an MCP tool's declared parameters are enforced, not merely advertised

`MCPTool.validateParameters` and `RelayMcpTool.validateParameters` each hand-rolled the same check —
presence of the schema's TOP-LEVEL `required` keys, and nothing else. No types, no enums, no bounds,
no nested traversal. `parameters` was a contract the model was shown and the runtime did not hold: a
payload with the right key names and entirely wrong values reached the tool handler unchallenged.

Both now route through one validator and through `validateAgainstJsonSchema`, the single complete
walk over the universal subset.

An MCP `inputSchema` is authored by a third-party server, so it may use ordinary JSON Schema this
repo's subset cannot model — and the walk REJECTS such a node, which would refuse every payload for
that tool. The schema is therefore narrowed rather than refused: inexpressible property subtrees are
replaced with an accepts-anything node (replaced, not deleted — an object declaring `properties` is
closed, so deleting a key would make the server's own parameter an "unexpected additional property"),
`required` is untouched so presence is still enforced, everything expressible is enforced completely,
and the unenforceable paths are reported once per tool rather than passed over in silence.

- `IRelayMcpOptions.onUnenforceableSchema`, and a third `MCPTool` constructor argument, receive that
  report. Omitting them logs a warning.
- `narrowToUniversalSubset`, `ThirdPartySchemaValidator`, `INarrowedSchema` and
  `TUnenforceableSchemaReporter` are exported: which parts of someone else's schema this runtime can
  enforce is a fact a consumer needs to be able to inspect.
- The package now declares a `source` export condition, alone among its siblings in lacking one — a
  `--conditions=source` consumer silently got the built output instead.
