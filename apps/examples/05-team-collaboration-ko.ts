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

        const team1 = createTeam({
            aiProviders: {
                openai: openaiProvider1,
                anthropic: anthropicProvider1
            },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemMessage: `You are a task coordinator. You can either handle simple requests directly or delegate complex tasks to specialized team members.
            
Available team members:
- domain_researcher: Research and analysis expert
- creative_ideator: Creative and content generation expert  
- summarizer: Information summarization specialist
- ethical_reviewer: Ethics and safety evaluation expert
- fast_executor: Quick task execution specialist

Use the assignTask tool to delegate work to team members when:
1. The task is complex and would benefit from specialized expertise
2. You need detailed research or analysis
3. The task involves creative work or ideation
4. You need content summarization
5. Ethical evaluation is required

Handle simple queries yourself without delegation.`,
            analytics: {
                enabled: true,
                trackPerformance: true,
                maxEntries: 100,
                performanceThreshold: 10000
            },
            logging: {
                level: (process.env.ROBOTA_LOG_LEVEL as any) || 'warn',
                enabled: process.env.ROBOTA_VERBOSE === 'true'
            }
        } as any);

        const simpleTask = 'React와 Vue.js의 주요 차이점 3가지를 간단히 알려주세요.';

        console.log(chalk.yellow(`사용자: ${simpleTask}`));
        console.log(chalk.blue('🤖 팀이 처리중입니다...'));

        const simpleResult = await team1.execute(simpleTask);
        logResult('팀 응답', simpleResult);

        // 예제 1 성능 분석
        logSection('예제 1: 성능 분석');

        const stats1 = team1.getAnalytics();
        const analysis1 = team1.getTeamExecutionAnalysis();
        const delegationHistory1 = team1.getDelegationHistory();

        console.log(chalk.blue(`
📈 예제 1 결과:
• 완료된 작업: ${stats1?.totalExecutions || 0}
• 성공률: ${((stats1?.successRate || 0) * 100).toFixed(1)}%
• 평균 실행 시간: ${(stats1?.averageDuration || 0).toFixed(0)}ms

🔄 작업 분배 분석:
• 직접 처리된 작업: ${analysis1.directlyHandledTasks}개
• 위임된 작업: ${analysis1.delegatedTasks}개
• 위임 비율: ${(analysis1.delegationRate * 100).toFixed(1)}%
        `));

        // 위임 내역 상세 표시
        if (delegationHistory1.length > 0) {
            console.log(chalk.cyan('\n📋 작업 위임 내역:'));
            delegationHistory1.forEach((record, index) => {
                console.log(chalk.gray(`
${index + 1}. ${record.agentTemplate || 'dynamic'} 에이전트 (${record.agentId})
   작업: "${record.originalTask.substring(0, 80)}${record.originalTask.length > 80 ? '...' : ''}"
   우선순위: ${record.priority}
   실행시간: ${record.duration}ms
   성공: ${record.success ? '✅' : '❌'}
   토큰 사용량: ${record.tokensUsed || 0}
                `));
            });
        } else {
            console.log(chalk.yellow('\n📝 이 작업은 팀 에이전트가 직접 처리했습니다 (위임 없음)'));
        }

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
        const team2 = createTeam({
            aiProviders: {
                openai: openaiProvider2,
                anthropic: anthropicProvider2
            },
            currentProvider: 'openai',
            currentModel: 'gpt-4o-mini',
            systemMessage: `You are a task coordinator. You can either handle simple requests directly or delegate complex tasks to specialized team members.
            
Available team members:
- domain_researcher: Research and analysis expert
- creative_ideator: Creative and content generation expert  
- summarizer: Information summarization specialist
- ethical_reviewer: Ethics and safety evaluation expert
- fast_executor: Quick task execution specialist

Use the assignTask tool to delegate work to team members when:
1. The task is complex and would benefit from specialized expertise
2. You need detailed research or analysis
3. The task involves creative work or ideation
4. You need content summarization
5. Ethical evaluation is required

Handle simple queries yourself without delegation.`,
            analytics: {
                enabled: true,
                trackPerformance: true,
                maxEntries: 100,
                performanceThreshold: 10000
            },
            logging: {
                level: (process.env.ROBOTA_LOG_LEVEL as any) || 'warn',
                enabled: process.env.ROBOTA_VERBOSE === 'true'
            }
        } as any);

        const complexTask = `카페 창업 계획서를 작성해주세요. 반드시 다음 두 부분을 모두 포함해야 합니다: 시장 분석, 메뉴 구성. 각각을 별도로 작성해주세요.`;

        console.log(chalk.yellow(`사용자: ${complexTask}`));
        console.log(chalk.blue('🤖 팀이 전문가들과 협업중입니다...'));

        const complexResult = await team2.execute(complexTask);
        logResult('팀 응답', complexResult);

        // 예제 2 성능 분석
        logSection('예제 2: 성능 분석');

        const stats2 = team2.getAnalytics();
        const analysis2 = team2.getTeamExecutionAnalysis();
        const delegationHistory2 = team2.getDelegationHistory();

        console.log(chalk.blue(`
📈 예제 2 결과:
• 완료된 작업: ${stats2?.totalExecutions || 0}
• 성공률: ${((stats2?.successRate || 0) * 100).toFixed(1)}%
• 평균 실행 시간: ${(stats2?.averageDuration || 0).toFixed(0)}ms

🔄 작업 분배 분석:
• 직접 처리된 작업: ${analysis2.directlyHandledTasks}개
• 위임된 작업: ${analysis2.delegatedTasks}개
• 위임 비율: ${(analysis2.delegationRate * 100).toFixed(1)}%
        `));

        // 위임 내역 상세 표시
        if (delegationHistory2.length > 0) {
            console.log(chalk.cyan('\n📋 작업 위임 내역:'));
            delegationHistory2.forEach((record, index) => {
                console.log(chalk.gray(`
${index + 1}. ${record.agentTemplate || 'dynamic'} 에이전트 (${record.agentId})
   작업: "${record.originalTask.substring(0, 80)}${record.originalTask.length > 80 ? '...' : ''}"
   우선순위: ${record.priority}
   실행시간: ${record.duration}ms
   성공: ${record.success ? '✅' : '❌'}
   토큰 사용량: ${record.tokensUsed || 0}
                `));
            });

            // 템플릿별 성능 분석
            if (analysis2.delegationBreakdown.length > 0) {
                console.log(chalk.cyan('\n📊 에이전트 템플릿별 성능:'));
                analysis2.delegationBreakdown.forEach(breakdown => {
                    console.log(chalk.gray(`
• ${breakdown.template}: ${breakdown.count}회 사용
  - 평균 실행 시간: ${breakdown.averageDuration.toFixed(0)}ms
  - 성공률: ${(breakdown.successRate * 100).toFixed(1)}%
                    `));
                });
            }
        } else {
            console.log(chalk.yellow('\n📝 이 작업은 팀 에이전트가 직접 처리했습니다 (위임 없음)'));
        }

        // 최종 통계 표시 (두 팀 통합)
        logSection('전체 팀 성능 요약');

        const totalExecutions = (stats1?.totalExecutions || 0) + (stats2?.totalExecutions || 0);
        const totalDelegations = delegationHistory1.length + delegationHistory2.length;
        const totalDirectTasks = analysis1.directlyHandledTasks + analysis2.directlyHandledTasks;
        const avgSuccessRate = ((stats1?.successRate || 0) + (stats2?.successRate || 0)) / 2;

        // 템플릿 사용 통계 통합
        const allTemplateUsage = new Map<string, { count: number; totalDuration: number; successes: number }>();

        [...delegationHistory1, ...delegationHistory2].forEach(record => {
            const template = record.agentTemplate || 'dynamic';
            const stats = allTemplateUsage.get(template) || { count: 0, totalDuration: 0, successes: 0 };

            stats.count++;
            stats.totalDuration += record.duration || 0;
            if (record.success) stats.successes++;

            allTemplateUsage.set(template, stats);
        });

        console.log(chalk.green(`
🎯 전체 성능 요약:
• 총 실행된 작업: ${totalExecutions}개
• 평균 성공률: ${(avgSuccessRate * 100).toFixed(1)}%
• 직접 처리: ${totalDirectTasks}개 (${totalExecutions > 0 ? ((totalDirectTasks / totalExecutions) * 100).toFixed(1) : 0}%)
• 위임 처리: ${totalDelegations}개 (${totalExecutions > 0 ? ((totalDelegations / totalExecutions) * 100).toFixed(1) : 0}%)

🤖 에이전트 활용 분석:
        `));

        if (allTemplateUsage.size > 0) {
            Array.from(allTemplateUsage.entries()).forEach(([template, stats]) => {
                const avgDuration = stats.count > 0 ? stats.totalDuration / stats.count : 0;
                const successRate = stats.count > 0 ? stats.successes / stats.count : 0;

                console.log(chalk.cyan(`
• ${template} 에이전트:
  - 사용 횟수: ${stats.count}회
  - 평균 실행시간: ${avgDuration.toFixed(0)}ms
  - 성공률: ${(successRate * 100).toFixed(1)}%
                `));
            });
        } else {
            console.log(chalk.yellow('모든 작업이 팀 에이전트에 의해 직접 처리되었습니다.'));
        }

        console.log(chalk.bold.green(`
💡 인사이트:
${totalDelegations > 0 ?
                `• 복잡한 작업의 경우 전문 에이전트에게 위임하여 효율성을 높였습니다.
• 위임된 작업들의 평균 성공률이 높아 적절한 역할 분담이 이루어졌습니다.` :
                `• 이번 작업들은 복잡도가 낮아 팀 에이전트가 직접 처리했습니다.
• 필요에 따라 전문 에이전트 위임을 통해 더 복잡한 작업도 처리 가능합니다.`}
• 두 팀 인스턴스가 완전히 독립적으로 작동하여 싱글톤 문제가 해결되었습니다.
        `));

        console.log(chalk.green('\n✅ 팀 협업 데모가 성공적으로 완료되었습니다!'));
        console.log(chalk.cyan('팀 에이전트가 직접 처리할지 위임할지를 지능적으로 결정합니다.'));
        console.log(chalk.cyan('복잡한 작업에서는 에이전트들이 어떻게 협업하는지 분석할 수 있습니다.'));

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