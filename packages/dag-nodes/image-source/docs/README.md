# Image Source Node

`@robota-sdk/dag-node-image-source` (internal) exports `ImageSourceNodeDefinition`, node type
`image-source` (category `Test`). It is a source node that emits a configured image, for tests and
for injecting a fixed image into a pipeline.

- **Inputs** none.
- **Output** `image` (binary image: PNG, JPEG or WebP).
- **Config** `asset` (media reference, required — `{ referenceType: 'asset', assetId }` or
  `{ referenceType: 'uri', uri }`); `mimeType` (string, optional).

The MIME type comes from `config.mimeType`, then the reference's own media type, then `image/png`.
No external service or environment variable; the cost estimate is 0. Part of the default node set.

Contract: [SPEC.md](SPEC.md).
