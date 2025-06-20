# @robota-sdk/team

[![npm version](https://badge.fury.io/js/%40robota-sdk%2Fteam.svg)](https://www.npmjs.com/package/@robota-sdk/team)

Multi-agent teamwork functionality for Robota SDK - Dynamic agent coordination and task delegation.

## Documentation

For full documentation, visit [https://robota.io](https://robota.io)

## Installation

```bash
npm install @robota-sdk/team
```

## Overview

`@robota-sdk/team` enables multi-agent collaboration by allowing a Team agent to dynamically create and coordinate temporary agents for complex tasks. Using a simple `delegateWork` tool, tasks are broken down and distributed across specialized agents that are created on-demand.

## Key Features

### 🤝 **Dynamic Agent Coordination**
- Team agent analyzes user requests and delegates to specialized members
- Temporary agents created on-demand for specific tasks
- Automatic cleanup and resource management

### ⚡ **Unified delegateWork Tool**
- Single tool interface for all task delegation
- No special agent types - all agents use the same Robota instances
- Recursive delegation support for complex task breakdown

### 🎯 **Task-Specific Agent Creation**
- AgentFactory generates agents with appropriate system prompts
- Tool selection based on task requirements
- Role-based specialization through prompt engineering

### 📊 **Team Analytics & Monitoring**
- Real-time statistics on agent creation and task completion
- Execution time tracking and token usage monitoring
- Debug mode for detailed team coordination logs

## Architecture

### Simple 2-Layer Structure
```
Team Agent (User Interface)
├── Receives user requests
├── Uses delegateWork to create temporary team leader
└── Returns coordinated results

Temporary Agents (Task Execution)
├── Team leader analyzes and breaks down tasks
├── Creates specialized members via delegateWork
└── All agents auto-cleanup after task completion
```

### Core Components
- **TeamContainer**: Main coordination class
- **AgentFactory**: Creates task-specific agents with appropriate prompts
- **delegateWork Tool**: Universal task delegation interface

## Basic Usage

```typescript
import { createTeam } from '@robota-sdk/team';

// Create a team with simple configuration
const team = createTeam({
  teamAgent: {
    provider: 'openai',
    model: 'gpt-4',
    systemPrompt: 'You are a team coordinator...' // Optional custom prompt
  },
  memberDefaults: {
    provider: 'openai',
    model: 'gpt-4'
  },
  maxMembers: 5,
  debug: true
});

// Execute complex tasks through team coordination
const result = await team.execute(
  'Create a comprehensive marketing strategy for our new SaaS product'
);

console.log(result);
```

## How It Works

### 1. User Request Processing
```typescript
// User makes a request
const result = await team.execute('Analyze the smartphone market and create a report');

// Team agent decides: delegate or handle directly
// For complex tasks, uses delegateWork tool
```

### 2. Dynamic Task Delegation
```typescript
// Team agent delegates analysis task
delegateWork({
  jobDescription: '프롬프트를 분석해서 업무를 분배하고 member들에게 업무를 분배하세요',
  context: 'User wants smartphone market analysis and report',
  requiredTools: ['analysis', 'delegation']
});

// Temporary team leader created, analyzes, then delegates sub-tasks:
// 1. Market research specialist
// 2. Data analyst  
// 3. Report writer
```

### 3. Automatic Coordination
```typescript
// Each agent completes their task and returns results
// Team leader synthesizes all results
// Final response returned to user
// All temporary agents automatically cleaned up
```

## Advanced Configuration

### Custom Agent Factory
```typescript
import { TeamContainer, AgentFactory } from '@robota-sdk/team';

const agentFactory = new AgentFactory({
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  temperature: 0.7
}, true); // debug mode

const team = new TeamContainer({
  teamAgent: {
    provider: 'openai',
    model: 'gpt-4'
  },
  memberDefaults: {
    provider: 'anthropic', 
    model: 'claude-3-5-sonnet-20241022'
  },
  maxMembers: 10,
  debug: true
});
```

### Team Statistics
```typescript
// Get team performance metrics
const stats = team.getStats();
console.log(`Agents created: ${stats.totalAgentsCreated}`);
console.log(`Tasks completed: ${stats.tasksCompleted}`);
console.log(`Average execution time: ${stats.totalExecutionTime / stats.tasksCompleted}ms`);

// Reset statistics
team.resetStats();
```

## Example Scenarios

### Market Research Project
```typescript
const result = await team.execute(`
  Research the smartphone market trends for 2024 and create a detailed analysis report.
  Include competitor analysis, market size, and growth projections.
`);

// Automatically creates:
// - Market researcher (web search, data collection)
// - Data analyst (statistical analysis, visualization) 
// - Technical writer (report creation, formatting)
```

### Software Development Task
```typescript
const result = await team.execute(`
  Create a Todo app with React frontend and Node.js backend.
  Include tests and deployment configuration.
`);

// Automatically creates:
// - System architect (overall design)
// - Frontend developer (React components)
// - Backend developer (API, database)
// - QA engineer (test suites)
```

## Benefits

### ✅ **Simplicity**
- Single `delegateWork` tool for all coordination
- No complex agent hierarchies or special configurations
- Standard Robota instances with different prompts

### ✅ **Flexibility** 
- Dynamic agent creation based on actual task needs
- No pre-defined roles or rigid structures
- Recursive delegation for complex task breakdown

### ✅ **Efficiency**
- Temporary agents with automatic cleanup
- Resource-efficient execution
- Task-specific tool and prompt optimization

### ✅ **Scalability**
- Configurable team size limits
- Parallel task execution capability
- Built-in performance monitoring

## Integration

Works seamlessly with other Robota SDK packages:

```typescript
import { createTeam } from '@robota-sdk/team';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import { OpenAIProvider } from '@robota-sdk/openai';

// Team with custom tools
const team = createTeam({
  teamAgent: {
    provider: 'openai',
    model: 'gpt-4'
  },
  memberDefaults: {
    provider: 'openai',
    model: 'gpt-4'
  },
  // Custom tools will be available to all team members
  sharedToolProviders: [webSearchProvider, fileSystemProvider]
});
```

## Development Status

This package provides a working implementation with mock agents for development and testing. The architecture is designed for easy integration with actual Robota instances in production environments.

Key mock components:
- `MockTaskAgent`: Simulates agent behavior with realistic responses
- `MockTeamAgent`: Demonstrates delegation patterns and coordination logic
- Development-focused logging and debugging capabilities

Production integration points are clearly marked in the codebase for seamless transition to real AI provider integration. 