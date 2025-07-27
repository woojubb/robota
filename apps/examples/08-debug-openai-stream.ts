/**
 * OpenAI 스트림 디버깅 테스트
 * 
 * LocalExecutor가 받는 OpenAI 스트림과 동일한 조건에서
 * 도구 호출 청크들이 어떤 형태로 오는지 확인
 */

import chalk from 'chalk';
import { OpenAIProvider } from '@robota-sdk/openai';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

function logSection(title: string) {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.blue.bold(`📋 ${title}`));
    console.log(chalk.blue('='.repeat(60)));
}

async function debugOpenAIStream() {
    try {
        logSection('OpenAI 스트림 디버깅 테스트');

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // OpenAI 프로바이더 생성 (LocalExecutor와 동일한 설정)
        const openaiProvider = new OpenAIProvider({
            apiKey: apiKey,
            // executor를 설정하지 않으면 네이티브 OpenAI 스트림 사용
        });

        const messages = [
            { role: 'user', content: '카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 시장 분석, 메뉴 구성. 각각을 별도로 작성해주세요.' }
        ];

        // assignTask 도구 정의 (팀에서 사용하는 것과 동일)
        const tools = [{
            type: 'function',
            function: {
                name: 'assignTask',
                description: '새로운 작업을 전문 에이전트에게 할당합니다.',
                parameters: {
                    type: 'object',
                    properties: {
                        jobDescription: {
                            type: 'string',
                            description: '에이전트가 수행할 작업에 대한 명확한 설명'
                        },
                        context: {
                            type: 'string',
                            description: '작업 수행에 필요한 추가 컨텍스트나 요구사항'
                        },
                        priority: {
                            type: 'string',
                            enum: ['low', 'medium', 'high', 'urgent'],
                            description: '작업의 우선순위'
                        },
                        agentTemplate: {
                            type: 'string',
                            enum: ['task_coordinator', 'domain_researcher', 'creative_ideator', 'technical_specialist', 'quality_reviewer'],
                            description: '작업에 적합한 에이전트 템플릿'
                        }
                    },
                    required: ['jobDescription', 'context', 'priority', 'agentTemplate']
                }
            }
        }];

        console.log(chalk.cyan('🔌 OpenAI chatStream 시작...'));

        const stream = openaiProvider.chatStream(messages as any, {
            model: 'gpt-4o-mini',
            tools: tools as any
        });

        let chunkCount = 0;
        let toolCallChunks = 0;
        let contentChunks = 0;

        console.log(chalk.yellow('📊 스트림 청크 분석 시작...'));

        for await (const chunk of stream) {
            chunkCount++;

            const assistantChunk = chunk as any; // Type assertion for debugging
            console.log(chalk.magenta(`\n🔍 [CHUNK ${chunkCount}]:`), {
                role: chunk.role,
                content: chunk.content?.substring(0, 50) + (chunk.content && chunk.content.length > 50 ? '...' : ''),
                hasToolCalls: !!assistantChunk.toolCalls,
                toolCallsLength: assistantChunk.toolCalls?.length || 0
            });

            if (assistantChunk.toolCalls && assistantChunk.toolCalls.length > 0) {
                toolCallChunks++;
                console.log(chalk.green(`   🔧 [TOOL-CALLS]:`, assistantChunk.toolCalls));
            }

            if (chunk.content && chunk.content.trim() !== '') {
                contentChunks++;
            }
        }

        console.log(chalk.yellow('\n📊 스트림 분석 완료:'));
        console.log(chalk.yellow(`• 총 청크: ${chunkCount}`));
        console.log(chalk.yellow(`• 도구 호출 청크: ${toolCallChunks}`));
        console.log(chalk.yellow(`• 컨텐츠 청크: ${contentChunks}`));

    } catch (error) {
        console.log(chalk.red('❌ 테스트 실행 중 오류 발생:'));
        console.error(error);
    }
}

// 테스트 실행
debugOpenAIStream(); 