/**
 * 04-provider-switching-simple.ts
 * 
 * 이 예제는 OpenAI provider에서 여러 모델을 전환하면서 사용하는 방법을 보여줍니다:
 * - 동일한 provider 내에서 다른 모델로 전환
 * - 각 모델의 응답 스타일과 특성 비교
 * - 대화 히스토리가 모델 전환 시에도 유지되는지 확인
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

async function main() {
    try {
        // API 키 확인
        const openaiApiKey = process.env.OPENAI_API_KEY;

        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다.');
        }

        // OpenAI Client 생성
        const openaiClient = new OpenAI({ apiKey: openaiApiKey });

        // OpenAI Provider 생성
        const openaiProvider = new OpenAIProvider({
            client: openaiClient,
            model: 'gpt-3.5-turbo',
            temperature: 0.7
        });

        // 테스트할 모델들
        const models = ['gpt-3.5-turbo', 'gpt-4', 'gpt-4o-mini'];

        // Robota 인스턴스 생성
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: '당신은 각 AI 모델의 특징을 보여주는 도움이 되는 어시스턴트입니다. 응답할 때 현재 사용 중인 모델명을 간단히 언급해주세요.'
        });

        console.log('🤖 Robota 모델 전환 예제를 시작합니다!\n');

        // 테스트할 질문들
        const testQuestions = [
            '안녕하세요! 당신은 어떤 AI 모델인가요? 간단한 자기소개를 해주세요.',
            'TypeScript와 JavaScript의 주요 차이점 3가지를 설명해주세요.',
            '창의적인 아이디어: 우주 여행이 일반화된 미래의 모습을 그려보세요.'
        ];

        // 각 질문에 대해 모든 모델로 테스트
        for (let i = 0; i < testQuestions.length; i++) {
            const question = testQuestions[i];
            console.log(`\n${'='.repeat(80)}`);
            console.log(`📝 질문 ${i + 1}: ${question}`);
            console.log(`${'='.repeat(80)}\n`);

            // 각 모델로 응답 받기
            for (const model of models) {
                console.log(`🔄 ${model}로 전환 중...`);

                // 모델 전환
                robota.setCurrentAI('openai', model);

                const currentAI = robota.getCurrentAI();
                console.log(`   Provider: ${currentAI.provider}`);
                console.log(`   Model: ${currentAI.model}\n`);

                try {
                    // 응답 시간 측정
                    const startTime = Date.now();
                    const response = await robota.run(question);
                    const endTime = Date.now();
                    const responseTime = endTime - startTime;

                    console.log(`💬 ${model} 응답 (${responseTime}ms):`);
                    console.log(`${response}\n`);
                    console.log(`${'-'.repeat(60)}\n`);

                } catch (error) {
                    console.error(`❌ ${model} 오류:`, error);
                    console.log(`${'-'.repeat(60)}\n`);
                }
            }

            // 질문 사이에 잠시 대기
            if (i < testQuestions.length - 1) {
                console.log('⏳ 다음 질문을 위해 잠시 대기 중...\n');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🎯 대화 히스토리 연속성 테스트');
        console.log(`${'='.repeat(80)}\n`);

        // 대화 히스토리가 모델 전환 시에도 유지되는지 테스트
        if (models.length >= 2) {
            // 첫 번째 모델로 대화 시작
            robota.setCurrentAI('openai', models[0]);

            console.log(`🟢 ${models[0]}로 대화 시작:`);
            const response1 = await robota.run('제 이름을 "김철수"라고 기억해주세요. 그리고 안녕하세요!');
            console.log(`응답: ${response1}\n`);

            // 두 번째 모델로 전환하여 이전 대화 기억하는지 확인
            robota.setCurrentAI('openai', models[1]);

            console.log(`🔄 ${models[1]}로 전환 후:`);
            const response2 = await robota.run('제 이름이 무엇인지 기억하시나요?');
            console.log(`응답: ${response2}\n`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🏁 스트리밍 응답 테스트');
        console.log(`${'='.repeat(80)}\n`);

        // 스트리밍 응답 테스트 (가장 빠른 모델로)
        robota.setCurrentAI('openai', 'gpt-3.5-turbo');

        console.log(`🌊 gpt-3.5-turbo로 스트리밍 응답:`);
        console.log('질문: AI의 미래에 대해 짧은 시를 지어주세요.\n');
        console.log('스트리밍 응답: ');

        const stream = await robota.runStream('AI의 미래에 대해 짧은 시를 지어주세요.');
        for await (const chunk of stream) {
            process.stdout.write(chunk.content || '');
        }
        console.log('\n');

        console.log(`\n${'='.repeat(80)}`);
        console.log('🔀 동적 모델 변경 시연');
        console.log(`${'='.repeat(80)}\n`);

        // 동적으로 모델을 변경하면서 연속 대화
        const questions = [
            { question: '간단한 더하기: 123 + 456은?', model: 'gpt-3.5-turbo' },
            { question: '이제 복잡한 수학 문제를 주겠습니다. 미적분을 사용해서 x^3 + 2x^2 - 5x + 1의 도함수를 구하고 x=2일 때의 값을 계산해주세요.', model: 'gpt-4' },
            { question: '이전 계산이 맞는지 다시 한번 확인해주세요.', model: 'gpt-4o-mini' }
        ];

        for (const { question, model } of questions) {
            console.log(`🔄 ${model}로 전환하여 질문:`);
            console.log(`❓ ${question}\n`);

            robota.setCurrentAI('openai', model);
            const response = await robota.run(question);

            console.log(`💬 ${model} 응답:`);
            console.log(`${response}\n`);
            console.log(`${'-'.repeat(60)}\n`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('✅ 모든 테스트 완료!');
        console.log('📊 모델별 특성 요약:');
        console.log('   - gpt-3.5-turbo: 빠르고 효율적, 일반적인 작업에 적합');
        console.log('   - gpt-4: 더 정확하고 복잡한 추론, 전문적 작업에 적합');
        console.log('   - gpt-4o-mini: 균형 잡힌 성능, 다양한 작업에 활용 가능');
        console.log(`${'='.repeat(80)}`);

    } catch (error) {
        console.error('❌ 오류 발생:', error);
    }
}

// 실행
main().catch(console.error); 