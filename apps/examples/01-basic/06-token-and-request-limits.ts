/**
 * 06-token-and-request-limits.ts
 * 
 * This example demonstrates Robota's token and request limitation features:
 * - Default limit settings (maxTokens: 4096, maxRequests: 25)
 * - Custom limit settings
 * - Unlimited settings (using 0 value)
 * - Cost savings through pre-token calculation
 * - Error handling when limits are exceeded
 * - Real-time limit information monitoring
 * - Analytics data collection
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
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

    console.log('🚀 Robota Token and Request Limit Features Example\n');

    // 1. Default limit settings example
    await demonstrateDefaultLimits(openaiProvider);

    // 2. Custom limit settings example
    await demonstrateCustomLimits(openaiProvider);

    // 3. Unlimited settings example
    await demonstrateUnlimitedMode(openaiProvider);

    // 4. Cost savings through pre-token calculation example
    await demonstrateTokenPrevention(openaiProvider);

    // 5. Request limit example
    await demonstrateRequestLimits(openaiProvider);

    // 6. Real-time monitoring example
    await demonstrateRealTimeMonitoring(openaiProvider);

    console.log('\n✅ All examples completed!');
}

async function demonstrateDefaultLimits(openaiProvider: OpenAIProvider) {
    console.log('=== 1. Default Limit Settings Example ===');

    // Create Robota with default settings (maxTokens: 4096, maxRequests: 25)
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'Please respond concisely.'
    });

    // Check default limits
    console.log(`Default token limit: ${robota.getMaxTokenLimit()}`);
    console.log(`Default request limit: ${robota.getMaxRequestLimit()}`);

    // Output limit information
    const limitInfo = robota.getLimitInfo();
    console.log('Current limit status:', {
        maxTokens: limitInfo.maxTokens,
        maxRequests: limitInfo.maxRequests,
        remainingTokens: limitInfo.remainingTokens,
        remainingRequests: limitInfo.remainingRequests,
        isTokensUnlimited: limitInfo.isTokensUnlimited,
        isRequestsUnlimited: limitInfo.isRequestsUnlimited
    });

    // Execute some requests
    const response = await robota.execute('What is TypeScript?');
    console.log(`Response: ${response.substring(0, 100)}...`);

    // Check usage
    console.log(`Tokens used: ${robota.getTotalTokensUsed()}`);
    console.log(`Requests executed: ${robota.getRequestCount()}\n`);
}

async function demonstrateCustomLimits(openaiProvider: OpenAIProvider) {
    console.log('=== 2. Custom Limit Settings Example ===');

    // Set low limits
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'Please respond concisely.',
        maxTokenLimit: 200,  // Very low token limit
        maxRequestLimit: 3   // Only 3 requests allowed
    });

    console.log(`Set token limit: ${robota.getMaxTokenLimit()}`);
    console.log(`Set request limit: ${robota.getMaxRequestLimit()}`);

    try {
        // First request
        const response1 = await robota.execute('Hello');
        console.log(`1st request success: ${response1.substring(0, 50)}...`);

        // Second request
        const response2 = await robota.execute('How is the weather?');
        console.log(`2nd request success: ${response2.substring(0, 50)}...`);

        // Third request (may hit token limit)
        const response3 = await robota.execute('Please explain programming in detail.');
        console.log(`3rd request success: ${response3.substring(0, 50)}...`);

    } catch (error) {
        console.log(`Limit exceeded error: ${(error as Error).message}`);
    }

    console.log(`Final token usage: ${robota.getTotalTokensUsed()}`);
    console.log(`Final request count: ${robota.getRequestCount()}\n`);
}

async function demonstrateUnlimitedMode(openaiProvider: OpenAIProvider) {
    console.log('=== 3. Unlimited Settings Example ===');

    // Unlimited settings (using 0 value)
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'Please respond concisely.',
        maxTokenLimit: 0,    // Unlimited
        maxRequestLimit: 0   // Unlimited
    });

    const limitInfo = robota.getLimitInfo();
    console.log('Unlimited mode check:');
    console.log(`Tokens unlimited: ${limitInfo.isTokensUnlimited}`);
    console.log(`Requests unlimited: ${limitInfo.isRequestsUnlimited}`);
    console.log(`Remaining tokens: ${limitInfo.remainingTokens ?? 'Unlimited'}`);
    console.log(`Remaining requests: ${limitInfo.remainingRequests ?? 'Unlimited'}`);

    // In unlimited mode, many requests are possible
    const response = await robota.execute('Please explain the advantages of TypeScript in detail.');
    console.log(`Response: ${response.substring(0, 100)}...`);
    console.log(`Token usage: ${robota.getTotalTokensUsed()}\n`);
}

async function demonstrateTokenPrevention(openaiProvider: OpenAIProvider) {
    console.log('=== 4. Cost Savings Through Pre-Token Calculation Example ===');

    // Set very low token limit
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'Please respond concisely.',
        maxTokenLimit: 50,   // Very low limit
        debug: true          // Debug mode to see token calculation process
    });

    console.log(`Very low token limit set: ${robota.getMaxTokenLimit()}`);

    try {
        // Short message (should succeed)
        console.log('\nTrying short message...');
        const shortResponse = await robota.execute('Hello');
        console.log(`✅ Success: ${shortResponse}`);
        console.log(`Tokens used: ${robota.getTotalTokensUsed()}`);

        // Long message (will be blocked by pre-calculation)
        console.log('\nTrying long message...');
        await robota.execute('Please explain all features, advantages, disadvantages of TypeScript, and differences from JavaScript in great detail. Also tell me how to use it in actual projects and best practices.');

    } catch (error) {
        console.log(`❌ Request blocked by pre-token calculation: ${(error as Error).message}`);
        console.log('💰 API cost saved! Limit exceeded detected without actual API call.');
    }

    console.log(`Final token usage: ${robota.getTotalTokensUsed()}\n`);
}

async function demonstrateRequestLimits(openaiProvider: OpenAIProvider) {
    console.log('=== 5. Request Limit Example ===');

    // Request count limit
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'Please respond concisely.',
        maxTokenLimit: 5000,  // Sufficient tokens
        maxRequestLimit: 2    // Only 2 requests allowed
    });

    console.log(`Request limit: ${robota.getMaxRequestLimit()} times`);

    try {
        // First request
        console.log('1st request...');
        await robota.execute('Hello');
        console.log(`✅ 1st request success (remaining requests: ${robota.getLimitInfo().remainingRequests})`);

        // Second request
        console.log('2nd request...');
        await robota.execute('Thank you');
        console.log(`✅ 2nd request success (remaining requests: ${robota.getLimitInfo().remainingRequests})`);

        // Third request (exceeds limit)
        console.log('3rd request...');
        await robota.execute('Another question');

    } catch (error) {
        console.log(`❌ Request limit exceeded: ${(error as Error).message}`);
    }

    console.log(`Final request count: ${robota.getRequestCount()}\n`);
}

async function demonstrateRealTimeMonitoring(openaiProvider: OpenAIProvider) {
    console.log('=== 6. Real-time Monitoring Example ===');

    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: 'Please respond concisely.',
        maxTokenLimit: 500,
        maxRequestLimit: 5
    });

    // Monitoring function
    function printStatus(step: string) {
        const limitInfo = robota.getLimitInfo();
        const analytics = robota.getAnalytics();

        console.log(`\n[${step}] Current status:`);
        console.log(`  Tokens: ${limitInfo.currentTokensUsed}/${limitInfo.maxTokens} (remaining: ${limitInfo.remainingTokens})`);
        console.log(`  Requests: ${limitInfo.currentRequestCount}/${limitInfo.maxRequests} (remaining: ${limitInfo.remainingRequests})`);
        console.log(`  Average tokens/request: ${analytics.averageTokensPerRequest.toFixed(1)}`);
    }

    printStatus('Start');

    // Execute multiple requests while monitoring
    const questions = [
        'Hello',
        'What is TypeScript?',
        'What is React?',
        'Explain Node.js'
    ];

    for (let i = 0; i < questions.length; i++) {
        try {
            console.log(`\nQuestion ${i + 1}: "${questions[i]}"`);
            const response = await robota.execute(questions[i]);
            console.log(`Response: ${response.substring(0, 80)}...`);
            printStatus(`Request ${i + 1} completed`);

        } catch (error) {
            console.log(`❌ Request ${i + 1} failed: ${(error as Error).message}`);
            break;
        }
    }

    // Final analytics
    const finalAnalytics = robota.getAnalytics();
    console.log('\n📊 Final analytics:');
    console.log(`  Total requests: ${finalAnalytics.requestCount}`);
    console.log(`  Total token usage: ${finalAnalytics.totalTokensUsed}`);
    console.log(`  Average tokens/request: ${finalAnalytics.averageTokensPerRequest.toFixed(1)}`);

    // Usage by time period (last 1 minute)
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const recentUsage = robota.getTokenUsageByPeriod(oneMinuteAgo);
    console.log(`  Last 1 minute: ${recentUsage.requestCount} requests, ${recentUsage.totalTokens} tokens`);

    console.log('\n');
}

// Execute
main().catch(error => {
    console.error('Error occurred:', error);
}); 