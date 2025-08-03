/**
 * 팀 협업 예제 (한국어)
 * 
 * @robota-sdk/team을 사용한 멀티 에이전트 팀워크 데모
 * Team 에이전트가 복잡한 작업을 처리하는 방법을 보여줍니다.
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { WorkflowEventSubscriber } from '@robota-sdk/agents';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES module __dirname 설정
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 환경 변수 로드
dotenv.config();

// 유틸리티 함수들
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
사용자 명령 → Team 에이전트 → (필요시 작업 위임) → 팀 멤버들 → 최종 응답

📋 이 데모에서 보여줄 것:
• 단순한 작업은 팀 에이전트가 직접 처리
• 복잡한 작업은 전문화된 팀 멤버들에게 위임
• 성능 통계 및 분석

🚀 간소화된 API:
이 예제는 새로운 간소화된 createTeam API를 사용하며,
task_coordinator 템플릿이 최적화된 설정으로 팀 협업을 자동으로 처리합니다.
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

        // 예제 1: 단순한 작업 (직접 처리)
        logSection('예제 1: 단순한 작업 (직접 처리)');

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

        // 🎯 WorkflowEventSubscriber 활성화로 워크플로우 이벤트 추적
        const workflowEventSubscriber1 = new WorkflowEventSubscriber(console);

        const team1 = createTeam({
            aiProviders: [openaiProvider1, anthropicProvider1],
            maxMembers: 5,
            maxTokenLimit: 8000,
            logger: console,
            debug: false,
            eventService: workflowEventSubscriber1  // 🎯 워크플로우 이벤트 구독 활성화
        });

        const simpleTask = 'React와 Vue.js의 주요 차이점 3가지를 간단히 알려주세요.';

        console.log(chalk.yellow(`사용자: ${simpleTask}`));
        console.log(chalk.blue('🤖 팀이 처리중입니다...'));

        const simpleResult = await team1.execute(simpleTask);
        logResult('팀 응답', simpleResult);

        // 예제 1 성능 분석
        logSection('예제 1: 성능 분석');

        const stats1 = team1.getStats();

        console.log(chalk.blue(`
📈 예제 1 결과:
• 완료된 작업: ${stats1.tasksCompleted}
• 총 생성된 에이전트: ${stats1.totalAgentsCreated}
• 총 실행 시간: ${stats1.totalExecutionTime}ms
        `));



        console.log('✅ 예제 1 완료!\n');

        // 예제 2: 복잡한 작업 (팀 협업)
        logSection('예제 2: 복잡한 작업 (팀 협업)');
        console.log('✅ 예제 2용 새로운 팀을 생성하고 있습니다...');

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
        // 🎯 WorkflowEventSubscriber 활성화로 복잡한 워크플로우 이벤트 추적 (2개 assignTask 시나리오)
        const workflowEventSubscriber2 = new WorkflowEventSubscriber(console);

        const team2 = createTeam({
            aiProviders: [openaiProvider2, anthropicProvider2],
            maxMembers: 5,
            maxTokenLimit: 8000,
            logger: console,
            debug: false,
            eventService: workflowEventSubscriber2  // 🎯 Agent 0 → Agent 1,2 워크플로우 추적 활성화
        });

        const complexTask = `카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 시장 분석, 메뉴 구성. 각각을 별도로 작성해주세요.`;

        console.log(chalk.yellow(`사용자: ${complexTask}`));
        console.log(chalk.blue('🤖 팀이 전문가들과 협업중입니다...'));

        const complexResult = await team2.execute(complexTask);
        logResult('팀 응답', complexResult);

        // 예제 2 성능 분석
        logSection('예제 2: 성능 분석');

        const stats2 = team2.getStats();

        console.log(chalk.blue(`
📈 예제 2 결과:
• 완료된 작업: ${stats2.tasksCompleted}
• 총 생성된 에이전트: ${stats2.totalAgentsCreated}
• 총 실행 시간: ${stats2.totalExecutionTime}ms
        `));



        // 최종 통계 표시 (두 팀 통합)
        logSection('전체 팀 성능 요약');

        console.log(chalk.blue(`
📊 전체 요약:
• 총 완료된 작업: ${stats1.tasksCompleted + stats2.tasksCompleted}
• 총 생성된 에이전트: ${stats1.totalAgentsCreated + stats2.totalAgentsCreated}
• 총 실행 시간: ${stats1.totalExecutionTime + stats2.totalExecutionTime}ms
        `));

        console.log(chalk.green('\n✅ 팀 협업 데모가 성공적으로 완료되었습니다!'));
        console.log(chalk.cyan('팀 에이전트가 직접 처리할지 위임할지를 지능적으로 결정합니다.'));
        console.log(chalk.cyan('복잡한 작업에서는 에이전트들이 어�떻게 협업하는지 분석할 수 있습니다.'));

        // 🎯 실제 생성된 워크플로우 데이터 추출
        console.log(chalk.yellow('\n📊 실제 생성된 워크플로우 데이터 추출 중...'));

        // 두 팀의 워크플로우 데이터 수집
        const team1Nodes = workflowEventSubscriber1.getAllNodes();
        const team2Nodes = workflowEventSubscriber2.getAllNodes();

        console.log(chalk.blue(`\n📋 Team 1 생성된 노드 수: ${team1Nodes.length}`));
        console.log(chalk.blue(`📋 Team 2 생성된 노드 수: ${team2Nodes.length}`));

        // 실제 워크플로우 데이터를 JSON 파일로 저장
        const workflowData = {
            metadata: {
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                metrics: {
                    totalNodes: team1Nodes.length + team2Nodes.length,
                    team1Nodes: team1Nodes.length,
                    team2Nodes: team2Nodes.length
                },
                testType: "team-collaboration-real-data",
                sourceExample: "05-team-collaboration-ko.ts"
            },
            team1: {
                nodes: team1Nodes,
                nodeIds: team1Nodes.map(n => n.id)
            },
            team2: {
                nodes: team2Nodes,
                nodeIds: team2Nodes.map(n => n.id)
            },
            allNodes: [...team1Nodes, ...team2Nodes]
        };

        // JSON 파일로 저장
        const outputPath = path.join(__dirname, 'real-workflow-data.json');
        fs.writeFileSync(outputPath, JSON.stringify(workflowData, null, 2));

        console.log(chalk.green(`\n💾 실제 워크플로우 데이터가 저장되었습니다: ${outputPath}`));
        console.log(chalk.cyan('이 데이터를 perfect-playground-data.json에 복사하여 Playground에서 확인할 수 있습니다.'));

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

main().catch((error) => {
    console.error(chalk.red('❌ 오류:'), error);
    process.exit(1);
});