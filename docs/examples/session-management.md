# Session Management

This example demonstrates how to use the Robota Sessions package to manage user sessions, multiple chats, and conversation state across different contexts.

## Overview

The session management example shows how to:
- Create and manage user sessions with SessionManager
- Handle multiple chats within a single session
- Switch between different chat contexts
- Manage session lifecycle (pause, resume, cleanup)
- Configure session limits and auto-cleanup

## Source Code

**Location**: `apps/examples/04-sessions/basic-session-usage.ts`

## Key Concepts

### 1. Session Manager Creation
```typescript
import { SessionManagerImpl } from '@robota-sdk/sessions';

const sessionManager = new SessionManagerImpl({
    maxActiveSessions: 3,        // Maximum concurrent sessions per user
    autoCleanup: true,           // Automatic cleanup of expired sessions
    sessionTimeout: 30 * 60 * 1000,  // 30 minutes timeout
    maxChatsPerSession: 10       // Maximum chats per session
});
```

### 2. Creating User Sessions
```typescript
// Create a new session for a user
const session = await sessionManager.createSession('user123', {
    sessionName: 'My Work Session',
    metadata: {
        userAgent: 'Browser/1.0',
        ipAddress: '192.168.1.100',
        tags: ['work', 'productivity']
    }
});

console.log(`Session created: ${session.metadata.sessionName}`);
```

### 3. Managing Multiple Chats
```typescript
// Create first chat within the session
const chat1 = await session.createNewChat({
    chatName: 'General Chat',
    robotaConfig: {
        // AI provider configuration for this specific chat
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'You are a helpful assistant for general questions.'
    }
});

// Create second chat with different configuration
const chat2 = await session.createNewChat({
    chatName: 'Code Review',
    robotaConfig: {
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-4',
        systemPrompt: 'You are a senior developer helping with code reviews.'
    }
});
```

### 4. Chat Context Switching
```typescript
// Switch between chats
await session.switchToChat(chat1.metadata.chatId);
console.log('Switched to general chat');

// Send message in current chat context
await session.sendMessage('Hello! How can you help me today?');

// Switch to different chat
await session.switchToChat(chat2.metadata.chatId);
console.log('Switched to code review chat');

// Message will be sent in code review context
await session.sendMessage('Please review this TypeScript function...');
```

## Running the Example

1. **Ensure setup is complete** (see [Setup Guide](./setup.md))

2. **Install sessions package**:
   ```bash
   pnpm add @robota-sdk/sessions
   ```

3. **Navigate to examples directory**:
   ```bash
   cd apps/examples
   ```

4. **Run the example**:
   ```bash
   # Using bun (recommended)
   bun run 04-sessions/basic-session-usage.ts
   
   # Using pnpm + tsx
   pnpm tsx 04-sessions/basic-session-usage.ts
   ```

## Expected Output

```
📝 Basic Session Management Usage Example

✅ Session created: My Work Session
💬 First chat created: General Chat
💡 Message sending feature ready (AI provider configuration required)
⚠️  Skipping message sending due to unconfigured AI provider
💬 Second chat created: Code Review
🔄 Switched to first chat

📊 Session statistics: {
  'Chat count': 2,
  'Total messages': 0,
  'Created at': '12/1/2024, 3:45:30 PM'
}

⏸️  Session paused
▶️  Session resumed
👤 User session count: 2
🧹 Session manager cleanup completed
```

## Advanced Session Patterns

### 1. Complete Session with AI Integration
```typescript
import { SessionManagerImpl } from '@robota-sdk/sessions';
import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';

async function createCompleteSessionExample() {
    // Setup AI provider
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const openaiProvider = new OpenAIProvider(openaiClient);
    
    // Create session manager
    const sessionManager = new SessionManagerImpl({
        maxActiveSessions: 5,
        autoCleanup: true,
        sessionTimeout: 60 * 60 * 1000 // 1 hour
    });
    
    // Create user session
    const session = await sessionManager.createSession('user456', {
        sessionName: 'AI Assistant Session',
        preferences: {
            language: 'en',
            timezone: 'UTC',
            theme: 'dark'
        }
    });
    
    // Create chat with full AI configuration
    const chat = await session.createNewChat({
        chatName: 'Main Conversation',
        robotaConfig: {
            aiProviders: { 'openai': openaiProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: 'You are a helpful AI assistant. Maintain context across our conversation.',
            debug: false
        }
    });
    
    // Send messages and maintain conversation
    await chat.sendMessage('Hello! What can you help me with?');
    const response1 = await chat.getLastResponse();
    console.log('AI:', response1);
    
    await chat.sendMessage('Can you remember what we talked about?');
    const response2 = await chat.getLastResponse();
    console.log('AI:', response2);
    
    return { sessionManager, session, chat };
}
```

### 2. Multi-User Session Management
```typescript
class MultiUserSessionManager {
    private sessionManager: SessionManagerImpl;
    private userSessions: Map<string, string[]> = new Map();
    
    constructor() {
        this.sessionManager = new SessionManagerImpl({
            maxActiveSessions: 50,        // Total across all users
            maxSessionsPerUser: 5,        // Per user limit
            autoCleanup: true,
            cleanupInterval: 5 * 60 * 1000 // 5 minutes
        });
    }
    
    async createUserSession(userId: string, sessionConfig: any) {
        // Check user session limit
        const userSessionIds = this.userSessions.get(userId) || [];
        if (userSessionIds.length >= 5) {
            throw new Error(`User ${userId} has reached maximum session limit`);
        }
        
        // Create session
        const session = await this.sessionManager.createSession(userId, sessionConfig);
        
        // Track user sessions
        userSessionIds.push(session.metadata.sessionId);
        this.userSessions.set(userId, userSessionIds);
        
        return session;
    }
    
    async getUserSessions(userId: string) {
        return this.sessionManager.getUserSessions(userId);
    }
    
    async cleanupUserSessions(userId: string) {
        const sessions = await this.getUserSessions(userId);
        
        for (const session of sessions) {
            await session.close();
        }
        
        this.userSessions.delete(userId);
    }
    
    async getActiveUserCount(): Promise<number> {
        return this.userSessions.size;
    }
    
    async getTotalActiveChats(): Promise<number> {
        let totalChats = 0;
        
        for (const userId of this.userSessions.keys()) {
            const sessions = await this.getUserSessions(userId);
            for (const session of sessions) {
                const stats = session.getStats();
                totalChats += stats.chatCount;
            }
        }
        
        return totalChats;
    }
}
```

### 3. Session Persistence and Recovery
```typescript
class PersistentSessionManager {
    private sessionManager: SessionManagerImpl;
    private persistenceAdapter: SessionPersistenceAdapter;
    
    constructor(persistenceAdapter: SessionPersistenceAdapter) {
        this.sessionManager = new SessionManagerImpl({
            maxActiveSessions: 10,
            autoCleanup: true,
            persistenceAdapter: persistenceAdapter
        });
        this.persistenceAdapter = persistenceAdapter;
    }
    
    async saveSession(sessionId: string) {
        const session = await this.sessionManager.getSession(sessionId);
        if (session) {
            const sessionData = await session.serialize();
            await this.persistenceAdapter.save(sessionId, sessionData);
        }
    }
    
    async loadSession(sessionId: string, userId: string) {
        try {
            const sessionData = await this.persistenceAdapter.load(sessionId);
            return await this.sessionManager.deserializeSession(userId, sessionData);
        } catch (error) {
            console.error(`Failed to load session ${sessionId}:`, error);
            return null;
        }
    }
    
    async recoverUserSessions(userId: string) {
        const sessionIds = await this.persistenceAdapter.getUserSessionIds(userId);
        const recoveredSessions = [];
        
        for (const sessionId of sessionIds) {
            const session = await this.loadSession(sessionId, userId);
            if (session) {
                recoveredSessions.push(session);
            }
        }
        
        return recoveredSessions;
    }
}

// Example persistence adapter interface
interface SessionPersistenceAdapter {
    save(sessionId: string, data: any): Promise<void>;
    load(sessionId: string): Promise<any>;
    delete(sessionId: string): Promise<void>;
    getUserSessionIds(userId: string): Promise<string[]>;
}
```

## Configuration Options

### 1. Session Manager Configuration
```typescript
interface SessionManagerConfig {
    maxActiveSessions?: number;        // Maximum concurrent sessions
    maxSessionsPerUser?: number;       // Per-user session limit
    autoCleanup?: boolean;             // Enable automatic cleanup
    cleanupInterval?: number;          // Cleanup interval in ms
    sessionTimeout?: number;           // Session timeout in ms
    maxChatsPerSession?: number;       // Maximum chats per session
    persistenceAdapter?: SessionPersistenceAdapter;  // Persistence layer
    logger?: Logger;                   // Custom logger
}

const sessionManager = new SessionManagerImpl({
    maxActiveSessions: 100,
    maxSessionsPerUser: 10,
    autoCleanup: true,
    cleanupInterval: 10 * 60 * 1000,   // 10 minutes
    sessionTimeout: 2 * 60 * 60 * 1000, // 2 hours
    maxChatsPerSession: 20,
    logger: customLogger
});
```

### 2. Session Creation Options
```typescript
interface SessionCreateOptions {
    sessionName?: string;
    metadata?: Record<string, any>;
    preferences?: Record<string, any>;
    tags?: string[];
    expiresAt?: Date;
    autoSave?: boolean;
}

const session = await sessionManager.createSession('user123', {
    sessionName: 'Customer Support Session',
    metadata: {
        department: 'support',
        priority: 'high',
        customerTier: 'premium'
    },
    preferences: {
        language: 'en-US',
        timezone: 'America/New_York',
        responseStyle: 'formal'
    },
    tags: ['support', 'urgent', 'premium'],
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    autoSave: true
});
```

### 3. Chat Configuration Options
```typescript
interface ChatCreateOptions {
    chatName?: string;
    robotaConfig?: RobotaConfig;
    metadata?: Record<string, any>;
    systemPrompt?: string;
    tags?: string[];
    maxMessages?: number;
}

const chat = await session.createNewChat({
    chatName: 'Technical Support',
    robotaConfig: {
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-4',
        toolProviders: [technicalSupportTools],
        debug: true
    },
    metadata: {
        category: 'technical',
        difficulty: 'advanced'
    },
    systemPrompt: 'You are a technical support specialist...',
    tags: ['technical', 'support'],
    maxMessages: 100
});
```

## Session Analytics and Monitoring

### 1. Session Statistics
```typescript
// Get session statistics
const stats = session.getStats();
console.log('Session Statistics:', {
    sessionId: stats.sessionId,
    userId: stats.userId,
    chatCount: stats.chatCount,
    totalMessages: stats.totalMessages,
    createdAt: stats.createdAt,
    lastActivity: stats.lastActivity,
    isActive: stats.isActive,
    isPaused: stats.isPaused
});

// Get chat-specific statistics
const chatStats = await chat.getStats();
console.log('Chat Statistics:', {
    chatId: chatStats.chatId,
    messageCount: chatStats.messageCount,
    createdAt: chatStats.createdAt,
    lastMessage: chatStats.lastMessage,
    averageResponseTime: chatStats.averageResponseTime
});
```

### 2. System-Wide Analytics
```typescript
class SessionAnalytics {
    private sessionManager: SessionManagerImpl;
    
    constructor(sessionManager: SessionManagerImpl) {
        this.sessionManager = sessionManager;
    }
    
    async getSystemStats() {
        const allSessions = await this.sessionManager.getAllActiveSessions();
        
        return {
            totalActiveSessions: allSessions.length,
            totalActiveUsers: new Set(allSessions.map(s => s.metadata.userId)).size,
            totalActiveChats: allSessions.reduce((sum, s) => sum + s.getStats().chatCount, 0),
            averageChatsPerSession: allSessions.length > 0 
                ? allSessions.reduce((sum, s) => sum + s.getStats().chatCount, 0) / allSessions.length 
                : 0,
            oldestSession: Math.min(...allSessions.map(s => s.getStats().createdAt.getTime())),
            newestSession: Math.max(...allSessions.map(s => s.getStats().createdAt.getTime()))
        };
    }
    
    async getUserActivityReport(userId: string) {
        const userSessions = await this.sessionManager.getUserSessions(userId);
        
        return {
            userId,
            totalSessions: userSessions.length,
            activeSessions: userSessions.filter(s => s.getStats().isActive).length,
            totalChats: userSessions.reduce((sum, s) => sum + s.getStats().chatCount, 0),
            totalMessages: userSessions.reduce((sum, s) => sum + s.getStats().totalMessages, 0),
            lastActivity: Math.max(...userSessions.map(s => s.getStats().lastActivity?.getTime() || 0))
        };
    }
}
```

## Best Practices

### 1. Session Lifecycle Management
```typescript
// Proper session cleanup
async function sessionLifecycleExample() {
    const sessionManager = new SessionManagerImpl({ autoCleanup: true });
    
    try {
        // Create session
        const session = await sessionManager.createSession('user123', {
            sessionName: 'Temporary Session'
        });
        
        // Use session
        const chat = await session.createNewChat({
            chatName: 'Quick Chat',
            robotaConfig: { /* config */ }
        });
        
        // Graceful pause when user is inactive
        await session.pause();
        
        // Resume when user returns
        await session.resume();
        
        // Explicit cleanup when done
        await session.close();
        
    } catch (error) {
        console.error('Session error:', error);
    } finally {
        // Ensure cleanup
        await sessionManager.shutdown();
    }
}
```

### 2. Error Handling and Recovery
```typescript
async function robustSessionUsage() {
    const sessionManager = new SessionManagerImpl({ 
        maxActiveSessions: 10,
        autoCleanup: true 
    });
    
    try {
        // Attempt to create session
        const session = await sessionManager.createSession('user123', {
            sessionName: 'Robust Session'
        });
        
        // Create chat with error handling
        const chat = await session.createNewChat({
            chatName: 'Main Chat',
            robotaConfig: {
                aiProviders: { 'openai': openaiProvider },
                currentProvider: 'openai',
                currentModel: 'gpt-3.5-turbo'
            }
        }).catch(async (error) => {
            console.error('Chat creation failed:', error);
            // Fallback to simpler configuration
            return await session.createNewChat({
                chatName: 'Fallback Chat',
                robotaConfig: { /* minimal config */ }
            });
        });
        
        // Robust message sending
        await chat.sendMessage('Hello').catch(error => {
            console.error('Message failed:', error);
            // Could implement retry logic here
        });
        
    } catch (error) {
        console.error('Session operation failed:', error);
        // Handle session creation failure
    }
}
```

### 3. Performance Optimization
```typescript
// Batch operations for better performance
async function optimizedSessionOperations() {
    const sessionManager = new SessionManagerImpl({ autoCleanup: true });
    
    // Create multiple sessions efficiently
    const sessionPromises = ['user1', 'user2', 'user3'].map(userId =>
        sessionManager.createSession(userId, { sessionName: `Session for ${userId}` })
    );
    
    const sessions = await Promise.all(sessionPromises);
    
    // Batch chat creation
    const chatPromises = sessions.map(session =>
        session.createNewChat({
            chatName: 'Default Chat',
            robotaConfig: { /* shared config */ }
        })
    );
    
    const chats = await Promise.all(chatPromises);
    
    // Efficient cleanup
    await Promise.all(sessions.map(session => session.close()));
}
```

## Next Steps

After mastering session management, explore:

1. [**Advanced Session Patterns**](./advanced-sessions.md) - Complex session architectures
2. [**Session Persistence**](./session-persistence.md) - Saving and restoring sessions
3. [**Multi-Tenant Sessions**](./multi-tenant-sessions.md) - Enterprise session management

## Troubleshooting

### Session Creation Issues
- Verify session manager is properly initialized
- Check user session limits and quotas
- Ensure proper cleanup of expired sessions

### Chat Context Problems
- Confirm chat switching is successful before sending messages
- Verify Robota configuration is valid for each chat
- Check AI provider availability and credentials

### Performance Issues
- Monitor session and chat counts
- Implement proper cleanup strategies
- Consider session timeout and auto-cleanup settings

### Memory Management
- Enable auto-cleanup for production environments
- Set appropriate session timeouts
- Monitor and limit maximum sessions per user 