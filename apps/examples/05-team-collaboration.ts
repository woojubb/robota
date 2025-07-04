/**
 * Team Collaboration Example (English)
 * 
 * Multi-agent team collaboration demo using @robota-sdk/team
 * Shows how team agents handle complex tasks through intelligent delegation
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '@robota-sdk/anthropic';

// Load environment variables
dotenv.config();

// Utility functions
function logSection(title: string) {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.blue.bold(`📋 ${title}`));
    console.log(chalk.blue('='.repeat(60)));
}

function logResult(label: string, content: string) {
    console.log(chalk.yellow(`\n${label}:`));
    console.log(chalk.white(content));
}

async function runTeamExample() {
    try {
        logSection('Team Collaboration Demo (English)');

        console.log(chalk.cyan(`
🎯 Architecture:
User Command → Team Agent → (Delegate when needed) → Team Members → Final Response

📋 What this demo shows:
• Simple tasks are handled directly by the team agent
• Complex tasks are delegated to specialized team members
• Performance statistics and analysis

🚀 Simplified API:
This example uses the new simplified createTeam API,
where the task_coordinator template automatically handles team collaboration with optimized settings.
        `));

        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        if (!anthropicApiKey) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required');
        }

        // API key validation
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Example 1: Simple task (direct handling)
        logSection('Example 1: Simple Task (Direct Handling)');

        // Create OpenAI client and provider for example 1
        const openaiClient1 = new OpenAI({ apiKey });
        const openaiProvider1 = new OpenAIProvider({
            client: openaiClient1,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-collaboration-en/example1',
            includeTimestampInLogFiles: true
        });

        const anthropicClient1 = new Anthropic({ apiKey: anthropicApiKey });
        const anthropicProvider1 = new AnthropicProvider({
            client: anthropicClient1,
            model: 'claude-3-5-sonnet-20241022',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-collaboration-en/example1',
            includeTimestampInLogFiles: true
        });

        // Create team for example 1 (using simplified API)
        console.log(chalk.green('✅ Creating team for example 1...'));

        const team1 = createTeam({
            aiProviders: { openai: openaiProvider1, anthropic: anthropicProvider1 },
            maxMembers: 5,
            maxTokenLimit: 8000,
            logger: console,
            debug: false
        });

        const simpleTask = 'Please explain 3 key differences between React and Vue.js in simple terms.';

        console.log(chalk.yellow(`User: ${simpleTask}`));
        console.log(chalk.blue('🤖 Team is processing...'));

        const simpleResult = await team1.execute(simpleTask);
        logResult('Team Response', simpleResult);

        // Example 1 performance analysis
        logSection('Example 1: Performance Analysis');

        const stats1 = team1.getStats();

        console.log(chalk.blue(`
📈 Example 1 Results:
• Tasks completed: ${stats1.tasksCompleted}
• Total agents created: ${stats1.totalAgentsCreated}
• Total execution time: ${stats1.totalExecutionTime}ms
        `));

        console.log('✅ Example 1 completed!\n');

        // Example 2: Complex task (team collaboration)
        logSection('Example 2: Complex Task (Team Collaboration)');
        console.log('✅ Creating new team for example 2...');

        // Create OpenAI client and provider for example 2 (completely new instances)
        const openaiClient2 = new OpenAI({ apiKey });
        const openaiProvider2 = new OpenAIProvider({
            client: openaiClient2,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-collaboration-en/example2',
            includeTimestampInLogFiles: true
        });

        const anthropicClient2 = new Anthropic({ apiKey: anthropicApiKey });
        const anthropicProvider2 = new AnthropicProvider({
            client: anthropicClient2,
            model: 'claude-3-5-sonnet-20241022',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-collaboration-en/example2',
            includeTimestampInLogFiles: true
        });

        // Create team for example 2 (using simplified API, completely new team)
        const team2 = createTeam({
            aiProviders: { openai: openaiProvider2, anthropic: anthropicProvider2 },
            maxMembers: 5,
            maxTokenLimit: 8000,
            logger: console,
            debug: false
        });

        const complexTask = `Create a comprehensive coffee shop business plan. Please include both of the following sections: market analysis and menu development. Write each section separately.`;

        console.log(chalk.yellow(`User: ${complexTask}`));
        console.log(chalk.blue('🤖 Team is collaborating with specialists...'));

        const complexResult = await team2.execute(complexTask);
        logResult('Team Response', complexResult);

        // Example 2 performance analysis
        logSection('Example 2: Performance Analysis');

        const stats2 = team2.getStats();

        console.log(chalk.blue(`
📈 Example 2 Results:
• Tasks completed: ${stats2.tasksCompleted}
• Total agents created: ${stats2.totalAgentsCreated}
• Total execution time: ${stats2.totalExecutionTime}ms
        `));

        // Final statistics display (combined teams)
        logSection('Overall Team Performance Summary');

        console.log(chalk.blue(`
📊 Overall Summary:
• Total tasks completed: ${stats1.tasksCompleted + stats2.tasksCompleted}
• Total agents created: ${stats1.totalAgentsCreated + stats2.totalAgentsCreated}
• Total execution time: ${stats1.totalExecutionTime + stats2.totalExecutionTime}ms
        `));

        console.log(chalk.green('\n✅ Team collaboration demo completed successfully!'));
        console.log(chalk.cyan('The team agent intelligently decides whether to handle tasks directly or delegate them.'));
        console.log(chalk.cyan('For complex tasks, you can analyze how agents collaborate with each other.'));

    } catch (error) {
        console.error(chalk.red('\n❌ Demo failed:'), error);
        process.exit(1);
    }
}

// Run example
async function main() {
    await runTeamExample();
    console.log(chalk.blue('\n🧹 Cleanup completed. Exiting...'));
    process.exit(0);
}

main().catch((error) => {
    console.error(chalk.red('❌ Error:'), error);
    process.exit(1);
}); 