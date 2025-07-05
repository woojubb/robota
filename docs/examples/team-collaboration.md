# Multi-Agent Team Collaboration

The Robota team collaboration system enables intelligent multi-agent workflows where a dedicated task coordinator automatically analyzes requests and delegates specialized tasks to expert agents. This template-based approach allows solving complex, multi-faceted problems through coordinated teamwork with automatic expert selection.

## Overview

Team collaboration works through an intelligent **Task Coordinator** template that:
1. Analyzes incoming requests for complexity and required expertise
2. Automatically selects appropriate expert templates based on natural language requests
3. Creates temporary expert agents using predefined specialized templates
4. Coordinates multiple agents for complex workflows
5. Synthesizes results into comprehensive responses

The system includes 6 built-in expert templates:
- **Task Coordinator**: Team coordination and work distribution
- **Domain Researcher**: Research, analysis, and market studies
- **Creative Ideator**: Innovation, brainstorming, and creative solutions
- **Summarizer**: Document summarization and key point extraction
- **Ethical Reviewer**: Ethics review and compliance evaluation
- **Fast Executor**: Quick and accurate task execution

## Quick Start

### Basic Team Setup (Simplified API)

```typescript
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// Create providers
const openaiProvider = new OpenAIProvider({
  client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  model: 'gpt-4o-mini',
  enablePayloadLogging: true,
  payloadLogDir: './logs/team-collaboration',
  includeTimestampInLogFiles: true
});

const anthropicProvider = new AnthropicProvider({
  client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
  model: 'claude-3-5-sonnet-20241022',
  enablePayloadLogging: true,
  payloadLogDir: './logs/team-collaboration',
  includeTimestampInLogFiles: true
});

// Create team using simplified template-based API
const team = createTeam({
  aiProviders: [openaiProvider, anthropicProvider],
  maxMembers: 5,
  maxTokenLimit: 50000,
  logger: console,
  debug: false
});

// Simple request - handled directly by task coordinator
const response = await team.execute(
  'What are the main differences between React and Vue.js? Please provide 3 key points briefly.'
);

// Complex request - automatically delegates to specialists
const businessPlan = await team.execute(
  'Create a cafe business plan. It must include both: 1) Market analysis, 2) Menu composition. Please write each section separately.'
);
```

### Two-Example Approach for Testing

For comprehensive testing of simple vs complex task handling:

```typescript
// Example 1: Simple Task (Direct Handling by Task Coordinator)
const openaiClient1 = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiProvider1 = new OpenAIProvider({
  client: openaiClient1,
  model: 'gpt-4o-mini',
  enablePayloadLogging: true,
  payloadLogDir: './logs/team-collaboration/example1',
  includeTimestampInLogFiles: true
});

const anthropicClient1 = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const anthropicProvider1 = new AnthropicProvider({
  client: anthropicClient1,
  model: 'claude-3-5-sonnet-20241022',
  enablePayloadLogging: true,
  payloadLogDir: './logs/team-collaboration/example1',
  includeTimestampInLogFiles: true
});

const team1 = createTeam({
  aiProviders: [openaiProvider1, anthropicProvider1],
  maxMembers: 5,
  maxTokenLimit: 50000,
  logger: console,
  debug: false
});

const simpleResult = await team1.execute(
  'What are the main differences between React and Vue.js? Please provide 3 key points briefly.'
);

// Example 2: Complex Task (Team Coordination with Template Selection)
const openaiClient2 = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const openaiProvider2 = new OpenAIProvider({
  client: openaiClient2,
  model: 'gpt-4o-mini',
  enablePayloadLogging: true,
  payloadLogDir: './logs/team-collaboration/example2',
  includeTimestampInLogFiles: true
});

const anthropicClient2 = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const anthropicProvider2 = new AnthropicProvider({
  client: anthropicClient2,
  model: 'claude-3-5-sonnet-20241022',
  enablePayloadLogging: true,
  payloadLogDir: './logs/team-collaboration/example2',
  includeTimestampInLogFiles: true
});

const team2 = createTeam({
  aiProviders: [openaiProvider2, anthropicProvider2],
  maxMembers: 5,
  maxTokenLimit: 50000,
  logger: console,
  debug: false
});

const complexResult = await team2.execute(
  'Create a cafe business plan. It must include both: 1) Market analysis, 2) Menu composition. Please write each section separately.'
);

// Performance analytics
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

### Advanced Configuration with Custom Templates

```typescript
import { AgentTemplateManager } from '@robota-sdk/core';

// Create custom template manager
const templateManager = new AgentTemplateManager();
templateManager.addTemplate({
  name: "data_scientist",
  description: "Expert in data analysis, machine learning, and statistical modeling. Use for: analyzing datasets, building ML models, statistical analysis, data visualization, predictive analytics, A/B testing, data preprocessing, feature engineering.",
  llm_provider: "anthropic",
  model: "claude-3-5-sonnet-20241022",
  temperature: 0.3,
  system_prompt: "You are a senior data scientist...",
  tags: ["data", "analytics", "ml"],
  version: "1.0.0",
  createdAt: new Date()
});

const team = createTeam({
  aiProviders: [openaiProvider, anthropicProvider],
  templateManager: templateManager,  // Custom template manager
  leaderTemplate: "task_coordinator", // Specify leader template
  maxMembers: 10,
  debug: true
});
```

## How Template-Based Delegation Works

### 1. Request Analysis by Task Coordinator
The task coordinator template automatically analyzes each request to determine:
- **Complexity**: Single-component vs multi-component tasks
- **Expertise Required**: Which specialist templates would be most effective
- **Scope**: Can this be handled directly or needs specialized delegation?

### 2. Intelligent Template Selection
The coordinator follows these principles:
- **Simple tasks**: Handle directly for efficiency
- **Research tasks**: Automatically select `domain_researcher` template
- **Creative tasks**: Automatically select `creative_ideator` template
- **Multi-part requests**: Break down and delegate each component to appropriate templates
- **Context preservation**: Ensure each delegated task is self-contained with proper context

### 3. Dynamic Agent Creation from Templates
For delegated tasks, the system:
- Selects the most appropriate expert template
- Creates temporary expert agents using template configurations
- Uses template-specific AI providers, models, and temperature settings
- Executes the specialized task with optimized parameters
- Automatically cleans up resources

## Template System Examples

### Multi-Template Healthcare Product Development

```typescript
// This example demonstrates automatic template selection
const collaborationTask = `
새로운 헬스케어 기술 제품을 개발하고 싶습니다. 다음 두 가지 작업을 각각 전문가에게 분배해주세요:

1. 시장 분석 및 경쟁사 조사
   - 헬스케어 기술 시장 현황 분석
   - 주요 경쟁업체 및 트렌드 조사
   - 시장 기회 및 진입 전략 제안

2. 혁신적인 제품 아이디어 발굴
   - 차별화된 헬스케어 기술 솔루션 아이디어
   - 사용자 경험 중심의 혁신 요소
   - 실현 가능한 3가지 제품 컨셉 제안

주제: AI 기반 개인 맞춤형 건강관리 솔루션
`;

const result = await team.execute(collaborationTask);

// The task coordinator will automatically:
// 1. Select domain_researcher template for market analysis (Anthropic Claude, temp: 0.4)
// 2. Select creative_ideator template for product ideation (OpenAI GPT-4, temp: 0.8)
// 3. Synthesize both results into a comprehensive response
```

## Workflow Analysis and Monitoring

### Workflow Visualization

```typescript
import { generateWorkflowFlowchart, generateAgentRelationshipDiagram } from '@robota-sdk/team';

// Get workflow history
const workflowHistory = team.getWorkflowHistory();

if (workflowHistory) {
    // Generate agent relationship diagram
    console.log('🔗 Agent relationship diagram:');
    console.log(generateAgentRelationshipDiagram(workflowHistory));

    // Generate workflow flowchart
    console.log('📊 Workflow flowchart:');
    console.log(generateWorkflowFlowchart(workflowHistory));
}
```

### Performance Analytics

```typescript
const stats = team.getStats();

console.log(`
📈 Team Performance:
• Tasks completed: ${stats.tasksCompleted}
• Total agents created: ${stats.totalAgentsCreated}
• Execution time: ${stats.totalExecutionTime}ms
• Average agents per task: ${(stats.totalAgentsCreated / stats.tasksCompleted).toFixed(1)}
`);
```

## Built-in Expert Templates

### Template Specifications

- **task_coordinator**: Team coordination and work distribution (OpenAI gpt-4o-mini, temp: 0.4)
- **domain_researcher**: Research, analysis, and market studies (Anthropic claude-3-5-sonnet-20241022, temp: 0.4)
- **creative_ideator**: Innovation, brainstorming, and creative solutions (OpenAI gpt-4o-mini, temp: 0.8)
- **summarizer**: Document summarization and key point extraction (OpenAI gpt-4o-mini, temp: 0.3)
- **ethical_reviewer**: Ethics review and compliance evaluation (Anthropic claude-3-5-sonnet-20241022, temp: 0.2)
- **fast_executor**: Quick and accurate task execution (OpenAI gpt-4o-mini, temp: 0.1)

### Template Manager Access

```typescript
// Access template manager
const templateManager = team.getTemplateManager();

// View available templates
const templates = templateManager.listTemplates();
console.log('Available templates:', templates.map(t => t.name));

// Add custom template
templateManager.addTemplate({
  name: "financial_analyst",
  description: "Expert in financial analysis, budgeting, and investment strategies...",
  llm_provider: "anthropic",
  model: "claude-3-5-sonnet-20241022",
  temperature: 0.3,
  system_prompt: "You are a senior financial analyst...",
  tags: ["finance", "analysis", "strategy"],
  version: "1.0.0",
  createdAt: new Date()
});
```

## Key Advantages of Template-Based Teams

### 1. **Automatic Expert Selection**
- No need to manually specify templates
- AI analyzes requests and selects optimal specialists
- Natural language requests automatically mapped to appropriate expertise

### 2. **Simplified Configuration**
- Only need to provide AI providers
- Templates handle all AI model, temperature, and system prompt configuration
- Reduces complexity while maintaining full customization capability

### 3. **Optimized Performance**
- Each template uses optimal AI provider and settings for its specialty
- Research tasks use Claude for deep analysis
- Creative tasks use GPT-4 with high temperature for innovation
- Coordination uses GPT-4o-mini with balanced settings for efficiency

### 4. **Consistent Quality**
- Predefined expert templates ensure consistent specialist behavior
- Specialized system prompts for each domain
- Optimized parameters for each type of task

### 5. **Resource Efficiency**
- Simple tasks handled directly by task coordinator
- Complex tasks delegated only when beneficial
- Automatic resource cleanup after task completion

## Common Patterns

### Business Planning
```typescript
const businessPlan = await team.execute(`
Create a comprehensive business plan for a new sustainable energy startup.
Include market analysis, competitive landscape, and financial projections.
`);
// Automatically delegates to domain_researcher and potentially fast_executor
```

### Creative Projects
```typescript
const creativeProject = await team.execute(`
Develop innovative marketing campaign ideas for a eco-friendly product line.
Need creative concepts, slogans, and engagement strategies.
`);
// Automatically delegates to creative_ideator template
```

### Research Tasks
```typescript
const researchReport = await team.execute(`
Research the current state of quantum computing technology.
Analyze market trends, key players, and future opportunities.
`);
// Automatically delegates to domain_researcher template
```

The template-based team system provides intelligent, automatic expert collaboration while maintaining simplicity in configuration and usage. Users simply express their needs in natural language, and the system handles all the complexity of selecting appropriate specialists and coordinating their efforts. 