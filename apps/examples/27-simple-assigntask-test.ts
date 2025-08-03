#!/usr/bin/env tsx
/**
 * Simple assignTask Test - Minimal example to test assignTask functionality
 * Tests the assignTask tool execution in isolation
 */

import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { config } from 'dotenv';

// Load environment variables
config();

async function testAssignTask() {
    console.log('🧪 Simple assignTask Test Starting...\n');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    try {
        // Create provider
        const openaiProvider = new OpenAIProvider({
            apiKey,
            enablePayloadLogging: true,
            payloadLogDir: './logs/simple-assigntask-test',
            includeTimestampInLogFiles: true
        });

        // Create a simple team
        console.log('1️⃣ Creating team...');
        const team = await createTeam({
            aiProviders: [openaiProvider],
            maxMembers: 3,
            maxTokenLimit: 8000,
            logger: console,
            debug: true,
        });
        console.log('✅ Team created\n');

        // Test with a very simple prompt that should trigger assignTask
        console.log('2️⃣ Executing team with simple task...');
        const prompt = `Create a simple test task using the assignTask tool. 
        Use these parameters:
        - jobDescription: "Write a test message"
        - agentTemplate: "test_agent"
        - priority: "high"
        
        Just call the tool once and return the result.`;

        const startTime = Date.now();
        const result = await team.execute(prompt);
        const duration = Date.now() - startTime;

        console.log('\n✅ Team execution completed');
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log('\n📊 Result:');
        console.log(result);

        // Get team stats
        const stats = team.getStats();
        console.log('\n📈 Team Stats:');
        console.log(`- Total executions: ${stats.totalExecutions}`);
        console.log(`- Active agents: ${stats.activeAgents}`);
        console.log(`- Total agents created: ${stats.totalAgentsCreated}`);
        console.log(`- Task delegations: ${stats.taskDelegations.length}`);

        if (stats.taskDelegations.length > 0) {
            console.log('\n📋 Task Delegations:');
            stats.taskDelegations.forEach((delegation, index) => {
                console.log(`  ${index + 1}. ${delegation.originalTask}`);
                console.log(`     Agent: ${delegation.agentId}`);
                console.log(`     Success: ${delegation.success}`);
                console.log(`     Duration: ${delegation.duration}ms`);
            });
        }

    } catch (error) {
        console.error('\n❌ Error during test:', error);
        if (error instanceof Error) {
            console.error('Stack:', error.stack);
        }
    }

    console.log('\n🏁 Test completed');
    process.exit(0);
}

// Run test
testAssignTask().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});