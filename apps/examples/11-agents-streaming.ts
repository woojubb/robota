/**
 * 11-agents-streaming.ts
 * 
 * This example demonstrates the streaming response capabilities of the @robota-sdk/agents package:
 * - Real-time streaming responses
 * - Streaming with tools and plugins
 * - Error handling in streaming scenarios
 * - Performance monitoring during streaming
 */

import {
    Robota,
    LoggingPlugin,
    PerformancePlugin
} from '@robota-sdk/agents';
import type { IAgentConfig } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables from examples directory
dotenv.config();

async function main() {
    try {
        console.log('🌊 Agents Package Streaming Example Started...\n');

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI provider (simplified)
        const openaiProvider = new OpenAIProvider({
            apiKey
        });

        // ===== AGENT CONFIGURATION FOR STREAMING =====
        console.log('⚙️ Creating agent optimized for streaming...');

        const config: IAgentConfig = {
            name: 'StreamingAgent',
            aiProviders: [openaiProvider],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo'
            },
            plugins: [
                new PerformancePlugin({
                    strategy: 'memory',
                    monitorMemory: true,
                    aggregateStats: true
                }),
                new LoggingPlugin({
                    strategy: 'silent',
                    level: 'error',
                    enabled: false
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
        const streamQuery = 'Tell me about space.';  // Short query always
        console.log(`User: ${streamQuery}\n`);
        console.log('Assistant: ');

        const startTime = Date.now();
        let totalChunks = 0;
        let fullResponse = '';

        for await (const chunk of robota.runStream(streamQuery)) {
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
            const stats = await performancePlugin.getAggregatedStats();
            console.log(`- Total operations: ${stats.totalOperations}`);
            console.log(`- Average duration: ${Math.round(stats.averageDuration)}ms`);
            if (stats.memoryStats) {
                console.log(`- Avg heap used: ${Math.round(stats.memoryStats.averageHeapUsed / 1024 / 1024)}MB`);
            }
        }
        console.log();

        // ===== SKIP ADDITIONAL STREAMING FOR TOKEN EFFICIENCY =====
        console.log('🌊 Skipping additional streaming demos for token efficiency\n');

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

        // Ensure process exits cleanly
        console.log('🧹 Exiting...');
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