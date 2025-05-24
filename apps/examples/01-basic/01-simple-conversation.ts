/**
 * 01-simple-conversation.ts
 * 
 * 이 예제는 Robota의 가장 기본적인 사용법을 보여줍니다:
 * - OpenAI 클라이언트를 사용한 간단한 대화
 * - 메시지 전송 (run 메서드)
 * - 스트리밍 응답 (runStream 메서드)
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

async function main() {
    // API 키 검증
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
    }

    // OpenAI 클라이언트 생성
    const openaiClient = new OpenAI({
        apiKey
    });

    // OpenAI Provider 생성
    const openaiProvider = new OpenAIProvider(openaiClient);

    // Robota 인스턴스 생성
    const robota = new Robota({
        aiProviders: {
            'openai': openaiProvider
        },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다. 간결하고 유용한 응답을 제공하세요.'
    });

    // 간단한 대화 실행
    console.log('===== 간단한 대화 예제 =====');

    const response1 = await robota.run('안녕하세요! 타입스크립트에 대해 알려주세요.');
    console.log('응답: ', response1);

    // 스트리밍 응답 예제
    console.log('\n===== 스트리밍 응답 예제 =====');
    console.log('응답: ');

    const stream = await robota.runStream('타입스크립트의 장점에 대해 간략하게 설명해주세요.');

    for await (const chunk of stream) {
        process.stdout.write(chunk.content || '');
    }
    console.log('\n');
}

// 실행
main().catch(error => {
    console.error('오류 발생:', error);
}); 