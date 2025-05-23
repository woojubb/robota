/**
 * 02-ai-with-tools.ts
 * 
 * 이 예제는 Robota에서 AI와 도구를 함께 사용하는 방법을 보여줍니다:
 * - OpenAIProvider를 aiClient로 사용
 * - 간단한 도구 정의 및 사용
 * - 도구 직접 호출하기
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

async function main() {
    try {
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
        const aiClient = new OpenAIProvider({
            model: 'gpt-3.5-turbo',
            client: openaiClient
        });

        // 간단한 계산기 도구 정의
        const calculatorTool = {
            name: 'calculate',
            description: '수학 계산을 수행합니다',
            parameters: z.object({
                operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('수행할 연산'),
                a: z.number().describe('첫 번째 숫자'),
                b: z.number().describe('두 번째 숫자')
            }),
            handler: async (params) => {
                const { operation, a, b } = params;
                console.log(`계산 수행: ${a} ${operation} ${b}`);
                switch (operation) {
                    case 'add': return { result: a + b };
                    case 'subtract': return { result: a - b };
                    case 'multiply': return { result: a * b };
                    case 'divide': return b !== 0 ? { result: a / b } : { error: '0으로 나눌 수 없습니다' };
                    default: return { error: '지원되지 않는 연산입니다' };
                }
            }
        };

        // 도구 제공자 생성
        const toolProvider = createZodFunctionToolProvider({
            tools: {
                calculate: calculatorTool
            }
        });

        // AI와 도구를 함께 사용하는 Robota 인스턴스
        const robota = new Robota({
            aiClient,
            provider: toolProvider,
            systemPrompt: '당신은 유용한 AI 비서입니다. 필요한 경우 계산 도구를 사용하여 사용자를 도울 수 있습니다.'
        });

        // 도구 없이 간단한 대화
        console.log('===== 일반 대화 예제 =====');
        const response1 = await robota.run('안녕하세요! 오늘 날씨가 어때요?');
        console.log('응답:', response1);

        // 도구를 사용하는 대화
        console.log('\n===== 도구 사용 예제 =====');
        const response2 = await robota.run('5와 7을 곱해주세요.');
        console.log('응답:', response2);

        // 도구 직접 호출
        console.log('\n===== 도구 직접 호출 예제 =====');
        const directResult = await robota.callTool('calculate', {
            operation: 'multiply',
            a: 8,
            b: 9
        });
        console.log('직접 도구 호출 결과:', directResult);

    } catch (error) {
        console.error('오류 발생:', error);
    }
}

// 실행
main().catch(console.error); 