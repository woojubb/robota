# @robota-sdk/team

Multi-agent collaboration system for the Robota SDK with advanced workflow management.

## Overview

The `@robota-sdk/team` package enables sophisticated multi-agent collaboration within the Robota framework. It provides tools for creating teams of AI agents, managing workflows, and coordinating tasks across multiple agents.

## Installation

```bash
npm install @robota-sdk/team @robota-sdk/agents
```

## Quick Start

```typescript
import { createTeam } from '@robota-sdk/team';
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

// Create individual agents
const researcher = new Robota({
  name: 'Researcher',
  aiProviders: { openai: new OpenAIProvider({ apiKey: 'sk-...' }) },
  currentProvider: 'openai'
});

const writer = new Robota({
  name: 'Writer', 
  aiProviders: { openai: new OpenAIProvider({ apiKey: 'sk-...' }) },
  currentProvider: 'openai'
});

// Create a team
const team = createTeam({
  name: 'Research Team',
  agents: { researcher, writer },
  workflow: {
    description: 'Research and write articles',
    steps: [
      { agent: 'researcher', task: 'Research the topic' },
      { agent: 'writer', task: 'Write an article based on research' }
    ]
  }
});

// Execute team task
const result = await team.executeWorkflow('Write about AI trends');
console.log(result);
```

## Features

### 🤝 Team Collaboration
- **Multi-Agent Coordination**: Orchestrate multiple AI agents working together
- **Workflow Management**: Define and execute complex multi-step workflows
- **Task Assignment**: Dynamic task distribution based on agent capabilities
- **Result Aggregation**: Combine outputs from multiple agents into coherent results

### 📊 Analytics & Monitoring
- **Team Performance**: Track team-wide metrics and statistics
- **Agent Utilization**: Monitor individual agent usage and performance
- **Workflow Analytics**: Analyze workflow execution patterns and efficiency
- **Cost Tracking**: Monitor usage costs across all team members

### 🔧 Advanced Features
- **Dynamic Scaling**: Add or remove agents from teams dynamically
- **Load Balancing**: Distribute tasks based on agent availability and capacity
- **Error Recovery**: Handle agent failures gracefully with fallback strategies
- **Template System**: Pre-defined team configurations for common use cases

## API Reference

### TeamContainer

Main class for managing multi-agent teams.

```typescript
class TeamContainer {
  constructor(config: TeamConfig)
  
  // Workflow execution
  executeWorkflow(input: string, options?: WorkflowOptions): Promise<WorkflowResult>
  assignTask(params: AssignTaskParams): Promise<AssignTaskResult>
  
  // Team management
  addAgent(name: string, agent: AgentInterface): void
  removeAgent(name: string): void
  getAgent(name: string): AgentInterface | undefined
  
  // Analytics
  getStats(): TeamStats
}
```

### Team Configuration

```typescript
interface TeamConfig {
  name: string;
  agents: Record<string, AgentInterface>;
  workflow?: {
    description: string;
    steps: WorkflowStep[];
  };
  options?: {
    maxConcurrent?: number;
    timeout?: number;
    retryPolicy?: RetryPolicy;
  };
}
```

### Workflow System

```typescript
interface WorkflowStep {
  agent: string;
  task: string;
  dependsOn?: string[];
  condition?: (context: WorkflowContext) => boolean;
  timeout?: number;
}

interface WorkflowResult {
  success: boolean;
  results: Record<string, string>;
  metadata: {
    totalTime: number;
    agentsUsed: string[];
    stepResults: StepResult[];
  };
}
```

## Architecture

### Module Structure

```
packages/team/src/
├── team-container.ts       # Main TeamContainer class
├── create-team.ts          # Team creation utilities
├── workflow-formatter.ts   # Workflow result formatting
├── types.ts               # TypeScript definitions
└── index.ts               # Public exports
```

### Integration Points

- **Agent System**: Works with any agent implementing AgentInterface
- **Plugin System**: Inherits all agent plugin capabilities
- **Analytics**: Aggregates metrics from all team members
- **Error Handling**: Unified error management across team operations

## Workflow Patterns

### Sequential Workflow
Agents execute tasks in a defined order:

```typescript
const team = createTeam({
  name: 'Sequential Team',
  workflow: {
    steps: [
      { agent: 'researcher', task: 'Gather information' },
      { agent: 'analyst', task: 'Analyze data' },
      { agent: 'reporter', task: 'Generate report' }
    ]
  }
});
```

### Parallel Workflow
Agents execute tasks concurrently:

```typescript
const team = createTeam({
  name: 'Parallel Team',
  workflow: {
    steps: [
      { agent: 'agent1', task: 'Task A' },
      { agent: 'agent2', task: 'Task B' },
      { agent: 'agent3', task: 'Task C' }
    ]
  },
  options: { maxConcurrent: 3 }
});
```

### Conditional Workflow
Agents execute based on conditions:

```typescript
const team = createTeam({
  name: 'Conditional Team',
  workflow: {
    steps: [
      { agent: 'classifier', task: 'Classify input' },
      { 
        agent: 'specialist1', 
        task: 'Handle type A',
        condition: (ctx) => ctx.classification === 'typeA'
      },
      { 
        agent: 'specialist2', 
        task: 'Handle type B',
        condition: (ctx) => ctx.classification === 'typeB'
      }
    ]
  }
});
```

## Team Templates

Pre-configured team setups for common scenarios:

### Research Team
- **Researcher**: Gathers information and sources
- **Analyst**: Processes and analyzes data
- **Writer**: Creates final documentation

### Development Team
- **Architect**: Designs system architecture
- **Developer**: Writes code implementations
- **Tester**: Creates tests and validates functionality
- **Reviewer**: Reviews and improves code quality

### Content Team
- **Content Strategist**: Plans content strategy
- **Writer**: Creates written content
- **Editor**: Reviews and refines content
- **SEO Specialist**: Optimizes for search engines

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm run test
```

### Linting

```bash
npm run lint
npm run lint:fix
```

## Examples

- [Basic Team Setup](../../../docs/examples/team-basic.md)
- [Sequential Workflows](../../../docs/examples/team-sequential.md)
- [Parallel Processing](../../../docs/examples/team-parallel.md)
- [Conditional Logic](../../../docs/examples/team-conditional.md)
- [Team Analytics](../../../docs/examples/team-analytics.md)

## Best Practices

1. **Agent Specialization**: Design agents with specific roles and capabilities
2. **Error Handling**: Implement robust error recovery in workflows
3. **Resource Management**: Monitor and optimize agent resource usage
4. **Task Granularity**: Break down complex tasks into manageable steps
5. **Performance Monitoring**: Regularly analyze team performance metrics

## License

MIT 