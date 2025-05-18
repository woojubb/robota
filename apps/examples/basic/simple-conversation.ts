/**
 * 간단한 대화 예제
 * 
 * 이 예제는 기본적인 Robota 설정과 사용법을 보여줍니다.
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
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

    // Robota 인스턴스 생성
    const robota = new Robota({
        provider: new OpenAIProvider({
            model: 'gpt-4',
            client: openaiClient
        }),
        systemPrompt: '당신은 도움이 되는 AI 어시스턴트입니다. 간결하고 유용한 응답을 제공하세요.'
    });

    // 간단한 대화 실행
    console.log('===== 간단한 대화 예제 =====');

    const response1 = await robota.run('안녕하세요! 타입스크립트에 대해 알려주세요.');
    console.log('응답: ', response1);

    const response2 = await robota.run('타입스크립트와 자바스크립트의 주요 차이점을 3가지만 알려주세요.');
    console.log('응답: ', response2);

    // 스트리밍 응답 예제
    console.log('\n===== 스트리밍 응답 예제 =====');
    console.log('응답: ');

    const stream = await robota.runStream('타입스크립트의 장점에 대해 자세히 설명해주세요.');

    for await (const chunk of stream) {
        process.stdout.write(chunk.content || '');
    }
    console.log('\n');
}

// 실행
main().catch(error => {
    console.error('오류 발생:', error);
}); 