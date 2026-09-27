# Text Output Node

`@robota-sdk/dag-node-text-output` (internal) exports `TextOutputNodeDefinition`, node type
`text-output` (category `Core`). It is the usual last node of a text pipeline: it passes its input
through unchanged so the final text has a clear place in the DAG.

- **Input** `text` (string, required).
- **Output** `text` (string) — the input, unchanged.
- **Config** none.

No external service or environment variable; the cost estimate is 0. Part of the default node set.

Contract: [SPEC.md](SPEC.md).
