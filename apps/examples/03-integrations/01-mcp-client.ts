/**
 * 01-mcp-client.ts
 * 
 * Example of integrating MCP client with Robota agent.
 * - Communicate with MCP (Model Context Protocol) server
 * - Use together with Robota agent
 */

import { Robota } from "@robota-sdk/core";
import { createMcpToolProvider } from "@robota-sdk/tools";
import { OpenAIProvider } from "@robota-sdk/openai";
import { Client } from "@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import OpenAI from "openai";
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        console.log('Starting MCP agent example...');

        // 1. Set MCP server path
        const serverPath = path.resolve(__dirname, '../../services/mcp-server.ts');
        console.log(`MCP server path: ${serverPath}`);

        // 2. Create MCP transport
        console.log('1. Creating MCP transport...');
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['ts-node', serverPath],
        });

        // 3. Create MCP client instance
        console.log('2. Creating MCP client...');
        const mcpClient = new Client({
            name: 'simple-client',
            version: '1.0',
        });

        await mcpClient.connect(transport);

        // 4. Create MCP tool provider
        console.log('3. Creating MCP tool provider...');
        // Use type assertion (as any) to resolve type errors
        const mcpProvider = createMcpToolProvider(mcpClient as any);

        // 5. Check OpenAI API key
        console.log('4. Creating OpenAI client...');
        if (!process.env.OPENAI_API_KEY) {
            console.warn('Warning: OPENAI_API_KEY environment variable is not set.');
            process.exit(1);
        }

        // 6. Create OpenAI client
        const openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || ''
        });

        // 7. Create OpenAI provider
        console.log('5. Creating OpenAI provider...');
        const openaiProvider = new OpenAIProvider({
            model: 'gpt-3.5-turbo',
            temperature: 0.7,
            client: openaiClient
        });

        // 8. Create Robota agent instance
        console.log('6. Creating Robota agent instance...');
        const agent = new Robota({
            aiClient: openaiProvider, // Use OpenAI provider
            provider: mcpProvider, // Use MCP provider
            systemPrompt: 'You are an assistant using AI models connected through MCP. Provide accurate and useful information.'
        });

        // 9. Calculation tool call example
        console.log('\n----- Calculation Tool Call Example -----');
        try {
            const response1 = await agent.run('Please add 5 and 7.');
            console.log(`User: Please add 5 and 7.`);
            console.log(`Response: ${response1}`);
        } catch (error) {
            console.error('Calculation tool call error:', error);
        }

        // 10. Weather information request conversation execution
        console.log('\n----- Weather Information Request Example -----');
        try {
            const response2 = await agent.run('Please tell me the current weather in Seoul.');
            console.log(`User: Please tell me the current weather in Seoul.`);
            console.log(`Response: ${response2}`);
        } catch (error) {
            console.error('Weather information request error:', error);
        }

        // 11. Additional weather information request (Fahrenheit unit)
        console.log('\n----- Additional Weather Information Request Example (Fahrenheit) -----');
        try {
            const response3 = await agent.run('Please tell me the weather in Jeju in Fahrenheit.');
            console.log(`User: Please tell me the weather in Jeju in Fahrenheit.`);
            console.log(`Response: ${response3}`);
        } catch (error) {
            console.error('Additional weather information request error:', error);
        }

        // 12. Close connection
        console.log('\nClosing connection...');
        try {
            // Close Robota agent
            await agent.close?.();
            console.log('Robota instance has been closed.');
        } catch (error) {
            console.error('Connection close error:', error);
        }

        console.log('\n===== MCP Client Example Completed =====');
    } catch (error) {
        console.error('Error occurred:', error);
        process.exit(1);
    }
}

// Execute program
main().catch(console.error); 