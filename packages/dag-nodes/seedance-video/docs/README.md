# Seedance Video Node

`@robota-sdk/dag-node-seedance-video` (internal) exports `SeedanceVideoNodeDefinition`, node type
`seedance-video` (category `AI`). It generates a video from a text prompt with the ByteDance
Seedance (ModelArk) video API. The package also exports `createSeedanceVideoNodeDefinition()`,
`SeedanceVideoRuntime` and `SeedanceVideoConfigSchema`.

- **Input** `text` (string, required) — the prompt.
- **Output** `video` (binary video, `video/mp4`).
- **Config** `model` (default `''` — use the provider definition's default model); `baseCredits`
  (default `0.5`, used as the cost estimate); `durationSeconds` (positive integer, optional);
  `aspectRatio` (string, optional); `pollIntervalMs` (default `5000`); `maxWaitMs` (default
  `300000`).

Generation is asynchronous: the node submits a job, then polls until it succeeds, fails or is
cancelled. If `maxWaitMs` passes first, it tries to cancel the job and fails. `seed` is not
configurable because the provider rejects it.

The video provider is an injected `IMediaProviderDefinition`, passed as
`new SeedanceVideoNodeDefinition({ videoProviderDefinition })`, optionally with `defaultModel` and
`allowedModels`. In the default node set this is the `seedance-video` definition from
`@robota-sdk/agent-builtin-providers`, which requires both `SEEDANCE_API_KEY` and
`SEEDANCE_BASE_URL` and defaults to model `seedance-2.0`. If either is missing, the run fails with a
validation error. The node never reads environment variables itself.

See [MEDIA-PROVIDER-CONTRACT.md](../../docs/MEDIA-PROVIDER-CONTRACT.md) for the provider contract and
[SPEC.md](SPEC.md) for this node's contract.
