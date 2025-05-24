/**
 * 06-token-and-request-limits.ts
 * 
 * 이 예제는 Robota의 토큰 및 요청 제한 기능을 보여줍니다:
 * - 기본 제한 설정 (maxTokens: 4096, maxRequests: 25)
 * - 커스텀 제한 설정
 * - 무제한 설정 (0 값 사용)
 * - 사전 토큰 계산을 통한 비용 절약
 * - 제한 초과 시 에러 처리
 * - 실시간 제한 정보 모니터링
 * - 애널리틱스 데이터 수집
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

    console.log('🚀 Robota 토큰 및 요청 제한 기능 예제\n');

    // 1. 기본 제한 설정 예제
    await demonstrateDefaultLimits(openaiProvider);

    // 2. 커스텀 제한 설정 예제
    await demonstrateCustomLimits(openaiProvider);

    // 3. 무제한 설정 예제
    await demonstrateUnlimitedMode(openaiProvider);

    // 4. 사전 토큰 계산을 통한 비용 절약 예제
    await demonstrateTokenPrevention(openaiProvider);

    // 5. 요청 제한 예제
    await demonstrateRequestLimits(openaiProvider);

    // 6. 실시간 모니터링 예제
    await demonstrateRealTimeMonitoring(openaiProvider);

    console.log('\n✅ 모든 예제가 완료되었습니다!');
}

async function demonstrateDefaultLimits(openaiProvider: OpenAIProvider) {
    console.log('=== 1. 기본 제한 설정 예제 ===');

    // 기본 설정으로 Robota 생성 (maxTokens: 4096, maxRequests: 25)
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: '간결하게 답변해주세요.'
    });

    // 기본 제한 확인
    console.log(`기본 토큰 제한: ${robota.getMaxTokenLimit()}`);
    console.log(`기본 요청 제한: ${robota.getMaxRequestLimit()}`);

    // 제한 정보 출력
    const limitInfo = robota.getLimitInfo();
    console.log('현재 제한 상태:', {
        maxTokens: limitInfo.maxTokens,
        maxRequests: limitInfo.maxRequests,
        remainingTokens: limitInfo.remainingTokens,
        remainingRequests: limitInfo.remainingRequests,
        isTokensUnlimited: limitInfo.isTokensUnlimited,
        isRequestsUnlimited: limitInfo.isRequestsUnlimited
    });

    // 몇 개의 요청 실행
    const response = await robota.execute('타입스크립트란 무엇인가요?');
    console.log(`응답: ${response.substring(0, 100)}...`);

    // 사용량 확인
    console.log(`사용된 토큰: ${robota.getTotalTokensUsed()}`);
    console.log(`실행된 요청: ${robota.getRequestCount()}\n`);
}

async function demonstrateCustomLimits(openaiProvider: OpenAIProvider) {
    console.log('=== 2. 커스텀 제한 설정 예제 ===');

    // 낮은 제한으로 설정
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: '간결하게 답변해주세요.',
        maxTokenLimit: 200,  // 매우 낮은 토큰 제한
        maxRequestLimit: 3   // 3회 요청만 허용
    });

    console.log(`설정된 토큰 제한: ${robota.getMaxTokenLimit()}`);
    console.log(`설정된 요청 제한: ${robota.getMaxRequestLimit()}`);

    try {
        // 첫 번째 요청
        const response1 = await robota.execute('안녕하세요');
        console.log(`1번째 요청 성공: ${response1.substring(0, 50)}...`);

        // 두 번째 요청
        const response2 = await robota.execute('날씨는 어때요?');
        console.log(`2번째 요청 성공: ${response2.substring(0, 50)}...`);

        // 세 번째 요청 (토큰 제한에 걸릴 수 있음)
        const response3 = await robota.execute('프로그래밍에 대해 자세히 설명해주세요.');
        console.log(`3번째 요청 성공: ${response3.substring(0, 50)}...`);

    } catch (error) {
        console.log(`제한 초과 에러: ${(error as Error).message}`);
    }

    console.log(`최종 토큰 사용량: ${robota.getTotalTokensUsed()}`);
    console.log(`최종 요청 수: ${robota.getRequestCount()}\n`);
}

async function demonstrateUnlimitedMode(openaiProvider: OpenAIProvider) {
    console.log('=== 3. 무제한 설정 예제 ===');

    // 무제한 설정 (0 값 사용)
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: '간결하게 답변해주세요.',
        maxTokenLimit: 0,    // 무제한
        maxRequestLimit: 0   // 무제한
    });

    const limitInfo = robota.getLimitInfo();
    console.log('무제한 모드 확인:');
    console.log(`토큰 무제한: ${limitInfo.isTokensUnlimited}`);
    console.log(`요청 무제한: ${limitInfo.isRequestsUnlimited}`);
    console.log(`남은 토큰: ${limitInfo.remainingTokens ?? '무제한'}`);
    console.log(`남은 요청: ${limitInfo.remainingRequests ?? '무제한'}`);

    // 무제한 모드에서는 많은 요청도 가능
    const response = await robota.execute('타입스크립트의 장점을 상세히 설명해주세요.');
    console.log(`응답: ${response.substring(0, 100)}...`);
    console.log(`토큰 사용량: ${robota.getTotalTokensUsed()}\n`);
}

async function demonstrateTokenPrevention(openaiProvider: OpenAIProvider) {
    console.log('=== 4. 사전 토큰 계산을 통한 비용 절약 예제 ===');

    // 매우 낮은 토큰 제한 설정
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: '간결하게 답변해주세요.',
        maxTokenLimit: 50,   // 매우 낮은 제한
        debug: true          // 디버그 모드로 토큰 계산 과정 확인
    });

    console.log(`매우 낮은 토큰 제한 설정: ${robota.getMaxTokenLimit()}`);

    try {
        // 짧은 메시지 (성공할 것)
        console.log('\n짧은 메시지 시도...');
        const shortResponse = await robota.execute('안녕');
        console.log(`✅ 성공: ${shortResponse}`);
        console.log(`사용된 토큰: ${robota.getTotalTokensUsed()}`);

        // 긴 메시지 (사전 계산으로 차단될 것)
        console.log('\n긴 메시지 시도...');
        await robota.execute('타입스크립트의 모든 기능과 장점, 단점, 그리고 자바스크립트와의 차이점에 대해 매우 상세하게 설명해주세요. 또한 실제 프로젝트에서 어떻게 활용하는지와 베스트 프랙티스도 알려주세요.');

    } catch (error) {
        console.log(`❌ 사전 토큰 계산으로 요청 차단: ${(error as Error).message}`);
        console.log('💰 API 비용 절약 성공! 실제 API 호출 없이 제한 초과를 감지했습니다.');
    }

    console.log(`최종 토큰 사용량: ${robota.getTotalTokensUsed()}\n`);
}

async function demonstrateRequestLimits(openaiProvider: OpenAIProvider) {
    console.log('=== 5. 요청 제한 예제 ===');

    // 요청 수 제한
    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: '간결하게 답변해주세요.',
        maxTokenLimit: 5000,  // 충분한 토큰
        maxRequestLimit: 2    // 단 2회 요청만 허용
    });

    console.log(`요청 제한: ${robota.getMaxRequestLimit()}회`);

    try {
        // 첫 번째 요청
        console.log('1번째 요청...');
        await robota.execute('안녕하세요');
        console.log(`✅ 1번째 요청 성공 (남은 요청: ${robota.getLimitInfo().remainingRequests})`);

        // 두 번째 요청
        console.log('2번째 요청...');
        await robota.execute('감사합니다');
        console.log(`✅ 2번째 요청 성공 (남은 요청: ${robota.getLimitInfo().remainingRequests})`);

        // 세 번째 요청 (제한 초과)
        console.log('3번째 요청...');
        await robota.execute('또 다른 질문');

    } catch (error) {
        console.log(`❌ 요청 제한 초과: ${(error as Error).message}`);
    }

    console.log(`최종 요청 수: ${robota.getRequestCount()}\n`);
}

async function demonstrateRealTimeMonitoring(openaiProvider: OpenAIProvider) {
    console.log('=== 6. 실시간 모니터링 예제 ===');

    const robota = new Robota({
        aiProviders: { 'openai': openaiProvider },
        currentProvider: 'openai',
        currentModel: 'gpt-3.5-turbo',
        systemPrompt: '간결하게 답변해주세요.',
        maxTokenLimit: 500,
        maxRequestLimit: 5
    });

    // 모니터링 함수
    function printStatus(step: string) {
        const limitInfo = robota.getLimitInfo();
        const analytics = robota.getAnalytics();

        console.log(`\n[${step}] 현재 상태:`);
        console.log(`  토큰: ${limitInfo.currentTokensUsed}/${limitInfo.maxTokens} (남은: ${limitInfo.remainingTokens})`);
        console.log(`  요청: ${limitInfo.currentRequestCount}/${limitInfo.maxRequests} (남은: ${limitInfo.remainingRequests})`);
        console.log(`  평균 토큰/요청: ${analytics.averageTokensPerRequest.toFixed(1)}`);
    }

    printStatus('시작');

    // 여러 요청 실행하며 모니터링
    const questions = [
        '안녕하세요',
        '타입스크립트란?',
        'React는 무엇인가요?',
        'Node.js 설명'
    ];

    for (let i = 0; i < questions.length; i++) {
        try {
            console.log(`\n질문 ${i + 1}: "${questions[i]}"`);
            const response = await robota.execute(questions[i]);
            console.log(`응답: ${response.substring(0, 80)}...`);
            printStatus(`요청 ${i + 1} 완료`);

        } catch (error) {
            console.log(`❌ 요청 ${i + 1} 실패: ${(error as Error).message}`);
            break;
        }
    }

    // 최종 애널리틱스
    const finalAnalytics = robota.getAnalytics();
    console.log('\n📊 최종 애널리틱스:');
    console.log(`  총 요청 수: ${finalAnalytics.requestCount}`);
    console.log(`  총 토큰 사용량: ${finalAnalytics.totalTokensUsed}`);
    console.log(`  평균 토큰/요청: ${finalAnalytics.averageTokensPerRequest.toFixed(1)}`);

    // 시간대별 사용량 (최근 1분)
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const recentUsage = robota.getTokenUsageByPeriod(oneMinuteAgo);
    console.log(`  최근 1분간: ${recentUsage.requestCount}요청, ${recentUsage.totalTokens}토큰`);

    console.log('\n');
}

// 실행
main().catch(error => {
    console.error('오류 발생:', error);
}); 