/**
 * 06-token-and-request-limits-simple.ts
 * 
 * Simple usage of token and request limit features:
 * - Default and custom settings
 * - Limit checking and monitoring
 * - Error handling
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    const openaiClient = new OpenAI({ apiKey });
    const openaiProvider = new OpenAIProvider(openaiClient);

    console.log('🔧 Simple Token/Request Limit Example\n');

    // 1. Default settings (maxTokens: 4096, maxRequests: 25)
    console.log('=== Default Settings ===');
    const robota1 = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    console.log(`Default token limit: ${robota1.getMaxTokenLimit()}`);
    console.log(`Default request limit: ${robota1.getMaxRequestLimit()}`);

    // 2. Custom settings
    console.log('\n=== Custom Settings ===');
    const robota2 = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'Please respond concisely.',
        maxTokenLimit: 100,  // Low token limit
        maxRequestLimit: 2   // Only 2 requests allowed
    });

    console.log(`Custom token limit: ${robota2.getMaxTokenLimit()}`);
    console.log(`Custom request limit: ${robota2.getMaxRequestLimit()}`);

    // 3. Execute requests and monitor
    console.log('\n=== Execute Requests and Monitor ===');

    try {
        // First request
        const response1 = await robota2.execute('Hello');
        console.log(`✅ Request 1 success: ${response1.substring(0, 50)}...`);

        // Check current status
        const info1 = robota2.getLimitInfo();
        console.log(`Status: tokens ${info1.currentTokensUsed}/${info1.maxTokens}, requests ${info1.currentRequestCount}/${info1.maxRequests}`);

        // Second request
        const response2 = await robota2.execute('Thank you');
        console.log(`✅ Request 2 success: ${response2.substring(0, 50)}...`);

        const info2 = robota2.getLimitInfo();
        console.log(`Status: tokens ${info2.currentTokensUsed}/${info2.maxTokens}, requests ${info2.currentRequestCount}/${info2.maxRequests}`);

        // Third request (exceeds limit)
        const response3 = await robota2.execute('Another question');
        console.log(`Request 3: ${response3}`);

    } catch (error) {
        console.log(`❌ Limit exceeded: ${(error as Error).message}`);
    }

    // 4. Unlimited settings
    console.log('\n=== Unlimited Settings ===');
    const unlimitedRobota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        maxTokenLimit: 0,    // Unlimited
        maxRequestLimit: 0   // Unlimited
    });

    const unlimitedInfo = unlimitedRobota.getLimitInfo();
    console.log(`Unlimited mode: tokens=${unlimitedInfo.isTokensUnlimited}, requests=${unlimitedInfo.isRequestsUnlimited}`);

    // 5. Check analytics
    console.log('\n=== Analytics ===');
    const analytics = robota2.getAnalytics();
    console.log(`Total requests: ${analytics.requestCount}`);
    console.log(`Total tokens: ${analytics.totalTokensUsed}`);
    console.log(`Average tokens/request: ${analytics.averageTokensPerRequest.toFixed(1)}`);

    // 6. Dynamic limit changes
    console.log('\n=== Dynamic Limit Changes ===');
    robota2.setMaxTokenLimit(1000);
    robota2.setMaxRequestLimit(10);
    console.log(`Changed token limit: ${robota2.getMaxTokenLimit()}`);
    console.log(`Changed request limit: ${robota2.getMaxRequestLimit()}`);

    console.log('\n✅ Example completed!');
}

main().catch(error => {
    console.error('Error:', error);
}); 