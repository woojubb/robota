# Transform Node

`@robota-sdk/dag-node-transform` (internal) exports `TransformNodeDefinition`, node type `transform`
(category `Core`). It prepends a prefix to text, or passes other inputs through unchanged.

- **Inputs** `text` (string, optional); `data` (object, optional). At least one input value is
  required.
- **Outputs** `text` (string, optional); `data` (object, optional).
- **Config** `prefix` (string, default `''`).

When `text` is present, the output `text` is `prefix + text`, checked against a UTF-8 byte ceiling
(which the host can tighten) before it is built. Otherwise every input value is passed through under
its own port name. No external service or environment variable. The cost estimate is `0.0001`
credits. Part of the default node set.

Contract: [SPEC.md](SPEC.md).
