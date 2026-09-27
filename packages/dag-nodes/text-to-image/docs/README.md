# Text to Image Node

`@robota-sdk/dag-node-text-to-image` (internal) exports `TextToImageNodeDefinition`, node type
`text-to-image` (category `AI`). It generates a new image from a text prompt; it takes no input
image. The package also exports `createTextToImageNodeDefinition()`, `TextToImageRuntime` and
`TextToImageConfigSchema`.

- **Input** `text` (string, required, non-empty) — the prompt.
- **Output** `image` (binary image: PNG, JPEG or WebP).
- **Config** `model` (string, default `''` — use the provider definition's default model);
  `baseCredits` (default `0.02`, used as the cost estimate).

The image provider is an injected `IMediaProviderDefinition` passed as
`new TextToImageNodeDefinition({ imageProviderDefinition })`, optionally with `defaultModel` and
`allowedModels`. In the default node set this is the `gemini-image` definition from
`@robota-sdk/agent-builtin-providers`: Google Gemini, credential `GEMINI_API_KEY`, default model
`gemini-2.5-flash-image`. A missing credential fails the run with a validation error.

See [MEDIA-PROVIDER-CONTRACT.md](../../docs/MEDIA-PROVIDER-CONTRACT.md) for the provider contract and
[SPEC.md](SPEC.md) for this node's contract.
