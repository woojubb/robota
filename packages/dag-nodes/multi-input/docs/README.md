# Multi-Input Node

`@robota-sdk/dag-node-multi-input` (internal) exports `MultiInputNodeDefinition`, node type
`multi-input` (category `Core`). It is an entry point with several named output ports, for pipelines
that start from more than one value.

- **Inputs** none declared; values arrive as runtime inputs keyed by port name.
- **Outputs** one string port per name, decided at run time (none are declared statically).
- **Config** `ports` (string array, default `[]`); `values` (string record, default `{}`).

Port names come from `config.ports`; when it is empty, they are the union of `config.values` keys
and runtime input keys. Each port takes the runtime input value, then `config.values[name]`, then
`''`. No external service or environment variable; the cost estimate is 0. Part of the default node
set.

Contract: [SPEC.md](SPEC.md).
