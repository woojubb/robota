/**
 * 11-agents-streaming.ts
 * 
 * This example demonstrates the streaming response capabilities of the @robota-sdk/agents package:
 * - Real-time streaming responses
 * - Streaming with tools and plugins
 * - Error handling in streaming scenarios
 * - Performance monitoring during streaming
 */

import OpenAI from 'openai';
import { Robota, type RobotaConfig, PerformancePlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        console.log('🌊 Agents Package Streaming Example Started...\n');

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

        // ===== AGENT CONFIGURATION FOR STREAMING =====
        console.log('⚙️ Creating agent optimized for streaming...');

        const config: RobotaConfig = {
            name: 'StreamingAgent',
            model: 'gpt-3.5-turbo',
            provider: 'openai',
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            plugins: [
                new PerformancePlugin({
                    trackMemory: true,
                    trackTiming: true,
                    strategy: 'memory'
                })
            ],
            logging: {
                level: 'silent', // Reduce noise during streaming
                enabled: false
            }
        };

        const robota = new Robota(config);
        console.log(`✅ Streaming agent '${robota.name}' created successfully\n`);

        // ===== BASIC STREAMING =====
        console.log('🌊 Basic Streaming Response:');
        console.log('User: Tell me a detailed story about a space explorer discovering a new planet.\n');
        console.log('Assistant: ');

        const startTime = Date.now();
        let totalChunks = 0;
        let fullResponse = '';

        for await (const chunk of robota.runStream('Tell me a detailed story about a space explorer discovering a new planet.')) {
            process.stdout.write(chunk);
            fullResponse += chunk;
            totalChunks++;
        }

        const streamingDuration = Date.now() - startTime;
        console.log('\n\n');

        // ===== STREAMING STATISTICS =====
        console.log('📊 Streaming Statistics:');
        console.log(`- Total chunks received: ${totalChunks}`);
        console.log(`- Total response length: ${fullResponse.length} characters`);
        console.log(`- Average chunk size: ${Math.round(fullResponse.length / totalChunks)} characters`);
        console.log(`- Streaming duration: ${streamingDuration}ms`);
        console.log(`- Characters per second: ${Math.round(fullResponse.length / (streamingDuration / 1000))}\n`);

        // ===== PERFORMANCE MONITORING =====
        console.log('⚡ Performance Metrics:');
        const performancePlugin = robota.getPlugin<PerformancePlugin>('performance-plugin');
        if (performancePlugin) {
            const metrics = performancePlugin.getMetrics();
            console.log(`- Execution count: ${metrics.executionCount}`);
            console.log(`- Average response time: ${Math.round(metrics.averageResponseTime)}ms`);
            console.log(`- Memory usage: ${Math.round(metrics.memoryUsage / 1024 / 1024)}MB`);
        }
        console.log();

        // ===== CONVERSATIONAL STREAMING =====
        console.log('🌊 Conversational Streaming (building on previous context):');
        console.log('User: What challenges might this explorer face on this new planet?\n');
        console.log('Assistant: ');

        let response2 = '';
        for await (const chunk of robota.runStream('What challenges might this explorer face on this new planet?')) {
            process.stdout.write(chunk);
            response2 += chunk;
        }
        console.log('\n\n');

        // ===== STREAMING WITH TIMEOUT SIMULATION =====
        console.log('🌊 Streaming with Custom Processing:');
        console.log('User: Describe the alien life forms the explorer might encounter.\n');
        console.log('Assistant: ');

        const processedChunks: string[] = [];
        for await (const chunk of robota.runStream('Describe the alien life forms the explorer might encounter.')) {
            // Simulate processing each chunk
            const processedChunk = chunk.replace(/\b(alien|creature|being)\b/gi, '👽$1👽');
            process.stdout.write(processedChunk);
            processedChunks.push(chunk);

            // Add small delay to simulate processing
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        console.log('\n\n');

        // ===== ERROR HANDLING IN STREAMING =====
        console.log('🚨 Testing Error Handling in Streaming:');
        try {
            console.log('User: [Testing with potentially problematic input]\n');
            console.log('Assistant: ');

            for await (const chunk of robota.runStream('Tell me about... [normal request]')) {
                process.stdout.write(chunk);
            }
            console.log('\n✅ Streaming completed successfully\n');

        } catch (error) {
            console.log('\n❌ Streaming error handled gracefully:');
            console.log(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
        }

        // ===== FINAL STATISTICS =====
        console.log('📊 Final Agent Statistics:');
        const finalStats = robota.getStats();
        console.log(`- Total conversations: ${Math.ceil(finalStats.historyLength / 2)}`);
        console.log(`- Messages in history: ${finalStats.historyLength}`);
        console.log(`- Session duration: ${Math.round(finalStats.uptime / 1000)}s`);
        console.log(`- Agent uptime: ${Math.round(finalStats.uptime / 1000)}s\n`);

        console.log('✅ Agents Package Streaming Example Completed!');

        // ===== RESOURCE CLEANUP =====
        console.log('🧹 Cleaning up resources...');
        await robota.destroy();
        console.log('✅ Cleanup complete!');

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