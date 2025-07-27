/**
 * EventService Team Collaboration Test
 * 
 * Tests EventService integration with complex team tasks (assignTask delegation)
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Debug EventService that logs everything
class DebugEventService {
    constructor() {
        console.log(chalk.magenta.bold('🔧 DebugEventService CREATED'));
    }

    emit(eventType: string, data: any): void {
        console.log(chalk.green.bold(`🎯 EVENT: ${eventType}`));
        console.log(chalk.cyan(`   Source: ${data.sourceType}:${data.sourceId}`));
        console.log(chalk.gray(`   Time: ${new Date().toISOString()}`));
        console.log(chalk.gray(`   Meta:`, JSON.stringify(data.metadata || {}, null, 2)));
        console.log(chalk.gray('   ---'));
    }
}

async function testEventServiceWithTeam() {
    try {
        console.log(chalk.blue.bold('\n🧪 EventService Team Collaboration Test'));

        // Environment validation
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }
        if (!anthropicApiKey) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required');
        }

        // Create providers
        console.log(chalk.yellow('\n1. Creating AI providers...'));
        const openaiProvider = new OpenAIProvider({
            apiKey: openaiApiKey,
            enablePayloadLogging: true,
            payloadLogDir: './logs/eventservice-test',
            includeTimestampInLogFiles: true
        });

        const anthropicProvider = new AnthropicProvider({
            apiKey: anthropicApiKey
        });

        // Create debug EventService
        console.log(chalk.yellow('\n2. Creating EventService...'));
        const debugEventService = new DebugEventService();
        console.log(chalk.blue(`🔧 EventService created:`, debugEventService));

        // Create team with EventService
        console.log(chalk.yellow('\n3. Creating team with EventService...'));
        const team = createTeam({
            aiProviders: [openaiProvider, anthropicProvider],
            maxMembers: 3,
            maxTokenLimit: 8000,
            logger: console,
            debug: false,
            eventService: debugEventService as any
        });

        console.log(chalk.green('✅ Team created with EventService'));

        // Test complex task that will trigger assignTask (delegation)
        console.log(chalk.yellow('\n4. Testing complex task that triggers team collaboration...'));

        const complexTask = `Create a brief coffee shop business plan. Include these 2 sections: 
1) Market analysis (just key points)
2) Menu suggestions (5-6 items)
Write each section separately and keep it concise.`;

        console.log(chalk.blue('User:', complexTask));
        console.log(chalk.cyan('🤖 Team is collaborating with specialists...'));

        const startTime = Date.now();
        const result = await team.execute(complexTask);
        const endTime = Date.now();

        console.log(chalk.green.bold('\n✅ Task completed!'));
        console.log(chalk.blue(`Execution time: ${endTime - startTime}ms`));

        console.log(chalk.yellow('\n📋 Result:'));
        console.log(result);

        console.log(chalk.green.bold('\n🎯 EventService test completed successfully!'));

    } catch (error) {
        console.error(chalk.red('\n💥 Test failed:'), error);
        process.exit(1);
    }
}

// Run the test
testEventServiceWithTeam()
    .then(() => {
        console.log(chalk.blue('\n🏁 EventService team test completed'));
        process.exit(0);
    })
    .catch((error) => {
        console.error(chalk.red('\n💥 Test execution failed:'), error);
        process.exit(1);
    }); 