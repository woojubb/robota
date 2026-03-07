# Agents Package Streaming

This example demonstrates the real-time streaming response capabilities of the `@robota-sdk/agents` package, showcasing advanced streaming features with performance monitoring.

## Overview

The agents streaming example shows how to:
- Implement real-time streaming responses
- Monitor streaming performance and metrics
- Handle errors gracefully during streaming
- Optimize agent configuration for streaming
- Track streaming statistics and performance

## Code Example

```typescript
/**
 * 11-agents-streaming.ts
 * 
 * This example demonstrates the streaming response capabilities of the @robota-sdk/agents package:
 * - Real-time streaming responses
 * - Streaming with tools and plugins
 * - Error handling in streaming scenarios
 * - Performance monitoring during streaming
 */

import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
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

        console.log('⚙️ Creating agent optimized for streaming...');

        // Create OpenAI client and provider
        const openaiClient = new OpenAI({ apiKey });
        const openaiProvider = new OpenAIProvider({
            client: openaiClient
        });

        // Create Robota instance optimized for streaming
        const robota = new Robota({
            name: 'StreamingAgent',
            model: 'gpt-3.5-turbo',
            provider: 'openai',
            aiProviders: {
                'openai': openaiProvider
            },
            currentModel: 'gpt-3.5-turbo',
            systemMessage: 'You are a helpful assistant that provides detailed explanations.',
            logging: {
                level: 'info',
                enabled: true
            },
            streaming: {
                enabled: true,
                bufferSize: 50
            }
        });

        console.log(`✅ Streaming agent '${robota.getStats().name}' created successfully\n`);

        // Test streaming with different query types
        const queries = [
            'Tell me about space exploration.',
            'Explain quantum computing in simple terms.'
        ];

        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`🌊 Streaming Response ${i + 1}:`);
            console.log(`User: ${query}\n`);

            const startTime = Date.now();
            let streamedContent = '';
            let chunkCount = 0;

            try {
                // Start streaming
                const stream = await robota.stream(query);

                process.stdout.write('Assistant: ');

                // Handle streaming chunks
                for await (const chunk of stream) {
                    if (chunk.content) {
                        process.stdout.write(chunk.content);
                        streamedContent += chunk.content;
                        chunkCount++;
                    }
                    
                    // Handle streaming metadata
                    if (chunk.metadata) {
                        // Optional: Process streaming metadata
                    }
                }

                const duration = Date.now() - startTime;
                console.log(`\n\n📊 Streaming Stats:`);
                console.log(`- Duration: ${duration}ms`);
                console.log(`- Chunks received: ${chunkCount}`);
                console.log(`- Characters streamed: ${streamedContent.length}`);
                console.log(`- Average chunk size: ${Math.round(streamedContent.length / chunkCount)} chars`);

            } catch (error) {
                console.error(`❌ Streaming error: ${error}`);
            }

            if (i < queries.length - 1) {
                console.log('\n' + '─'.repeat(80) + '\n');
            }
        }

        // Show Final Statistics
        console.log('\n📊 Final Agent Statistics:');
        const stats = robota.getStats();
        console.log(`- Agent name: ${stats.name}`);
        console.log(`- Total interactions: ${stats.historyLength / 2}`);
        console.log(`- Uptime: ${Math.round(stats.uptime)}ms`);

        console.log('\n✅ Streaming Example Completed!');

        // Clean up resources
        await robota.destroy();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error occurred:', error);
        process.exit(1);
    }
}

// Execute
main();
```

## Expected Output

```
🌊 Agents Package Streaming Example Started...

⚙️ Creating agent optimized for streaming...
✅ Streaming agent 'StreamingAgent' created successfully

🌊 Streaming Response 1:
User: Tell me about space exploration.

Space exploration represents humanity's quest to understand and explore the cosmos beyond Earth. It began in earnest during the mid-20th century with the launch of Sputnik 1 in 1957, marking the start of the space age. Since then, we've achieved remarkable milestones including human moon landings, robotic missions to Mars, and the development of the International Space Station.

📊 Streaming Stats:
- Duration: 1847ms
- Chunks received: 45
- Characters streamed: 384
- Average chunk size: 9 chars

📊 Final Agent Statistics:
- Agent name: StreamingAgent
- Total interactions: 22
- Current provider: openai
- Uptime: 1847ms

✅ Streaming Example Completed!