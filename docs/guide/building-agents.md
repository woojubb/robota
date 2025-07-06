---
title: Building Agents
description: Building AI agents with Robota
lang: en-US
---

# Building Agents

Advanced patterns and best practices for building AI agents with the Robota SDK.

## Overview

Building effective AI agents requires understanding patterns, architecture, and best practices. This guide covers advanced techniques for creating sophisticated agents that can handle complex tasks, collaborate with other agents, and adapt to different scenarios.

## Agent Architecture Patterns

### 1. Basic Agent Pattern

The simplest agent for single-purpose tasks:

```typescript
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

// Create a focused agent for a specific task
const translationAgent = new Robota({
    name: 'TranslationAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        systemMessage: `You are a professional translator specializing in accurate, 
    contextual translations between languages. Always preserve meaning and tone.`
    }
});

// Use the agent
const translation = await translationAgent.run(
    'Translate to French: "The weather is beautiful today."'
);
```

### 2. Tool-Enhanced Agent Pattern

Agents with specialized capabilities through tools:

```typescript
import { Robota, createFunctionTool } from '@robota-sdk/agents';

// Create specialized tools
const codeAnalysisTool = createFunctionTool(
    'analyzeCode',
    'Analyze code for issues and improvements',
    {
        type: 'object',
        properties: {
            code: { type: 'string', description: 'Code to analyze' },
            language: { 
                type: 'string', 
                enum: ['typescript', 'javascript', 'python', 'java'],
                description: 'Programming language'
            }
        },
        required: ['code', 'language']
    },
    async (params) => {
        const { code, language } = params;
        
        // Simulate code analysis
        return {
            issues: [
                'Missing type annotations',
                'Unused variable on line 5'
            ],
            suggestions: [
                'Add strict TypeScript configuration',
                'Use const instead of let for immutable values'
            ],
            complexity: 'Medium',
            language
        };
    }
);

// Create agent with tools
const codeReviewAgent = new Robota({
    name: 'CodeReviewAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        systemMessage: `You are a senior software engineer specializing in code reviews.
    Use the code analysis tool to identify issues and provide constructive feedback.`
    },
    tools: [codeAnalysisTool]
});
```

### 3. Multi-Provider Agent Pattern

Agents that leverage different AI providers for different tasks:

```typescript
class SmartAgent extends Robota {
    constructor(providers: AIProvider[]) {
        super({
            name: 'SmartAgent',
            aiProviders: providers,
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo',
                systemMessage: 'You are a versatile AI assistant.'
            }
        });
    }

    async run(input: string): Promise<string> {
        // Use different providers based on task type
        if (this.isCreativeTask(input)) {
            this.setModel({ provider: 'anthropic', model: 'claude-3-sonnet' });
        } else if (this.isComplexReasoning(input)) {
            this.setModel({ provider: 'openai', model: 'gpt-4' });
        } else if (this.isFactualQuery(input)) {
            this.setModel({ provider: 'google', model: 'gemini-1.5-flash' });
        }
        
        return super.run(input);
    }

    private isCreativeTask(input: string): boolean {
        return /write|story|creative|poem|song/.test(input.toLowerCase());
    }

    private isComplexReasoning(input: string): boolean {
        return /analyze|solve|explain|calculate|complex/.test(input.toLowerCase());
    }

    private isFactualQuery(input: string): boolean {
        return /what is|who is|when|where|how many/.test(input.toLowerCase());
    }
}
```

## Advanced Agent Patterns

### 1. Agent with Memory and Context

Agents that maintain conversation context and learn from interactions:

```typescript
import { ConversationHistoryPlugin, ExecutionAnalyticsPlugin } from '@robota-sdk/agents';

class MemoryAgent extends Robota {
    constructor() {
        const conversationPlugin = new ConversationHistoryPlugin({
            maxMessages: 50,
            persistToFile: true,
            filePath: './agent-memory.json'
        });

        const analyticsPlugin = new ExecutionAnalyticsPlugin({
            trackErrors: true,
            maxEntries: 1000
        });

        super({
            name: 'MemoryAgent',
            aiProviders: [openaiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4',
                systemMessage: `You are a personal assistant with excellent memory.
            Remember user preferences, past conversations, and context.
            Provide personalized responses based on conversation history.`
            },
            plugins: [conversationPlugin, analyticsPlugin]
        });
    }

    async getConversationSummary(): Promise<string> {
        const plugin = this.getPlugin('ConversationHistoryPlugin');
        if (plugin) {
            const stats = plugin.getStats();
            return `Conversation summary: ${stats.messageCount} messages exchanged.`;
        }
        return 'No conversation history available.';
    }

    async getPerformanceStats(): Promise<any> {
        const plugin = this.getPlugin('ExecutionAnalyticsPlugin');
        if (plugin && 'getAggregatedStats' in plugin) {
            return (plugin as any).getAggregatedStats();
        }
        return null;
    }
}
```

### 2. Workflow Agent Pattern

Agents that execute multi-step workflows:

```typescript
interface WorkflowStep {
    name: string;
    description: string;
    execute: (context: any) => Promise<any>;
}

class WorkflowAgent extends Robota {
    private workflows: Map<string, WorkflowStep[]> = new Map();

    constructor() {
        super({
            name: 'WorkflowAgent',
            aiProviders: [openaiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4',
                systemMessage: 'You are a workflow automation agent.'
            }
        });

        this.setupWorkflows();
    }

    private setupWorkflows() {
        // Research workflow
        this.workflows.set('research', [
            {
                name: 'search',
                description: 'Search for information',
                execute: async (context) => {
                    // Search implementation
                    return { searchResults: ['result1', 'result2'] };
                }
            },
            {
                name: 'analyze',
                description: 'Analyze search results',
                execute: async (context) => {
                    // Analysis implementation
                    return { analysis: 'Detailed analysis...' };
                }
            },
            {
                name: 'summarize',
                description: 'Create summary',
                execute: async (context) => {
                    // Summarization implementation
                    return { summary: 'Executive summary...' };
                }
            }
        ]);
    }

    async executeWorkflow(workflowName: string, initialContext: any = {}): Promise<any> {
        const workflow = this.workflows.get(workflowName);
        if (!workflow) {
            throw new Error(`Workflow ${workflowName} not found`);
        }

        let context = { ...initialContext };
        const results = [];

        for (const step of workflow) {
            console.log(`Executing step: ${step.name}`);
            
            try {
                const stepResult = await step.execute(context);
                context = { ...context, ...stepResult };
                results.push({
                    step: step.name,
                    result: stepResult,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error(`Step ${step.name} failed:`, error);
                throw error;
            }
        }

        return {
            workflow: workflowName,
            results,
            finalContext: context
        };
    }
}
```

### 3. Specialized Agent Roles

#### Research Agent

```typescript
const researchAgent = new Robota({
    name: 'ResearchAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        systemMessage: `You are a research specialist focused on thorough, accurate research.
    Always:
    - Verify information from multiple sources
    - Provide citations and references
    - Distinguish between facts and opinions
    - Flag uncertain or contradictory information`
    },
    tools: [
        webSearchTool,
        documentAnalysisTool,
        citationTool
    ]
});
```

#### Code Generation Agent

```typescript
const codeGeneratorAgent = new Robota({
    name: 'CodeGeneratorAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        systemMessage: `You are a software engineering expert specializing in code generation.
    Always:
    - Write clean, maintainable code
    - Include comprehensive error handling
    - Add appropriate comments and documentation
    - Follow language-specific best practices
    - Generate corresponding unit tests`
    },
    tools: [
        codeAnalysisTool,
        testGenerationTool,
        documentationTool
    ]
});
```

#### Data Analysis Agent

```typescript
const dataAnalysisAgent = new Robota({
    name: 'DataAnalysisAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        systemMessage: `You are a data scientist specializing in data analysis and insights.
    Always:
    - Validate data quality and completeness
    - Apply appropriate statistical methods
    - Provide clear, actionable insights
    - Create meaningful visualizations
    - Explain methodology and limitations`
    },
    tools: [
        dataProcessingTool,
        visualizationTool,
        statisticalAnalysisTool
    ]
});
```

### 4. Module-Enhanced Agent Pattern

Agents that leverage the new modular architecture system for extended functionality:

```typescript
import { 
    Robota, 
    BaseModule, 
    ModuleRegistry, 
    LoggingPlugin, 
    PerformancePlugin, 
    UsagePlugin 
} from '@robota-sdk/agents';

// Create a custom module for data processing
class DataProcessingModule extends BaseModule {
    readonly name = 'DataProcessingModule';
    readonly version = '1.0.0';
    readonly moduleType = 'processing';
    
    constructor(options: any, eventEmitter?: EventEmitter) {
        super(options, eventEmitter);
        this.capabilities = ['data-transformation', 'validation'];
    }
    
    async initialize(): Promise<void> {
        this.emitModuleEvent('initialize.start', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.generateExecutionId()
        });
        
        // Initialize data processing resources
        await this.setupDataProcessors();
        
        this.emitModuleEvent('initialize.complete', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.lastExecutionId,
            duration: Date.now() - this.startTime
        });
    }
    
    async execute(context: any): Promise<any> {
        this.emitModuleEvent('execution.start', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.generateExecutionId(),
            context
        });
        
        try {
            const result = await this.processData(context.data);
            
            this.emitModuleEvent('execution.complete', {
                moduleName: this.name,
                moduleType: this.moduleType,
                executionId: this.lastExecutionId,
                duration: Date.now() - this.startTime,
                success: true,
                result
            });
            
            return { success: true, data: result };
        } catch (error) {
            this.emitModuleEvent('execution.error', {
                moduleName: this.name,
                moduleType: this.moduleType,
                executionId: this.lastExecutionId,
                error: error.message
            });
            
            return { success: false, error: error.message };
        }
    }
    
    private async setupDataProcessors(): Promise<void> {
        // Setup data processing logic
    }
    
    private async processData(data: any): Promise<any> {
        // Data processing implementation
        return { processed: true, data };
    }
}

// Create agent with module support
class ModularAgent extends Robota {
    private moduleRegistry: ModuleRegistry;
    
    constructor() {
        // Create plugins that will monitor module activities
        const loggingPlugin = new LoggingPlugin({
            level: 'info',
            moduleEvents: ['module.initialize.complete', 'module.execution.complete']
        });
        
        const performancePlugin = new PerformancePlugin({
            moduleEvents: ['module.execution.start', 'module.execution.complete']
        });
        
        const usagePlugin = new UsagePlugin({
            moduleEvents: ['module.execution.complete']
        });
        
        super({
            name: 'ModularAgent',
            aiProviders: [openaiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4',
                systemMessage: 'You are a modular AI agent with enhanced capabilities.'
            },
            plugins: [loggingPlugin, performancePlugin, usagePlugin]
        });
        
        // Initialize module registry with shared EventEmitter
        this.moduleRegistry = new ModuleRegistry(this.eventEmitter);
        
        // Register modules
        this.setupModules();
    }
    
    private async setupModules(): Promise<void> {
        // Register data processing module
        const dataModule = new DataProcessingModule({
            enabled: true,
            config: { maxDataSize: 10000 }
        }, this.eventEmitter);
        
        await this.moduleRegistry.registerModule(dataModule);
        
        // Initialize all modules
        await this.moduleRegistry.initializeModules();
    }
    
    async processWithModules(input: string, data?: any): Promise<string> {
        // Execute modules if data is provided
        if (data) {
            const moduleResult = await this.moduleRegistry.executeModule(
                'DataProcessingModule',
                { data }
            );
            
            if (moduleResult.success) {
                input += `\n\nProcessed data: ${JSON.stringify(moduleResult.data)}`;
            }
        }
        
        return this.run(input);
    }
    
    getModuleStats(): any {
        return this.moduleRegistry.getStats();
    }
}

// Usage example
const modularAgent = new ModularAgent();

// Process input with module enhancement
const result = await modularAgent.processWithModules(
    'Analyze the processed data and provide insights',
    { rawData: [1, 2, 3, 4, 5] }
);

console.log('Agent result:', result);
console.log('Module stats:', modularAgent.getModuleStats());
```

## Agent Factory Pattern

Create agents from templates for consistency:

```typescript
import { AgentFactory } from '@robota-sdk/agents';

class CustomAgentFactory extends AgentFactory {
    constructor(providers: Record<string, BaseAIProvider>) {
        super({
            providers,
            defaultProvider: 'openai',
            templates: {
                'research-assistant': {
                    name: 'ResearchAssistant',
                    model: 'gpt-4',
                    systemMessage: 'You are a research assistant...',
                    tools: ['webSearch', 'documentAnalysis'],
                    plugins: ['conversationHistory', 'analytics']
                },
                'code-reviewer': {
                    name: 'CodeReviewer',
                    model: 'gpt-4',
                    systemMessage: 'You are a senior code reviewer...',
                    tools: ['codeAnalysis', 'testGeneration'],
                    plugins: ['logging', 'analytics']
                }
            }
        });
    }

    async createResearchAgent(customizations?: any): Promise<Robota> {
        return this.createFromTemplate('research-assistant', {
            ...customizations,
            plugins: [
                new ConversationHistoryPlugin(),
                new ExecutionAnalyticsPlugin()
            ]
        });
    }

    async createCodeReviewAgent(customizations?: any): Promise<Robota> {
        return this.createFromTemplate('code-reviewer', {
            ...customizations,
            plugins: [
                new LoggingPlugin({ level: 'debug' }),
                new ExecutionAnalyticsPlugin()
            ]
        });
    }
}
```

## Agent Collaboration Patterns

### Sequential Agent Chain

```typescript
class AgentChain {
    private agents: Robota[] = [];

    constructor(agents: Robota[]) {
        this.agents = agents;
    }

    async execute(input: string): Promise<string> {
        let currentInput = input;
        
        for (const agent of this.agents) {
            console.log(`Processing with ${agent.getStats().name}`);
            currentInput = await agent.run(currentInput);
        }
        
        return currentInput;
    }
}

// Usage
const researchChain = new AgentChain([
    researchAgent,      // Gather information
    analysisAgent,      // Analyze findings
    summaryAgent        // Create final summary
]);

const result = await researchChain.execute('Research the impact of AI on education');
```

### Team-Based Collaboration

Use the `@robota-sdk/team` package for sophisticated multi-agent workflows:

```typescript
import { createTeam } from '@robota-sdk/team';

// Create a team optimized for research tasks
const researchTeam = createTeam({
    aiProviders: {
        openai: openaiProvider,
        anthropic: anthropicProvider
    },
    maxMembers: 5,
    debug: true
});

// Team automatically coordinates complex research workflow
const result = await researchTeam.execute(
    'Research the environmental impact of electric vehicles vs gasoline cars, including lifecycle analysis, manufacturing impact, and long-term sustainability'
);

console.log('Team research result:', result);
```

### Development Team Simulation

```typescript
// Create a development-focused team
const devTeam = createTeam({
  aiProviders: {
        openai: openaiProvider,
        anthropic: anthropicProvider
    },
    maxMembers: 8,
    maxTokenLimit: 100000,
    debug: true
});

// Team handles complex development tasks intelligently
const developmentResult = await devTeam.execute(
    'Design and implement a REST API for user authentication with JWT tokens, password hashing, rate limiting, and comprehensive test coverage'
);

console.log('Development result:', developmentResult);

// Get team performance metrics
const devStats = devTeam.getStats();
console.log(`Development team created ${devStats.totalAgentsCreated} specialist agents`);
console.log(`Total development time: ${devStats.totalExecutionTime}ms`);
```

### Parallel Agent Processing

```typescript
class ParallelAgentProcessor {
    private agents: Robota[] = [];

    constructor(agents: Robota[]) {
        this.agents = agents;
    }

    async processInParallel(input: string): Promise<string[]> {
        const promises = this.agents.map(agent => agent.run(input));
        return Promise.all(promises);
    }

    async processWithConsensus(input: string): Promise<string> {
        const results = await this.processInParallel(input);
        
        // Create consensus agent to combine results
        const consensusAgent = new Robota({
            name: 'ConsensusAgent',
            aiProviders: [openaiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4',
                systemMessage: 'Combine multiple perspectives into a coherent response.'
            }
        });

        const combinedInput = `
        Multiple agents provided these responses to: "${input}"
        
        ${results.map((result, i) => `Agent ${i + 1}: ${result}`).join('\n\n')}
        
        Please provide a unified, comprehensive response that incorporates the best insights from each perspective.
        `;

        return consensusAgent.run(combinedInput);
    }
}
```

## Error Handling and Resilience

### Robust Agent with Retry Logic

```typescript
class ResilientAgent extends Robota {
    constructor(config: any) {
        super({
            ...config,
            plugins: [
                ...(config.plugins || []),
                new ErrorHandlingPlugin({
                    retryAttempts: 3,
                    retryDelay: 1000,
                    exponentialBackoff: true
                })
            ]
        });
    }

    async runWithRetry(input: string, maxRetries: number = 3): Promise<string> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.run(input);
            } catch (error) {
                lastError = error as Error;
                console.warn(`Attempt ${attempt} failed:`, error.message);
                
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }
        
        throw new Error(`Agent failed after ${maxRetries} attempts. Last error: ${lastError?.message}`);
    }
}
```

## Performance Optimization

### Agent with Caching

```typescript
class CachedAgent extends Robota {
    private cache = new Map<string, { result: string; timestamp: number }>();
    private cacheTTL = 5 * 60 * 1000; // 5 minutes

    async run(input: string): Promise<string> {
        const cacheKey = this.createCacheKey(input);
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            console.log('Cache hit');
            return cached.result;
        }
        
        const result = await super.run(input);
        
        this.cache.set(cacheKey, {
            result,
            timestamp: Date.now()
        });
        
        return result;
    }

    private createCacheKey(input: string): string {
        return Buffer.from(input).toString('base64');
    }

    clearCache(): void {
        this.cache.clear();
    }
}
```

## Best Practices

### ✅ Do

1. **Design for specific purposes**: Create focused agents for specific tasks
2. **Use appropriate models**: Match model capabilities to task complexity
3. **Implement proper error handling**: Always handle failures gracefully
4. **Monitor performance**: Use analytics plugins to track agent performance
5. **Clean up resources**: Always call `destroy()` when done with agents
6. **Use type safety**: Leverage TypeScript for better development experience
7. **Document agent behavior**: Clearly document what each agent is designed to do

### ❌ Don't

1. **Create overly complex agents**: Keep agents focused and maintainable
2. **Ignore error handling**: Don't let errors crash your application
3. **Skip resource cleanup**: Always clean up agents to prevent memory leaks
4. **Use inappropriate models**: Don't use expensive models for simple tasks
5. **Ignore security**: Validate inputs and sanitize outputs
6. **Skip testing**: Always test agent behavior thoroughly

## Testing Agents

### Unit Testing

```typescript
describe('ResearchAgent', () => {
    let agent: Robota;
    
    beforeEach(() => {
        agent = new ResearchAgent();
    });
    
    afterEach(async () => {
        await agent.destroy();
    });
    
    it('should provide research results', async () => {
        const response = await agent.run('Research renewable energy trends');
        
        expect(response).toBeDefined();
        expect(response.length).toBeGreaterThan(0);
        expect(response).toContain('renewable energy');
    });
    
    it('should handle invalid queries gracefully', async () => {
        const response = await agent.run('');
        
        expect(response).toBeDefined();
        // Should provide helpful error message
    });
});
```

### Integration Testing

```typescript
describe('Agent Integration', () => {
    it('should work with real providers', async () => {
        const agent = new Robota({
            name: 'TestAgent',
            aiProviders: [realOpenAIProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo'
            }
        });
        
        const response = await agent.run('Hello');
        expect(typeof response).toBe('string');
        
        await agent.destroy();
    });
});
```

## Future: Advanced Planning Systems

The Robota SDK roadmap includes sophisticated autonomous planning capabilities:

```typescript
// Future roadmap - Advanced Planning System
import { createPlanner } from '@robota-sdk/planning';
import { ReActPlanner, CAMELPlanner, ReflectionPlanner } from '@robota-sdk/planner-strategies';

// This is planned for future releases
const autonomousPlanner = createPlanner({
    baseAgentConfig: {
        aiProviders: [openaiProvider, anthropicProvider],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4'
        }
    },
    maxAgents: 10,
    maxConcurrentPlanners: 3
});

// Register different planning strategies
autonomousPlanner.registerPlanner(new ReActPlanner({
    maxIterations: 10,
    toolTimeout: 5000
}));

autonomousPlanner.registerPlanner(new CAMELPlanner({
    maxAgents: 5,
    collaborationMode: 'debate'
}));

autonomousPlanner.registerPlanner(new ReflectionPlanner({
    maxReflectionCycles: 3,
    qualityThreshold: 0.8
}));

// Execute complex autonomous workflows
const plannerResult = await autonomousPlanner.execute(
    'Design and implement a complete microservices architecture for an e-commerce platform',
    ['camel', 'react', 'reflection'],
    'sequential'
);
```

### Planned Agent Capabilities

- **ReAct Planning**: Iterative Reason → Act → Observe cycles
- **CAMEL Communication**: Multi-agent role-based collaboration  
- **Reflection Loops**: Self-evaluation and improvement cycles
- **Hierarchical Planning**: Complex task decomposition
- **Autonomous Execution**: Long-running goal-oriented workflows

## Next Steps

- **[Team Collaboration](../examples/team-collaboration.md)** - Multi-agent workflows
- **[Performance Monitoring](../examples/execution-analytics.md)** - Agent analytics
- **[Examples](../examples/README.md)** - Complete working examples 