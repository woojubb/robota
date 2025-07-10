# @robota-sdk/google

Google AI integration for the Robota SDK, providing seamless access to Google's Gemini models.

## Features

- **Gemini Models**: Support for Gemini 1.5 Pro, Gemini 1.5 Flash, and other Google AI models
- **Streaming Support**: Real-time response streaming for enhanced user experience
- **Function Calling**: Full support for Google AI function calling capabilities
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
  apiKey: process.env.GOOGLE_AI_API_KEY,
  model: 'gemini-1.5-pro'
});

// Create a Robota instance
const robota = new Robota({
  provider,
  systemMessage: 'You are a helpful AI assistant.'
});

// Start chatting
const response = await robota.run('Hello, how can you help me today?');
console.log(response);
```

## Configuration

```typescript
const provider = new GoogleProvider({
  apiKey: 'your-google-ai-api-key',
  model: 'gemini-1.5-pro', // or 'gemini-1.5-flash'
  temperature: 0.7,
  maxTokens: 1000
});
```

## Supported Models

- `gemini-1.5-pro` - Most capable model for complex tasks
- `gemini-1.5-flash` - Fast and efficient for simpler tasks
- `gemini-pro` - Previous generation model

## Environment Variables

```bash
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
```

## Documentation

For complete documentation, examples, and API reference, visit:
- [Robota SDK Documentation](https://robota.io/)
- [Google AI Documentation](https://ai.google.dev/)

## License

MIT License - see LICENSE file for details. 