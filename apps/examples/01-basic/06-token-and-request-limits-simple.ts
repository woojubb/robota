/**
 * 06-token-and-request-limits-simple.ts
 * 
 * 토큰 및 요청 제한 기능의 간단한 사용법:
 * - 기본 설정과 커스텀 설정
 * - 제한 확인 및 모니터링
 * - 에러 처리
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
    }

    const openaiClient = new OpenAI({ apiKey });
    const openaiProvider = new OpenAIProvider(openaiClient);

    console.log('🔧 간단한 토큰/요청 제한 예제\n');

    // 1. 기본 설정 (maxTokens: 4096, maxRequests: 25)
    console.log('=== 기본 설정 ===');
    const robota1 = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo'
    });

    console.log(`기본 토큰 제한: ${robota1.getMaxTokenLimit()}`);
    console.log(`기본 요청 제한: ${robota1.getMaxRequestLimit()}`);

    // 2. 커스텀 설정
    console.log('\n=== 커스텀 설정 ===');
    const robota2 = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: '간결하게 답변해주세요.',
        maxTokenLimit: 100,  // 낮은 토큰 제한
        maxRequestLimit: 2   // 2회 요청만 허용
    });

    console.log(`커스텀 토큰 제한: ${robota2.getMaxTokenLimit()}`);
    console.log(`커스텀 요청 제한: ${robota2.getMaxRequestLimit()}`);

    // 3. 요청 실행 및 모니터링
    console.log('\n=== 요청 실행 및 모니터링 ===');

    try {
        // 첫 번째 요청
        const response1 = await robota2.execute('안녕하세요');
        console.log(`✅ 요청 1 성공: ${response1.substring(0, 50)}...`);

        // 현재 상태 확인
        const info1 = robota2.getLimitInfo();
        console.log(`상태: 토큰 ${info1.currentTokensUsed}/${info1.maxTokens}, 요청 ${info1.currentRequestCount}/${info1.maxRequests}`);

        // 두 번째 요청
        const response2 = await robota2.execute('감사합니다');
        console.log(`✅ 요청 2 성공: ${response2.substring(0, 50)}...`);

        const info2 = robota2.getLimitInfo();
        console.log(`상태: 토큰 ${info2.currentTokensUsed}/${info2.maxTokens}, 요청 ${info2.currentRequestCount}/${info2.maxRequests}`);

        // 세 번째 요청 (제한 초과)
        const response3 = await robota2.execute('또 다른 질문');
        console.log(`요청 3: ${response3}`);

    } catch (error) {
        console.log(`❌ 제한 초과: ${(error as Error).message}`);
    }

    // 4. 무제한 설정
    console.log('\n=== 무제한 설정 ===');
    const unlimitedRobota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        maxTokenLimit: 0,    // 무제한
        maxRequestLimit: 0   // 무제한
    });

    const unlimitedInfo = unlimitedRobota.getLimitInfo();
    console.log(`무제한 모드: 토큰=${unlimitedInfo.isTokensUnlimited}, 요청=${unlimitedInfo.isRequestsUnlimited}`);

    // 5. 애널리틱스 확인
    console.log('\n=== 애널리틱스 ===');
    const analytics = robota2.getAnalytics();
    console.log(`총 요청: ${analytics.requestCount}`);
    console.log(`총 토큰: ${analytics.totalTokensUsed}`);
    console.log(`평균 토큰/요청: ${analytics.averageTokensPerRequest.toFixed(1)}`);

    // 6. 동적 제한 변경
    console.log('\n=== 동적 제한 변경 ===');
    robota2.setMaxTokenLimit(1000);
    robota2.setMaxRequestLimit(10);
    console.log(`변경된 토큰 제한: ${robota2.getMaxTokenLimit()}`);
    console.log(`변경된 요청 제한: ${robota2.getMaxRequestLimit()}`);

    console.log('\n✅ 예제 완료!');
}

main().catch(error => {
    console.error('오류:', error);
}); 