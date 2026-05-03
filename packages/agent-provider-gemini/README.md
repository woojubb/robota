# @robota-sdk/agent-provider-gemini

Google Gemini provider for the Robota SDK. The canonical provider profile type is `gemini`; `google` remains a compatibility alias through the provider-definition contract.

## Installation

```bash
npm install @robota-sdk/agent-provider-gemini @google/genai
```

Peer dependency: `@robota-sdk/agent-core`

## Quick Start

```typescript
import { Robota } from '@robota-sdk/agent-core';
import { GeminiProvider, createGeminiProviderDefinition } from '@robota-sdk/agent-provider-gemini';

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY,
  defaultModel: 'gemini-3-flash-preview',
});

const agent = new Robota({
  name: 'Assistant',
  aiProviders: [provider],
  defaultModel: {
    provider: 'gemini',
    model: 'gemini-3-flash-preview',
    systemMessage: 'You are a helpful assistant.',
  },
});

const response = await agent.run('Hello!');
```

`createGeminiProviderDefinition()` returns setup metadata for CLI/SDK composition:

```typescript
const definition = createGeminiProviderDefinition();
// definition.type === 'gemini'
// definition.aliases includes 'google'
```

## Supported Models

- `gemini-3-flash-preview` — default current setup model
- `gemini-2.5-flash-image` (or equivalent) — image generation and composition

## Features

### Streaming

```typescript
const stream = provider.chatStream(messages, { model: 'gemini-3-flash-preview' });
for await (const chunk of stream) {
  process.stdout.write(chunk.content ?? '');
}
```

### Tool Calling

Tool calls are handled automatically by the Robota execution loop. The provider converts between the universal message format and Gemini's `functionDeclarations`-based tool format.

Tool results are sent back to Gemini as `functionResponse` parts with the original tool call id and function name.

### Image Generation

```typescript
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY,
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
const provider = new GeminiProvider({
  apiKey: 'your-api-key',                           // required
  defaultModel: 'gemini-3-flash-preview',           // optional fallback for direct chat calls
  defaultResponseModalities: ['TEXT', 'IMAGE'],      // optional
  imageCapableModels: ['gemini-2.5-flash-image'],    // optional, overrides heuristic
  responseMimeType: 'application/json',              // optional, for structured output
  responseSchema: { ... },                           // optional OpenAPI-style schema
  responseJsonSchema: { ... },                       // optional JSON Schema, mutually exclusive
  safetySettings: [                                  // optional provider defaults
    { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  ],
  thinkingConfig: { thinkingLevel: 'LOW' },           // optional
  executor: remoteExecutor,                          // optional
});
```

Robota `system` messages are sent to Gemini as `config.systemInstruction`, matching the current Google GenAI SDK request shape. Structured output schemas default `responseMimeType` to `application/json` when the MIME type is not provided.

## Public API

### Exports

| Export                           | Kind      | Description                                                                                                                             |
| -------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GeminiProvider`                 | class     | Gemini provider implementing `AbstractAIProvider` and `IImageGenerationProvider`                                                        |
| `createGeminiProviderDefinition` | function  | Returns provider setup/creation metadata with canonical `gemini` type and `google` compatibility alias                                  |
| `IGeminiProviderOptions`         | interface | Constructor options: `apiKey`, `defaultModel`, structured output, safety/thinking config, modalities, image model allowlist, `executor` |
| `TGeminiProviderOptionValue`     | type      | Union type for valid provider option values                                                                                             |

`api-types.ts` is an internal module and is not part of the public API.

### GeminiProvider Methods

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

This package uses `node:crypto` `randomUUID()` for message identifiers.

## Package Examples

Two runnable examples are included in `examples/`:

- `examples/example-generate-image.ts`
- `examples/example-compose-image.ts`

Both support `DRY_RUN=1` for local smoke testing without API calls.

## Environment Variables

```bash
GEMINI_API_KEY=your_gemini_api_key_here
```

## Modernization Note

Google's current documentation recommends `@google/genai` for new Gemini API work. This package uses `@google/genai` for direct Gemini transport while preserving the existing `GeminiProvider` public class and `google` compatibility alias.

## Migration Note

New code should use the `gemini` provider profile type and import from `@robota-sdk/agent-provider-gemini`. The legacy `@robota-sdk/agent-provider-google` package remains a compatibility wrapper for existing imports and settings that still reference `google`.

## License

MIT
