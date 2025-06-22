/**
 * 02-tool-calling.ts
 * 
 * This example demonstrates tool calling functionality:
 * - Define tools using Zod schemas
 * - AI agent automatically calls appropriate tools
 * - Handle tool execution results
 */

import { z } from 'zod';
import { Robota, createFunctionTool } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

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
    async (params) => {
        const { operation, a, b } = params;
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

const weatherTool = createFunctionTool(
    'getWeather',
    'Gets current weather information for a city',
    {
        type: 'object',
        properties: {
            city: {
                type: 'string',
                description: 'City name to get weather for'
            },
            unit: {
                type: 'string',
                enum: ['celsius', 'fahrenheit'],
                description: 'Temperature unit'
            }
        },
        required: ['city']
    },
    async (params) => {
        const { city, unit = 'celsius' } = params;
        console.log(`🌤️ Getting weather for: ${city} (${unit})`);

        // Mock weather data
        const weatherData: Record<string, any> = {
            'seoul': { temp: 22, condition: 'Clear', humidity: 65 },
            'busan': { temp: 24, condition: 'Partly Cloudy', humidity: 70 },
            'jeju': { temp: 26, condition: 'Cloudy', humidity: 75 },
            'tokyo': { temp: 20, condition: 'Rainy', humidity: 80 },
            'new york': { temp: 18, condition: 'Sunny', humidity: 55 }
        };

        const cityKey = city.toLowerCase();
        const data = weatherData[cityKey] || { temp: 15, condition: 'Unknown', humidity: 60 };

        const temperature = unit === 'fahrenheit'
            ? Math.round(data.temp * 9 / 5 + 32)
            : data.temp;

        return {
            city,
            temperature,
            unit: unit === 'celsius' ? '°C' : '°F',
            condition: data.condition,
            humidity: `${data.humidity}%`
        };
    }
);

const timeTool = createFunctionTool(
    'getCurrentTime',
    'Gets the current date and time',
    {
        type: 'object',
        properties: {
            timezone: {
                type: 'string',
                description: 'Timezone (e.g., UTC, Asia/Seoul)'
            }
        },
        required: []
    },
    async (params) => {
        const { timezone = 'UTC' } = params;
        console.log(`🕐 Getting current time for timezone: ${timezone}`);

        const now = new Date();
        const timeString = timezone === 'UTC'
            ? now.toISOString()
            : now.toLocaleString('en-US', { timeZone: timezone });

        return {
            timezone,
            currentTime: timeString,
            timestamp: now.getTime()
        };
    }
);

async function main() {
    try {
        console.log('🛠️ Tool Calling Example Started...\n');

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client and provider
        const openaiClient = new OpenAI({ apiKey });
        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-3.5-turbo'
        });

        // Create Robota instance with tools
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            tools: [calculateTool, weatherTool, timeTool],
            systemMessage: 'You are a helpful assistant that can perform calculations, check weather, and tell time. Use the available tools when needed.',
            logging: {
                level: (process.env.ROBOTA_LOG_LEVEL as any) || 'warn',
                enabled: process.env.ROBOTA_VERBOSE === 'true'
            }
        } as any);

        // Test queries that should trigger tool calls
        const queries = [
            'Hello! What can you help me with?',
            'What is 15 multiplied by 8?',
            'What\'s the weather like in Seoul?',
            'Can you tell me the current time in UTC?',
            'Calculate 100 divided by 4, and then tell me the weather in Tokyo in Fahrenheit'
        ];

        // Process each query
        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`\n${i + 1}. User: ${query}`);

            const response = await robota.run(query);
            console.log(`   Assistant: ${response}`);

            if (i < queries.length - 1) {
                console.log('   ' + '─'.repeat(50));
            }
        }

        console.log('\n✅ Tool Calling Example Completed!');

        // Clean up resources
        await robota.destroy();
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main(); 