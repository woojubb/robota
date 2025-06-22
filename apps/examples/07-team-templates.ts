/**
 * Team with Agent Templates Example
 * 
 * Demonstrates multi-template collaboration where different specialist agents
 * work together on a complex task using predefined expert templates.
 */

import chalk from 'chalk';
import { createTeam } from '@robota-sdk/team';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Utility functions for demo output
function logSection(title: string) {
    console.log('\n' + chalk.blue('='.repeat(60)));
    console.log(chalk.blue.bold(`📋 ${title}`));
    console.log(chalk.blue('='.repeat(60)));
}

function logResult(label: string, content: string) {
    console.log(chalk.yellow(`\n${label}:`));
    console.log(chalk.white(content));
}

async function runTeamTemplatesExample() {
    try {
        logSection('Multi-Template Collaboration Demo');

        console.log(chalk.cyan(`
🎯 Demo Overview:
Two specialist agents will collaborate on creating a comprehensive product proposal:
• Domain Researcher (domain_researcher template) - Market analysis & research
• Creative Ideator (creative_ideator template) - Innovative product concept

📋 Template Specializations:
• domain_researcher - Research and analysis expert (Anthropic Claude, temp: 0.4)
• creative_ideator - Creative thinking expert (OpenAI GPT-4, temp: 0.8)
• task_coordinator - Team coordination expert (OpenAI GPT-4o-mini, temp: 0.4)

🚀 Simplified API:
This example uses the new simplified createTeam API where templates automatically
handle AI provider selection, model configuration, and temperature settings.
You only need to provide the AI providers and basic configuration.
        `));

        // Validate API keys
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        if (!anthropicApiKey) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required');
        }

        // Create providers with payload logging
        const openaiClient = new OpenAI({ apiKey: openaiApiKey });

        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-4o-mini',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-templates',
            includeTimestampInLogFiles: true
        });

        const anthropicClient = new Anthropic({ apiKey: anthropicApiKey });
        const anthropicProvider = new AnthropicProvider({
            client: anthropicClient,
            model: 'claude-3-5-sonnet-20241022',
            enablePayloadLogging: true,
            payloadLogDir: './logs/team-templates',
            includeTimestampInLogFiles: true
        });

        // Create team using simplified template-based API
        console.log(chalk.green('✅ Creating team with multi-template support...'));

        const team = createTeam({
            aiProviders: {
                openai: openaiProvider,
                anthropic: anthropicProvider
            },
            maxMembers: 5,
            maxTokenLimit: 8000,
            logger: console,
            debug: true
        });

        // Multi-Template Collaboration Example
        logSection('Multi-Template Product Development Collaboration');

        const collaborationTask = `
        새로운 헬스케어 기술 제품을 개발하고 싶습니다. 다음 두 가지 작업을 각각 전문가에게 분배해주세요:

        1. 시장 분석 및 경쟁사 조사
           - 헬스케어 기술 시장 현황 분석
           - 주요 경쟁업체 및 트렌드 조사
           - 시장 기회 및 진입 전략 제안

        2. 혁신적인 제품 아이디어 발굴
           - 차별화된 헬스케어 기술 솔루션 아이디어
           - 사용자 경험 중심의 혁신 요소
           - 실현 가능한 3가지 제품 컨셉 제안

        주제: AI 기반 개인 맞춤형 건강관리 솔루션
        `;

        console.log(chalk.yellow('User: 헬스케어 기술 제품 개발 (자동 템플릿 선택)'));
        console.log(chalk.gray('Expected: AI will automatically choose appropriate templates for market analysis and creative ideation'));

        const collaborationResult = await team.execute(collaborationTask);
        logResult('Multi-Template Collaboration Result', collaborationResult);

        // Show template usage statistics
        const stats = team.getStats();
        const avgAgentsPerTask = stats.tasksCompleted > 0 ? stats.totalAgentsCreated / stats.tasksCompleted : 0;

        console.log(chalk.blue(`
📈 Collaboration Performance:
• Total specialist agents: ${stats.totalAgentsCreated}
• Tasks completed: ${stats.tasksCompleted}
• Total execution time: ${stats.totalExecutionTime}ms
• Average agents per task: ${avgAgentsPerTask.toFixed(1)}
        `));

        console.log(chalk.green('\n✅ Multi-template collaboration demo completed successfully!'));
        console.log(chalk.cyan('🔬 Template system enables automatic specialist selection'));
        console.log(chalk.cyan('💡 AI intelligently chooses the best expert for each task component'));
        console.log(chalk.cyan('🤝 Team coordinator synthesizes all perspectives into comprehensive results'));

    } catch (error) {
        console.error(chalk.red('\n❌ Demo failed:'), error);
        process.exit(1);
    }
}

// Run the example
async function main() {
    await runTeamTemplatesExample();
    process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch((error) => {
        console.error(chalk.red('❌ Error:'), error);
        process.exit(1);
    });
} 