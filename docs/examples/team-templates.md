# Agent Templates

This example demonstrates using different AI providers and models for specialized tasks, creating template-like agent configurations for optimal performance.

## Overview

The agent templates example shows how to:
- Configure specialized agents with different AI providers
- Use provider-specific strengths for optimal task performance
- Create multi-provider collaboration workflows
- Template-based agent configurations for reusability

## Code Example

```typescript
/**
 * 07-team-templates.ts
 * 
 * Simplified Agent Templates Example
 * Demonstrates using different AI providers and models for specialized tasks
 */

import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        console.log('🎯 Agent Templates Example Started...\n');

        console.log(`
📋 This demo shows:
• Different AI providers for specialized tasks
• Template-like agent configurations
• Multi-provider collaboration approach

🤖 Agent Templates:
• Research Agent (Anthropic Claude) - Market analysis specialist
• Creative Agent (OpenAI GPT-4) - Innovation and ideation specialist
• Coordinator Agent (OpenAI GPT-4o-mini) - Results synthesis
        `);

        // Validate API keys
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        if (!anthropicApiKey) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required');
        }

        // Create providers
        const openaiClient = new OpenAI({ apiKey: openaiApiKey });
        const anthropicClient = new Anthropic({ apiKey: anthropicApiKey });

        // Research Agent Template (Anthropic Claude)
        const anthropicProvider = new AnthropicProvider({
            client: anthropicClient,
            model: 'claude-3-5-sonnet-20241022'
        });

        const researchAgent = new Robota({
            name: 'ResearchAgent',
            model: 'claude-3-5-sonnet-20241022',
            provider: 'anthropic',
            aiProviders: {
                'anthropic': anthropicProvider
            },
            currentProvider: 'anthropic',
            currentModel: 'claude-3-5-sonnet-20241022',
            systemMessage: 'You are a market research and analysis specialist. Focus on data-driven insights, market trends, competitive analysis, and strategic recommendations.'
        });

        // Creative Agent Template (OpenAI GPT-4)
        const creativeProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini',
            temperature: 0.8  // Higher temperature for creativity
        });

        const creativeAgent = new Robota({
            name: 'CreativeAgent',
            model: 'gpt-4o-mini',
            provider: 'openai',
            aiProviders: {
                'openai': creativeProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemMessage: 'You are a creative ideation specialist. Focus on innovative solutions, user experience design, and breakthrough thinking.'
        });

        // Coordinator Agent Template (OpenAI GPT-4o-mini)
        const coordinatorProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini',
            temperature: 0.4  // Lower temperature for structured coordination
        });

        const coordinatorAgent = new Robota({
            name: 'CoordinatorAgent',
            model: 'gpt-4o-mini',
            provider: 'openai',
            aiProviders: {
                'openai': coordinatorProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemMessage: 'You are a project coordinator and synthesis specialist. Focus on integration, prioritization, and clear communication.'
        });

        console.log('\n' + '='.repeat(60));
        console.log('📊 Template-Based Healthcare Product Development');
        console.log('='.repeat(60));

        const topic = 'AI-based personalized health monitoring solution';

        // Task 1: Market Research (Anthropic Claude)
        console.log('\n🔬 Research Agent (Anthropic Claude) - Market Analysis');
        const researchTask = `Analyze the healthcare technology market for ${topic}. Include:
        1. Current market size and growth trends
        2. Key competitors and their offerings
        3. Market opportunities and entry strategies
        4. Target customer segments`;

        const startTime1 = Date.now();
        const researchResult = await researchAgent.run(researchTask);
        const duration1 = Date.now() - startTime1;

        console.log('✅ Research Analysis:', researchResult.substring(0, 200) + '...');
        console.log(`⏱️  Duration: ${duration1}ms`);

        // Task 2: Creative Ideation (OpenAI GPT-4)
        console.log('\n🎨 Creative Agent (OpenAI GPT-4) - Innovation Ideas');
        const creativeTask = `Generate innovative ideas for ${topic}. Focus on:
        1. Unique value propositions and differentiation
        2. User experience innovations
        3. Three specific product concepts with key features
        4. Implementation approaches`;

        const startTime2 = Date.now();
        const creativeResult = await creativeAgent.run(creativeTask);
        const duration2 = Date.now() - startTime2;

        console.log('✅ Creative Ideas:', creativeResult.substring(0, 200) + '...');
        console.log(`⏱️  Duration: ${duration2}ms`);

        // Task 3: Synthesis and Coordination (OpenAI GPT-4o-mini)
        console.log('\n📋 Coordinator Agent (OpenAI GPT-4o-mini) - Final Synthesis');
        const coordinationTask = `Synthesize the research and creative inputs into a cohesive product development plan:

        MARKET RESEARCH FINDINGS: ${researchResult}
        CREATIVE PRODUCT IDEAS: ${creativeResult}

        Create a structured plan with:
        1. Executive summary
        2. Prioritized product concept
        3. Go-to-market strategy
        4. Next steps and timeline`;

        const startTime3 = Date.now();
        const finalResult = await coordinatorAgent.run(coordinationTask);
        const duration3 = Date.now() - startTime3;

        console.log('\n📄 Final Product Development Plan:');
        console.log(finalResult);
        console.log(`\n⏱️  Coordination Duration: ${duration3}ms`);

        // Performance Summary
        console.log('\n' + '='.repeat(60));
        console.log('📈 Template Performance Summary');
        console.log('='.repeat(60));

        console.log(`
🤖 Agent Performance:
• Research Agent (Anthropic): ${duration1}ms
• Creative Agent (OpenAI): ${duration2}ms
• Coordinator Agent (OpenAI): ${duration3}ms
• Total execution time: ${duration1 + duration2 + duration3}ms

🎯 Template Benefits:
• Specialized AI providers for optimal performance
• Task-specific system prompts and configurations
• Multi-provider collaboration approach
• Structured workflow with clear handoffs
        `);

        console.log('\n✅ Agent Templates Example completed successfully!');

    } catch (error) {
        console.error('\n❌ Demo failed:', error);
        process.exit(1);
    }
}

// Execute
main();
```

## Expected Output

```
🎯 Agent Templates Example Started...

📋 This demo shows:
• Different AI providers for specialized tasks
• Template-like agent configurations
• Multi-provider collaboration approach

🤖 Agent Templates:
• Research Agent (Anthropic Claude) - Market analysis specialist
• Creative Agent (OpenAI GPT-4) - Innovation and ideation specialist
• Coordinator Agent (OpenAI GPT-4o-mini) - Results synthesis

============================================================
📊 Template-Based Healthcare Product Development
============================================================

🔬 Research Agent (Anthropic Claude) - Market Analysis
✅ Research Analysis: The healthcare technology market for AI-based personalized health monitoring solutions is experiencing robust growth...
⏱️  Duration: 3420ms

🎨 Creative Agent (OpenAI GPT-4) - Innovation Ideas
✅ Creative Ideas: Here are innovative ideas for an AI-based personalized health monitoring solution that could differentiate in the market...
⏱️  Duration: 2891ms

📋 Coordinator Agent (OpenAI GPT-4o-mini) - Final Synthesis
📄 Final Product Development Plan:
# Executive Summary
Based on comprehensive market research and creative ideation, we recommend developing...

⏱️  Coordination Duration: 4156ms

============================================================
📈 Template Performance Summary
============================================================

🤖 Agent Performance:
• Research Agent (Anthropic): 3420ms
• Creative Agent (OpenAI): 2891ms
• Coordinator Agent (OpenAI): 4156ms
• Total execution time: 10467ms

🎯 Template Benefits:
• Specialized AI providers for optimal performance
• Task-specific system prompts and configurations
• Multi-provider collaboration approach
• Structured workflow with clear handoffs

✅ Agent Templates Example completed successfully!
```

## Key Features

### 1. **Specialized Agent Templates**

Each agent is optimized for specific tasks:

```typescript
// Research Agent (Anthropic Claude) - Analytical strength
const researchAgent = new Robota({
    model: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    systemMessage: 'You are a market research and analysis specialist. Focus on data-driven insights...'
});

// Creative Agent (OpenAI GPT-4) - Creative thinking
const creativeAgent = new Robota({
    model: 'gpt-4o-mini',
    provider: 'openai',
    systemMessage: 'You are a creative ideation specialist. Focus on innovative solutions...'
});
```

### 2. **Provider-Specific Optimization**

Different providers excel at different tasks:
- **Anthropic Claude**: Market research, analytical thinking, structured analysis
- **OpenAI GPT-4**: Creative ideation, innovation, user experience design
- **OpenAI GPT-4o-mini**: Coordination, synthesis, structured planning

### 3. **Temperature Configuration**

Adjust creativity levels for different tasks:

```typescript
// High creativity for ideation
const creativeProvider = new OpenAIProvider({
    model: 'gpt-4o-mini',
    temperature: 0.8  // Higher temperature for creativity
});

// Lower temperature for structured coordination
const coordinatorProvider = new OpenAIProvider({
    model: 'gpt-4o-mini',
    temperature: 0.4  // Lower temperature for coordination
});
```

### 4. **Multi-Stage Workflow**

Structured handoff between specialized agents:

1. **Research Phase**: Market analysis and data gathering
2. **Creative Phase**: Innovation and concept development  
3. **Coordination Phase**: Synthesis and actionable planning

### 5. **Performance Tracking**

Monitor execution time and efficiency:

```typescript
const startTime = Date.now();
const result = await agent.run(task);
const duration = Date.now() - startTime;
console.log(`Duration: ${duration}ms`);
```

## Template Patterns

### Research Template (Analytical)
- **Provider**: Anthropic Claude
- **Strengths**: Data analysis, market research, competitive intelligence
- **System Message**: Focus on data-driven insights and strategic recommendations

### Creative Template (Innovation)
- **Provider**: OpenAI GPT-4
- **Strengths**: Creative thinking, user experience, breakthrough concepts
- **System Message**: Focus on innovative solutions and user value propositions

### Coordinator Template (Synthesis)
- **Provider**: OpenAI GPT-4o-mini
- **Strengths**: Integration, prioritization, structured planning
- **System Message**: Focus on combining perspectives into actionable plans

## Best Practices

1. **Provider Selection**: Match AI provider strengths to task requirements
2. **System Messages**: Use specific, task-focused system messages
3. **Temperature Tuning**: Adjust temperature based on creativity vs. structure needs
4. **Workflow Design**: Create clear handoffs between template stages
5. **Performance Monitoring**: Track execution time for optimization
6. **Template Reusability**: Design templates for multiple use cases

## Use Cases

- **Product Development**: Research → Innovation → Planning
- **Market Analysis**: Data gathering → Creative positioning → Strategic recommendations
- **Content Creation**: Research → Creative writing → Editorial review
- **Problem Solving**: Analysis → Ideation → Implementation planning

This template-based approach ensures optimal performance by leveraging each AI provider's strengths for specific task types. 