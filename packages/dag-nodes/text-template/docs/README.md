# Text Template Node

`@robota-sdk/dag-node-text-template` (internal) exports `TextTemplateNodeDefinition`, node type
`text-template` (category `Core`). It inserts the input text into a template string.

- **Input** `text` (string, required).
- **Output** `text` (string) — the rendered template.
- **Config** `template` (string, default `'%s'`).

Both `{{text}}` and `%s` in the template are replaced with the input text; write `%%s` for a literal
`%s`. The template is read once, so placeholder-like text inside the input is kept as is. Output
larger than the UTF-8 byte ceiling (which the host can tighten) is rejected before it is built. No
external service or environment variable; the cost estimate is 0. Part of the default node set.

Contract: [SPEC.md](SPEC.md).
