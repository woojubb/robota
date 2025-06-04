/**
 * System Message Management Advanced Examples
 * 
 * This example demonstrates advanced system message configuration patterns
 * for different use cases and scenarios.
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const openaiProvider = new OpenAIProvider({ client: openaiClient });

    // ============================================================
    // Single System Prompt Pattern
    // ============================================================

    console.log('=== Single System Prompt ===');
    const robota1 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    // Simple system prompt setting
    robota1.setSystemPrompt('You are an expert TypeScript developer who writes clean, well-documented code.');

    const response1 = await robota1.run('How do I create a generic interface in TypeScript?');
    console.log('Response:', response1);

    // ============================================================
    // Multiple System Messages Pattern
    // ============================================================

    console.log('\n=== Multiple System Messages ===');
    const robota2 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    // Complex system configuration with multiple messages
    robota2.setSystemMessages([
        { role: 'system', content: 'You are a helpful AI assistant specialized in software architecture.' },
        { role: 'system', content: 'Always provide code examples when explaining concepts.' },
        { role: 'system', content: 'Consider performance, maintainability, and scalability in your recommendations.' }
    ]);

    const response2 = await robota2.run('What are the best patterns for handling errors in a large TypeScript application?');
    console.log('Response:', response2);

    // ============================================================
    // Dynamic System Message Updates
    // ============================================================

    console.log('\n=== Dynamic System Message Updates ===');
    const robota3 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    // Start with basic system prompt
    robota3.setSystemPrompt('You are a code reviewer.');

    // Add additional constraints dynamically
    robota3.addSystemMessage('Focus on security vulnerabilities.');
    robota3.addSystemMessage('Always explain your reasoning step by step.');
    robota3.addSystemMessage('Suggest specific improvements with code examples.');

    const codeToReview = `
        function processUserData(userData: any) {
            return eval(userData.expression);
        }
    `;

    const response3 = await robota3.run(`Please review this code:\n${codeToReview}`);
    console.log('Code Review:', response3);

    // ============================================================
    // Context-Aware System Messages
    // ============================================================

    console.log('\n=== Context-Aware System Messages ===');

    // Different personalities for different tasks
    const personalities = {
        teacher: 'You are a patient programming teacher. Explain concepts clearly with analogies and examples.',
        critic: 'You are a senior code reviewer. Be thorough and point out potential issues.',
        architect: 'You are a system architect. Focus on scalability, patterns, and best practices.'
    };

    for (const [personality, prompt] of Object.entries(personalities)) {
        console.log(`\n--- ${personality.toUpperCase()} Personality ---`);

        const robota = new Robota({
            aiProviders: { openai: openaiProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo'
        });

        robota.setSystemPrompt(prompt);

        const question = 'What is dependency injection?';
        const response = await robota.run(question);
        console.log(`${personality} response:`, response.substring(0, 200) + '...');
    }

    // ============================================================
    // Role-Based System Configuration
    // ============================================================

    console.log('\n=== Role-Based System Configuration ===');

    const robota4 = new Robota({
        aiProviders: { openai: openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    // Configure for a specific domain expert role
    robota4.setSystemMessages([
        { role: 'system', content: 'You are a DevOps engineer with 10+ years of experience.' },
        { role: 'system', content: 'You specialize in containerization, CI/CD, and cloud infrastructure.' },
        { role: 'system', content: 'Always consider security, scalability, and cost optimization.' },
        { role: 'system', content: 'Provide practical, actionable advice with specific tool recommendations.' }
    ]);

    const devopsQuestion = 'How should I set up a CI/CD pipeline for a TypeScript microservices project?';
    const devopsResponse = await robota4.run(devopsQuestion);
    console.log('DevOps Expert Response:', devopsResponse);

    await robota1.close();
    await robota2.close();
    await robota3.close();
    await robota4.close();
}

main().catch(console.error); 