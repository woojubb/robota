/**
 * Team Collaboration Example
 * 
 * Demonstrates multi-agent teamwork with @robota-sdk/team
 * This example shows how a Team agent coordinates temporary agents
 * for complex tasks using the delegateWork tool.
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Utility function for demo output
function logSection(title: string) {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.blue.bold(`📋 ${title}`));
    console.log(chalk.blue('='.repeat(60)));
}

function logResult(label: string, content: string) {
    console.log(chalk.yellow(`\n${label}:`));
    console.log(chalk.white(content));
}

async function runTeamCollaborationExample() {
    try {
        logSection('Team Collaboration Demo');

        console.log(chalk.cyan(`
🎯 Architecture:
User Command → Team Agent → (delegateWork if needed) → Team Members → Final Response

📋 This demo shows:
• Simple tasks handled directly by the team agent
• Complex tasks delegated to specialized team members
        `));

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client and provider
        const openaiClient = new OpenAI({ apiKey });
        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4'
        });

        // Create team
        console.log(chalk.green('✅ Creating team with OpenAI GPT-4 provider...'));

        const team = createTeam({
            baseRobotaOptions: {
                aiProviders: { openai: openaiProvider },
                currentProvider: 'openai',
                currentModel: 'gpt-4',
                temperature: 0.7,
                maxTokens: 1500
            },
            maxMembers: 3,
            debug: true
        });

        // Example 1: Simple task (handled directly)
        logSection('Example 1: Simple Task (Direct Handling)');

        const simpleTask = 'What are the main benefits of using TypeScript in web development? Please provide 3 key points.';

        console.log(chalk.yellow(`User: ${simpleTask}`));
        console.log(chalk.blue('🤖 Team processing...'));

        const simpleResult = await team.execute(simpleTask);
        logResult('Team Response', simpleResult);

        // Example 2: Complex task (delegation required)
        logSection('Example 2: Complex Task (Team Coordination)');

        const complexTask = 'Create a brief business plan for a food delivery app. I need both a market analysis section and a technical architecture section.';

        console.log(chalk.yellow(`User: ${complexTask}`));
        console.log(chalk.blue('🤖 Team coordinating with specialists...'));

        const complexResult = await team.execute(complexTask);
        logResult('Team Response', complexResult);

        // Show final stats
        logSection('Team Performance Summary');

        const stats = team.getStats();
        console.log(chalk.blue(`
📈 Results:
• Tasks completed: ${stats.tasksCompleted}
• Total agents created: ${stats.totalAgentsCreated}
• Total execution time: ${stats.totalExecutionTime}ms
• Average time per task: ${Math.round(stats.totalExecutionTime / stats.tasksCompleted)}ms
        `));

        console.log(chalk.green('\n✅ Team collaboration demo completed successfully!'));
        console.log(chalk.cyan('The team agent intelligently decides when to delegate vs handle directly.'));

    } catch (error) {
        console.error(chalk.red('\n❌ Demo failed:'), error);
        process.exit(1);
    }
}

// Run the example
async function main() {
    await runTeamCollaborationExample();
    process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(chalk.red('❌ Error:'), error);
        process.exit(1);
    });
} 