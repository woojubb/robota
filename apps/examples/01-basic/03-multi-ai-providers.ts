/**
 * 03-multi-ai-providers.ts
 * 
 * 이 예제는 Robota에서 여러 AI 제공업체를 사용하는 방법을 보여줍니다:
 * - 여러 AI provider 등록
 * - 현재 사용할 provider와 model 설정
 * - 동적으로 provider 및 model 변경
 * - 사용 가능한 AI provider와 model 목록 확인
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

async function main() {
    try {
        // API 키 검증
        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
            throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
        }

        // OpenAI 클라이언트 생성
        const openaiClient = new OpenAI({
            apiKey: openaiApiKey
        });

        // OpenAI Provider 생성
        const openaiProvider = new OpenAIProvider(openaiClient);

        // Robota 인스턴스 생성 (초기에 여러 provider 등록)
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다. 현재 사용 중인 AI 모델에 대해 간단히 언급하고 질문에 답변해주세요.'
        });

        // 1. 사용 가능한 AI provider와 모델 확인
        console.log('===== 등록된 AI Providers =====');
        const availableAIs = robota.getAvailableAIs();
        console.log('사용 가능한 AI Providers와 모델들:');
        for (const [providerName, models] of Object.entries(availableAIs)) {
            console.log(`- ${providerName}: ${models.join(', ')}`);
        }

        // 2. 현재 설정 확인
        console.log('\n===== 현재 AI 설정 =====');
        const currentAI = robota.getCurrentAI();
        console.log(`현재 Provider: ${currentAI.provider}`);
        console.log(`현재 Model: ${currentAI.model}`);

        // 3. 현재 설정으로 대화
        console.log('\n===== GPT-3.5-Turbo로 대화 =====');
        const response1 = await robota.run('안녕하세요! 타입스크립트에 대해 간단히 설명해주세요.');
        console.log('응답:', response1);

        // 4. 다른 모델로 변경
        console.log('\n===== GPT-4로 모델 변경 =====');
        robota.setCurrentAI('openai', 'gpt-4');
        const currentAI2 = robota.getCurrentAI();
        console.log(`변경된 Provider: ${currentAI2.provider}`);
        console.log(`변경된 Model: ${currentAI2.model}`);

        const response2 = await robota.run('이전 질문과 같은 내용을 다시 답변해주세요. 어떤 모델을 사용하고 있는지도 알려주세요.');
        console.log('응답:', response2);

        // 5. 스트리밍 테스트
        console.log('\n===== 스트리밍 응답 테스트 =====');
        console.log('응답: ');
        const stream = await robota.runStream('리액트와 뷰의 차이점을 간단히 설명해주세요.');

        for await (const chunk of stream) {
            process.stdout.write(chunk.content || '');
        }
        console.log('\n');

        // 6. 런타임에 새 provider 추가 (예시)
        console.log('\n===== 런타임에 Provider 추가 =====');
        // 만약 Anthropic이 있다면:
        // const anthropicProvider = new AnthropicProvider(anthropicClient);
        // robota.addAIProvider('anthropic', anthropicProvider);

        // 새로운 OpenAI provider 추가 (다른 설정으로)
        const anotherOpenaiProvider = new OpenAIProvider(openaiClient);
        robota.addAIProvider('openai-alternative', anotherOpenaiProvider);

        const updatedAIs = robota.getAvailableAIs();
        console.log('업데이트된 AI Providers:');
        for (const [providerName, models] of Object.entries(updatedAIs)) {
            console.log(`- ${providerName}: ${models.join(', ')}`);
        }

    } catch (error) {
        console.error('오류 발생:', error);
    }
}

// 실행
main().catch(console.error); 