/**
 * Team Collaboration Example (English)
 * 
 * Multi-agent team collaboration demo using @robota-sdk/team
 * Shows how team agents handle complex tasks through intelligent delegation
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import dotenv from 'dotenv';
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

        // Create providers for example 1
        const openaiProvider1 = new OpenAIProvider({
            apiKey,
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-collaboration-en/example1',
            includeTimestampInLogFiles: true
        });

        const anthropicProvider1 = new AnthropicProvider({
            apiKey: anthropicApiKey
        });

        // Debug EventService for testing
        class DebugEventService {
            constructor() {
                console.log(chalk.magenta.bold('🔧 DebugEventService CREATED'));
            }

            emit(eventType: string, data: any): void {
                console.log(chalk.green.bold(`🎯 EVENT: ${eventType}`));
                console.log(chalk.cyan(`   Source: ${data.sourceType}:${data.sourceId}`));
                console.log(chalk.gray(`   Time: ${new Date().toISOString()}`));
                console.log(chalk.gray('   ---'));
            }
        }

        // Create team for example 1 (using simplified API)
        console.log(chalk.green('✅ Creating team for example 1...'));

        const debugEventService = new DebugEventService();
        console.log(chalk.blue(`🔧 About to inject DebugEventService:`, debugEventService));

        const team1 = createTeam({
            aiProviders: [openaiProvider1, anthropicProvider1],
            maxMembers: 5,
            maxTokenLimit: 8000,
            logger: console,
            debug: false,
            eventService: debugEventService as any // Add EventService for testing
        });

        console.log(chalk.blue(`🔧 Team created. Let's test simple task...`));

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

        // Create providers for example 2 (completely new instances)
        const openaiProvider2 = new OpenAIProvider({
            apiKey
        });

        const anthropicProvider2 = new AnthropicProvider({
            apiKey: anthropicApiKey
        });

        // Create team for example 2 (using simplified API, completely new team)
        const debugEventService2 = new DebugEventService();
        console.log(chalk.blue(`🔧 About to inject DebugEventService2:`, debugEventService2));

        const team2 = createTeam({
            aiProviders: [openaiProvider2, anthropicProvider2],
            maxMembers: 5,
            maxTokenLimit: 8000,
            logger: console,
            debug: false,
            eventService: debugEventService2 as any // Add EventService for testing
        });

        console.log(chalk.blue(`🔧 Team2 created. Let's test complex task...`));

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

        // 🎯 Extract actual generated workflow data
        console.log(chalk.yellow('\n📊 Extracting actual generated workflow data...'));

        // Try to extract workflow data from the event service
        // Note: This is a simplified approach - we'll get whatever workflow data was generated
        // 📊 Extracting actual generated workflow data...
        console.log(chalk.blue(`\n📊 Extracting real workflow data from NodeEdgeManager...`));

        // Get real workflow data from team2's WorkflowEventSubscriber
        const team2Subscriber = team2.getWorkflowSubscriber();
        if (!team2Subscriber) {
            throw new Error('❌ No WorkflowEventSubscriber found in team2');
        }

        // Extract nodes and edges from NodeEdgeManager
        const nodeManager = team2Subscriber['nodeEdgeManager']; // Access through property
        if (!nodeManager) {
            throw new Error('❌ No NodeEdgeManager found in WorkflowEventSubscriber');
        }

        const exportedData = nodeManager.exportForJSON();
        const workflowData = {
            metadata: {
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                metrics: {
                    totalNodes: exportedData.nodes.length,
                    totalEdges: exportedData.edges.length
                },
                testType: "team-collaboration-real-data",
                sourceExample: "05-team-collaboration.ts"
            },
            nodes: exportedData.nodes,
            edges: exportedData.edges
        };

        console.log(chalk.blue(`📋 Generated workflow data: ${exportedData.nodes.length} nodes, ${exportedData.edges.length} edges`));

        // Note: For now, save placeholder data - the actual workflow data  
        // will be captured by the WorkflowEventSubscriber during execution

        // Save to JSON file in data directory
        const outputPath = path.join(__dirname, 'data/real-workflow-data.json');
        fs.writeFileSync(outputPath, JSON.stringify(workflowData, null, 2));

        console.log(chalk.green(`\n💾 Actual workflow data saved to: ${outputPath}`));
        console.log(chalk.cyan('This data can be verified using the workflow validation script.'));

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