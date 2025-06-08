# Google Provider

The `@robota-sdk/google` package provides integration with Google AI (Gemini) API.

## Installation

```bash
npm install @robota-sdk/google @google/generative-ai
# or
pnpm add @robota-sdk/google @google/generative-ai
# or
yarn add @robota-sdk/google @google/generative-ai
```

## Basic Usage

To use the Google provider, you first need a Google AI API key.

```typescript
import { Agent } from '@robota-sdk/core';
import { GoogleProvider } from '@robota-sdk/google';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Google AI client
const googleClient = new GoogleGenerativeAI('YOUR_API_KEY');

// Create Google provider
const googleProvider = new GoogleProvider({
    client: googleClient,
    model: 'gemini-1.5-flash', // default
    temperature: 0.7,
    maxTokens: undefined
});

// Create Agent
const agent = new Agent(googleProvider);

// Start conversation
const response = await agent.chat('Hello! How is the weather today?');
console.log(response.content);
```

## Provider Options

`GoogleProvider` supports the following options:

```typescript
interface GoogleProviderOptions {
    /** Google AI client instance (required) */
    client: GoogleGenerativeAI;
    
    /** Model to use (default: 'gemini-1.5-flash') */
    model?: string;
    
    /** Temperature setting (0-1, default: 0.7) */
    temperature?: number;
    
    /** Maximum number of tokens */
    maxTokens?: number;
}
```

## Supported Models

Google provider supports the following models:

- `gemini-1.5-flash` (default)
- `gemini-1.5-pro`
- `gemini-1.0-pro`

## Streaming

Google provider supports streaming responses:

```typescript
const stream = agent.chatStream('Tell me a long story');

for await (const chunk of stream) {
    process.stdout.write(chunk.content);
}
```

## System Messages

Google provider supports system messages:

```typescript
const agent = new Agent(googleProvider, {
    systemPrompt: 'You are a helpful AI assistant. Always respond in Korean.'
});

const response = await agent.chat('Hello, how are you?');
// Will respond in Korean.
```

## Environment Variable Configuration

It is recommended to manage API keys using environment variables:

```bash
# .env file
GOOGLE_AI_API_KEY=your_api_key_here
```

```typescript
import { GoogleGenerativeAI } from '@google/generative-ai';

const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
```

## Error Handling

Google provider properly handles various error situations:

```typescript
try {
    const response = await agent.chat('Hello');
    console.log(response.content);
} catch (error) {
    if (error.message.includes('API key')) {
        console.error('Please check your API key');
    } else {
        console.error('Error processing request:', error.message);
    }
}
```

## Limitations

Current limitations of Google provider:

- Function calling is not yet supported (planned for development)
- Usage information (token count) is not yet accurately returned

## API Key Generation

Google AI API keys can be obtained from [Google AI Studio](https://aistudio.google.com/).

1. Visit Google AI Studio
2. Create a new project or select an existing project
3. Generate API key
4. Store the key in a secure location

## Examples

### Basic Chatbot

```typescript
import { Agent } from '@robota-sdk/core';
import { GoogleProvider } from '@robota-sdk/google';
import { GoogleGenerativeAI } from '@google/generative-ai';

const googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
const provider = new GoogleProvider({ client: googleClient });
const agent = new Agent(provider);

async function chatBot() {
    const response = await agent.chat('Please briefly explain AI');
    console.log(response.content);
}

chatBot();
```

### Multi-turn Conversation

```typescript
const agent = new Agent(provider);

// First message
await agent.chat('My name is John Smith');

// Second message (remembers previous context)
const response = await agent.chat('What was my name?');
console.log(response.content); // "You said your name is John Smith"
``` 