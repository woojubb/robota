# @robota-sdk/agents

The comprehensive AI agent framework that unifies conversational AI, tool execution, and plugin systems into a powerful, extensible platform.

## Overview

The `@robota-sdk/agents` package is the unified core of the Robota SDK, providing a complete AI agent system with advanced capabilities for conversation management, tool execution, and extensible plugin architecture.

## Key Features

### 🤖 Agent System
- **Robota Class**: Complete AI agent implementation with conversation + tool system + plugin integration
- **Stateless Service Layer**: ConversationService, ToolExecutionService, ExecutionService for business logic
- **Manager Layer**: AIProviders, Tools, AgentFactory, Plugins, ConversationHistory for resource management
- **Parallel Tool Execution**: Concurrent multi-tool calling support

### 🌊 Streaming Response System
- **Real-time Streaming**: Full streaming support across all AI providers
- **Modular Architecture**: Separate streaming/parsing logic for each provider
- **Provider Support**: OpenAI, Anthropic, Google with dedicated stream handlers
- **File Size Optimization**: Modular design keeps files under 150 lines

### 🔧 Tool System
- **ToolRegistry**: Schema storage and validation system
- **Function Tools**: Zod schema-based function tool implementation
- **OpenAPI/MCP Support**: Basic structure for extensibility
- **Tool State Management**: Registration, deregistration, and query functionality

### 🔌 Plugin System
Eight core plugins providing lifecycle hooks and extensibility:

- **ConversationHistoryPlugin**: Conversation storage (memory/file/database)
- **UsagePlugin**: Usage statistics collection (calls, tokens, costs)
- **LoggingPlugin**: Operation logging (Console/File/Remote with environment control)
- **PerformancePlugin**: Performance metrics (response time, memory, CPU)
- **ErrorHandlingPlugin**: Error logging, recovery, and retry handling
- **LimitsPlugin**: Token/request limits (Rate limiting, cost control)
- **EventEmitterPlugin**: Tool event detection and propagation
- **WebhookPlugin**: Webhook notifications for external systems

### 🗂️ Conversation History System
- **Unified Architecture**: Complete integration of Core package's conversation system
- **Multiple Implementations**: SimpleConversationHistory, PersistentSystemConversationHistory
- **Session Management**: ConversationSession with duplicate prevention + API conversion
- **Type Safety**: Complete type system with JSDoc, type guards, and factory functions

### 🤝 Team Collaboration System
- **TeamContainer Integration**: Full agents standard migration with getStats support
- **Execution Tracking**: Task completion, execution time, and agent creation metrics
- **Multi-language Examples**: Working team collaboration examples in English and Korean
- **Test Coverage**: Comprehensive unit tests for team functionality

### 🔌 AI Provider Architecture
- **Provider-agnostic Interface**: Universal message system across all providers
- **Complete Separation**: Independent provider packages with unidirectional dependencies
- **Native Type Usage**: Each provider uses SDK-native types internally
- **Tool Calling Support**: Infinite loop prevention and proper content handling

### 🧪 Testing System
- **Comprehensive Coverage**: 82 total tests (Agents 76 + Team 6)
- **Component Testing**: Core components, managers, services, and team functionality
- **Integration Testing**: Full workflow testing with real provider interactions
- **Mock Support**: Proper mocking for isolated unit testing

## Architecture

### Core Abstraction Layers

```
BaseAgent (Abstract Class)
└── Robota (Implementation - AI conversation + tool system + plugins)

Plugin System (Extensions):
├── BasePlugin (Abstract plugin class)
├── Core Plugins (8 essential plugins)
└── Custom Plugins (User-defined extensions)
```

### Module Structure

```
packages/agents/src/
├── abstracts/           # Abstract base classes
├── interfaces/          # Interface definitions
├── agents/             # Main agent system
│   ├── managers/       # Resource managers
│   ├── services/       # Stateless business logic
│   └── tools/          # Tool system
├── plugins/            # Plugin system
└── utils/              # Core utilities
```

## Package Compatibility

### Integrated Packages
- **@robota-sdk/openai**: Complete agents standard migration
- **@robota-sdk/anthropic**: Complete agents standard migration  
- **@robota-sdk/google**: Complete agents standard migration
- **@robota-sdk/team**: Full integration with team collaboration features
- **@robota-sdk/sessions**: Complete v2.0.0 redesign with ChatInstance, ConversationServiceImpl, and individual service classes

### Deprecated Packages
- **@robota-sdk/core**: Deprecated - functionality moved to agents
- **@robota-sdk/tools**: Deprecated - functionality moved to agents

## Getting Started

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const agent = new Robota({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini'
  }),
  plugins: [
    // Add plugins as needed
  ]
});

const response = await agent.run('Hello, how can you help me today?');
console.log(response);
```

## Examples

See the [examples directory](../../examples/) for comprehensive usage examples including:
- Basic conversations
- Tool calling
- Multi-provider setups
- Team collaboration
- Streaming responses
- Advanced plugin usage

## Documentation

- [API Reference](../../api-reference/agents/)
- [Development Guide](../../development/)
- [Examples](../../examples/) 