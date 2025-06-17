/**
 * 04-simple-tool-calling.ts
 * 
 * Simple tool calling test to debug the issues and verify conversation history
 */

import { z } from "zod";
import { Robota, OpenAIProvider } from "@robota-sdk/core";
import { createZodFunctionToolProvider } from "@robota-sdk/tools";
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Define a simple tool that returns weather information
const tools = {
    getWeather: {
        name: "getWeather",
        description: "Gets weather for a city",
        parameters: z.object({
            city: z.string().describe("City name")
        }),
        handler: async (params) => {
            console.log(`🌤️ Getting weather for ${params.city}`);
            return {
                city: params.city,
                temperature: 22,
                condition: 'Sunny'
            };
        }
    }
};

async function main() {
    try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('OPENAI_API_KEY required');

        const openaiClient = new OpenAI({ apiKey });
        const openaiProvider = new OpenAIProvider(openaiClient);
        const toolProvider = createZodFunctionToolProvider({ tools });

        const robota = new Robota({
            aiProviders: { 'openai': openaiProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-4',
            toolProviders: [toolProvider],
            systemPrompt: `Use the getWeather tool when asked about weather.`,
            debug: true
        });

        console.log("🚀 Testing tool calling...");
        const response = await robota.run("What's the weather in Seoul?");
        console.log(`🤖 Response: ${response}`);

        // 🔍 VERIFICATION: Check conversation history
        console.log("\n📋 === CONVERSATION HISTORY VERIFICATION ===");
        const messages = robota.conversation.getMessages();
        console.log(`Total messages in history: ${messages.length}`);

        messages.forEach((msg, idx) => {
            console.log(`${idx + 1}. [${msg.role}] ${msg.timestamp.toISOString()}`);
            if (msg.role === 'user') {
                console.log(`   Content: ${msg.content}`);
            } else if (msg.role === 'assistant') {
                const assistantMsg = msg as any;
                if (assistantMsg.toolCalls) {
                    console.log(`   Content: ${msg.content || 'null'}`);
                    console.log(`   Tool Calls: ${assistantMsg.toolCalls.length} calls`);
                    assistantMsg.toolCalls.forEach((tc: any, tcIdx: number) => {
                        console.log(`     ${tcIdx + 1}. ${tc.function.name} (ID: ${tc.id})`);
                    });
                } else {
                    console.log(`   Content: ${msg.content}`);
                }
            } else if (msg.role === 'tool') {
                const toolMsg = msg as any;
                console.log(`   Tool Call ID: ${toolMsg.toolCallId}`);
                console.log(`   Tool Name: ${toolMsg.name}`);
                console.log(`   Content: ${msg.content.substring(0, 100)}...`);
            } else if (msg.role === 'system') {
                console.log(`   Content: ${msg.content}`);
            }
        });

        // 🔍 VERIFICATION: Expected sequence
        console.log("\n✅ === EXPECTED SEQUENCE VERIFICATION ===");
        const expectedSequence = [
            'system',  // System prompt
            'user',    // User question
            'assistant', // Assistant with tool calls
            'tool',    // Tool result
            'assistant'  // Final assistant response
        ];

        const actualSequence = messages.map(m => m.role);
        console.log(`Expected: [${expectedSequence.join(', ')}]`);
        console.log(`Actual:   [${actualSequence.join(', ')}]`);

        const isCorrectSequence = JSON.stringify(expectedSequence) === JSON.stringify(actualSequence);
        console.log(`✅ Sequence correct: ${isCorrectSequence}`);

        if (!isCorrectSequence) {
            console.log("❌ Sequence mismatch detected!");
        }

    } catch (error) {
        console.error("❌ Error:", error);
    }
}

// Execute
main().catch(console.error); 