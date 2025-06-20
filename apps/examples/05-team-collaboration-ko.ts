/**
 * 팀 협업 예제 (한국어)
 * 
 * @robota-sdk/team을 사용한 멀티 에이전트 팀워크 데모
 * Team 에이전트가 delegateWork 도구를 사용해서 
 * 복잡한 작업을 위해 임시 에이전트들을 조정하는 방법을 보여줍니다.
 * 워크플로우 히스토리 시각화 기능도 제공합니다.
 */

import chalk from 'chalk';
import { createTeam, generateWorkflowFlowchart, generateAgentRelationshipDiagram } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '@robota-sdk/anthropic/dist';

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
• 워크플로우 히스토리 및 에이전트 관계 시각화

🚀 간소화된 API:
이 예제는 새로운 간소화된 createTeam API를 사용하여 task_coordinator
템플릿이 자동으로 최적화된 설정으로 팀 조정을 담당합니다.
        `));


        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        if (!anthropicApiKey) {
            throw new Error('ANTHROPIC_API_KEY 환경 변수가 필요합니다');
        }

        // API 키 검증
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
        }

        // 예제 1: 간단한 작업 (직접 처리)
        logSection('예제 1: 간단한 작업 (직접 처리)');

        // 예제 1용 OpenAI 클라이언트와 프로바이더 생성
        const openaiClient1 = new OpenAI({ apiKey });
        const openaiProvider1 = new OpenAIProvider({
            client: openaiClient1,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-collaboration-ko/example1',
            includeTimestampInLogFiles: true
        });

        const anthropicClient1 = new Anthropic({ apiKey: anthropicApiKey });
        const anthropicProvider1 = new AnthropicProvider({
            client: anthropicClient1,
            model: 'claude-3-5-sonnet-20241022',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-collaboration-ko/example1',
            includeTimestampInLogFiles: true
        });

        // 예제 1용 팀 생성 (간소화된 API 사용)
        console.log(chalk.green('✅ 예제 1용 팀을 생성하고 있습니다...'));

        const team1 = createTeam({
            aiProviders: { openai: openaiProvider1, anthropic: anthropicProvider1 },
            maxMembers: 5,
            maxTokenLimit: 50000,
            logger: console,
            debug: false
        });

        const simpleTask = 'React와 Vue.js의 주요 차이점 3가지를 간단히 알려주세요.';

        console.log(chalk.yellow(`사용자: ${simpleTask}`));
        console.log(chalk.blue('🤖 팀이 처리중입니다...'));

        const simpleResult = await team1.execute(simpleTask);
        logResult('팀 응답', simpleResult);

        // 예제 1 워크플로우 히스토리 표시
        logSection('예제 1: 워크플로우 분석');

        const workflowHistory1 = team1.getWorkflowHistory();
        if (workflowHistory1) {
            console.log(chalk.magenta('🔗 에이전트 관계 다이어그램:'));
            console.log(generateAgentRelationshipDiagram(workflowHistory1));
            console.log('');

            console.log(chalk.magenta('📊 워크플로우 플로우차트:'));
            console.log(generateWorkflowFlowchart(workflowHistory1));
        } else {
            console.log(chalk.gray('워크플로우 히스토리가 없습니다.'));
        }

        console.log('✅ 예제 1 완료!\n');

        // 예제 2: 복잡한 작업 (팀 협업)
        logSection('예제 2: 복잡한 작업 (팀 협업)');

        // 예제 2용 OpenAI 클라이언트와 프로바이더 생성 (완전히 새로운 인스턴스)
        const openaiClient2 = new OpenAI({ apiKey });
        const openaiProvider2 = new OpenAIProvider({
            client: openaiClient2,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-collaboration-ko/example2',
            includeTimestampInLogFiles: true
        });

        const anthropicClient2 = new Anthropic({ apiKey: anthropicApiKey });
        const anthropicProvider2 = new AnthropicProvider({
            client: anthropicClient2,
            model: 'claude-3-5-sonnet-20241022',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-collaboration-ko/example2',
            includeTimestampInLogFiles: true
        });


        // 예제 2용 팀 생성 (간소화된 API 사용, 완전히 새로운 팀)
        console.log(chalk.green('✅ 예제 2용 새로운 팀을 생성하고 있습니다...'));

        const team2 = createTeam({
            aiProviders: { openai: openaiProvider2, anthropic: anthropicProvider2 },
            maxMembers: 5,
            maxTokenLimit: 50000,
            logger: console,
            debug: false
        });

        const complexTask = '카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 1) 시장 분석, 2) 메뉴 구성. 각각을 별도로 작성해주세요.';

        console.log(chalk.yellow(`사용자: ${complexTask}`));
        console.log(chalk.blue('🤖 팀이 전문가들과 협업중입니다...'));

        const complexResult = await team2.execute(complexTask);
        logResult('팀 응답', complexResult);

        // 예제 2 워크플로우 히스토리 표시
        logSection('예제 2: 워크플로우 분석');

        const workflowHistory2 = team2.getWorkflowHistory();
        if (workflowHistory2) {
            console.log(chalk.magenta('🔗 에이전트 관계 다이어그램:'));
            console.log(generateAgentRelationshipDiagram(workflowHistory2));
            console.log('');

            console.log(chalk.magenta('📊 워크플로우 플로우차트:'));
            console.log(generateWorkflowFlowchart(workflowHistory2));
        } else {
            console.log(chalk.gray('워크플로우 히스토리가 없습니다.'));
        }

        // 최종 통계 표시 (두 팀 모두 합쳐서)
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
        console.log(chalk.cyan('워크플로우 히스토리를 통해 에이전트 간 협업 과정을 시각화할 수 있습니다.'));

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