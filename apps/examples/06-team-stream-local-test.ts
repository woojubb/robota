/**
 * 팀 스트림 모드 + LocalExecutor 테스트
 * 
 * RemoteExecutor와 비교하여 LocalExecutor에서 
 * 도구 호출이 제대로 작동하는지 확인하는 테스트
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

function logSection(title: string) {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.blue.bold(`📋 ${title}`));
    console.log(chalk.blue('='.repeat(60)));
}

async function testLocalStreamMode() {
    try {
        logSection('로컬 스트림 모드 + 도구 호출 테스트');

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
        }

        console.log(chalk.cyan(`
🎯 테스트 목적:
• LocalExecutor + Stream 모드에서 도구 호출이 정상 작동하는지 확인
• 팀 협업 시나리오에서 assignTask 호출 확인
• ToolHooks가 제대로 작동하는지 확인

🔧 설정:
• Provider: OpenAI (gpt-4o-mini)
• Mode: Stream (executeStream)
• Executor: LocalExecutor (기본값)
• ToolHooks: 활성화
        `));

        // OpenAI 클라이언트와 프로바이더 생성
        const openaiClient = new OpenAI({ apiKey });
        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini'
        });

        // 팀 생성 with ToolHooks
        console.log(chalk.green('✅ 팀 생성 중...'));

        const team = createTeam({
            aiProviders: [openaiProvider],
            maxMembers: 5,
            maxTokenLimit: 8000,
            logger: console,
            debug: true,
            toolHooks: {
                beforeExecute: async (tool, params) => {
                    console.log(chalk.magenta(`🔧 [ToolHook-BEFORE] Tool: ${tool.name}`));
                    console.log(chalk.magenta(`🔧 [ToolHook-BEFORE] Params:`, JSON.stringify(params, null, 2)));
                },
                afterExecute: async (tool, params, result) => {
                    console.log(chalk.green(`✅ [ToolHook-AFTER] Tool: ${tool.name} completed`));
                    console.log(chalk.green(`✅ [ToolHook-AFTER] Result preview:`,
                        typeof result === 'string' ? result.substring(0, 100) + '...' : JSON.stringify(result).substring(0, 100) + '...'));
                },
                onError: async (tool, params, error) => {
                    console.log(chalk.red(`❌ [ToolHook-ERROR] Tool: ${tool.name} failed`));
                    console.log(chalk.red(`❌ [ToolHook-ERROR] Error:`, error.message));
                }
            }
        });

        // 테스트 1: 단순 프롬프트 (도구 호출 없음)
        logSection('테스트 1: 단순 프롬프트 (도구 호출 없음)');

        const simplePrompt = '안녕하세요! 오늘 날씨가 좋네요.';
        console.log(chalk.yellow(`사용자: ${simplePrompt}`));
        console.log(chalk.blue('🤖 팀 처리 중 (스트림 모드)...'));

        let streamResult1 = '';
        for await (const chunk of team.executeStream(simplePrompt)) {
            process.stdout.write(chalk.white(chunk));
            streamResult1 += chunk;
        }

        console.log(chalk.cyan('\n✅ 테스트 1 완료 - 단순 프롬프트 정상 처리됨\n'));

        // 테스트 2: 복잡한 프롬프트 (도구 호출 필요)
        logSection('테스트 2: 복잡한 프롬프트 (도구 호출 필요)');

        const complexPrompt = `카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 시장 분석, 메뉴 구성. 각각을 별도로 작성해주세요.`;
        console.log(chalk.yellow(`사용자: ${complexPrompt}`));
        console.log(chalk.blue('🤖 팀 처리 중 (스트림 모드, 도구 호출 예상)...'));

        let streamResult2 = '';
        let toolCallsDetected = 0;

        // executeStream에서 도구 호출 감지
        for await (const chunk of team.executeStream(complexPrompt)) {
            process.stdout.write(chalk.white(chunk));
            streamResult2 += chunk;

            // assignTask나 다른 도구 호출 관련 텍스트 감지
            if (chunk.includes('assignTask') || chunk.includes('시장 분석') || chunk.includes('메뉴 구성')) {
                toolCallsDetected++;
            }
        }

        console.log(chalk.cyan(`\n✅ 테스트 2 완료`));
        console.log(chalk.cyan(`📊 도구 호출 관련 청크 감지: ${toolCallsDetected}개`));

        // 최종 통계
        logSection('테스트 결과 요약');

        const stats = team.getStats();
        console.log(chalk.blue(`
📈 실행 통계:
• 완료된 작업: ${stats.tasksCompleted}
• 총 생성된 에이전트: ${stats.totalAgentsCreated}
• 총 실행 시간: ${stats.totalExecutionTime}ms

🔍 분석:
• 테스트 1 결과 길이: ${streamResult1.length} 문자
• 테스트 2 결과 길이: ${streamResult2.length} 문자
• 도구 호출 감지 여부: ${toolCallsDetected > 0 ? '✅ 감지됨' : '❌ 감지 안됨'}
        `));

        if (stats.totalAgentsCreated > 1) {
            console.log(chalk.green('✅ 팀 협업 (assignTask) 정상 작동 - 추가 에이전트 생성됨!'));
        } else {
            console.log(chalk.yellow('⚠️  팀 협업 미발생 - 모든 작업이 메인 에이전트에서 처리됨'));
        }

        console.log(chalk.green('\n🎉 로컬 스트림 모드 테스트 완료!'));

        return {
            simpleWorked: streamResult1.length > 0,
            complexWorked: streamResult2.length > 0,
            toolCallsDetected: toolCallsDetected > 0,
            agentsCreated: stats.totalAgentsCreated,
            success: true
        };

    } catch (error) {
        console.error(chalk.red('\n❌ 테스트 실패:'), error);
        return {
            simpleWorked: false,
            complexWorked: false,
            toolCallsDetected: false,
            agentsCreated: 0,
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

// 테스트 실행
async function main() {
    const result = await testLocalStreamMode();

    console.log(chalk.blue('\n' + '='.repeat(60)));
    console.log(chalk.blue.bold('📋 최종 테스트 결과'));
    console.log(chalk.blue('='.repeat(60)));

    if (result.success) {
        console.log(chalk.green('✅ 전체 테스트 성공'));
        console.log(chalk.white(`• 단순 프롬프트: ${result.simpleWorked ? '✅' : '❌'}`));
        console.log(chalk.white(`• 복잡 프롬프트: ${result.complexWorked ? '✅' : '❌'}`));
        console.log(chalk.white(`• 도구 호출 감지: ${result.toolCallsDetected ? '✅' : '❌'}`));
        console.log(chalk.white(`• 생성된 에이전트: ${result.agentsCreated}개`));

        if (result.toolCallsDetected && result.agentsCreated > 1) {
            console.log(chalk.green('\n🎯 결론: LocalExecutor + Stream 모드에서 도구 호출 정상 작동!'));
        } else {
            console.log(chalk.yellow('\n⚠️  결론: 도구 호출이 예상대로 작동하지 않음'));
        }
    } else {
        console.log(chalk.red('❌ 테스트 실패'));
        console.log(chalk.red(`오류: ${result.error}`));
    }

    process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
    console.error(chalk.red('❌ 실행 오류:'), error);
    process.exit(1);
}); 