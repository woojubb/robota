# Gemini Image Edit and Compose Nodes

`@robota-sdk/dag-node-gemini-image-edit` (internal) exports two nodes (category `AI`) that change
images according to a text prompt:

- **`GeminiImageEditNodeDefinition`**, node type `gemini-image-edit` — edits one image.
  Inputs: `image` (binary image, required), `text` (string, required). Output: `image`. Config:
  `model` (default `''`), `baseCredits` (default `0.01`).
- **`GeminiImageComposeNodeDefinition`**, node type `gemini-image-compose` — combines several
  images into one. Inputs: `images` (list of binary images, at least 2), `text` (string, required).
  Output: `image`. Config: `model` (default `''`), `baseCredits` (default `0.015`).

Images are PNG, JPEG or WebP. An empty `model` uses the provider definition's default model;
`baseCredits` is the cost estimate. The nodes run on Node.js only, because an HTTP image source is
fetched through the shared Node egress boundary.

The image provider is an injected `IMediaProviderDefinition`, passed as
`{ imageProviderDefinition }` to either constructor (optionally with `defaultModel` and
`allowedModels`). In the default node set this is the `gemini-image` definition from
`@robota-sdk/agent-builtin-providers`: Google Gemini, credential `GEMINI_API_KEY`, default model
`gemini-2.5-flash-image`. A missing credential fails the run with a validation error; the nodes
never read environment variables themselves.

See [MEDIA-PROVIDER-CONTRACT.md](../../docs/MEDIA-PROVIDER-CONTRACT.md) for the provider contract and
[SPEC.md](SPEC.md) for this package's contract.
