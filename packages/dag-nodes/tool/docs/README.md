# Tool Node

`@robota-sdk/dag-node-tool` (internal) exports `ToolNodeDefinition`, node type `tool` (category
`Integration`). It runs one `@robota-sdk/agent-tools` builtin in-process as a DAG step. The package
also exports `createToolNodeDefinition()` and `TOOL_NODE_ALLOWED_TOOLS`.

- **Input** `params` (string, optional) — a JSON object merged over `config.params` (input wins).
- **Outputs** `output` (string) — the tool's text output; `isError` (boolean) — true when the tool
  reported a soft failure.
- **Config** `toolName` (string, required); `params` (record, default `{}`); `cwd` (string,
  optional); `baseCredits` (default `0`, used as the cost estimate).

`toolName` must be one of `TOOL_NODE_ALLOWED_TOOLS`: `read`, `write`, `edit`, `shell`, `bash`,
`glob`, `grep`, `web-fetch`, `web-search`. Any other name fails validation.

The filesystem and shell tools are built per call and bound to the run's execution root.
`config.cwd` can narrow that root but never widen it. For `read`, `write`, `edit`, `glob` and `grep`
the root is a real boundary; for `shell` and `bash` it is only the starting directory, since a
command can `cd` anywhere. `web-fetch` and `web-search` reach the network; `web-search` uses Brave
Search and needs `BRAVE_API_KEY`. No other environment variables. Part of the default node set.

Contract: [SPEC.md](SPEC.md).
