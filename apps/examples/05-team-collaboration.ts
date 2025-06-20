/**
 * Team Collaboration Example
 * 
 * Demonstrates multi-agent teamwork with @robota-sdk/team
 * This example shows how a Team agent coordinates temporary agents
 * for complex tasks using the delegateWork tool and provides
 * workflow visualization for analysis.
 */

import chalk from 'chalk';
import { createTeam, generateWorkflowFlowchart, generateAgentRelationshipDiagram } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Utility functions for demo output
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
• Workflow history and agent relationship visualization
        `));

        // Validate API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Example 1: Simple task (handled directly)
        logSection('Example 1: Simple Task (Direct Handling)');

        // Create OpenAI client and provider for example 1
        const openaiClient1 = new OpenAI({ apiKey });
        const openaiProvider1 = new OpenAIProvider({
            client: openaiClient1,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,  // Enable payload logging
            payloadLogDir: './logs/team-collaboration/example1',
            includeTimestampInLogFiles: true
        });

        // Create team for example 1
        console.log(chalk.green('✅ Creating team for example 1...'));

        const team1 = createTeam({
            baseRobotaOptions: {
                aiProviders: { openai: openaiProvider1 },
                currentProvider: 'openai',
                currentModel: 'gpt-4o-mini',
                temperature: 0.7,
                maxTokens: 16000,
                maxTokenLimit: 50000,  // Increase total conversation token limit
                systemPrompt: 'You are a team coordinator that manages collaborative work.',
                logger: console
            },
            maxMembers: 5,
            debug: false
        });

        const simpleTask = 'What are the main differences between React and Vue.js? Please provide 3 key points briefly.';

        console.log(chalk.yellow(`User: ${simpleTask}`));
        console.log(chalk.blue('🤖 Team processing...'));

        const simpleResult = await team1.execute(simpleTask);
        logResult('Team Response', simpleResult);

        // Show workflow analysis for example 1
        logSection('Example 1: Workflow Analysis');

        const workflowHistory1 = team1.getWorkflowHistory();
        if (workflowHistory1) {
            console.log(chalk.magenta('🔗 Agent relationship diagram:'));
            console.log(generateAgentRelationshipDiagram(workflowHistory1));
            console.log('');

            console.log(chalk.magenta('📊 Workflow flowchart:'));
            console.log(generateWorkflowFlowchart(workflowHistory1));
        } else {
            console.log(chalk.gray('No workflow history available for analysis.'));
        }

        console.log('✅ Example 1 completed!\n');

        // Example 2: Complex task (team coordination)
        logSection('Example 2: Complex Task (Team Coordination)');

        // Create OpenAI client and provider for example 2 (completely new instance)
        const openaiClient2 = new OpenAI({ apiKey });
        const openaiProvider2 = new OpenAIProvider({
            client: openaiClient2,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,  // Enable payload logging
            payloadLogDir: './logs/team-collaboration/example2',
            includeTimestampInLogFiles: true
        });

        // Create team for example 2 (completely new team)
        console.log(chalk.green('✅ Creating new team for example 2...'));

        const team2 = createTeam({
            baseRobotaOptions: {
                aiProviders: { openai: openaiProvider2 },
                currentProvider: 'openai',
                currentModel: 'gpt-4o-mini',
                temperature: 0.7,
                maxTokens: 16000,
                maxTokenLimit: 50000,  // Increase total conversation token limit
                systemPrompt: 'You are a team coordinator that manages collaborative work.',
                logger: console
            },
            maxMembers: 5,
            debug: false
        });

        const complexTask = 'Create a cafe business plan. It must include both: 1) Market analysis, 2) Menu composition. Please write each section separately.';

        console.log(chalk.yellow(`User: ${complexTask}`));
        console.log(chalk.blue('🤖 Team coordinating with specialists...'));

        const complexResult = await team2.execute(complexTask);
        logResult('Team Response', complexResult);

        // Show workflow analysis for example 2
        logSection('Example 2: Workflow Analysis');

        const workflowHistory2 = team2.getWorkflowHistory();
        if (workflowHistory2) {
            console.log(chalk.magenta('🔗 Agent relationship diagram:'));
            console.log(generateAgentRelationshipDiagram(workflowHistory2));
            console.log('');

            console.log(chalk.magenta('📊 Workflow flowchart:'));
            console.log(generateWorkflowFlowchart(workflowHistory2));
        } else {
            console.log(chalk.gray('No workflow history available for analysis.'));
        }

        // Show final stats (combining both teams)
        logSection('Team Performance Summary');

        const stats1 = team1.getStats();
        const stats2 = team2.getStats();

        console.log(chalk.blue(`
📈 Example 1 Results:
• Tasks completed: ${stats1.tasksCompleted}
• Total agents created: ${stats1.totalAgentsCreated}
• Execution time: ${stats1.totalExecutionTime}ms

📈 Example 2 Results:
• Tasks completed: ${stats2.tasksCompleted}
• Total agents created: ${stats2.totalAgentsCreated}
• Execution time: ${stats2.totalExecutionTime}ms

📊 Overall Summary:
• Total tasks completed: ${stats1.tasksCompleted + stats2.tasksCompleted}
• Total agents created: ${stats1.totalAgentsCreated + stats2.totalAgentsCreated}
• Total execution time: ${stats1.totalExecutionTime + stats2.totalExecutionTime}ms
        `));

        console.log(chalk.green('\n✅ Team collaboration demo completed successfully!'));
        console.log(chalk.cyan('The team agent intelligently decides when to handle directly vs when to delegate.'));
        console.log(chalk.cyan('Use workflow history to analyze how agents collaborate on complex tasks.'));

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