# Robota Playground Implementation Guide

## Overview

The Robota Playground is a comprehensive visual interface for designing, configuring, and testing AI agents and teams using a block-coding approach. This implementation provides a complete integration with the Robota SDK architecture while maintaining a user-friendly interface.

## Architecture Components

### Core Infrastructure

#### 1. PlaygroundContext (`apps/web/src/contexts/playground-context.tsx`)
- **Purpose**: Global state management using React Context and useReducer
- **Features**:
  - Type-safe state management with TypeScript
  - Executor lifecycle management
  - Real-time state synchronization
  - Comprehensive error handling and loading states

#### 2. PlaygroundExecutor (`apps/web/src/lib/playground/robota-executor.ts`)
- **Purpose**: Core execution engine following Robota SDK patterns
- **Features**:
  - Facade pattern with simplified public interface
  - Browser-compatible type definitions mirroring `@robota-sdk/agents`
  - Real-time WebSocket communication
  - Plugin system integration

### Custom Hooks

#### 1. usePlaygroundData
```typescript
import { usePlaygroundData } from '@/hooks/use-playground-data';

const {
  visualizationData,
  conversationEvents,
  totalEvents,
  filterEventsByType,
  getExecutionStatistics
} = usePlaygroundData();
```

#### 2. useRobotaExecution
```typescript
import { useRobotaExecution } from '@/hooks/use-robota-execution';

const {
  createAgent,
  createTeam,
  executePrompt,
  executeStreamPrompt,
  canExecute,
  executionState
} = useRobotaExecution();
```

#### 3. useWebSocketConnection
```typescript
import { useWebSocketConnection } from '@/hooks/use-websocket-connection';

const {
  connectionState,
  isConnected,
  connect,
  disconnect,
  statistics
} = useWebSocketConnection();
```

#### 4. useChatInput
```typescript
import { useChatInput } from '@/hooks/use-chat-input';

const {
  inputState,
  sendMessage,
  sendStreamingMessage,
  canSend,
  inputRef
} = useChatInput();
```

### Visual Components

#### 1. AgentConfigurationBlock
```typescript
import { AgentConfigurationBlock } from '@/components/playground/agent-configuration-block';

<AgentConfigurationBlock
  config={agentConfig}
  isActive={true}
  isExecuting={false}
  onConfigChange={handleConfigChange}
  onExecute={handleExecute}
  validationErrors={[]}
/>
```

**Features**:
- Real-time model parameter editing (temperature, tokens, system message)
- AI Provider selection (OpenAI, Anthropic, Google)
- Tools & Plugins integration
- Validation feedback and status indicators

#### 2. TeamConfigurationBlock
```typescript
import { TeamConfigurationBlock } from '@/components/playground/team-configuration-block';

<TeamConfigurationBlock
  config={teamConfig}
  isActive={true}
  isExecuting={false}
  onConfigChange={handleConfigChange}
  onExecute={handleExecute}
/>
```

**Features**:
- Interactive workflow diagrams (Sequential, Parallel, Consensus)
- Coordinator strategy selection with visual preview
- Agent container management within teams
- Team-level settings and metadata

#### 3. ToolContainerBlock
```typescript
import { ToolContainerBlock } from '@/components/playground/tool-container-block';

<ToolContainerBlock
  tools={toolBlocks}
  isEditable={true}
  onToolsChange={handleToolsChange}
  onToolAdd={handleToolAdd}
  onToolExecute={handleToolExecute}
/>
```

**Features**:
- Collapsible tool blocks with parameter configuration
- Tool library with search and discovery
- Execution preview and validation
- Dynamic add/remove with drag & drop support

#### 4. PluginContainerBlock
```typescript
import { PluginContainerBlock } from '@/components/playground/plugin-container-block';

<PluginContainerBlock
  plugins={pluginBlocks}
  isEditable={true}
  onPluginsChange={handlePluginsChange}
  onPluginToggle={handlePluginToggle}
/>
```

**Features**:
- Category-based organization (Storage, Monitoring, Analytics, Security)
- Plugin statistics and performance monitoring
- Options configuration with type-safe inputs
- Priority management and enable/disable controls

## Implementation Example

### Basic Setup

```typescript
// 1. Wrap your app with PlaygroundProvider
import { PlaygroundProvider } from '@/contexts/playground-context';

function App() {
  return (
    <PlaygroundProvider defaultServerUrl="ws://localhost:3001">
      <PlaygroundInterface />
    </PlaygroundProvider>
  );
}

// 2. Use hooks in your components
function PlaygroundInterface() {
  const { state } = usePlayground();
  const { createAgent, executePrompt } = useRobotaExecution();
  const { conversationEvents } = usePlaygroundData();

  const handleCreateAgent = async () => {
    const agentConfig = {
      name: 'My Agent',
      aiProviders: [],
      defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 2000,
        systemMessage: 'You are a helpful AI assistant.'
      },
      tools: [],
      plugins: []
    };
    
    await createAgent(agentConfig);
  };

  const handleExecute = async (prompt: string) => {
    const result = await executePrompt(prompt);
    console.log('Execution result:', result);
  };

  return (
    <div>
      {/* Your UI components */}
    </div>
  );
}
```

### Advanced Configuration

```typescript
// Custom agent with tools and plugins
const advancedAgentConfig = {
  name: 'Advanced Agent',
  aiProviders: [customProvider],
  defaultModel: {
    provider: 'openai',
    model: 'gpt-4-turbo',
    temperature: 0.3,
    maxTokens: 4000,
    systemMessage: 'You are an expert developer assistant.'
  },
  tools: [
    {
      name: 'web_search',
      description: 'Search the web for information',
      execute: async (params) => { /* implementation */ }
    }
  ],
  plugins: [
    {
      name: 'HistoryPlugin',
      version: '1.0.0',
      initialize: async () => {},
      dispose: async () => {}
    }
  ]
};

// Team configuration
const teamConfig = {
  name: 'Development Team',
  agents: [leadAgent, assistantAgent, reviewerAgent],
  workflow: {
    coordinator: 'priority',
    maxDepth: 5
  }
};
```

## WebSocket Integration

The Playground supports real-time communication through WebSocket connections:

```typescript
// Connection management
const { connect, disconnect, isConnected } = useWebSocketConnection();

// Connect to server
await connect('ws://localhost:3001', {
  userId: 'user123',
  sessionId: 'session456',
  authToken: 'token789'
});

// Connection status monitoring
console.log('Connected:', isConnected);
```

## Plugin System

### Creating Custom Plugins

```typescript
import { BasePlugin, PluginCategory, PluginPriority } from '@/lib/playground/plugins/playground-history-plugin';

class CustomPlugin extends BasePlugin {
  readonly name = 'CustomPlugin';
  readonly version = '1.0.0';
  
  constructor(options = {}, logger) {
    super(logger);
    this.category = PluginCategory.CUSTOM;
    this.priority = PluginPriority.NORMAL;
  }

  async initialize(options) {
    await super.initialize(options);
    // Custom initialization logic
  }

  async dispose() {
    // Cleanup logic
  }

  getStats() {
    return {
      ...this.stats,
      customMetric: this.calculateCustomMetric()
    };
  }
}
```

## Type Safety

All components are fully typed with TypeScript:

```typescript
// Agent configuration types
interface PlaygroundAgentConfig {
  id?: string;
  name: string;
  aiProviders: AIProvider[];
  defaultModel: {
    provider: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    systemMessage?: string;
  };
  tools?: BaseTool[];
  plugins?: BasePlugin[];
  metadata?: Record<string, unknown>;
}

// Execution result types
interface PlaygroundExecutionResult {
  success: boolean;
  response: string;
  duration: number;
  error?: Error;
  visualizationData?: PlaygroundVisualizationData;
  toolsExecuted?: string[];
}
```

## Performance Optimization

### Memoization
All hooks use `useMemo` and `useCallback` for optimal performance:

```typescript
const expensiveCalculation = useMemo(() => {
  return calculateStatistics(conversationEvents);
}, [conversationEvents]);

const handleExecute = useCallback(async (prompt: string) => {
  return await executePrompt(prompt);
}, [executePrompt]);
```

### Virtual Scrolling
For large datasets, implement virtual scrolling:

```typescript
import { ScrollArea } from '@/components/ui/scroll-area';

<ScrollArea className="h-96">
  {largeDataset.map(item => (
    <ItemComponent key={item.id} item={item} />
  ))}
</ScrollArea>
```

## Error Handling

Comprehensive error handling throughout the system:

```typescript
try {
  const result = await executePrompt(prompt);
  // Handle success
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle validation errors
  } else if (error instanceof ConnectionError) {
    // Handle connection errors
  } else {
    // Handle unexpected errors
  }
}
```

## Testing

### Unit Tests
```typescript
import { renderHook, act } from '@testing-library/react';
import { useRobotaExecution } from '@/hooks/use-robota-execution';

test('should create agent successfully', async () => {
  const { result } = renderHook(() => useRobotaExecution());
  
  await act(async () => {
    await result.current.createAgent(mockAgentConfig);
  });
  
  expect(result.current.currentAgentConfig).toEqual(mockAgentConfig);
});
```

### Integration Tests
```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { PlaygroundProvider } from '@/contexts/playground-context';
import { AgentConfigurationBlock } from '@/components/playground/agent-configuration-block';

test('should update agent configuration', async () => {
  render(
    <PlaygroundProvider>
      <AgentConfigurationBlock
        config={mockConfig}
        onConfigChange={mockOnChange}
      />
    </PlaygroundProvider>
  );
  
  const nameInput = screen.getByPlaceholderText('Agent Name');
  fireEvent.change(nameInput, { target: { value: 'New Name' } });
  
  expect(mockOnChange).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'New Name' })
  );
});
```

## Deployment

### Build Configuration
```json
{
  "scripts": {
    "build": "next build",
    "start": "next start",
    "dev": "next dev"
  }
}
```

### Environment Variables
```env
NEXT_PUBLIC_PLAYGROUND_WS_URL=ws://localhost:3001
NEXT_PUBLIC_PLAYGROUND_API_URL=http://localhost:3001
```

## Best Practices

1. **State Management**: Use PlaygroundContext for global state, local state for component-specific data
2. **Performance**: Implement proper memoization and avoid unnecessary re-renders
3. **Error Handling**: Provide user-friendly error messages and recovery options
4. **Accessibility**: Ensure keyboard navigation and screen reader compatibility
5. **Type Safety**: Leverage TypeScript for compile-time error prevention
6. **Testing**: Write comprehensive tests for critical functionality

## Troubleshooting

### Common Issues

1. **WebSocket Connection Failed**
   - Check server URL and availability
   - Verify authentication credentials
   - Ensure firewall allows WebSocket connections

2. **Agent Creation Errors**
   - Validate agent configuration
   - Check AI provider credentials
   - Verify tool and plugin dependencies

3. **Performance Issues**
   - Monitor component re-renders
   - Check for memory leaks in WebSocket connections
   - Optimize large datasets with virtual scrolling

For more detailed documentation, see the [Robota SDK Documentation](../README.md). 