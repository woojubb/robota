/**
 * 팀 협업 예제 (한국어)
 * 
 * @robota-sdk/team을 사용한 멀티 에이전트 팀워크 데모
 * Team 에이전트가 delegateWork 도구를 사용해서 
 * 복잡한 작업을 위해 임시 에이전트들을 조정하는 방법을 보여줍니다.
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

// 데모 출력을 위한 유틸리티 함수
function logSection(title: string) {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.blue.bold(`📋 ${title}`));
    console.log(chalk.blue('='.repeat(60)));
}

function logResult(label: string, content: string) {
    console.log(chalk.yellow(`\n${label}:`));
    console.log(chalk.white(content));
}

async function runKoreanTeamExample() {
    try {
        logSection('팀 협업 데모 (한국어)');

        console.log(chalk.cyan(`
🎯 아키텍처:
사용자 명령 → 팀 에이전트 → (필요시 delegateWork) → 팀 멤버들 → 최종 응답

📋 이 데모는 다음을 보여줍니다:
• 간단한 작업은 팀 에이전트가 직접 처리
• 복잡한 작업은 전문 팀 멤버들에게 위임
        `));

        // API 키 검증
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
        }

        // 예제 1: 간단한 작업 (직접 처리)
        logSection('예제 1: 간단한 작업 (직접 처리)');

        // 예제 1용 OpenAI 클라이언트와 제공자 생성
        const openaiClient1 = new OpenAI({ apiKey });
        const openaiProvider1 = new OpenAIProvider({
            client: openaiClient1,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,  // 페이로드 로깅 활성화
            payloadLogDir: './logs/team-collaboration-ko/example1',
            includeTimestampInLogFiles: true
        });

        // 예제 1용 팀 생성
        console.log(chalk.green('✅ 예제 1용 팀을 생성하고 있습니다...'));

        const team1 = createTeam({
            baseRobotaOptions: {
                aiProviders: { openai: openaiProvider1 },
                currentProvider: 'openai',
                currentModel: 'gpt-4o-mini',
                temperature: 0.7,
                maxTokens: 16000,
                maxTokenLimit: 50000,  // 전체 대화 토큰 제한 증가
                systemPrompt: 'You are a team coordinator that manages collaborative work.',
                logger: console
            },
            maxMembers: 5,
            debug: false
        });

        const simpleTask = 'React와 Vue.js의 주요 차이점 3가지를 간단히 알려주세요.';

        console.log(chalk.yellow(`사용자: ${simpleTask}`));
        console.log(chalk.blue('🤖 팀이 처리중입니다...'));

        const simpleResult = await team1.execute(simpleTask);
        logResult('팀 응답', simpleResult);

        console.log('✅ 예제 1 완료!\n');

        // 예제 2: 복잡한 작업 (팀 협업)
        logSection('예제 2: 복잡한 작업 (팀 협업)');

        // 예제 2용 OpenAI 클라이언트와 제공자 생성 (완전히 새로운 인스턴스)
        const openaiClient2 = new OpenAI({ apiKey });
        const openaiProvider2 = new OpenAIProvider({
            client: openaiClient2,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,  // 페이로드 로깅 활성화
            payloadLogDir: './logs/team-collaboration-ko/example2',
            includeTimestampInLogFiles: true
        });

        // 예제 2용 팀 생성 (완전히 새로운 팀)
        console.log(chalk.green('✅ 예제 2용 새로운 팀을 생성하고 있습니다...'));

        const team2 = createTeam({
            baseRobotaOptions: {
                aiProviders: { openai: openaiProvider2 },
                currentProvider: 'openai',
                currentModel: 'gpt-4o-mini',
                temperature: 0.7,
                maxTokens: 16000,
                maxTokenLimit: 50000,  // 전체 대화 토큰 제한 증가
                systemPrompt: 'You are a team coordinator that manages collaborative work.',
                logger: console
            },
            maxMembers: 5,
            debug: false
        });

        const complexTask = '카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 1) 시장 분석, 2) 메뉴 구성. 각각을 별도로 작성해주세요.';

        console.log(chalk.yellow(`사용자: ${complexTask}`));
        console.log(chalk.blue('🤖 팀이 전문가들과 협업중입니다...'));

        const complexResult = await team2.execute(complexTask);
        logResult('팀 응답', complexResult);

        // 최종 통계 표시 (두 팀의 통계 합산)
        logSection('팀 성능 요약');

        const stats1 = team1.getStats();
        const stats2 = team2.getStats();

        console.log(chalk.blue(`
📈 예제 1 결과:
• 완료된 작업: ${stats1.tasksCompleted}개
• 생성된 에이전트: ${stats1.totalAgentsCreated}개
• 실행 시간: ${stats1.totalExecutionTime}ms

📈 예제 2 결과:
• 완료된 작업: ${stats2.tasksCompleted}개
• 생성된 에이전트: ${stats2.totalAgentsCreated}개
• 실행 시간: ${stats2.totalExecutionTime}ms

📊 전체 요약:
• 총 완료된 작업: ${stats1.tasksCompleted + stats2.tasksCompleted}개
• 총 생성된 에이전트: ${stats1.totalAgentsCreated + stats2.totalAgentsCreated}개
• 총 실행 시간: ${stats1.totalExecutionTime + stats2.totalExecutionTime}ms
        `));

        console.log(chalk.green('\n✅ 팀 협업 데모가 성공적으로 완료되었습니다!'));
        console.log(chalk.cyan('팀 에이전트가 언제 직접 처리하고 언제 위임할지를 지능적으로 판단합니다.'));

    } catch (error) {
        console.error(chalk.red('\n❌ 데모 실패:'), error);
        process.exit(1);
    }
}

// 예제 실행
async function main() {
    await runKoreanTeamExample();
    process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(chalk.red('❌ 오류:'), error);
        process.exit(1);
    });
} 