# @robota-sdk/sessions

Session management package for the Robota SDK, providing high-level session lifecycle management, conversation history, and state persistence for AI agent interactions.

## Overview

The sessions package enables you to:
- Manage conversation sessions with unique identifiers
- Persist conversation history across interactions
- Handle system messages and context management
- Implement custom storage providers for session data
- Track session metadata and analytics

## Key Features

### 🔄 Session Lifecycle Management
- Create, pause, resume, and terminate sessions
- Automatic session cleanup and resource management
- User-based session organization and filtering

### 💬 Conversation History
- Store and retrieve conversation messages
- Support for all message types (user, assistant, system, tool)
- Configurable message limits and retention policies

### 🗄️ Flexible Storage
- In-memory storage for development and testing
- Plugin architecture for custom storage providers
- Async-first design for database integration

### 🎯 System Message Management
- Configure AI behavior with system prompts
- Layer multiple system instructions
- Dynamic system message updates during sessions

## Installation

```bash
npm install @robota-sdk/sessions
```

## Quick Start

### Basic Session Usage

```typescript
import { SessionManagerImpl, BasicSessionStore } from '@robota-sdk/sessions';

// Create a session manager with in-memory storage
const sessionManager = new SessionManagerImpl({
  maxActiveSessions: 10,
  autoCleanup: true
});

// Create a new session for a user
const session = await sessionManager.createSession('user-123', {
  name: 'Customer Support Chat'
});

// Use the session for conversations
const chatInstance = session.createChat({
  name: 'Main Conversation'
});

await chatInstance.addMessage('user', 'Hello, I need help with my order');
```

### Conversation History Management

```typescript
import { SimpleConversationHistory } from '@robota-sdk/sessions';

// Create conversation history with message limit
const history = new SimpleConversationHistory(50); // Keep last 50 messages

// Add messages
history.addMessage({
  role: 'user',
  content: 'What is the weather like today?',
  timestamp: new Date()
});

history.addMessage({
  role: 'assistant',
  content: 'I can help you check the weather. What location are you interested in?',
  timestamp: new Date()
});

// Retrieve conversation
const messages = history.getMessages();
const lastUserMessage = history.getLastUserMessage();
```

### System Message Management

```typescript
import { SystemMessageManagerImpl } from '@robota-sdk/sessions';

const systemManager = new SystemMessageManagerImpl();

// Set primary system prompt
systemManager.setSystemPrompt(
  'You are a helpful customer service assistant. Be polite and professional.'
);

// Add additional context
systemManager.addSystemMessage(
  'Today is a busy day, so prioritize urgent customer issues.'
);

// Get all system messages for AI context
const systemMessages = systemManager.getSystemMessages();
```

### Custom Storage Provider

```typescript
import { SessionStore, SessionInfo } from '@robota-sdk/sessions';

class DatabaseSessionStore implements SessionStore {
  async save(session: SessionInfo): Promise<void> {
    // Save to your database
    await database.sessions.create(session);
  }

  async load(sessionId: string): Promise<SessionInfo | null> {
    // Load from your database
    return await database.sessions.findById(sessionId);
  }

  async delete(sessionId: string): Promise<boolean> {
    // Delete from your database
    const result = await database.sessions.delete(sessionId);
    return result.deletedCount > 0;
  }

  async list(userId?: string): Promise<SessionInfo[]> {
    // List sessions from your database
    const filter = userId ? { userId } : {};
    return await database.sessions.find(filter);
  }

  async exists(sessionId: string): Promise<boolean> {
    // Check existence in your database
    const count = await database.sessions.count({ id: sessionId });
    return count > 0;
  }

  async clear(): Promise<void> {
    // Clear all sessions from your database
    await database.sessions.deleteMany({});
  }
}

// Use custom storage
const customStore = new DatabaseSessionStore();
const sessionManager = new SessionManagerImpl({
  storage: customStore
});
```

## Architecture

The sessions package follows a facade pattern to provide high-level APIs while maintaining flexibility:

- **Session Management**: Core session lifecycle and state management
- **Storage Layer**: Pluggable storage providers for persistence
- **Conversation History**: Message storage and retrieval with type safety
- **System Context**: AI instruction and behavior management
- **Utilities**: Logging, metrics, and helper functions

## API Reference

### Core Classes

- [`SessionManagerImpl`](../../api-reference/sessions/classes/SessionManagerImpl.md) - Main session management
- [`SimpleConversationHistory`](../../api-reference/sessions/classes/SimpleConversationHistory.md) - Basic conversation storage
- [`BasicSessionStore`](../../api-reference/sessions/classes/BasicSessionStore.md) - In-memory session storage
- [`SystemMessageManagerImpl`](../../api-reference/sessions/classes/SystemMessageManagerImpl.md) - System message management

### Interfaces

- [`SessionStore`](../../api-reference/sessions/interfaces/SessionStore.md) - Storage provider contract
- [`ConversationHistoryInterface`](../../api-reference/sessions/interfaces/ConversationHistoryInterface.md) - Conversation history contract
- [`SystemMessageManager`](../../api-reference/sessions/interfaces/SystemMessageManager.md) - System message management contract

### Types

- [`SessionInfo`](../../api-reference/sessions/interfaces/SessionInfo.md) - Session metadata and state
- [`SessionConfig`](../../api-reference/sessions/interfaces/SessionConfig.md) - Session configuration options
- [`SessionState`](../../api-reference/sessions/enums/SessionState.md) - Session lifecycle states

## Best Practices

### Session Organization

```typescript
// Group sessions by user and purpose
const supportSession = await sessionManager.createSession('user-123', {
  name: 'Customer Support',
  metadata: {
    department: 'billing',
    priority: 'high',
    tags: ['urgent', 'billing-issue']
  }
});
```

### Memory Management

```typescript
// Configure appropriate limits
const history = new SimpleConversationHistory(100); // Limit to 100 messages
const sessionManager = new SessionManagerImpl({
  maxActiveSessions: 50,
  autoCleanup: true,
  cleanupInterval: 3600000 // 1 hour
});
```

### Error Handling

```typescript
try {
  const session = await sessionManager.createSession('user-123');
  // Use session...
} catch (error) {
  if (error.message.includes('Maximum session count')) {
    // Handle session limit exceeded
    await sessionManager.cleanup(); // Clean up old sessions
    const session = await sessionManager.createSession('user-123');
  } else {
    throw error;
  }
}
```

## Integration with Robota Core

The sessions package integrates seamlessly with the core Robota SDK:

```typescript
import { Robota } from '@robota-sdk/core';
import { SessionManagerImpl } from '@robota-sdk/sessions';

const robota = new Robota({
  // ... AI provider configuration
});

const sessionManager = new SessionManagerImpl();
const session = await sessionManager.createSession('user-123');

// Use session's conversation history with Robota
const messages = session.getConversationHistory().getMessages();
const response = await robota.run('Continue our conversation', {
  conversationHistory: messages
});
```

## Examples

See the [session examples](../../../apps/examples/04-sessions/) for comprehensive usage patterns and integration scenarios.

## Contributing

This package follows the same contribution guidelines as the main Robota SDK. See the [development guide](../../development/) for more information.

## License

MIT - See the main Robota SDK license for details. 