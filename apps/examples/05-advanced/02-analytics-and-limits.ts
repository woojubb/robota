/**
 * Analytics and Limits Management Advanced Examples
 * 
 * This example demonstrates comprehensive analytics tracking and limit management
 * for monitoring usage, setting budgets, and controlling API costs.
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const openaiProvider = new OpenAIProvider({ client: openaiClient });

    // ============================================================
    // Basic Limit Configuration
    // ============================================================

    console.log('=== Basic Limit Configuration ===');
    const robota1 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        maxTokenLimit: 10000,      // Set token budget
        maxRequestLimit: 50        // Set request budget
    });

    console.log('Initial limits:', robota1.getLimitInfo());

    // Make some requests
    for (let i = 1; i <= 3; i++) {
        const response = await robota1.run(`Tell me a ${i}-sentence fact about TypeScript.`);
        console.log(`Request ${i}:`, response);
        console.log(`After request ${i}:`, robota1.getLimitInfo());
    }

    // ============================================================
    // Dynamic Limit Updates
    // ============================================================

    console.log('\n=== Dynamic Limit Updates ===');
    const robota2 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    console.log('Default limits:', robota2.getLimitInfo());

    // Set conservative limits
    robota2.setMaxTokenLimit(5000);
    robota2.setMaxRequestLimit(10);
    console.log('Conservative limits set:', robota2.getLimitInfo());

    // Make some requests
    await robota2.run('What is TypeScript?');
    console.log('After first request:', robota2.getLimitInfo());

    // Increase limits dynamically
    robota2.setMaxTokenLimit(15000);
    robota2.setMaxRequestLimit(25);
    console.log('Increased limits:', robota2.getLimitInfo());

    // ============================================================
    // Analytics Tracking
    // ============================================================

    console.log('\n=== Analytics Tracking ===');
    const robota3 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    // Make several requests to generate analytics data
    const questions = [
        'What is dependency injection?',
        'Explain TypeScript generics.',
        'How do async/await work in JavaScript?',
        'What are design patterns?'
    ];

    for (const question of questions) {
        await robota3.run(question);
        console.log(`Current usage: ${robota3.getTotalTokensUsed()} tokens, ${robota3.getRequestCount()} requests`);
    }

    // Get comprehensive analytics
    const analytics = robota3.getAnalytics();
    console.log('Complete analytics:', analytics);

    // ============================================================
    // Time-based Analytics
    // ============================================================

    console.log('\n=== Time-based Analytics ===');
    const robota4 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    const startTime = new Date();
    console.log('Session started at:', startTime.toISOString());

    // Make requests over time
    await robota4.run('What is React?');

    // Wait a bit to create time separation
    await new Promise(resolve => setTimeout(resolve, 1000));

    await robota4.run('What is Vue.js?');

    const midTime = new Date();
    await robota4.run('What is Angular?');

    const endTime = new Date();

    // Get usage analytics for different time periods
    const fullPeriodUsage = robota4.getTokenUsageByPeriod(startTime, endTime);
    const midPeriodUsage = robota4.getTokenUsageByPeriod(startTime, midTime);

    console.log('Full period usage:', fullPeriodUsage);
    console.log('Mid period usage:', midPeriodUsage);

    // ============================================================
    // Budget Management Patterns
    // ============================================================

    console.log('\n=== Budget Management Patterns ===');

    const budgetScenarios = [
        { name: 'Conservative', tokens: 3000, requests: 5 },
        { name: 'Standard', tokens: 10000, requests: 20 },
        { name: 'Premium', tokens: 50000, requests: 100 }
    ];

    for (const scenario of budgetScenarios) {
        console.log(`\n--- ${scenario.name} Budget ---`);

        const robota = new Robota({
            aiProviders: { openai: openaiProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            maxTokenLimit: scenario.tokens,
            maxRequestLimit: scenario.requests
        });

        console.log(`Budget: ${scenario.tokens} tokens, ${scenario.requests} requests`);

        // Test the budget with a request
        try {
            await robota.run('Explain the concept of clean code in one paragraph.');
            const usage = robota.getLimitInfo();
            const tokenUtilization = (usage.tokens.used / usage.tokens.max * 100).toFixed(1);
            const requestUtilization = (usage.requests.used / usage.requests.max * 100).toFixed(1);

            console.log(`Usage: ${tokenUtilization}% tokens, ${requestUtilization}% requests`);
        } catch (error) {
            console.log('Budget exceeded:', error instanceof Error ? error.message : String(error));
        }

        await robota.close();
    }

    // ============================================================
    // Real-time Monitoring
    // ============================================================

    console.log('\n=== Real-time Monitoring ===');
    const robota5 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        maxTokenLimit: 8000,
        maxRequestLimit: 15
    });

    // Monitor usage during operations
    const monitoringQuestions = [
        'What is Node.js?',
        'Explain REST APIs.',
        'What is GraphQL?'
    ];

    for (let i = 0; i < monitoringQuestions.length; i++) {
        const question = monitoringQuestions[i];
        console.log(`\n--- Request ${i + 1} ---`);
        console.log('Question:', question);

        const beforeUsage = robota5.getLimitInfo();
        console.log('Before:', `${beforeUsage.tokens.used}/${beforeUsage.tokens.max} tokens, ${beforeUsage.requests.used}/${beforeUsage.requests.max} requests`);

        const response = await robota5.run(question);

        const afterUsage = robota5.getLimitInfo();
        console.log('After:', `${afterUsage.tokens.used}/${afterUsage.tokens.max} tokens, ${afterUsage.requests.used}/${afterUsage.requests.max} requests`);

        const tokensDelta = afterUsage.tokens.used - beforeUsage.tokens.used;
        console.log(`Tokens used in this request: ${tokensDelta}`);
        console.log(`Response: ${response.substring(0, 100)}...`);

        // Check if approaching limits
        const tokenPercentage = (afterUsage.tokens.used / afterUsage.tokens.max) * 100;
        const requestPercentage = (afterUsage.requests.used / afterUsage.requests.max) * 100;

        if (tokenPercentage > 80) {
            console.log('⚠️  Warning: Approaching token limit!');
        }
        if (requestPercentage > 80) {
            console.log('⚠️  Warning: Approaching request limit!');
        }
    }

    // ============================================================
    // Analytics Reset and Session Management
    // ============================================================

    console.log('\n=== Analytics Reset and Session Management ===');
    const robota6 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    // Build up some usage
    await robota6.run('What is machine learning?');
    await robota6.run('Explain neural networks.');

    console.log('Before reset:', robota6.getAnalytics());

    // Reset analytics for new session
    robota6.resetAnalytics();
    console.log('After reset:', robota6.getAnalytics());

    // Start new session
    await robota6.run('What is deep learning?');
    console.log('New session analytics:', robota6.getAnalytics());

    // Close all instances
    await robota1.close();
    await robota2.close();
    await robota3.close();
    await robota4.close();
    await robota5.close();
    await robota6.close();
}

main().catch(console.error); 