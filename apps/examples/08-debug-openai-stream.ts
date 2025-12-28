/**
 * 08-debug-openai-stream.ts
 *
 * OpenAI streaming debug example.
 * Inspects streaming chunks and tool-call fragments as produced by OpenAIProvider.
 */

import chalk from 'chalk';
import { OpenAIProvider } from '@robota-sdk/openai';
import type { IAssistantMessage, IToolSchema, TUniversalMessage } from '@robota-sdk/agents';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

function logSection(title: string) {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.blue.bold(`📋 ${title}`));
    console.log(chalk.blue('='.repeat(60)));
}

async function debugOpenAIStream() {
    try {
        logSection('OpenAI streaming debug');

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI provider (no custom executor => direct OpenAI streaming)
        const openaiProvider = new OpenAIProvider({
            apiKey: apiKey,
        });

        const messages: TUniversalMessage[] = [
            {
                role: 'user',
                content: 'Write a cafe launch plan with two sections: market analysis and menu outline.',
                timestamp: new Date()
            }
        ];

        // Tool schemas must use the canonical IToolSchema shape (not OpenAI's raw tool format).
        const tools: IToolSchema[] = [
            {
                name: 'assignTask',
                description: 'Assign a new task to a specialized agent.',
                parameters: {
                    type: 'object',
                    properties: {
                        jobDescription: {
                            type: 'string',
                            description: 'Clear description of the task for the agent to execute.'
                        },
                        context: {
                            type: 'string',
                            description: 'Additional context or constraints for the task.'
                        },
                        priority: {
                            type: 'string',
                            enum: ['low', 'medium', 'high', 'urgent'],
                            description: 'Task priority.'
                        },
                        agentTemplate: {
                            type: 'string',
                            enum: ['task_coordinator', 'domain_researcher', 'creative_ideator', 'technical_specialist', 'quality_reviewer'],
                            description: 'Agent template best suited for the task.'
                        }
                    },
                    required: ['jobDescription', 'context', 'priority', 'agentTemplate']
                }
            }
        ];

        console.log(chalk.cyan('🔌 Starting OpenAI chatStream...'));

        const stream = openaiProvider.chatStream(messages, {
            model: 'gpt-4o-mini',
            tools
        });

        let chunkCount = 0;
        let toolCallChunks = 0;
        let contentChunks = 0;

        console.log(chalk.yellow('📊 Analyzing stream chunks...'));

        for await (const chunk of stream) {
            chunkCount++;

            const assistantChunk = chunk as IAssistantMessage;
            console.log(chalk.magenta(`\n🔍 [CHUNK ${chunkCount}]:`), {
                role: chunk.role,
                content: chunk.content?.substring(0, 50) + (chunk.content && chunk.content.length > 50 ? '...' : ''),
                hasToolCalls: !!assistantChunk.toolCalls,
                toolCallsLength: assistantChunk.toolCalls?.length || 0
            });

            if (assistantChunk.toolCalls && assistantChunk.toolCalls.length > 0) {
                toolCallChunks++;
                console.log(chalk.green(`   🔧 [TOOL-CALLS]:`), assistantChunk.toolCalls);
            }

            if (chunk.content && chunk.content.trim() !== '') {
                contentChunks++;
            }
        }

        console.log(chalk.yellow('\n📊 Stream analysis complete:'));
        console.log(chalk.yellow(`• Total chunks: ${chunkCount}`));
        console.log(chalk.yellow(`• Tool-call chunks: ${toolCallChunks}`));
        console.log(chalk.yellow(`• Content chunks: ${contentChunks}`));

    } catch (error) {
        console.log(chalk.red('❌ Error while running stream debug:'));
        console.error(error);
        process.exitCode = 1;
    }
}

// Run
void debugOpenAIStream();