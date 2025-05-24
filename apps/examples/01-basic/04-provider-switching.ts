/**
 * 04-provider-switching.ts
 * 
 * 이 예제는 여러 AI provider를 전환하면서 같은 질문에 대한 응답을 비교하는 방법을 보여줍니다:
 * - 여러 AI provider 동시 등록 (OpenAI, Anthropic, Google)
 * - 각 provider로 전환하면서 같은 질문하기
 * - 각 provider의 응답 스타일과 특성 비교
 * - 대화 히스토리가 provider 전환 시에도 유지되는지 확인
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { GoogleProvider } from '@robota-sdk/google';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

async function main() {
    try {
        // API 키 확인
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
        const googleApiKey = process.env.GOOGLE_API_KEY;

        if (!openaiApiKey) {
            console.log('⚠️  OPENAI_API_KEY가 없어서 OpenAI provider는 건너뜁니다.');
        }
        if (!anthropicApiKey) {
            console.log('⚠️  ANTHROPIC_API_KEY가 없어서 Anthropic provider는 건너뜁니다.');
        }
        if (!googleApiKey) {
            console.log('⚠️  GOOGLE_API_KEY가 없어서 Google provider는 건너뜁니다.');
        }

        // 사용 가능한 provider들과 모델 설정
        const aiProviders: Record<string, any> = {};
        const providerModels: Record<string, string> = {};

        // OpenAI Provider 생성
        if (openaiApiKey) {
            const openaiClient = new OpenAI({ apiKey: openaiApiKey });
            aiProviders['openai'] = new OpenAIProvider({
                client: openaiClient,
                model: 'gpt-4',
                temperature: 0.7
            });
            providerModels['openai'] = 'gpt-4';
        }

        // Anthropic Provider 생성
        if (anthropicApiKey) {
            const anthropicClient = new Anthropic({ apiKey: anthropicApiKey });
            aiProviders['anthropic'] = new AnthropicProvider({
                client: anthropicClient,
                model: 'claude-3-5-sonnet-20241022',
                temperature: 0.7
            });
            providerModels['anthropic'] = 'claude-3-5-sonnet-20241022';
        }

        // Google Provider 생성
        if (googleApiKey) {
            const googleClient = new GoogleGenerativeAI(googleApiKey);
            aiProviders['google'] = new GoogleProvider({
                client: googleClient,
                model: 'gemini-1.5-pro',
                temperature: 0.7
            });
            providerModels['google'] = 'gemini-1.5-pro';
        }

        if (Object.keys(aiProviders).length === 0) {
            throw new Error('사용 가능한 AI provider가 없습니다. 최소 하나의 API 키를 설정해주세요.');
        }

        // 첫 번째 provider를 기본으로 설정
        const firstProviderName = Object.keys(aiProviders)[0];

        // Robota 인스턴스 생성
        const robota = new Robota({
            aiProviders,
            currentProvider: firstProviderName,
            currentModel: providerModels[firstProviderName],
            systemPrompt: '당신은 각 AI 모델의 특징을 보여주는 도움이 되는 어시스턴트입니다. 응답할 때 어떤 모델인지 간단히 언급해주세요.'
        });

        console.log('🤖 Robota Provider 전환 예제를 시작합니다!\n');

        // 테스트할 질문들
        const testQuestions = [
            '안녕하세요! 당신은 어떤 AI 모델인가요? 간단한 자기소개를 해주세요.',
            '프로그래밍에서 함수형 프로그래밍의 장점 3가지를 설명해주세요.',
            '창의적인 아이디어: 미래의 도시는 어떤 모습일까요?'
        ];

        // 각 질문에 대해 모든 provider로 테스트
        for (let i = 0; i < testQuestions.length; i++) {
            const question = testQuestions[i];
            console.log(`\n${'='.repeat(80)}`);
            console.log(`📝 질문 ${i + 1}: ${question}`);
            console.log(`${'='.repeat(80)}\n`);

            // 각 provider로 응답 받기
            for (const providerName of Object.keys(aiProviders)) {
                console.log(`🔄 ${providerName.toUpperCase()} Provider로 전환 중...`);

                // Provider와 모델 전환
                robota.setCurrentAI(providerName, providerModels[providerName]);

                const currentAI = robota.getCurrentAI();
                console.log(`   Provider: ${currentAI.provider}`);
                console.log(`   Model: ${currentAI.model}\n`);

                try {
                    // 응답 시간 측정
                    const startTime = Date.now();
                    const response = await robota.run(question);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;

                    console.log(`💬 ${providerName.toUpperCase()} 응답 (${responseTime}ms):`);
                    console.log(`${response}\n`);
                    console.log(`${'-'.repeat(60)}\n`);

                } catch (error) {
                    console.error(`❌ ${providerName.toUpperCase()} 오류:`, error);
                    console.log(`${'-'.repeat(60)}\n`);
                }
            }

            // 질문 사이에 잠시 대기
            if (i < testQuestions.length - 1) {
                console.log('⏳ 다음 질문을 위해 잠시 대기 중...\n');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🎯 대화 히스토리 연속성 테스트');
        console.log(`${'='.repeat(80)}\n`);

        // 대화 히스토리가 provider 전환 시에도 유지되는지 테스트
        const availableProviders = Object.keys(aiProviders);
        if (availableProviders.length >= 2) {
            // 첫 번째 provider로 대화 시작
            const firstProvider = availableProviders[0];
            robota.setCurrentAI(firstProvider, providerModels[firstProvider]);

            console.log(`🟢 ${firstProvider.toUpperCase()}로 대화 시작:`);
            const response1 = await robota.run('제 이름을 "김철수"라고 기억해주세요. 그리고 안녕하세요!');
            console.log(`응답: ${response1}\n`);

            // 두 번째 provider로 전환하여 이전 대화 기억하는지 확인
            const secondProvider = availableProviders[1];
            robota.setCurrentAI(secondProvider, providerModels[secondProvider]);

            console.log(`🔄 ${secondProvider.toUpperCase()}로 전환 후:`);
            const response2 = await robota.run('제 이름이 무엇인지 기억하시나요?');
            console.log(`응답: ${response2}\n`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🏁 스트리밍 응답 테스트');
        console.log(`${'='.repeat(80)}\n`);

        // 스트리밍 응답 테스트 (사용 가능한 첫 번째 provider로)
        const streamingProvider = Object.keys(aiProviders)[0];
        robota.setCurrentAI(streamingProvider, providerModels[streamingProvider]);

        console.log(`🌊 ${streamingProvider.toUpperCase()}로 스트리밍 응답:`);
        console.log('질문: 인공지능의 미래에 대해 짧게 설명해주세요.\n');
        console.log('스트리밍 응답: ');

        const stream = await robota.runStream('인공지능의 미래에 대해 짧게 설명해주세요.');
        for await (const chunk of stream) {
            process.stdout.write(chunk.content || '');
        }
        console.log('\n');

        console.log(`\n${'='.repeat(80)}`);
        console.log('✅ 모든 테스트 완료!');
        console.log(`${'='.repeat(80)}`);

    } catch (error) {
        console.error('❌ 오류 발생:', error);
    }
}

// 실행
main().catch(console.error); 