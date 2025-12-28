/**
 * 02-tool-calling.ts
 * 
 * This example demonstrates tool calling functionality:
 * - Define tools using JSON schemas
 * - AI agent automatically calls appropriate tools
 * - Handle tool execution results
 * - Show tool usage statistics
 */

import { Robota, createFunctionTool } from '@robota-sdk/agents';
import type { TToolParameters } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { ScenarioStore, createScenarioProviderFromEnv, createScenarioToolWrapper } from '@robota-sdk/workflow/scenario';

// Load environment variables from examples directory
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define tool functions using createFunctionTool with manual JSON schema
const calculateTool = createFunctionTool(
    'calculate',
    'Performs basic mathematical calculations (add, subtract, multiply, divide)',
    {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['add', 'subtract', 'multiply', 'divide'],
                description: 'Mathematical operation to perform'
            },
            a: {
                type: 'number',
                description: 'First number'
            },
            b: {
                type: 'number',
                description: 'Second number'
            }
        },
        required: ['operation', 'a', 'b']
    },
    async (params: TToolParameters) => {
        const operation = params.operation as string;
        const a = Number(params.a);
        const b = Number(params.b);

        // Validate parameters
        if (isNaN(a) || isNaN(b)) {
            throw new Error('Parameters a and b must be valid numbers');
        }

        console.log(`🧮 Calculating: ${a} ${operation} ${b}`);

        let result: number;
        switch (operation) {
            case 'add':
                result = a + b;
                break;
            case 'subtract':
                result = a - b;
                break;
            case 'multiply':
                result = a * b;
                break;
            case 'divide':
                if (b === 0) throw new Error('Division by zero is not allowed');
                result = a / b;
                break;
            default:
                throw new Error(`Unknown operation: ${operation}`);
        }

        return { result, operation: `${a} ${operation} ${b} = ${result}` };
    }
);

const _weatherTool = {
    name: 'get_weather',
    description: 'Get current weather information for a city',
    parameters: {
        type: 'object',
        properties: {
            city: {
                type: 'string',
                description: 'The city name'
            },
            unit: {
                type: 'string',
                enum: ['celsius', 'fahrenheit'],
                description: 'Temperature unit'
            }
        },
        required: ['city']
    }
};

const _timeTool = {
    name: 'get_current_time',
    description: 'Get the current time',
    parameters: {
        type: 'object',
        properties: {
            timezone: {
                type: 'string',
                description: 'Timezone (optional)'
            }
        }
    }
};

async function main() {
    try {
        console.log('🛠️ Tool Calling Example Started...\n');

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

        const scenarioCalculateTool = createScenarioToolWrapper(calculateTool, {
            mode: scenario.mode,
            scenarioId: scenario.mode === 'none' ? undefined : scenario.scenarioId,
            store,
            ...(scenario.mode === 'play' ? { onToolCallUsed: scenario.onToolCallUsed } : undefined)
        });

        // Create Robota instance with tools using new API
        const robota = new Robota({
            name: 'ToolAgent',
            aiProviders: [scenario.provider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo',
                systemMessage: 'You are a helpful assistant that can perform calculations. When using tools, use the results to provide a complete answer.'
            },
            tools: [scenarioCalculateTool],
            logging: {
                level: 'info', // 자세한 로그를 통해 중복 실행 원인 파악
                enabled: true
            }
        });

        // Test queries optimized for minimal token usage
        const queries = [
            'Hi', // Minimal greeting to test basic functionality
            'What is 5 plus 3?' // Single tool demonstration with clear instruction
        ];

        console.log(`📝 Executing ${queries.length} minimal queries for efficiency`);

        // Process each query with error handling
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`\n${i + 1}. User: ${query}`);

            try {
                const response = await robota.run(query);
                console.log(`   Assistant: ${response}`);
            } catch (error) {
                console.error(`   Error: ${error}`);
                break; // Stop on error to prevent infinite loops
            }

            if (i < queries.length - 1) {
                console.log('   ' + '─'.repeat(50));
            }
        }

        // === Show Final Statistics ===
        console.log('\n📊 Final Statistics:');
        const stats = robota.getStats();
        console.log(`- Agent name: ${stats.name}`);
        console.log(`- Tools registered: ${stats.tools.join(', ')}`);
        console.log(`- History length: ${stats.historyLength}`);
        console.log(`- Current provider: ${stats.currentProvider}`);
        console.log(`- Uptime: ${Math.round(stats.uptime)}ms`);

        // Debug: Show conversation history
        console.log('\n🔍 Final Conversation History:');
        const history = robota.getHistory();
        history.forEach((msg, index) => {
            const content = msg.content?.substring(0, 100) || '';
            const toolCalls = 'toolCalls' in msg ? (msg as any).toolCalls?.length || 0 : 0;
            const toolCallId = 'toolCallId' in msg ? (msg as any).toolCallId : '';
            console.log(`${index + 1}. ${msg.role}: ${content}${toolCalls > 0 ? ` [${toolCalls} tool calls]` : ''}${toolCallId ? ` [toolCallId: ${toolCallId}]` : ''}`);
        });

        if (scenario.mode === 'play') {
            await scenario.assertNoUnusedSteps();
        }

        console.log('\n✅ Tool Calling Example Completed!');

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