# @robota-sdk/sessions

Session and chat management for Robota SDK - multi-session support with independent workspaces.

## Overview

The `@robota-sdk/sessions` package provides comprehensive session and chat management capabilities for the Robota SDK ecosystem. It enables you to create, manage, and switch between multiple AI conversation sessions with independent configurations and chat histories.

## Features

- **🔄 Multi-Session Management**: Create and manage multiple AI conversation sessions
- **💬 Chat History Management**: Automatic conversation history tracking and persistence
- **⚙️ Independent Configurations**: Each session can have its own AI provider settings
- **🔀 Session Switching**: Seamlessly switch between different conversation contexts
- **📝 Memory Optimization**: Efficient chat history management with configurable limits
- **🛠️ Runtime Configuration**: Dynamic session configuration updates
- **🔧 TypeScript Support**: Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install @robota-sdk/sessions
```

## Quick Start

```typescript
import { SessionManager } from '@robota-sdk/sessions';
import { OpenAIProvider } from '@robota-sdk/openai';

// Create a session manager
const sessionManager = new SessionManager();

// Create a new session with OpenAI
const session = sessionManager.createSession({
  name: 'Customer Support Chat',
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4'
  })
});

// Send a message
const response = await session.sendMessage('Hello, how can I help you today?');
console.log(response.content);

// Create another session for a different context
const codeSession = sessionManager.createSession({
  name: 'Code Assistant',
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY!,
    model: 'gpt-4',
    systemPrompt: 'You are an expert programming assistant.'
  })
});

// Switch between sessions
sessionManager.setActiveSession(codeSession.id);
```

## Core Concepts

### SessionManager

The `SessionManager` is the central hub for managing multiple AI conversation sessions:

```typescript
import { SessionManager } from '@robota-sdk/sessions';

const manager = new SessionManager({
  maxHistoryLength: 100, // Maximum messages per session
  autoSave: true,        // Automatically save chat history
  storage: 'memory'      // Storage type: 'memory' | 'localStorage' | custom
});
```

### Chat Sessions

Each `ChatSession` represents an independent conversation context:

```typescript
// Create a session
const session = manager.createSession({
  name: 'My Chat Session',
  provider: myAIProvider,
  systemPrompt: 'You are a helpful assistant.',
  maxHistoryLength: 50
});

// Send messages
const response = await session.sendMessage('What is TypeScript?');

// Get chat history
const history = session.getChatHistory();

// Update configuration
session.updateConfig({
  systemPrompt: 'You are a coding expert.',
  maxHistoryLength: 100
});
```

### Session Configuration

Sessions support runtime configuration updates:

```typescript
interface SessionConfig {
  name?: string;
  provider?: AIProvider;
  systemPrompt?: string;
  maxHistoryLength?: number;
  metadata?: Record<string, any>;
}

// Update session configuration
session.updateConfig({
  name: 'Updated Session Name',
  systemPrompt: 'New system prompt',
  maxHistoryLength: 150
});
```

## Advanced Usage

### Custom Storage

Implement custom storage for chat history persistence:

```typescript
import { ChatStorage } from '@robota-sdk/sessions';

class DatabaseStorage implements ChatStorage {
  async saveHistory(sessionId: string, history: ChatMessage[]): Promise<void> {
    // Save to database
  }

  async loadHistory(sessionId: string): Promise<ChatMessage[]> {
    // Load from database
    return [];
  }

  async deleteHistory(sessionId: string): Promise<void> {
    // Delete from database
  }
}

const manager = new SessionManager({
  storage: new DatabaseStorage()
});
```

### Session Events

Listen to session events for custom logic:

```typescript
// Listen to session events
session.on('messageAdded', (message) => {
  console.log('New message:', message);
});

session.on('configUpdated', (newConfig) => {
  console.log('Configuration updated:', newConfig);
});

manager.on('sessionCreated', (session) => {
  console.log('New session created:', session.id);
});

manager.on('sessionDeleted', (sessionId) => {
  console.log('Session deleted:', sessionId);
});
```

### Multi-Provider Sessions

Use different AI providers for different sessions:

```typescript
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';

const manager = new SessionManager();

// OpenAI session for general chat
const openaiSession = manager.createSession({
  name: 'General Chat',
  provider: new OpenAIProvider({ model: 'gpt-4' })
});

// Anthropic session for writing
const anthropicSession = manager.createSession({
  name: 'Writing Assistant',
  provider: new AnthropicProvider({ model: 'claude-3-sonnet' })
});

// Google session for analysis
const googleSession = manager.createSession({
  name: 'Data Analysis',
  provider: new GoogleProvider({ model: 'gemini-pro' })
});
```

## API Reference

### SessionManager

#### Methods

- `createSession(config: SessionConfig): ChatSession` - Create a new session
- `getSession(id: string): ChatSession | undefined` - Get session by ID
- `listSessions(): ChatSession[]` - Get all sessions
- `deleteSession(id: string): boolean` - Delete a session
- `setActiveSession(id: string): void` - Set active session
- `getActiveSession(): ChatSession | undefined` - Get current active session

### ChatSession

#### Methods

- `sendMessage(content: string): Promise<ChatResponse>` - Send a message
- `getChatHistory(): ChatMessage[]` - Get chat history
- `clearHistory(): void` - Clear chat history
- `updateConfig(config: Partial<SessionConfig>): void` - Update configuration
- `getConfig(): SessionConfig` - Get current configuration

## Examples

Check out the [examples](./examples) directory for more detailed usage examples:

- [Basic Session Management](./examples/basic-session.ts)
- [Multi-Provider Setup](./examples/multi-provider.ts)
- [Custom Storage Implementation](./examples/custom-storage.ts)
- [Session Events](./examples/session-events.ts)

## TypeScript Support

This package is written in TypeScript and includes comprehensive type definitions:

```typescript
import type {
  SessionManager,
  ChatSession,
  SessionConfig,
  ChatMessage,
  ChatResponse,
  ChatStorage
} from '@robota-sdk/sessions';
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](https://github.com/woojubb/robota/blob/main/CONTRIBUTING.md) for details.

## License

MIT © [Robota SDK Team](https://github.com/woojubb/robota)

## Related Packages

- [`@robota-sdk/core`](https://www.npmjs.com/package/@robota-sdk/core) - Core functionality
- [`@robota-sdk/openai`](https://www.npmjs.com/package/@robota-sdk/openai) - OpenAI integration
- [`@robota-sdk/anthropic`](https://www.npmjs.com/package/@robota-sdk/anthropic) - Anthropic integration
- [`@robota-sdk/google`](https://www.npmjs.com/package/@robota-sdk/google) - Google AI integration
- [`@robota-sdk/tools`](https://www.npmjs.com/package/@robota-sdk/tools) - Tools and utilities 