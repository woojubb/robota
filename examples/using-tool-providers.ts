/**
 * 도구 제공자를 활용한 Robota 예제
 * 
 * 이 예제는 다음을 보여줍니다:
 * 1. OpenAIProvider를 aiClient로 설정하는 방법
 * 2. createZodFunctionToolProvider를 provider로 설정하는 방법
 * 3. createOpenAPIToolProvider 사용 방법
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/provider-openai';
import { createZodFunctionToolProvider, createOpenAPIToolProvider, type ZodFunctionTool } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';

// 비동기 실행을 위한 메인 함수
async function main() {
    try {
        // OpenAI 클라이언트 생성
        const openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        // OpenAI Provider 생성 (aiClient로 사용)
        const openaiProvider = new OpenAIProvider({
            model: 'gpt-4',
            client: openaiClient
        });

        // 간단한 계산기 도구 정의
        const calculatorTool: ZodFunctionTool<z.ZodObject<any>> = {
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
        const weatherTool: ZodFunctionTool<z.ZodObject<any>> = {
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

        // 1. Zod 함수 도구 제공자 생성
        const zodToolProvider = createZodFunctionToolProvider({
            tools: {
                calculate: calculatorTool,
                getWeather: weatherTool
            }
        });

        // Robota 인스턴스 생성 (OpenAI Provider를 aiClient로, Zod 함수 도구 제공자를 provider로 사용)
        const robota = new Robota({
            aiClient: openaiProvider,
            provider: zodToolProvider,
            systemPrompt: '당신은 유용한 AI 비서입니다. 필요한 경우 도구를 사용하여 사용자를 도울 수 있습니다.'
        });

        // 사용자 메시지에 응답
        const response1 = await robota.run('서울의 날씨는 어때?');
        console.log('응답 1:', response1);

        const response2 = await robota.run('5와 3을 더하면 얼마야?');
        console.log('응답 2:', response2);

        // OpenAPI 도구 제공자 사용 예제 (주석 처리, 실제 구현 시 활성화)
        /*
        // OpenAPI 명세 URL
        const openApiSpec = 'https://api.example.com/openapi.json';
        
        // OpenAPI 도구 제공자 생성
        const openApiToolProvider = createOpenAPIToolProvider(openApiSpec, {
          baseUrl: 'https://api.example.com'
        });
        
        // OpenAPI 도구 제공자를 사용하는 Robota 인스턴스
        const robotaOpenApi = new Robota({
          aiClient: openaiProvider,
          provider: openApiToolProvider
        });
        */

    } catch (error) {
        console.error('오류 발생:', error);
    }
}

// 메인 함수 실행
main().catch(console.error); 