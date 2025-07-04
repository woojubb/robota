# @robota-sdk/team

Multi-agent collaboration system for the Robota SDK with advanced workflow management.

## Overview

The `@robota-sdk/team` package enables sophisticated multi-agent collaboration with intelligent template-based expert selection. It features automatic task analysis, expert delegation, and comprehensive workflow management for complex multi-step projects.

## Installation

```bash
npm install @robota-sdk/team @robota-sdk/agents
```

## Quick Start

```typescript
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';

// Create AI providers
const openaiProvider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
const anthropicProvider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });

// Create team with template-based expert selection
const team = createTeam({
  aiProviders: {
    openai: openaiProvider,
    anthropic: anthropicProvider
  }
});

// Execute complex task - automatic expert delegation
const result = await team.execute(`
Analyze the market for sustainable energy solutions and develop 3 innovative product concepts.
Include market research, competitive analysis, and detailed product specifications.
`);

console.log(result);
```

## Features

### 🧠 Intelligent Template System
- **Automatic Expert Selection**: AI analyzes requests and selects optimal specialist templates
- **Built-in Expert Templates**: 6 specialized templates (task_coordinator, domain_researcher, creative_ideator, summarizer, ethical_reviewer, fast_executor)
- **Optimized AI Providers**: Each template uses optimal AI model and settings for its specialty
- **Natural Language Interface**: Simply describe your needs - the system handles expert delegation

### 🤝 Advanced Collaboration
- **Task Decomposition**: Automatically breaks complex requests into specialist tasks
- **Context Preservation**: Ensures delegated tasks maintain proper context and requirements
- **Dynamic Agent Creation**: Creates temporary expert agents from templates as needed
- **Result Synthesis**: Combines specialist outputs into comprehensive responses

### 📊 Workflow Analytics & Monitoring
- **Workflow Visualization**: Generate flowcharts and relationship diagrams
- **Performance Metrics**: Track execution time, success rates, and resource usage
- **Template Usage Statistics**: Monitor which experts are used most frequently
- **Cost Optimization**: Track costs across different AI providers and models

### 🔧 Template Management
- **Custom Templates**: Add your own expert templates with specialized prompts
- **Template Registry**: Centralized management of all available expert templates
- **Provider Configuration**: Each template specifies optimal AI provider and settings
- **Version Control**: Template versioning and update management

## API Reference

### TeamContainer

Main class for managing multi-agent teams.

```typescript
class TeamContainer {
  constructor(config: TeamConfig)
  
  // Workflow execution
  execute(input: string): Promise<string>
  
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