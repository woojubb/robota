#!/usr/bin/env tsx
/**
 * Simple assignTask Test - Minimal example to test assignTask functionality
 * Tests the assignTask tool execution in isolation
 * 
 * 🚀 Cache-enabled for cost-efficient development
 */

import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { config } from 'dotenv';
import { CacheManager } from './utils/cache-manager';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
config();

// ES module __filename equivalent
const __filename = fileURLToPath(import.meta.url);

const cacheManager = new CacheManager();
const EXAMPLE_NAME = '27-simple-assigntask-test';
const SOURCE_FILE = __filename;

async function testAssignTask() {
    console.log('🧪 Simple assignTask Test Starting...\n');

    // 🚀 Check cache first (cost-efficient development)
    const cacheKey = cacheManager.generateCacheKey(EXAMPLE_NAME, SOURCE_FILE);
    const cacheResult = cacheManager.checkCache(cacheKey);

    if (cacheResult.isValid && cacheResult.data) {
        console.log('📊 Using cached execution result for analysis:\n');

        // Analyze cached workflow data for Tool Response connections
        const cachedWorkflow = cacheResult.data.executionResult;
        console.log(`🔍 Cached workflow analysis:`);
        console.log(`- Total nodes: ${cachedWorkflow.nodes?.length || 0}`);
        console.log(`- Total edges: ${cachedWorkflow.edges?.length || 0}`);

        // Filter logs for Agent Copy and Tool Response tracking
        const agentCopyLogs = cachedWorkflow.logs?.filter(log =>
            log.includes('AGENT-COPY') || log.includes('MERGE-RESULTS') || log.includes('TOOL-RESPONSE')
        ) || [];

        if (agentCopyLogs.length > 0) {
            console.log('\n🎯 Tool Response Connection Analysis:');
            agentCopyLogs.forEach(log => console.log(`  ${log}`));
        }

        console.log('\n🏁 Cache analysis completed');
        return;
    }

    console.log('💰 Cache MISS - executing with LLM (cost incurred)');
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    const executionLogs: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args) => {
        const message = args.join(' ');
        executionLogs.push(message);
        originalConsoleLog(...args);
    };

    try {
        // Create provider with correct interface
        const openaiProvider = new OpenAIProvider({
            apiKey
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
        - agentTemplate: "general"
        - priority: "high"
        
        Just call the tool once and return the result.`;

        const startTime = Date.now();
        const result = await team.execute(prompt);
        const duration = Date.now() - startTime;

        console.log('\n✅ Team execution completed');
        console.log(`⏱️  Duration: ${duration}ms`);
        console.log('\n📊 Result:');
        console.log(result);

        // Get team stats (using correct property names)
        const stats = team.getStats();
        console.log('\n📈 Team Stats:');
        console.log(`- Tasks completed: ${stats.tasksCompleted}`);
        console.log(`- Total agents created: ${stats.totalAgentsCreated}`);
        console.log(`- Total execution time: ${stats.totalExecutionTime}ms`);

        // Get detailed team stats
        const teamStats = team.getTeamStats();
        console.log('\n📋 Detailed Team Stats:');
        console.log(`- Active agents: ${teamStats.activeAgentsCount}`);
        console.log(`- Max members: ${teamStats.maxMembers}`);
        console.log(`- Successful tasks: ${teamStats.successfulTasks}`);
        console.log(`- Failed tasks: ${teamStats.failedTasks}`);
        console.log(`- Delegation history: ${teamStats.delegationHistoryLength} entries`);

        // 💾 Save successful execution to cache
        const mockWorkflowResult = {
            nodes: [], // Would be populated by WorkflowEventSubscriber
            edges: [], // Would be populated by WorkflowEventSubscriber  
            metadata: { teamStats, duration }
        };

        cacheManager.saveToCache(cacheKey, mockWorkflowResult, executionLogs);
        console.log('\n💾 Execution result cached for future use');

    } catch (error) {
        console.error('\n❌ Error during test:', error);
        if (error instanceof Error) {
            console.error('Stack:', error.stack);
        }
    } finally {
        // Restore console.log
        console.log = originalConsoleLog;
    }

    console.log('\n🏁 Test completed');
    process.exit(0);
}

// Run test
testAssignTask().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});