/**
 * 04-advanced-features.ts
 * 
 * This example demonstrates advanced Robota features:
 * - Analytics and usage tracking
 * - Request and token limits
 * - Conversation history management
 * - Streaming responses with tool calling
 * - Custom system messages
 */

import { z } from 'zod';
import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Define a simple tool for demonstration
const tools = {
    analyzeText: {
        name: 'analyzeText',
        description: 'Analyzes text and returns word count and sentiment',
        parameters: z.object({
            text: z.string().describe('Text to analyze'),
            includeDetails: z.boolean().optional().default(false).describe('Include detailed analysis')
        }),
        handler: async (params) => {
            const { text, includeDetails } = params;
            console.log(`🔍 Analyzing text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);

            const wordCount = text.split(/\s+/).filter(word => word.length > 0).length;
            const charCount = text.length;

            // Simple sentiment analysis (very basic)
            const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'happy', 'love'];
            const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'sad', 'angry', 'disappointed'];

            const words = text.toLowerCase().split(/\s+/);
            const positiveCount = words.filter(word => positiveWords.includes(word)).length;
            const negativeCount = words.filter(word => negativeWords.includes(word)).length;

            let sentiment = 'neutral';
            if (positiveCount > negativeCount) sentiment = 'positive';
            else if (negativeCount > positiveCount) sentiment = 'negative';

            const result: any = {
                wordCount,
                charCount,
                sentiment,
                sentimentScore: positiveCount - negativeCount
            };

            if (includeDetails) {
                result.details = {
                    positiveWords: words.filter(word => positiveWords.includes(word)),
                    negativeWords: words.filter(word => negativeWords.includes(word)),
                    averageWordLength: words.reduce((sum, word) => sum + word.length, 0) / words.length
                };
            }

            return result;
        }
    }
};

async function main() {
    try {
        console.log('⚡ Advanced Features Example Started...\n');

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

        // Create tool provider
        const toolProvider = createZodFunctionToolProvider({ tools });

        // === Advanced Configuration ===
        const robota = new Robota({
            aiProviders: { openai: openaiProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            toolProviders: [toolProvider],
            systemPrompt: 'You are an advanced AI assistant with text analysis capabilities. Use tools when users ask for text analysis.',

            // Advanced options
            temperature: 0.7,
            maxTokens: 1000,
            maxTokenLimit: 5000,  // Total token budget
            maxRequestLimit: 10,  // Request limit
            debug: true,          // Enable debug logging

            // Tool call callback
            onToolCall: (toolName, params, result) => {
                console.log(`🔧 Tool "${toolName}" called with params:`, params);
                console.log(`📊 Tool result:`, result);
            }
        });

        // === Analytics Demo ===
        console.log('📊 Analytics & Limits Demo');
        console.log('='.repeat(40));

        // Check initial analytics
        console.log('\n📈 Initial Analytics:');
        console.log('- Request count:', robota.analytics.getRequestCount());
        console.log('- Available tools:', robota.getAvailableTools().length);

        // === Conversation History Demo ===
        console.log('\n💬 Conversation History Demo');
        console.log('='.repeat(40));

        const queries = [
            'Hello! What can you help me with?',
            'Can you analyze this text: "I love this amazing product! It works great and makes me very happy."',
            'Now analyze: "This is terrible. I hate it and it makes me sad."'
        ];

        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`\n${i + 1}. User: ${query}`);

            const response = await robota.run(query);
            console.log(`   Assistant: ${response}`);

            // Show updated analytics
            console.log(`   📊 Requests: ${robota.analytics.getRequestCount()}`);
        }

        // === Conversation History Inspection ===
        console.log('\n📜 Conversation History:');
        console.log('='.repeat(40));

        const history = robota.conversation.getMessages();
        history.forEach((msg, index) => {
            console.log(`${index + 1}. [${msg.role}] ${msg.content?.substring(0, 100)}${msg.content && msg.content.length > 100 ? '...' : ''}`);
        });

        // === Streaming Demo ===
        console.log('\n🌊 Streaming Response Demo');
        console.log('='.repeat(40));

        const streamQuery = 'Please analyze this text with details: "The weather is absolutely wonderful today! I feel fantastic and everything seems amazing. This is the best day ever!"';
        console.log(`User: ${streamQuery}`);
        console.log('Assistant: ');

        const stream = await robota.runStream(streamQuery);
        for await (const chunk of stream) {
            process.stdout.write(chunk.content || '');
        }
        console.log('\n');

        // === Final Analytics ===
        console.log('\n📊 Final Analytics:');
        console.log('='.repeat(40));
        console.log('- Total requests:', robota.analytics.getRequestCount());
        console.log('- Conversation length:', robota.conversation.getMessages().length, 'messages');

        // === Limits Demo ===
        console.log('\n⚠️ Testing Limits:');
        console.log('='.repeat(40));

        try {
            // This should work if under limits
            await robota.run('Quick test message');
            console.log('✅ Request within limits');
        } catch (error) {
            console.log('❌ Request limit exceeded:', error);
        }

        // === Conversation Clearing ===
        console.log('\n🧹 Clearing Conversation History...');
        robota.clearConversationHistory();
        console.log('Conversation length after clear:', robota.conversation.getMessages().length, 'messages');

        console.log('\n✅ Advanced Features Example Completed!');

        // Clean up resources
        await robota.close();
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main(); 