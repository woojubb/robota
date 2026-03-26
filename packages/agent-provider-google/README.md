# @robota-sdk/agent-provider-google

Google Gemini provider for the Robota SDK. Implements `AbstractAIProvider` and `IImageGenerationProvider` with support for Gemini models, streaming, tool calling, and multimodal image generation.

## Installation

```bash
npm install @robota-sdk/agent-provider-google @google/generative-ai
```

Peer dependency: `@robota-sdk/agent-core`

## Quick Start

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { GoogleProvider } from '@robota-sdk/agent-provider-google';

const provider = new GoogleProvider({
  apiKey: process.env.GOOGLE_API_KEY,
});

const agent = new Robota({
  name: 'Assistant',
  aiProviders: [provider],
  defaultModel: {
    provider: 'google',
    model: 'gemini-1.5-pro',
    systemMessage: 'You are a helpful assistant.',
  },
});

const response = await agent.run('Hello!');
```

## Supported Models

- `gemini-1.5-pro` — most capable for complex tasks
- `gemini-1.5-flash` — fast and efficient
- `gemini-2.5-flash-image` (or equivalent) — image generation and composition

## Features

### Streaming

```typescript
const stream = provider.chatStream(messages, { model: 'gemini-1.5-flash' });
for await (const chunk of stream) {
  process.stdout.write(chunk.content ?? '');
}
```

### Tool Calling

Tool calls are handled automatically by the Robota execution loop. The provider converts between the universal message format and Gemini's `functionDeclarations`-based tool format.

### Image Generation

```typescript
import { GoogleProvider } from '@robota-sdk/agent-provider-google';

const provider = new GoogleProvider({
  apiKey: process.env.GOOGLE_API_KEY,
  defaultResponseModalities: ['TEXT', 'IMAGE'],
  imageCapableModels: ['gemini-2.5-flash-image'],
});

const result = await provider.generateImage({
  prompt: 'A watercolor fox character',
  model: 'gemini-2.5-flash-image',
});

if (result.ok) {
  // result.value contains IMediaOutputRef with inline image data
}
```

`editImage()` and `composeImage()` follow the same pattern. Image methods return `TProviderMediaResult` (discriminated union with `ok: true | false`) instead of throwing.

### Multimodal Input

Input messages can include `image_inline` parts (`mimeType` + base64 `data`). `image_uri` parts are not supported directly.

## Configuration

```typescript
const provider = new GoogleProvider({
  apiKey: 'your-api-key',                           // required
  defaultResponseModalities: ['TEXT', 'IMAGE'],      // optional
  imageCapableModels: ['gemini-2.5-flash-image'],    // optional, overrides heuristic
  responseMimeType: 'application/json',              // optional, for structured output
  responseSchema: { ... },                           // optional
  executor: remoteExecutor,                          // optional
});
```

## Public API

### Exports

| Export                       | Kind      | Description                                                                                                                        |
| ---------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GoogleProvider`             | class     | Gemini provider implementing `AbstractAIProvider` and `IImageGenerationProvider`                                                   |
| `IGoogleProviderOptions`     | interface | Constructor options: `apiKey`, `responseMimeType`, `responseSchema`, `defaultResponseModalities`, `imageCapableModels`, `executor` |
| `TGoogleProviderOptionValue` | type      | Union type for valid provider option values                                                                                        |

`api-types.ts` is an internal module and is not part of the public API.

### GoogleProvider Methods

| Method             | Description                                   |
| ------------------ | --------------------------------------------- |
| `chat()`           | Single-turn chat, returns `TUniversalMessage` |
| `chatStream()`     | Streaming chat (TEXT modality only)           |
| `generateImage()`  | Generate an image from a text prompt          |
| `editImage()`      | Edit an image from a prompt and source image  |
| `composeImage()`   | Compose multiple source images with a prompt  |
| `supportsTools()`  | Returns true                                  |
| `validateConfig()` | Returns true if apiKey or executor is present |
| `dispose()`        | Releases resources                            |

## Crypto Dependency

This package uses the Web Crypto API (`globalThis.crypto`) for internal operations — no `node:crypto` dependency.

## Package Examples

Two runnable examples are included in `examples/`:

- `examples/example-generate-image.ts`
- `examples/example-compose-image.ts`

Both support `DRY_RUN=1` for local smoke testing without API calls.

## Environment Variables

```bash
GOOGLE_API_KEY=your_google_ai_api_key_here
# Backward-compatible alias:
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
```

## License

MIT
