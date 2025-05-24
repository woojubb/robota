/**
 * 03-api-integration.ts
 * 
 * 이 예제는 Robota와 외부 API를 통합하는 방법을 보여줍니다:
 * - 외부 API 호출을 위한 도구 구현
 * - API 결과를 처리하고 응답하는 방법
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
        console.log("===== 외부 API 통합 예제 =====");

        // API 키 확인
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
        }

        // OpenAI 클라이언트 생성
        const openaiClient = new OpenAI({ apiKey });

        // 환율 변환 API 도구 정의
        const exchangeRateTool = {
            name: 'getExchangeRate',
            description: '두 통화 간의 환율 정보를 조회합니다',
            parameters: z.object({
                from_currency: z.string().describe('변환할 통화 코드 (예: USD, EUR, KRW)'),
                to_currency: z.string().describe('대상 통화 코드 (예: USD, EUR, KRW)'),
                amount: z.number().optional().describe('변환할 금액 (기본값: 1)')
            }),
            handler: async (params: { [key: string]: any }) => {
                const from = params.from_currency.toUpperCase();
                const to = params.to_currency.toUpperCase();
                const amount = params.amount || 1;

                console.log(`환율 조회: ${from} -> ${to}, 금액: ${amount}`);

                try {
                    // 모의 환율 데이터 (실제로는 API 호출)
                    const exchangeRates: Record<string, Record<string, number>> = {
                        'USD': { 'EUR': 0.92, 'KRW': 1350.45, 'JPY': 154.32, 'GBP': 0.78 },
                        'EUR': { 'USD': 1.09, 'KRW': 1470.23, 'JPY': 168.75, 'GBP': 0.85 },
                        'KRW': { 'USD': 0.00074, 'EUR': 0.00068, 'JPY': 0.113, 'GBP': 0.00058 },
                        'JPY': { 'USD': 0.0065, 'EUR': 0.0059, 'KRW': 8.85, 'GBP': 0.0051 },
                        'GBP': { 'USD': 1.28, 'EUR': 1.17, 'KRW': 1730.25, 'JPY': 196.45 }
                    };

                    if (!exchangeRates[from] || !exchangeRates[from][to]) {
                        return {
                            error: `지원되지 않는 통화 변환: ${from} -> ${to}`,
                            supported_currencies: Object.keys(exchangeRates).join(', ')
                        };
                    }

                    const rate = exchangeRates[from][to];
                    const convertedAmount = amount * rate;

                    return {
                        from_currency: from,
                        to_currency: to,
                        exchange_rate: rate,
                        amount: amount,
                        converted_amount: convertedAmount
                    };
                } catch (error) {
                    return { error: `환율 조회 실패: ${(error as Error).message}` };
                }
            }
        };

        // 주식 시세 조회 API 도구 정의
        const stockQuoteTool = {
            name: 'getStockQuote',
            description: '주식 심볼에 대한 현재 시세를 조회합니다',
            parameters: z.object({
                symbol: z.string().describe('주식 심볼 (예: AAPL, MSFT, GOOG)'),
                include_details: z.boolean().optional().default(false).describe('추가 세부 정보 포함 여부')
            }),
            handler: async (params: { [key: string]: any }) => {
                const symbol = params.symbol.toUpperCase();
                const includeDetails = params.include_details || false;

                console.log(`주식 시세 조회: ${symbol}, 상세정보: ${includeDetails}`);

                try {
                    // 모의 주식 데이터 (실제로는 주식 API 호출)
                    const stocks: Record<string, any> = {
                        'AAPL': { price: 182.63, change: 1.25, change_percent: 0.69, volume: 52_500_000, company: 'Apple Inc.' },
                        'MSFT': { price: 410.34, change: -2.45, change_percent: -0.59, volume: 28_300_000, company: 'Microsoft Corporation' },
                        'GOOG': { price: 159.13, change: 0.87, change_percent: 0.55, volume: 18_900_000, company: 'Alphabet Inc.' },
                        'AMZN': { price: 178.15, change: 3.21, change_percent: 1.83, volume: 41_200_000, company: 'Amazon.com Inc.' },
                        'META': { price: 474.99, change: -8.32, change_percent: -1.72, volume: 16_800_000, company: 'Meta Platforms Inc.' },
                        'TSLA': { price: 247.85, change: 5.67, change_percent: 2.34, volume: 89_600_000, company: 'Tesla, Inc.' }
                    };

                    if (!stocks[symbol]) {
                        return {
                            error: `주식 심볼을 찾을 수 없음: ${symbol}`,
                            available_symbols: Object.keys(stocks).join(', ')
                        };
                    }

                    const stockData = stocks[symbol];

                    // 기본 정보 반환
                    const result: Record<string, any> = {
                        symbol: symbol,
                        price: stockData.price,
                        change: stockData.change,
                        change_percent: stockData.change_percent,
                        company: stockData.company
                    };

                    // 추가 세부 정보 요청 시 포함
                    if (includeDetails) {
                        result.volume = stockData.volume;
                        result.market_cap = Math.round(stockData.price * (stockData.volume * 10));
                        result.pe_ratio = (stockData.price / (stockData.price / 20 + Math.random() * 5)).toFixed(2);
                        result.dividend_yield = (Math.random() * 2).toFixed(2) + '%';
                    }

                    return result;
                } catch (error) {
                    return { error: `주식 시세 조회 실패: ${(error as Error).message}` };
                }
            }
        };

        // 도구 제공자 생성
        const toolProvider = createZodFunctionToolProvider({
            tools: {
                getExchangeRate: exchangeRateTool,
                getStockQuote: stockQuoteTool
            }
        });

        // OpenAI 제공자 생성
        const aiProvider = new OpenAIProvider({
            model: 'gpt-3.5-turbo',
            client: openaiClient
        });

        // Robota 인스턴스 생성
        const robota = new Robota({
            aiClient: aiProvider,
            provider: toolProvider,
            systemPrompt: '당신은 금융 정보를 제공하는 어시스턴트입니다. 사용자의 질문에 적절한 도구를 사용하여 환율과 주식 정보를 정확하게 알려주세요.'
        });

        // 테스트 질문들
        const questions = [
            '달러를 원화로 바꾸면 얼마예요?',
            '100 유로는 몇 달러인가요?',
            '애플 주식 현재 가격이 얼마죠?',
            '테슬라와 마이크로소프트 주가를 비교해서 알려줘',
            '애플 주식에 대해 모든 정보를 알려주세요'
        ];

        // 순차적으로 질문 처리
        for (const question of questions) {
            console.log(`\n사용자: ${question}`);
            try {
                const response = await robota.run(question);
                console.log(`어시스턴트: ${response}`);
            } catch (err) {
                console.error(`오류 발생: ${err}`);
            }
        }

        // 스트리밍 예제
        console.log("\n----- 스트리밍 응답 예제 -----");
        console.log("사용자: 애플과 구글 주식을 비교하고 50,000원을 달러로 환전하면 얼마인지 계산해줘.");
        console.log("어시스턴트: ");

        try {
            const stream = await robota.runStream("애플과 구글 주식을 비교하고 50,000원을 달러로 환전하면 얼마인지 계산해줘.");
            for await (const chunk of stream) {
                process.stdout.write(chunk.content || "");
            }
            console.log('\n');
        } catch (err) {
            console.error("스트리밍 응답 오류:", err);
        }

        console.log("===== 외부 API 통합 예제 완료 =====");
    } catch (error) {
        console.error("오류 발생:", error);
    }
}

// 실행
main().catch(console.error); 