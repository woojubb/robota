/**
 * EventService Debug Test
 * 
 * Simple test to verify EventService injection and event emission is working
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Debug EventService that logs everything
class DebugEventService {
    emit(eventType: string, data: any): void {
        console.log(chalk.green.bold(`🎯 EVENT CAPTURED: ${eventType}`));
        console.log(chalk.cyan(`   Source: ${data.sourceType}:${data.sourceId}`));
        console.log(chalk.gray(`   Data:`, JSON.stringify(data, null, 2)));
        console.log(chalk.gray('   ---'));
    }
}

async function debugEventService() {
    try {
        console.log(chalk.blue.bold('🧪 EventService Debug Test'));

        // Create debug EventService
        const debugEventService = new DebugEventService();

        console.log(chalk.yellow('\n1. Creating team with EventService...'));

        const team = createTeam({
            aiProviders: [
                new OpenAIProvider({
                    apiKey: process.env.OPENAI_API_KEY!,
                    baseURL: 'https://api.openai.com/v1'
                })
            ],
            maxMembers: 2,
            debug: true,
            eventService: debugEventService as any // Inject debug EventService
        });

        console.log(chalk.green('✅ Team created with DebugEventService'));

        console.log(chalk.yellow('\n2. Testing simple task...'));

        const result = await team.execute("What is 5 + 3? Just give me the answer.");

        console.log(chalk.blue('\nResult:', result));

        console.log(chalk.green.bold('\n✅ Test completed!'));

    } catch (error) {
        console.error(chalk.red('\n💥 Test failed:'), error);
        process.exit(1);
    }
}

// Run debug test
debugEventService()
    .then(() => {
        console.log(chalk.blue('\n🏁 Debug test completed'));
        process.exit(0);
    })
    .catch((error) => {
        console.error(chalk.red('\n💥 Debug test execution failed:'), error);
        process.exit(1);
    }); 