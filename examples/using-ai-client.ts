/**
 * AI 클라이언트와 도구 제공자 사용 예제
 * 
 * 이 예제는 다음을 보여줍니다:
 * 1. OpenAIClient를 aiClient로 설정하는 방법
 * 2. 도구 제공자(Tool Provider)를 provider로 설정하는 방법
 * 3. AI 클라이언트와 도구 제공자의 조합 방법
 */

import { Robota, createOpenAPIToolProvider } from '@robota-sdk/core';
import { OpenAIClient } from '@robota-sdk/openai-client';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';

// 비동기 실행을 위한 메인 함수
async function main() {
    try {
        // OpenAI API 클라이언트 생성
        const openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // OpenAI 클라이언트 생성 (aiClient로 사용)
        const aiClient = new OpenAIClient({
            model: 'gpt-4',
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
            handler: async ({ operation, a, b }: { operation: string; a: number; b: number }) => {
                switch (operation) {
                    case 'add': return { result: a + b };
                    case 'subtract': return { result: a - b };
                    case 'multiply': return { result: a * b };
                    case 'divide': return b !== 0 ? { result: a / b } : { error: '0으로 나눌 수 없습니다' };
                    default: return { error: '지원되지 않는 연산입니다' };
                }
            }
        };

        // 날씨 조회 도구 정의
        const weatherTool = {
            name: 'getWeather',
            description: '특정 도시의 현재 날씨 정보를 가져옵니다',
            parameters: z.object({
                city: z.string().describe('날씨를 조회할 도시 이름')
            }),
            handler: async ({ city }: { city: string }) => {
                // 실제 구현에서는 날씨 API 호출 필요
                return {
                    temperature: 23,
                    condition: '맑음',
                    humidity: 60,
                    city
                };
            }
        };

        // 1. AI 클라이언트만 사용하는 방법
        const robotaWithAIOnly = new Robota({
            aiClient,
            systemPrompt: '당신은 유용한 AI 비서입니다.'
        });

        // AI만 사용하는 응답 생성
        const aiOnlyResponse = await robotaWithAIOnly.run('안녕하세요! 반갑습니다.');
        console.log('AI 클라이언트만 사용한 응답:', aiOnlyResponse);

        // 2. AI 클라이언트와 도구 제공자를 함께 사용하는 방법
        // Zod 함수 도구 제공자 생성
        const provider = createZodFunctionToolProvider({
            tools: {
                calculate: calculatorTool,
                getWeather: weatherTool
            }
        });

        // AI 클라이언트와 도구 제공자 모두 사용하는 Robota 인스턴스
        const robota = new Robota({
            aiClient,
            provider,
            systemPrompt: '당신은 유용한 AI 비서입니다. 필요한 경우 도구를 사용하여 사용자를 도울 수 있습니다.'
        });

        // 도구 사용 요청
        const calculationResponse = await robota.run('5와 3을 더하면 얼마인가요?');
        console.log('계산 도구 사용 응답:', calculationResponse);

        const weatherResponse = await robota.run('서울의 날씨는 어때요?');
        console.log('날씨 도구 사용 응답:', weatherResponse);

        // 3. OpenAPI 도구 제공자 예제 (주석 처리, 실제 구현 시 활성화)
        /*
        // OpenAPI 도구 제공자 생성
        const openApiProvider = createOpenAPIToolProvider('https://api.example.com/openapi.json', {
          baseUrl: 'https://api.example.com'
        });
        
        // OpenAPI 도구 제공자를 사용하는 Robota 인스턴스
        const robotaWithOpenApi = new Robota({
          aiClient,
          provider: openApiProvider
        });
        
        // API 호출 요청
        const apiResponse = await robotaWithOpenApi.run('최신 뉴스를 알려줘');
        console.log('API 호출 응답:', apiResponse);
        */

        // 4. 도구 직접 호출 예제
        try {
            // 도구 직접 호출
            const calculationResult = await robota.callTool('calculate', {
                operation: 'multiply',
                a: 7,
                b: 6
            });
            console.log('직접 도구 호출 결과:', calculationResult);
        } catch (error) {
            console.error('도구 호출 오류:', error);
        }

    } catch (error) {
        console.error('오류 발생:', error);
    }
}

// 메인 함수 실행
main().catch(console.error); 