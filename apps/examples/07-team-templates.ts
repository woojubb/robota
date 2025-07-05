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
        console.log('🎯 Agent Templates Example Started...\\n');

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
            aiProviders: [anthropicProvider],
            defaultModel: {
                provider: 'anthropic',
                model: 'claude-3-5-sonnet-20241022',
                systemMessage: 'You are a market research and analysis specialist. Focus on data-driven insights, market trends, competitive analysis, and strategic recommendations. Provide detailed, analytical responses.'
            }
        });

        // Creative Agent Template (OpenAI GPT-4)
        const creativeProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini',
            temperature: 0.8  // Higher temperature for creativity
        });

        const creativeAgent = new Robota({
            name: 'CreativeAgent',
            aiProviders: [creativeProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                temperature: 0.8,
                systemMessage: 'You are a creative ideation specialist. Focus on innovative solutions, user experience design, and breakthrough thinking. Generate creative, practical ideas with strong user value propositions.'
            }
        });

        // Coordinator Agent Template (OpenAI GPT-4o-mini)
        const coordinatorProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini',
            temperature: 0.4  // Lower temperature for structured coordination
        });

        const coordinatorAgent = new Robota({
            name: 'CoordinatorAgent',
            aiProviders: [coordinatorProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-4o-mini',
                temperature: 0.4,
                systemMessage: 'You are a project coordinator and synthesis specialist. Your role is to combine different perspectives into cohesive, actionable plans. Focus on integration, prioritization, and clear communication.'
            }
        });

        console.log('\\n' + '='.repeat(60));
        console.log('📊 Template-Based Healthcare Product Development');
        console.log('='.repeat(60));

        const topic = 'AI-based personalized health monitoring solution';

        // Task 1: Market Research (Anthropic Claude)
        console.log('\\n🔬 Research Agent (Anthropic Claude) - Market Analysis');
        const researchTask = `Analyze the healthcare technology market for ${topic}. Include:
        1. Current market size and growth trends
        2. Key competitors and their offerings
        3. Market opportunities and entry strategies
        4. Target customer segments
        Please provide a structured, data-focused analysis.`;

        const startTime1 = Date.now();
        const researchResult = await researchAgent.run(researchTask);
        const duration1 = Date.now() - startTime1;

        console.log('✅ Research Analysis:', researchResult.substring(0, 200) + '...');
        console.log(`⏱️  Duration: ${duration1}ms`);

        // Task 2: Creative Ideation (OpenAI GPT-4)
        console.log('\\n🎨 Creative Agent (OpenAI GPT-4) - Innovation Ideas');
        const creativeTask = `Generate innovative ideas for ${topic}. Focus on:
        1. Unique value propositions and differentiation
        2. User experience innovations
        3. Three specific product concepts with key features
        4. Implementation approaches
        Think creatively and propose breakthrough solutions.`;

        const startTime2 = Date.now();
        const creativeResult = await creativeAgent.run(creativeTask);
        const duration2 = Date.now() - startTime2;

        console.log('✅ Creative Ideas:', creativeResult.substring(0, 200) + '...');
        console.log(`⏱️  Duration: ${duration2}ms`);

        // Task 3: Synthesis and Coordination (OpenAI GPT-4o-mini)
        console.log('\\n📋 Coordinator Agent (OpenAI GPT-4o-mini) - Final Synthesis');
        const coordinationTask = `As a project coordinator, please synthesize the following research and creative inputs into a cohesive product development plan:

        MARKET RESEARCH FINDINGS:
        ${researchResult}

        CREATIVE PRODUCT IDEAS:
        ${creativeResult}

        Create a structured plan that combines both perspectives into:
        1. Executive summary
        2. Prioritized product concept
        3. Go-to-market strategy
        4. Next steps and timeline

        Focus on practical integration and clear recommendations.`;

        const startTime3 = Date.now();
        const finalResult = await coordinatorAgent.run(coordinationTask);
        const duration3 = Date.now() - startTime3;

        console.log('\\n📄 Final Product Development Plan:');
        console.log(finalResult);
        console.log(`\\n⏱️  Coordination Duration: ${duration3}ms`);

        // Performance Summary
        console.log('\\n' + '='.repeat(60));
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

        console.log('\\n✅ Agent Templates Example completed successfully!');
        console.log('🔬 Each agent used optimal AI provider for their specialization');
        console.log('🤝 Coordinated workflow produced comprehensive results');

    } catch (error) {
        console.error('\\n❌ Demo failed:', error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
});