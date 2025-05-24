/**
 * 05-conversation-history-test.ts
 * 
 * 이 예제는 Robota의 대화 히스토리가 제대로 순차적으로 쌓이는지 확인합니다:
 * - 사용자 메시지와 어시스턴트 응답이 올바른 순서로 추가되는지 확인
 * - 여러 번의 대화 후 히스토리 상태 검증
 * - Provider 전환 시 히스토리 유지 확인
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import OpenAI from 'openai';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

// 히스토리 확인 함수
function printHistory(robota: Robota, step: string) {
    const history = (robota as any).conversationHistory;
    const messages = history.getMessages();
    console.log(`\n📋 ${step} - 현재 대화 히스토리 (총 ${messages.length}개):`);
    messages.forEach((msg: any, index: number) => {
        console.log(`  ${index + 1}. [${msg.role}] ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
    });
    console.log('');
}

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

        // Robota 인스턴스 생성
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            systemPrompt: '당신은 대화 히스토리 테스트를 위한 어시스턴트입니다. 간단하고 명확하게 답변해주세요.'
        });

        console.log('🧪 대화 히스토리 테스트 시작!\n');

        // 초기 상태 확인
        printHistory(robota, '초기 상태');

        // 첫 번째 대화
        console.log('🗣️  첫 번째 질문을 합니다...');
        const response1 = await robota.run('안녕하세요! 저는 김철수입니다.');
        console.log(`💬 응답: ${response1}`);
        printHistory(robota, '첫 번째 대화 후');

        // 두 번째 대화
        console.log('🗣️  두 번째 질문을 합니다...');
        const response2 = await robota.run('제 이름을 기억하시나요?');
        console.log(`💬 응답: ${response2}`);
        printHistory(robota, '두 번째 대화 후');

        // 세 번째 대화
        console.log('🗣️  세 번째 질문을 합니다...');
        const response3 = await robota.run('오늘 날씨가 어떤가요?');
        console.log(`💬 응답: ${response3}`);
        printHistory(robota, '세 번째 대화 후');

        console.log(`\n${'='.repeat(80)}`);
        console.log('🔄 Provider 전환 테스트');
        console.log(`${'='.repeat(80)}\n`);

        // 같은 provider 내에서 모델 전환
        console.log('🔄 gpt-4로 모델 전환...');
        robota.setCurrentAI('openai', 'gpt-4');
        printHistory(robota, '모델 전환 후 (gpt-4)');

        console.log('🗣️  모델 전환 후 질문...');
        const response4 = await robota.run('이전 대화 내용을 요약해주세요.');
        console.log(`💬 응답: ${response4}`);
        printHistory(robota, '모델 전환 후 대화');

        console.log(`\n${'='.repeat(80)}`);
        console.log('🚨 잘못된 사용법 시뮬레이션 (같은 질문 반복)');
        console.log(`${'='.repeat(80)}\n`);

        // 문제가 되는 패턴: 같은 질문을 여러 번 보내기
        const sameQuestion = '이것은 테스트 질문입니다.';

        console.log('⚠️  같은 질문을 3번 연속으로 보냅니다...');

        for (let i = 1; i <= 3; i++) {
            console.log(`🗣️  ${i}번째 같은 질문: "${sameQuestion}"`);
            const response = await robota.run(sameQuestion);
            console.log(`💬 응답 ${i}: ${response.substring(0, 100)}...`);
            printHistory(robota, `${i}번째 같은 질문 후`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('🎯 올바른 사용법: 각기 다른 질문');
        console.log(`${'='.repeat(80)}\n`);

        // 히스토리 초기화
        console.log('🧹 대화 히스토리 초기화...');
        robota.clearConversationHistory();
        printHistory(robota, '히스토리 초기화 후');

        // 서로 다른 질문들
        const questions = [
            '안녕하세요!',
            '오늘 뭐 하세요?',
            'TypeScript에 대해 알려주세요.',
            '감사합니다!'
        ];

        for (let i = 0; i < questions.length; i++) {
            console.log(`🗣️  질문 ${i + 1}: "${questions[i]}"`);
            const response = await robota.run(questions[i]);
            console.log(`💬 응답 ${i + 1}: ${response.substring(0, 100)}...`);
            printHistory(robota, `질문 ${i + 1} 후`);
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log('✅ 테스트 완료!');
        console.log('📊 결론:');
        console.log('   - 각 robota.run() 호출마다 사용자 메시지가 히스토리에 추가됩니다');
        console.log('   - 같은 질문을 여러 번 보내면 히스토리에 중복으로 쌓입니다');
        console.log('   - Provider/모델 전환 시에도 히스토리는 유지됩니다');
        console.log('   - 여러 provider 비교 시에는 히스토리 관리가 필요합니다');
        console.log(`${'='.repeat(80)}`);

    } catch (error) {
        console.error('❌ 오류 발생:', error);
    }
}

// 실행
main().catch(console.error); 