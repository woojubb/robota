# Multi-Agent Team Collaboration

The Robota team collaboration system enables intelligent multi-agent workflows where a primary coordinator can delegate specialized tasks to expert agents. This approach allows solving complex, multi-faceted problems through coordinated teamwork.

## Overview

Team collaboration works by having a **Team Coordinator** that:
1. Analyzes incoming requests for complexity and scope
2. Decides whether to handle tasks directly or delegate to specialists
3. Creates temporary expert agents for specific tasks
4. Coordinates multiple agents for complex workflows
5. Synthesizes results into comprehensive responses

## Quick Start

### Basic Team Setup

```typescript
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';

// Create OpenAI client and provider
const openaiClient = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY 
});

const openaiProvider = new OpenAIProvider({
  client: openaiClient,
  model: 'gpt-4o-mini',
  enablePayloadLogging: true,
  payloadLogDir: './logs/team-collaboration',
  includeTimestampInLogFiles: true
});

const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 16000,
    maxTokenLimit: 50000,
    systemPrompt: 'You are a team coordinator that manages collaborative work.',
    logger: console
  },
  maxMembers: 5,
  debug: false
});

// Simple request - handled directly by coordinator
const response = await team.execute(
  'What are the main differences between React and Vue.js? Please provide 3 key points briefly.'
);

// Complex request - automatically delegates to specialists
const businessPlan = await team.execute(
  'Create a cafe business plan. It must include both: 1) Market analysis, 2) Menu composition. Please write each section separately.'
);
```

### Structured Two-Example Approach

For comprehensive testing, you can create separate teams for different types of tasks:

```typescript
// Example 1: Simple Task (Direct Handling)
const openaiClient1 = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiProvider1 = new OpenAIProvider({
  client: openaiClient1,
  model: 'gpt-4o-mini',
  enablePayloadLogging: true,
  payloadLogDir: './logs/team-collaboration/example1',
  includeTimestampInLogFiles: true
});

const team1 = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider1 },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 16000,
    maxTokenLimit: 50000,
    systemPrompt: 'You are a team coordinator that manages collaborative work.',
    logger: console
  },
  maxMembers: 5,
  debug: false
});

const simpleResult = await team1.execute(
  'What are the main differences between React and Vue.js? Please provide 3 key points briefly.'
);

// Example 2: Complex Task (Team Coordination)
const openaiClient2 = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiProvider2 = new OpenAIProvider({
  client: openaiClient2,
  model: 'gpt-4o-mini',
  enablePayloadLogging: true,
  payloadLogDir: './logs/team-collaboration/example2',
  includeTimestampInLogFiles: true
});

const team2 = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider2 },
    currentProvider: 'openai',
    currentModel: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 16000,
    maxTokenLimit: 50000,
    systemPrompt: 'You are a team coordinator that manages collaborative work.',
    logger: console
  },
  maxMembers: 5,
  debug: false
});

const complexResult = await team2.execute(
  'Create a cafe business plan. It must include both: 1) Market analysis, 2) Menu composition. Please write each section separately.'
);

// Combine statistics from both teams
const stats1 = team1.getStats();
const stats2 = team2.getStats();

console.log(`
Example 1 Results:
• Tasks completed: ${stats1.tasksCompleted}
• Total agents created: ${stats1.totalAgentsCreated}
• Execution time: ${stats1.totalExecutionTime}ms

Example 2 Results:
• Tasks completed: ${stats2.tasksCompleted}
• Total agents created: ${stats2.totalAgentsCreated}
• Execution time: ${stats2.totalExecutionTime}ms

Overall Summary:
• Total tasks completed: ${stats1.tasksCompleted + stats2.tasksCompleted}
• Total agents created: ${stats1.totalAgentsCreated + stats2.totalAgentsCreated}
• Total execution time: ${stats1.totalExecutionTime + stats2.totalExecutionTime}ms
`);
```

### Advanced Configuration

```typescript
import { TeamContainer } from '@robota-sdk/team';
import { OpenAIProvider, AnthropicProvider } from '@robota-sdk/core';

const team = new TeamContainer({
  baseRobotaOptions: {
    aiProviders: {
      openai: new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4'
      }),
      anthropic: new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: 'claude-3-5-sonnet-20241022'
      })
    },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    maxTokenLimit: 100000,
    temperature: 0.7
  },
  maxMembers: 10,
  debug: true
});
```

## How Team Delegation Works

### 1. Request Analysis
The team coordinator analyzes each request to determine:
- **Complexity**: Single-component vs multi-component tasks
- **Expertise Required**: Does this need specialized knowledge?
- **Scope**: Can this be handled directly or needs breakdown?

### 2. Intelligent Decision Making
The coordinator follows these principles:
- **Simple tasks**: Handle directly for efficiency
- **Complex tasks**: Delegate to specialized agents
- **Multi-part requests**: Break down and delegate each component
- **Context preservation**: Ensure each delegated task is self-contained

### 3. Dynamic Agent Creation
For delegated tasks, the system:
- Creates temporary expert agents
- Configures them with appropriate tools and context
- Executes the specialized task
- Automatically cleans up resources

## Examples by Use Case

### Business Planning

```typescript
const businessPlan = await team.execute(`
  Create a comprehensive startup business plan for a sustainable fashion brand:
  1) Market analysis including target demographics and competition
  2) Product line design with sustainable materials focus
  3) Marketing strategy emphasizing eco-friendly values
  4) Financial projections with funding requirements
  5) Operations plan including supply chain considerations
`);

// Team creates specialists for:
// - Market research analyst
// - Product designer
// - Marketing strategist  
// - Financial analyst
// - Operations manager
```

### Software Development

```typescript
const architecturePlan = await team.execute(`
  Design a complete microservices architecture for a social media platform:
  1) System architecture with service boundaries
  2) Database design for user data and content
  3) API specifications for mobile and web clients
  4) Security considerations and authentication
  5) Deployment and scaling strategy
`);

// Team creates specialists for:
// - System architect
// - Database designer
// - API developer
// - Security expert
// - DevOps engineer
```

### Content Creation

```typescript
const marketingCampaign = await team.execute(`
  Develop a complete marketing campaign for a new SaaS product:
  1) Brand messaging and value proposition
  2) Content strategy across multiple channels
  3) Social media campaign with post schedules
  4) Email marketing automation sequences
  5) Performance metrics and KPIs
`);

// Team creates specialists for:
// - Brand strategist
// - Content creator
// - Social media manager
// - Email marketing expert
// - Analytics specialist
```

## Performance Monitoring

### Team Statistics

```typescript
// Execute several tasks with different teams
const team1Result = await team1.execute('Analyze market trends');
const team2Result = await team2.execute('Create financial projections');

// Check individual team performance
const stats1 = team1.getStats();
const stats2 = team2.getStats();

console.log(`Team 1 Performance Report:`);
console.log(`- Total agents created: ${stats1.totalAgentsCreated}`);
console.log(`- Tasks completed: ${stats1.tasksCompleted}`);
console.log(`- Tasks failed: ${stats1.tasksFailed}`);
console.log(`- Total execution time: ${stats1.totalExecutionTime}ms`);

console.log(`Team 2 Performance Report:`);
console.log(`- Total agents created: ${stats2.totalAgentsCreated}`);
console.log(`- Tasks completed: ${stats2.tasksCompleted}`);
console.log(`- Tasks failed: ${stats2.tasksFailed}`);
console.log(`- Total execution time: ${stats2.totalExecutionTime}ms`);

// Combined statistics
const totalTasks = stats1.tasksCompleted + stats2.tasksCompleted;
const totalFailed = stats1.tasksFailed + stats2.tasksFailed;
const successRate = totalTasks / (totalTasks + totalFailed);

console.log(`Combined Performance:`);
console.log(`- Total tasks completed: ${totalTasks}`);
console.log(`- Total agents created: ${stats1.totalAgentsCreated + stats2.totalAgentsCreated}`);
console.log(`- Combined execution time: ${stats1.totalExecutionTime + stats2.totalExecutionTime}ms`);
console.log(`- Success rate: ${(successRate * 100).toFixed(1)}%`);

// Reset statistics for new benchmark (if needed)
// team1.resetStats();
// team2.resetStats();
```

### Resource Management

```typescript
const team = createTeam({
  provider: openaiProvider,
  maxMembers: 5, // Limit concurrent agents
  debug: true    // Enable detailed logging
});

// Monitor resource usage
console.log('Starting complex workflow...');
const result = await team.execute(complexTask);

const stats = team.getStats();
if (stats.totalAgentsCreated >= 5) {
  console.log('Maximum team capacity reached');
}
```

## Best Practices

### 1. Task Design
- **Be specific**: Clear, detailed task descriptions get better results
- **Provide context**: Include relevant background and constraints
- **Set priorities**: Use priority levels to guide resource allocation

```typescript
// Good - specific and contextual
const result = await team.execute(`
  Analyze the competitive landscape for electric vehicle charging stations 
  in California, focusing on pricing strategies, location coverage, and 
  customer satisfaction metrics. The analysis should inform our market 
  entry strategy for Q2 2024.
`);

// Avoid - too vague
const result = await team.execute('Research electric cars');
```

### 2. Resource Planning
- **Set appropriate limits**: Use `maxMembers` to control resource usage
- **Monitor performance**: Regular statistics checks help optimize workflows
- **Plan for complexity**: Complex tasks require higher token limits

```typescript
// For simple workflows
const lightTeam = createTeam({
  provider: openaiProvider,
  maxTokenLimit: 20000,
  maxMembers: 3
});

// For complex analysis workflows  
const powerTeam = createTeam({
  provider: openaiProvider,
  maxTokenLimit: 100000,
  maxMembers: 10
});
```

### 3. Error Handling
- **Graceful degradation**: Handle failures appropriately
- **Retry logic**: Some failures may be transient
- **Logging**: Use debug mode for troubleshooting

```typescript
try {
  const result = await team.execute(complexTask);
  console.log('Task completed successfully:', result);
} catch (error) {
  console.error('Team execution failed:', error.message);
  
  // Check team stats for insights
  const stats = team.getStats();
  console.log(`Failed after creating ${stats.totalAgentsCreated} agents`);
  
  // Optionally retry with simpler approach
  const simpleResult = await team.execute(simplifiedTask);
}
```

## Integration with Other Features

### With Tool Providers

```typescript
import { createZodFunctionToolProvider } from '@robota-sdk/tools';

const calculatorTool = createZodFunctionToolProvider({
  tools: {
    calculate: {
      name: 'calculate',
      description: 'Perform mathematical calculations',
      parameters: z.object({
        expression: z.string(),
        precision: z.number().default(2)
      }),
      handler: async ({ expression, precision }) => {
        // Implementation
      }
    }
  }
});

const team = createTeam({
  baseRobotaOptions: {
    aiProviders: { openai: openaiProvider },
    currentProvider: 'openai',
    currentModel: 'gpt-4',
    toolProviders: [calculatorTool] // Available to all team agents
  }
});
```

### With Session Management

```typescript
import { SessionManager } from '@robota-sdk/sessions';

const sessionManager = new SessionManager();

// Create dedicated team session
const teamSession = sessionManager.createSession({
  name: 'Business Analysis Team',
  provider: openaiProvider,
  systemPrompt: 'You coordinate business analysis tasks'
});

// Use team within session context
const team = createTeam({
  provider: teamSession.getProvider(),
  maxTokenLimit: 50000
});
```

## Limitations and Considerations

### Current Limitations
- **Sequential Processing**: Complex tasks are broken down sequentially
- **Context Boundaries**: Each agent works independently without shared context
- **Resource Overhead**: Each agent creation has computational overhead

### Performance Considerations
- **Token Usage**: Complex delegations can consume significant tokens
- **Execution Time**: Multi-agent workflows take longer than direct processing
- **Cost Management**: Monitor usage with statistics tracking

### When to Use Teams
**Good for:**
- Complex, multi-faceted problems
- Tasks requiring diverse expertise
- Large-scale analysis or planning
- Creative projects with multiple components

**Not ideal for:**
- Simple, single-step tasks
- Real-time or latency-sensitive operations
- Tasks requiring shared state or context
- Resource-constrained environments

## Troubleshooting

### Common Issues

1. **High Token Usage**
   ```typescript
   // Monitor and adjust token limits
   const stats = team.getStats();
   if (stats.totalTokensUsed > expectedLimit) {
     console.warn('High token usage detected');
     team.resetStats(); // Reset for fresh measurement
   }
   ```

2. **Agent Creation Failures**
   ```typescript
   // Check for resource limits
   const stats = team.getStats();
   if (stats.tasksFailed > 0) {
     console.log('Some tasks failed - check logs');
     // Consider reducing complexity or increasing limits
   }
   ```

3. **Slow Performance**
   ```typescript
   // Enable debug mode for detailed timing
   const team = createTeam({
     provider: openaiProvider,
     debug: true // Shows delegation decisions and timing
   });
   ```

### Debug Output
With `debug: true`, you'll see:
```
🚀 Team agent starting work...
🎯 Tool call #1 received: delegateWork
📋 Job: Analyze market trends for electric vehicles
📊 Total tool calls made: 3
✅ Task completed successfully
```

This helps understand how the team is breaking down and processing your requests. 