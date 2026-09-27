# OK Emitter Node

`@robota-sdk/dag-node-ok-emitter` (internal) exports `OkEmitterNodeDefinition`, node type
`ok-emitter` (category `Test`). It is a test node that proves an upstream pipeline produced a valid
image binary; it says nothing about the image's content.

- **Input** `image` (binary image: PNG, JPEG or WebP, required).
- **Output** `status` (string) — always `"ok"` on success.
- **Config** none.

The input is checked again during execution, so a malformed binary fails even if it passed
validation. No external service or environment variable; the cost estimate is 0. Part of the default
node set.

Contract: [SPEC.md](SPEC.md).
