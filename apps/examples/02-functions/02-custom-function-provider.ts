/**
 * 02-custom-function-provider.ts
 * 
 * 이 예제는 커스텀 함수 제공자를 구현하는 방법을 보여줍니다:
 * - 직접 Tool Provider 인터페이스 구현
 * - 함수를 JSON Schema로 변환
 * - OpenAI와 함께 사용
 */

import { Robota } from "@robota-sdk/core";
import { OpenAIProvider } from "@robota-sdk/openai";
import type { ToolProvider, FunctionSchema } from "@robota-sdk/tools";
import OpenAI from "openai";
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

// 환경 변수 로드
dotenv.config();

// JSON Schema 타입 정의
type JSONSchema = {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
};

/**
 * 사용자 정의 함수 도구 제공자 클래스
 * ToolProvider 인터페이스를 직접 구현합니다
 */
class CustomFunctionToolProvider implements ToolProvider {
    private functions: Record<string, {
        name: string;
        description: string;
        schema: JSONSchema;
        handler: (params: any) => Promise<any>;
    }>;

    private functionSchemas: FunctionSchema[];

    constructor(functions: Record<string, {
        name: string;
        description: string;
        schema: JSONSchema;
        handler: (params: any) => Promise<any>;
    }>) {
        this.functions = functions;
        // FunctionSchema 배열로 변환
        this.functionSchemas = Object.values(functions).map(fn => ({
            name: fn.name,
            description: fn.description,
            parameters: fn.schema
        }));
    }

    // 도구 목록 반환
    getTools() {
        // OpenAI 함수 호출 형식으로 변환
        return Object.values(this.functions).map(fn => ({
            type: 'function' as const,
            function: {
                name: fn.name,
                description: fn.description,
                parameters: fn.schema
            }
        }));
    }

    // 함수 호출
    async callFunction(name: string, params: any) {
        const fn = this.functions[name];
        if (!fn) {
            throw new Error(`함수가 존재하지 않습니다: ${name}`);
        }
        console.log(`함수 '${name}' 호출:`, params);
        return await fn.handler(params);
    }

    // 도구 이름 받기 
    getToolNames() {
        return Object.keys(this.functions);
    }

    // 도구 호출하기
    async callTool(name: string, params: any) {
        return this.callFunction(name, params);
    }

    // 도구 ID 생성
    createToolCallId() {
        return randomUUID();
    }
}

async function main() {
    try {
        // API 키 확인
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
        }

        // OpenAI 클라이언트 생성
        const openaiClient = new OpenAI({
            apiKey
        });

        // 사용자 정의 함수들 정의
        const customFunctions = {
            fetchStockPrice: {
                name: 'fetchStockPrice',
                description: '주식의 현재 가격을 조회합니다',
                schema: {
                    type: 'object',
                    properties: {
                        symbol: {
                            type: 'string',
                            description: '주식 심볼 (예: AAPL, MSFT, GOOG)'
                        }
                    },
                    required: ['symbol']
                },
                handler: async (params: { symbol: string }) => {
                    const { symbol } = params;
                    // 실제로는 API 호출, 여기서는 예시 데이터
                    const stockPrices: Record<string, number> = {
                        'AAPL': 182.63,
                        'MSFT': 410.34,
                        'GOOG': 159.13,
                        'AMZN': 178.15,
                        'META': 474.99
                    };

                    const price = stockPrices[symbol.toUpperCase()] || Math.random() * 1000;
                    return { symbol: symbol.toUpperCase(), price, currency: 'USD' };
                }
            },

            convertCurrency: {
                name: 'convertCurrency',
                description: '통화 간 금액을 변환합니다',
                schema: {
                    type: 'object',
                    properties: {
                        amount: {
                            type: 'number',
                            description: '변환할 금액'
                        },
                        from: {
                            type: 'string',
                            description: '변환할 통화 (예: USD, EUR, KRW)'
                        },
                        to: {
                            type: 'string',
                            description: '변환 대상 통화 (예: USD, EUR, KRW)'
                        }
                    },
                    required: ['amount', 'from', 'to']
                },
                handler: async (params: { amount: number; from: string; to: string }) => {
                    const { amount, from, to } = params;

                    // 예시 환율 데이터 (실제로는 API 호출)
                    const exchangeRates: Record<string, Record<string, number>> = {
                        'USD': { 'EUR': 0.92, 'KRW': 1350.45, 'JPY': 154.32 },
                        'EUR': { 'USD': 1.09, 'KRW': 1470.23, 'JPY': 168.75 },
                        'KRW': { 'USD': 0.00074, 'EUR': 0.00068, 'JPY': 0.113 },
                        'JPY': { 'USD': 0.0065, 'EUR': 0.0059, 'KRW': 8.85 }
                    };

                    // 같은 통화면 그대로 반환
                    if (from === to) {
                        return { amount, currency: to };
                    }

                    // 환율 확인
                    if (!exchangeRates[from] || !exchangeRates[from][to]) {
                        return { error: `지원되지 않는 통화 변환: ${from} -> ${to}` };
                    }

                    const rate = exchangeRates[from][to];
                    const convertedAmount = amount * rate;

                    return {
                        original: { amount, currency: from },
                        converted: { amount: convertedAmount, currency: to },
                        rate: rate
                    };
                }
            }
        };

        // 사용자 정의 함수 제공자 생성
        const customProvider = new CustomFunctionToolProvider(customFunctions);

        // OpenAI 제공자 생성
        const aiClient = new OpenAIProvider({
            model: 'gpt-3.5-turbo',
            client: openaiClient
        });

        // Robota 인스턴스 생성
        const robota = new Robota({
            aiClient,
            provider: customProvider,
            systemPrompt: '당신은 금융 정보를 제공하는 AI 비서입니다. 사용자의 요청에 대해 주식 가격과 통화 변환 도구를 사용하여 정확한 정보를 제공해주세요.'
        });

        // 테스트 쿼리
        const queries = [
            "애플 주식의 현재 가격이 얼마야?",
            "마이크로소프트와 구글의 주가를 알려줘",
            "100 달러는 몇 유로인가요?",
            "5000 원을 달러로 바꾸면 얼마야?"
        ];

        // 순차적으로 질문 처리
        for (const query of queries) {
            console.log(`\n사용자: ${query}`);
            const response = await robota.run(query);
            console.log(`로봇: ${response}`);
        }

    } catch (error) {
        console.error("오류 발생:", error);
    }
}

// 실행
main().catch(console.error); 