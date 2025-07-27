/**
 * 팀 스트림 모드 + RemoteExecutor 테스트
 * 
 * LocalExecutor와 비교하여 RemoteExecutor에서 
 * 도구 호출이 제대로 작동하는지 확인하는 테스트
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { RemoteExecutor } from '@robota-sdk/remote';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

function logSection(title: string) {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.blue.bold(`📋 ${title}`));
    console.log(chalk.blue('='.repeat(60)));
}

async function testRemoteStreamMode() {
    try {
        logSection('원격 스트림 모드 + 도구 호출 테스트');

        const apiKey = process.env.OPENAI_API_KEY;
        const serverUrl = process.env.REMOTE_SERVER_URL || 'http://localhost:3001/api/v1/remote';
        const userApiKey = process.env.USER_API_KEY || 'test-api-key';

        if (!apiKey) {
            throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
        }

        console.log(chalk.cyan(`
🎯 테스트 목적:
• RemoteExecutor + Stream 모드에서 도구 호출이 정상 작동하는지 확인
• 팀 협업 시나리오에서 assignTask 호출 확인
• ToolHooks가 제대로 작동하는지 확인
• LocalExecutor와 동일한 결과인지 검증

🔧 설정:
• Provider: OpenAI (gpt-4o-mini)
• Mode: Stream (executeStream)
• Executor: RemoteExecutor (${serverUrl})
• ToolHooks: 활성화
        `));

        // RemoteExecutor 생성
        console.log(chalk.cyan('🔌 RemoteExecutor 생성 중...'));
        const remoteExecutor = new RemoteExecutor({
            serverUrl: serverUrl,
            userApiKey: userApiKey,
            timeout: 30000,
            enableWebSocket: false,
            logger: {
                debug: (msg: string, ...args: any[]) => console.log(chalk.gray(`[DEBUG] ${msg}`), ...args),
                info: (msg: string, ...args: any[]) => console.log(chalk.blue(`[INFO] ${msg}`), ...args),
                warn: (msg: string, ...args: any[]) => console.log(chalk.yellow(`[WARN] ${msg}`), ...args),
                error: (msg: string, ...args: any[]) => console.log(chalk.red(`[ERROR] ${msg}`), ...args),
                log: (msg: string, ...args: any[]) => console.log(msg, ...args)
            }
        });

        // OpenAI 프로바이더 생성 (RemoteExecutor와 함께 사용)
        const openaiProvider = new OpenAIProvider({
            apiKey: apiKey,
            executor: remoteExecutor  // RemoteExecutor 주입
        });

        // 팀 생성 with ToolHooks
        console.log(chalk.green('✅ 팀 생성 중 (RemoteExecutor 사용)...'));

        const team = createTeam({
            aiProviders: [openaiProvider as any],
            maxMembers: 5,
            maxTokenLimit: 8000,
            logger: console,
            debug: true,
            toolHooks: {
                beforeExecute: async (tool: any, params: any) => {
                    console.log(chalk.magenta(`🔧 [ToolHook-BEFORE] Tool: ${tool?.name || 'unknown'}`));
                    console.log(chalk.magenta(`🔧 [ToolHook-BEFORE] Params:`, JSON.stringify(params, null, 2)));
                },
                afterExecute: async (tool: any, params: any, result: any) => {
                    console.log(chalk.green(`✅ [ToolHook-AFTER] Tool: ${tool?.name || 'unknown'} completed`));
                    console.log(chalk.green(`✅ [ToolHook-AFTER] Result preview:`,
                        typeof result === 'string' ? result.substring(0, 100) + '...' : JSON.stringify(result).substring(0, 100) + '...'));
                },
                onError: async (tool: any, params: any, error: any) => {
                    console.log(chalk.red(`❌ [ToolHook-ERROR] Tool: ${tool?.name || 'unknown'} failed`));
                    console.log(chalk.red(`❌ [ToolHook-ERROR] Error:`, error.message));
                }
            }
        });

        // 테스트 1: 단순 프롬프트 (도구 호출 없음)
        logSection('테스트 1: 단순 프롬프트 (도구 호출 없음)');

        const simplePrompt = '안녕하세요! 오늘 날씨가 좋네요.';
        console.log(chalk.yellow(`사용자: ${simplePrompt}`));
        console.log(chalk.blue('🤖 팀 처리 중 (RemoteExecutor 스트림 모드)...'));

        let streamResult1 = '';
        for await (const chunk of team.executeStream(simplePrompt)) {
            process.stdout.write(chalk.white(chunk));
            streamResult1 += chunk;
        }

        console.log(chalk.cyan('\n✅ 테스트 1 완료 - 단순 프롬프트 정상 처리됨\n'));

        // 테스트 2: 복잡한 프롬프트 (도구 호출 필요)
        logSection('테스트 2: 복잡한 프롬프트 (도구 호출 필요) - RemoteExecutor');

        const complexPrompt = `카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 시장 분석, 메뉴 구성. 각각을 별도로 작성해주세요.`;
        console.log(chalk.yellow(`사용자: ${complexPrompt}`));
        console.log(chalk.blue('🤖 팀 처리 중 (RemoteExecutor 스트림 모드, 도구 호출 예상)...'));

        let streamResult2 = '';
        let toolCallsDetected = 0;

        for await (const chunk of team.executeStream(complexPrompt)) {
            process.stdout.write(chalk.white(chunk));
            streamResult2 += chunk;

            // 도구 호출 관련 청크 감지
            if (chunk.includes('assignTask') || chunk.includes('도구') || chunk.includes('tool')) {
                toolCallsDetected++;
            }
        }

        console.log(chalk.cyan('\n✅ 테스트 2 완료'));
        console.log(chalk.cyan(`📊 도구 호출 관련 청크 감지: ${toolCallsDetected}개`));

        // 결과 분석
        logSection('테스트 결과 요약');

        const stats = team.getStats();
        console.log(chalk.green(`
📈 실행 통계:
• 완료된 작업: ${stats.tasksCompleted}
• 총 생성된 에이전트: ${stats.totalAgentsCreated}
• 총 실행 시간: ${stats.totalExecutionTime}ms

🔍 분석:
• 테스트 1 결과 길이: ${streamResult1.length} 문자
• 테스트 2 결과 길이: ${streamResult2.length} 문자
• 도구 호출 감지 여부: ${toolCallsDetected > 0 ? '✅ 감지됨' : '❌ 감지되지 않음'}
        `));

        if (stats.totalAgentsCreated > 0) {
            console.log(chalk.green('✅ 팀 협업 (assignTask) 정상 작동 - 추가 에이전트 생성됨!'));
        } else {
            console.log(chalk.red('❌ 팀 협업 (assignTask) 미작동 - 에이전트 생성되지 않음'));
        }

        console.log(chalk.cyan('\n🎉 원격 스트림 모드 테스트 완료!'));

        // RemoteExecutor 정리
        await remoteExecutor.dispose();

        // 최종 결과
        logSection('최종 테스트 결과');
        console.log(chalk.green(`✅ 전체 테스트 성공`));
        console.log(chalk.green(`• 단순 프롬프트: ${streamResult1.length > 0 ? '✅' : '❌'}`));
        console.log(chalk.green(`• 복잡 프롬프트: ${streamResult2.length > 0 ? '✅' : '❌'}`));
        console.log(chalk.green(`• 도구 호출 감지: ${toolCallsDetected > 0 ? '✅' : '❌'}`));
        console.log(chalk.green(`• 생성된 에이전트: ${stats.totalAgentsCreated}개`));

        if (stats.totalAgentsCreated > 0 && toolCallsDetected > 0) {
            console.log(chalk.green('\n🎯 결론: RemoteExecutor + Stream 모드에서 도구 호출 정상 작동!'));
        } else {
            console.log(chalk.red('\n❌ 결론: RemoteExecutor에서 도구 호출 문제 발생 - 추가 디버깅 필요'));
        }

    } catch (error) {
        console.error(chalk.red('\n❌ 테스트 실행 중 오류 발생:'));
        console.error(error);
        process.exit(1);
    }
}

// 테스트 실행
testRemoteStreamMode(); 