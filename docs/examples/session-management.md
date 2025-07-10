# Session Management with @robota-sdk/sessions

The `@robota-sdk/sessions` package provides a clean way to manage multiple independent AI agents across different workspaces. Think of it as a container that lets you run multiple AI conversations simultaneously while keeping them completely isolated from each other.

## 🎯 Core Purpose

The sessions package is designed for **managing multiple independent AI agents** in isolated workspaces:

- **SessionManager**: Manages multiple sessions (workspaces)
- **ChatInstance**: Simple wrapper around individual Robota agents
- **Workspace Isolation**: Each session operates in its own memory space
- **Agent Switching**: Easy switching between different AI agents
- **Template Integration**: Uses AgentFactory and AgentTemplates from the agents package

## 🚀 Quick Start

### Installation

```bash
pnpm add @robota-sdk/sessions @robota-sdk/agents @robota-sdk/openai
```

### Basic Usage

```typescript
import { SessionManager } from '@robota-sdk/sessions';
import { OpenAIProvider } from '@robota-sdk/openai';

// Create a session manager
const sessionManager = new SessionManager({
    maxSessions: 10,
    maxChatsPerSession: 5,
    enableWorkspaceIsolation: true,
});

// Create a session (workspace)
const sessionId = sessionManager.createSession({
    name: 'Development Workspace',
    userId: 'developer-123',
    workspaceId: 'workspace-dev',
});

// Create an AI agent in the session
const chatId = await sessionManager.createChat(sessionId, {
    name: 'Coding Assistant',
    agentConfig: {
        name: 'Coding Assistant',
        aiProviders: [new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4',
            systemMessage: 'You are a helpful coding assistant.',
        },
    },
});

// Switch to the agent and start chatting
sessionManager.switchChat(sessionId, chatId);
const chat = sessionManager.getChat(chatId);
const response = await chat.sendMessage('Hello! Can you help me with TypeScript?');
```

## 📋 Key Features

### 1. **Multiple Sessions (Workspaces)**
Each session is an isolated workspace that can contain multiple AI agents:

```typescript
// Create different workspaces for different purposes
const devSession = sessionManager.createSession({
    name: 'Development',
    workspaceId: 'workspace-dev',
});

const researchSession = sessionManager.createSession({
    name: 'Research',
    workspaceId: 'workspace-research',
});
```

### 2. **Multiple AI Agents per Session**
Each session can have multiple specialized AI agents:

```typescript
// Create specialized agents in the same session
const codingAssistant = await sessionManager.createChat(devSession, {
    name: 'Coding Assistant',
    agentConfig: {
        name: 'Coding Assistant',
        aiProviders: [new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4',
            temperature: 0.1,
            systemMessage: 'You are an expert programmer.',
        },
    },
});

const reviewAssistant = await sessionManager.createChat(devSession, {
    name: 'Code Review Assistant',
    agentConfig: {
        name: 'Code Review Assistant',
        aiProviders: [new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4',
            temperature: 0.3,
            systemMessage: 'You are a thorough code reviewer.',
        },
    },
});
```

### 3. **Agent Switching**
Easily switch between different agents within a session:

```typescript
// Switch to coding assistant
sessionManager.switchChat(devSession, codingAssistant);
const codingChat = sessionManager.getChat(codingAssistant);
await codingChat.sendMessage('Help me implement a function');

// Switch to review assistant
sessionManager.switchChat(devSession, reviewAssistant);
const reviewChat = sessionManager.getChat(reviewAssistant);
await reviewChat.sendMessage('Please review this code');
```

### 4. **Workspace Isolation**
Each session operates independently with its own memory space:

```typescript
// Agents in different sessions don't interfere with each other
const session1 = sessionManager.createSession({ workspaceId: 'workspace-1' });
const session2 = sessionManager.createSession({ workspaceId: 'workspace-2' });

// These agents are completely isolated
const agent1 = await sessionManager.createChat(session1, config);
const agent2 = await sessionManager.createChat(session2, config);
```

## 🏗️ Architecture

The sessions package follows a clean, simplified architecture:

```
SessionManager
├── Session 1 (Workspace)
│   ├── ChatInstance 1 (Robota Agent)
│   ├── ChatInstance 2 (Robota Agent)
│   └── ChatInstance 3 (Robota Agent)
├── Session 2 (Workspace)
│   ├── ChatInstance 1 (Robota Agent)
│   └── ChatInstance 2 (Robota Agent)
└── Session 3 (Workspace)
    └── ChatInstance 1 (Robota Agent)
```

### Key Components

- **SessionManager**: Container for multiple sessions
- **ChatInstance**: Simple wrapper around Robota agents
- **TemplateManagerAdapter**: Integrates with agents package templates
- **Workspace Isolation**: Each session has independent memory

## 🎨 Advanced Use Cases

### 1. **Multi-Purpose Development Environment**
```typescript
const devSession = sessionManager.createSession({ name: 'Development' });

// Create specialized agents
const coder = await sessionManager.createChat(devSession, {
    name: 'Coder',
    agentConfig: {
        name: 'Coding Assistant',
        aiProviders: [provider],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4',
            temperature: 0.1,
            systemMessage: 'You are an expert programmer.',
        },
    },
});

const reviewer = await sessionManager.createChat(devSession, {
    name: 'Reviewer',
    agentConfig: {
        name: 'Code Reviewer',
        aiProviders: [provider],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4',
            temperature: 0.3,
            systemMessage: 'You are a thorough code reviewer.',
        },
    },
});

const documenter = await sessionManager.createChat(devSession, {
    name: 'Documenter',
    agentConfig: {
        name: 'Documentation Assistant',
        aiProviders: [provider],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4',
            temperature: 0.5,
            systemMessage: 'You are a technical documentation expert.',
        },
    },
});

// Switch between them as needed
sessionManager.switchChat(devSession, coder);     // For coding
sessionManager.switchChat(devSession, reviewer);  // For code review
sessionManager.switchChat(devSession, documenter); // For documentation
```

### 2. **Multi-User Support**
```typescript
// Create isolated workspaces for different users
const userASession = sessionManager.createSession({ 
    userId: 'user-a', 
    workspaceId: 'workspace-a' 
});

const userBSession = sessionManager.createSession({ 
    userId: 'user-b', 
    workspaceId: 'workspace-b' 
});

// Each user has their own isolated agents
const userAAssistant = await sessionManager.createChat(userASession, config);
const userBAssistant = await sessionManager.createChat(userBSession, config);
```

### 3. **Project-Based Organization**
```typescript
// Create sessions for different projects
const project1 = sessionManager.createSession({ 
    name: 'Project Alpha',
    workspaceId: 'project-alpha',
});

const project2 = sessionManager.createSession({ 
    name: 'Project Beta',
    workspaceId: 'project-beta',
});

// Each project has its own set of specialized agents
const alphaBackend = await sessionManager.createChat(project1, backendConfig);
const alphaFrontend = await sessionManager.createChat(project1, frontendConfig);

const betaBackend = await sessionManager.createChat(project2, backendConfig);
const betaFrontend = await sessionManager.createChat(project2, frontendConfig);
```

## 🔧 API Reference

### SessionManager

#### `createSession(options)`
Creates a new session (workspace):

```typescript
const sessionId = sessionManager.createSession({
    name: 'My Workspace',
    userId: 'user-123',
    workspaceId: 'workspace-abc',
});
```

#### `createChat(sessionId, options)`
Creates a new AI agent in a session:

```typescript
const chatId = await sessionManager.createChat(sessionId, {
    name: 'Assistant',
    agentConfig: {
        name: 'Assistant',
        aiProviders: [provider],
        defaultModel: { provider: 'openai', model: 'gpt-4' },
    },
});
```

#### `switchChat(sessionId, chatId)`
Switches to a different agent in the session:

```typescript
sessionManager.switchChat(sessionId, chatId);
```

#### `getChat(chatId)`
Gets a chat instance for direct interaction:

```typescript
const chat = sessionManager.getChat(chatId);
const response = await chat.sendMessage('Hello!');
```

### ChatInstance

#### `sendMessage(content)`
Sends a message to the AI agent:

```typescript
const response = await chat.sendMessage('Help me with TypeScript');
```

#### `getHistory()`
Gets the conversation history:

```typescript
const messages = chat.getHistory();
```

#### `clearHistory()`
Clears the conversation history:

```typescript
chat.clearHistory();
```

## 🔗 Integration with Agents Package

The sessions package is built on top of the agents package:

- **Robota**: Each ChatInstance wraps a Robota agent
- **AgentFactory**: Used for creating agents with proper configuration
- **AgentTemplates**: Template system for creating specialized agents
- **ConversationHistory**: Leverages the agents package history management

## 🎯 What's NOT Included

The sessions package focuses on session management and does NOT include:

- ❌ Message editing/deletion (use agents package directly)
- ❌ Complex conversation history manipulation
- ❌ Advanced configuration tracking
- ❌ Built-in persistence (use agents ConversationHistoryPlugin)

## 🚀 Running Examples

```bash
# Navigate to sessions examples
cd packages/sessions/examples

# Run basic usage example
bun run basic-session-usage.ts
```

## 📦 Installation

```bash
npm install @robota-sdk/sessions @robota-sdk/agents
# or
pnpm add @robota-sdk/sessions @robota-sdk/agents
```

## 🤝 Contributing

This package is part of the Robota SDK monorepo. See the main repository for contribution guidelines. 