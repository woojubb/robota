# Input Node

`@robota-sdk/dag-node-input` (internal) exports `InputNodeDefinition`, node type `input` (category
`Core`). It is the usual entry point of a text pipeline: a source node that emits one text value.

- **Inputs** none.
- **Output** `text` (string).
- **Config** `text` (string, default `''`).

When the run supplies a `text` input for this node, that value wins over `config.text`, so a DAG
run's inputs can replace the text saved in the definition. No external service or environment
variable; the cost estimate is 0. Part of the default node set.

Contract: [SPEC.md](SPEC.md).
