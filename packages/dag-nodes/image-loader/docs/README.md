# Image Loader Node

`@robota-sdk/dag-node-image-loader` (internal) exports `ImageLoaderNodeDefinition`, node type
`image-loader` (category `Media`). It converts a media reference into a binary image value for
downstream image nodes.

- **Input** `asset` (object, required) — a media reference, either
  `{ referenceType: 'asset', assetId }` or `{ referenceType: 'uri', uri }`.
- **Output** `image` (binary image: PNG, JPEG or WebP).
- **Config** none.

Pure conversion: no external service, network call or environment variable. The cost estimate is 0.
Part of the default node set.

Contract: [SPEC.md](SPEC.md).
