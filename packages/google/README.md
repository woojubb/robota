# @robota-sdk/google

Google AI integration for the Robota SDK, providing seamless access to Google's Gemini models.

## Features

- **Gemini Models**: Support for Gemini 1.5 Pro, Gemini 1.5 Flash, and other Google AI models
- **Streaming Support**: Real-time response streaming for enhanced user experience
- **Function Calling**: Full support for Google AI function calling capabilities
- **Image I/O (Multimodal)**: Supports inline image parts for image generation and composition flows
- **TypeScript**: Complete type safety with TypeScript support
- **Unified API**: Consistent interface across all Robota SDK providers

## Installation

```bash
npm install @robota-sdk/google @robota-sdk/agents
```

## Quick Start

```typescript
import { GoogleProvider } from '@robota-sdk/google';
import { Robota } from '@robota-sdk/agents';

// Initialize the Google provider
const provider = new GoogleProvider({
  apiKey: process.env.GOOGLE_AI_API_KEY
});

// Create a Robota instance
const robota = new Robota({
  name: 'GoogleAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'google',
    model: 'gemini-1.5-pro',
    systemMessage: 'You are a helpful AI assistant.'
  }
});

// Start chatting
const response = await robota.run('Hello, how can you help me today?');
console.log(response);
```

## Configuration

```typescript
const provider = new GoogleProvider({
  apiKey: 'your-google-ai-api-key'
});

// Model configuration is set in Robota's defaultModel
const robota = new Robota({
  name: 'GoogleAgent',
  aiProviders: [provider],
  defaultModel: {
    provider: 'google',
    model: 'gemini-1.5-pro', // or 'gemini-1.5-flash'
    temperature: 0.7,
    maxTokens: 1000
  }
});
```

## Multimodal Image Usage

`GoogleProvider` supports multimodal message parts through the shared Robota message contract.

### Input parts
- `text`
- `image_inline` (`mimeType` + base64 `data`)

### Output parts
- `text`
- `image_inline` (`mimeType` + base64 `data`)

### Minimal image generation example

```typescript
import { GoogleProvider } from '@robota-sdk/google';

const provider = new GoogleProvider({
  apiKey: process.env.GOOGLE_API_KEY!,
  defaultResponseModalities: ['TEXT', 'IMAGE'],
  imageCapableModels: ['gemini-2.5-flash-image']
});

const response = await provider.chat(
  [
    {
      role: 'user',
      content: 'Create a watercolor fox character.',
      parts: [{ type: 'text', text: 'Create a watercolor fox character.' }],
      timestamp: new Date()
    }
  ],
  {
    model: 'gemini-2.5-flash-image',
    google: { responseModalities: ['TEXT', 'IMAGE'] }
  }
);
```

## Package Examples

Two runnable examples are included:

- `examples/example-generate-image.ts`
- `examples/example-compose-image.ts`

Run examples from repository root:

```bash
GOOGLE_API_KEY=your_key pnpm dlx tsx packages/google/examples/example-generate-image.ts
GOOGLE_API_KEY=your_key GEMINI_SOURCE_IMAGE_PATH=./source.png GEMINI_STYLE_IMAGE_PATH=./style.png pnpm dlx tsx packages/google/examples/example-compose-image.ts
# CI/local smoke without API call:
DRY_RUN=1 pnpm dlx tsx packages/google/examples/example-generate-image.ts
DRY_RUN=1 pnpm dlx tsx packages/google/examples/example-compose-image.ts
```

## Supported Models

- `gemini-1.5-pro` - Most capable model for complex tasks
- `gemini-1.5-flash` - Fast and efficient for simpler tasks
- `gemini-pro` - Previous generation model
- `gemini-2.5-flash-image` (or equivalent image-capable Gemini models) for image generation/composition

## Environment Variables

```bash
GOOGLE_API_KEY=your_google_ai_api_key_here
# Backward-compatible alias:
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
```

## Documentation

For complete documentation, examples, and API reference, visit:
- [Robota SDK Documentation](https://robota.io/)
- [Google AI Documentation](https://ai.google.dev/)

## License

MIT License - see LICENSE file for details. 