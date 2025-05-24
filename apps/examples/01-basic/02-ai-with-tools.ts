/**
 * 02-ai-with-tools.ts
 * 
 * 이 예제는 Robota에서 AI와 도구를 함께 사용하는 방법을 보여줍니다:
 * - OpenAI 클라이언트를 aiClient로 사용
 * - 간단한 도구 정의 및 등록
 * - AI가 자동으로 필요한 도구를 호출하는 플로우
 * - 복잡한 계산도 AI가 단계별로 처리
 */

import { Robota, OpenAIProvider } from '@robota-sdk/core';
import type { Logger } from '@robota-sdk/core';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';
import dotenv from 'dotenv';
import chalk from 'chalk';

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
        const openaiProvider = new OpenAIProvider(openaiClient);

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
                console.log(`[도구 핸들러] 계산 수행: ${a} ${operation} ${b}`);
                let result;
                switch (operation) {
                    case 'add': result = { result: a + b }; break;
                    case 'subtract': result = { result: a - b }; break;
                    case 'multiply': result = { result: a * b }; break;
                    case 'divide': result = b !== 0 ? { result: a / b } : { error: '0으로 나눌 수 없습니다' }; break;
                    default: result = { error: '지원되지 않는 연산입니다' };
                }
                console.log(`[도구 핸들러] 계산 결과:`, result);
                return result;
            }
        };

        // 도구 제공자 생성
        const toolProvider = createZodFunctionToolProvider({
            tools: {
                calculate: calculatorTool
            }
        });

        // 도구 제공자 디버그
        console.log('도구 제공자:', toolProvider);
        console.log('도구 제공자 functions:', toolProvider.functions);
        console.log('functions 개수:', toolProvider.functions?.length || 0);

        // 커스텀 로거 정의
        const customLogger: Logger = {
            info: (message: string, ...args: any[]) => console.log(chalk.blue('ℹ️'), message, ...args),
            debug: (message: string, ...args: any[]) => console.log(chalk.gray('🐛'), message, ...args),
            warn: (message: string, ...args: any[]) => console.warn(chalk.yellow('⚠️'), message, ...args),
            error: (message: string, ...args: any[]) => console.error(chalk.red('❌'), message, ...args)
        };

        // AI와 도구를 함께 사용하는 Robota 인스턴스 (커스텀 로거 사용)
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            toolProviders: [toolProvider],
            systemPrompt: '당신은 유용한 AI 비서입니다. 수학 계산이 필요한 경우 반드시 calculate 도구를 사용해야 합니다. 직접 계산하지 마세요.',
            debug: true,  // 도구 호출 로깅 활성화
            logger: customLogger  // 커스텀 로거 사용
        });

        // Robota 인스턴스 디버그
        console.log('Robota toolProviders 개수:', robota['toolProviders']?.length || 0);

        // 사용 가능한 도구 확인
        console.log('===== 사용 가능한 도구들 =====');
        const availableTools = robota.getAvailableTools();
        console.log('등록된 도구들:', availableTools.map(tool => tool.name));
        console.log('도구 스키마:', JSON.stringify(availableTools, null, 2));

        // 도구 없이 간단한 대화
        console.log('\n===== 일반 대화 예제 =====');
        try {
            const response1 = await robota.run('안녕하세요! 오늘 날씨가 어때요?');
            console.log('응답:', response1);
        } catch (error) {
            console.error('일반 대화 오류:', error);
        }

        // 도구를 사용하는 대화
        console.log('\n===== 도구 사용 예제 =====');
        try {
            console.log('도구 사용 요청 시작...');
            const response2 = await robota.run('계산 도구를 사용해서 5와 7을 곱해주세요.');
            console.log('응답:', response2);
        } catch (error) {
            console.error('도구 사용 오류:', error);
        }

        console.log('\n===== 복잡한 계산 예제 =====');
        try {
            const response3 = await robota.run('100을 25로 나누고, 그 결과에 3을 더해주세요.');
            console.log('응답:', response3);
        } catch (error) {
            console.error('복잡한 계산 오류:', error);
        }

        // 기본 console 로거 및 debug 모드 비활성화 테스트
        console.log('\n===== 기본 로거 & debug 비활성화 테스트 =====');
        const robotaDefault = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            toolProviders: [toolProvider],
            debug: false  // debug 모드 비활성화 (기본값)
        });

        try {
            const response4 = await robotaDefault.run('10을 2로 나누어주세요.');
            console.log('응답 (로깅 없음):', response4);
        } catch (error) {
            console.error('기본 로거 테스트 오류:', error);
        }

    } catch (error) {
        console.error('오류 발생:', error);
    }
}

// 실행
main().catch(console.error); 