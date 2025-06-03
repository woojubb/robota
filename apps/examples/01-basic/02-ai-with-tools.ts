/**
 * 02-ai-with-tools.ts
 * 
 * This example demonstrates how to use AI with tools in Robota:
 * - Using OpenAI client as aiClient
 * - Simple tool definition and registration
 * - AI automatically calling necessary tools
 * - AI handling complex calculations step by step
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import type { Logger } from '@robota-sdk/core';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';
import dotenv from 'dotenv';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

async function main() {
    try {
        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client
        const openaiClient = new OpenAI({
            apiKey
        });

        // Create OpenAI Provider
        const openaiProvider = new OpenAIProvider(openaiClient);

        // Define simple calculator tool
        const calculatorTool = {
            name: 'calculate',
            description: 'Performs mathematical calculations',
            parameters: z.object({
                operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('Operation to perform'),
                a: z.number().describe('First number'),
                b: z.number().describe('Second number')
            }),
            handler: async (params) => {
                const { operation, a, b } = params;
                console.log(`[Tool Handler] Performing calculation: ${a} ${operation} ${b}`);
                let result;
                switch (operation) {
                    case 'add': result = { result: a + b }; break;
                    case 'subtract': result = { result: a - b }; break;
                    case 'multiply': result = { result: a * b }; break;
                    case 'divide': result = b !== 0 ? { result: a / b } : { error: 'Cannot divide by zero' }; break;
                    default: result = { error: 'Unsupported operation' };
                }
                console.log(`[Tool Handler] Calculation result:`, result);
                return result;
            }
        };

        // Create tool provider
        const toolProvider = createZodFunctionToolProvider({
            tools: {
                calculate: calculatorTool
            }
        });

        // Debug tool provider
        console.log('Tool Provider:', toolProvider);
        console.log('Tool Provider functions:', toolProvider.functions);
        console.log('Functions count:', toolProvider.functions?.length || 0);

        // Define custom logger
        const customLogger: Logger = {
            info: (message: string, ...args: any[]) => console.log(chalk.blue('ℹ️'), message, ...args),
            debug: (message: string, ...args: any[]) => console.log(chalk.gray('🐛'), message, ...args),
            warn: (message: string, ...args: any[]) => console.warn(chalk.yellow('⚠️'), message, ...args),
            error: (message: string, ...args: any[]) => console.error(chalk.red('❌'), message, ...args)
        };

        // Robota instance using AI and tools together (with custom logger)
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            toolProviders: [toolProvider],
            systemPrompt: 'You are a helpful AI assistant. When mathematical calculations are needed, you must use the calculate tool. Do not calculate directly.',
            debug: true,  // Enable tool call logging
            logger: customLogger  // Use custom logger
        });

        // Debug Robota instance
        console.log('Robota toolProviders count:', robota['toolProviders']?.length || 0);

        // Check available tools
        console.log('===== Available Tools =====');
        const availableTools = robota.getAvailableTools();
        console.log('Registered tools:', availableTools.map(tool => tool.name));
        console.log('Tool schemas:', JSON.stringify(availableTools, null, 2));

        // Simple conversation without tools
        console.log('\n===== General Conversation Example =====');
        try {
            const response1 = await robota.run('Hello! How is the weather today?');
            console.log('Response:', response1);
        } catch (error) {
            console.error('General conversation error:', error);
        }

        // Conversation using tools
        console.log('\n===== Tool Usage Example =====');
        try {
            console.log('Starting tool usage request...');
            const response2 = await robota.run('Please use the calculation tool to multiply 5 and 7.');
            console.log('Response:', response2);
        } catch (error) {
            console.error('Tool usage error:', error);
        }

        console.log('\n===== Complex Calculation Example =====');
        try {
            const response3 = await robota.run('Please divide 100 by 25, then add 3 to the result.');
            console.log('Response:', response3);
        } catch (error) {
            console.error('Complex calculation error:', error);
        }

        // Test with default console logger and debug mode disabled
        console.log('\n===== Default Logger & Debug Disabled Test =====');
        const robotaDefault = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            toolProviders: [toolProvider],
            debug: false  // Disable debug mode (default)
        });

        try {
            const response4 = await robotaDefault.run('Please divide 10 by 2.');
            console.log('Response (no logging):', response4);
        } catch (error) {
            console.error('Default logger test error:', error);
        }

    } catch (error) {
        console.error('Error occurred:', error);
    }
}

// Execute
main().catch(console.error); 