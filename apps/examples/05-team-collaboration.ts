/**
 * 05-team-collaboration.ts
 * 
 * Simplified Multiple Provider Example
 * Demonstrates using different AI providers for different tasks
 */

import OpenAI from 'openai';
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        console.log('⚡ Multi-Provider Collaboration Example Started...\\n');

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client and provider
        const openaiClient = new OpenAI({ apiKey });
        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini'
        });

        // Create first agent - general purpose
        const generalAgent = new Robota({
            name: 'GeneralAgent',
            model: 'gpt-4o-mini',
            provider: 'openai',
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemMessage: 'You are a helpful general-purpose assistant.'
        });

        // Create second agent - specialized for analysis
        const analysisAgent = new Robota({
            name: 'AnalysisAgent',
            model: 'gpt-4o-mini',
            provider: 'openai',
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemMessage: 'You are a data analysis specialist. Focus on analytical thinking and structured responses.'
        });

        console.log('='.repeat(50));
        console.log('🎯 Example 1: Simple Task');
        console.log('='.repeat(50));

        const simpleQuestion = 'What are 3 key benefits of TypeScript?';
        console.log(`\\nUser: ${simpleQuestion}`);
        console.log('🤖 General Agent responding...');

        const startTime1 = Date.now();
        const simpleResponse = await generalAgent.run(simpleQuestion);
        const duration1 = Date.now() - startTime1;

        console.log(`\\nResponse: ${simpleResponse}`);
        console.log(`\\n✅ Completed in ${duration1}ms`);

        console.log('\\n' + '='.repeat(50));
        console.log('🎯 Example 2: Analysis Task');
        console.log('='.repeat(50));

        const analysisQuestion = 'Compare the performance characteristics of React vs Vue.js from a technical perspective.';
        console.log(`\\nUser: ${analysisQuestion}`);
        console.log('📊 Analysis Agent responding...');

        const startTime2 = Date.now();
        const analysisResponse = await analysisAgent.run(analysisQuestion);
        const duration2 = Date.now() - startTime2;

        console.log(`\\nResponse: ${analysisResponse}`);
        console.log(`\\n✅ Completed in ${duration2}ms`);

        console.log('\\n' + '='.repeat(50));
        console.log('📈 Performance Summary');
        console.log('='.repeat(50));

        console.log(`
📊 Results:
• Simple task: ${duration1}ms
• Analysis task: ${duration2}ms
• Total agents used: 2
• Provider: OpenAI (gpt-4o-mini)
        `);

        console.log('\\n✅ Multi-provider collaboration demo completed successfully!');
        console.log('This example shows how different agents can be specialized for different types of tasks.');

    } catch (error) {
        console.error('\\n❌ Demo failed:', error);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
    });
} 