#!/usr/bin/env tsx
/**
 * Test Real AssignTask Implementation
 * Tests the extracted assignTask functionality to ensure it creates actual agents
 */

import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { config } from 'dotenv';

// Load environment variables
config();

async function testRealAssignTask() {
    console.log('🧪 Testing Real AssignTask Implementation...\n');

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    try {
        // Create provider
        const openaiProvider = new OpenAIProvider({
            apiKey
        });

        // Create team
        console.log('1️⃣ Creating team...');
        const team = await createTeam({
            aiProviders: [openaiProvider],
            maxMembers: 5,
            maxTokenLimit: 15000,
            logger: console,
            debug: true,
        });
        console.log('✅ Team created\n');

        // Get initial stats
        const initialStats = team.getTeamStats();
        console.log('📊 Initial Team Stats:');
        console.log(`- Active agents: ${initialStats.activeAgentsCount}`);
        console.log(`- Total agents created: ${initialStats.totalAgentsCreated}`);
        console.log(`- Delegation history: ${initialStats.delegationHistoryLength} entries\n`);

        // Test with a complex prompt that requires delegation
        console.log('2️⃣ Executing complex task that requires delegation...');
        const prompt = `I need you to create a comprehensive business plan for a new coffee shop. 

This is a complex task that requires multiple areas of expertise. Please break this down and delegate specific parts to specialized agents:

1. Market analysis - delegate to a domain researcher
2. Financial projections - delegate to a general agent  
3. Marketing strategy - delegate to a creative ideator

Use the assignTask tool to delegate each of these tasks to appropriate agent templates. Make sure to:
- Use jobDescription parameter with clear, specific descriptions
- Use agentTemplate parameter to select appropriate specialists
- Use priority parameter (set to "high" for all tasks)
- Use context parameter to provide additional guidance

After delegating all tasks, synthesize the results into a final comprehensive business plan.`;

        const startTime = Date.now();
        const result = await team.execute(prompt);
        const duration = Date.now() - startTime;

        console.log('\n✅ Team execution completed');
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log('\n📊 Result (first 500 chars):');
        console.log(result.substring(0, 500) + '...');

        // Get final stats to see if agents were created
        const finalStats = team.getTeamStats();
        console.log('\n📈 Final Team Stats:');
        console.log(`- Active agents: ${finalStats.activeAgentsCount}`);
        console.log(`- Total agents created: ${finalStats.totalAgentsCreated}`);
        console.log(`- Delegation history: ${finalStats.delegationHistoryLength} entries`);

        // Get delegation history details
        const delegationHistory = team.getDelegationHistory();
        console.log('\n📋 Delegation History:');
        delegationHistory.forEach((record, index) => {
            console.log(`${index + 1}. Agent: ${record.agentId}`);
            console.log(`   Template: ${record.agentTemplate || 'dynamic'}`);
            console.log(`   Task: ${record.originalTask.substring(0, 100)}...`);
            console.log(`   Success: ${record.success}`);
            console.log(`   Duration: ${record.duration}ms\n`);
        });

        // Verify that assignTask was actually used
        if (finalStats.totalAgentsCreated > 0) {
            console.log('✅ SUCCESS: AssignTask implementation is working correctly!');
            console.log(`   - Created ${finalStats.totalAgentsCreated} agents`);
            console.log(`   - Completed ${delegationHistory.length} delegations`);
        } else {
            console.log('❌ WARNING: No agents were created. AssignTask may not have been called.');
        }

    } catch (error) {
        console.error('\n❌ Error during test:', error);
        if (error instanceof Error) {
            console.error('Stack:', error.stack);
        }
        throw error;
    }

    console.log('\n🏁 Test completed');
}

// Run test
testRealAssignTask().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
