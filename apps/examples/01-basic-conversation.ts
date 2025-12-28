/**
 * 01-basic-conversation.ts
 * 
 * This example demonstrates the most basic usage of Robota:
 * - Simple conversation using OpenAI
 * - Message sending and responses
 * - Proper error handling
 * - Basic statistics and resource management
 */

import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ScenarioStore } from './lib/scenario/store';
import { createScenarioProviderFromEnv } from './lib/scenario/provider';

// Load environment variables from examples directory
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    try {
        console.log('🤖 Basic Conversation Example Started...\n');

        const store = new ScenarioStore({ baseDir: path.resolve(__dirname, 'scenarios') });
        const isPlayMode = Boolean(process.env.SCENARIO_PLAY_ID);

        const delegate =
            isPlayMode
                ? undefined
                : (() => {
                    const apiKey = process.env.OPENAI_API_KEY;
                    if (!apiKey) {
                        throw new Error('OPENAI_API_KEY environment variable is required (record/none mode)');
                    }
                    return new OpenAIProvider({ apiKey });
                })();

        const scenario = createScenarioProviderFromEnv({
            store,
            ...(delegate ? { delegate } : undefined),
            providerName: 'openai',
            providerVersion: 'scenario',
            defaultPlayStrategy: 'sequential'
        });

        // Create Robota instance with new configuration format
        const robota = new Robota({
            name: 'BasicAgent',
            aiProviders: [scenario.provider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo',
                systemMessage: 'You are a helpful AI assistant. Provide concise and useful responses.'
            }
        });

        // === Optimized Conversation for Token Efficiency ===
        console.log('📝 Simple Question:');
        const query = 'Hi, what is TypeScript?';
        console.log(`User: ${query}`);

        const response = await robota.run(query);
        console.log(`Assistant: ${response}\n`);

        if (scenario.mode === 'play') {
            await scenario.assertNoUnusedSteps();
        }

        // === Show Statistics ===
        console.log('📊 Session Statistics:');
        const stats = robota.getStats();
        console.log(`- Agent name: ${stats.name}`);
        console.log(`- Current provider: ${stats.currentProvider}`);
        console.log(`- History length: ${stats.historyLength}`);
        console.log(`- Available tools: ${stats.tools.length}`);
        console.log(`- Plugins: ${stats.plugins.length}`);
        console.log(`- Uptime: ${Math.round(stats.uptime)}ms\n`);

        console.log('✅ Basic Conversation Example Completed!');

        // Clean up resources
        await robota.destroy();

        // Ensure process exits cleanly
        console.log('🧹 Cleanup completed. Exiting...');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error occurred:', error);
        if (error instanceof Error) {
            console.error('Stack trace:', error.stack);
        }
        process.exit(1);
    }
}

// Execute
main(); 