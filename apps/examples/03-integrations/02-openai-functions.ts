/**
 * 02-openai-functions.ts
 * 
 * 이 예제는 Robota와 OpenAI 함수 호출 기능을 통합하는 방법을 보여줍니다:
 * - OpenAI Function Calling API 직접 사용
 * - Robota의 도구 체계와 연동
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
        console.log("===== OpenAI 함수 호출 통합 예제 =====");

        // API 키 확인
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
        }

        // OpenAI 클라이언트 생성
        const openaiClient = new OpenAI({ apiKey });

        // 날씨 API 도구 정의
        const weatherTool = {
            name: 'getWeather',
            description: '특정 위치의 현재 날씨 정보를 조회합니다',
            parameters: z.object({
                location: z.string().describe('날씨를 조회할 도시 이름'),
                unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('온도 단위')
            }),
            handler: async (params: { [key: string]: any }) => {
                const location = params.location;
                const unit = params.unit || 'celsius';
                console.log(`getWeather 함수 호출: ${location}, ${unit}`);

                // 실제 API 호출 대신 모의 데이터 반환
                const weatherData: Record<string, any> = {
                    '서울': { temp: 22, condition: '맑음', humidity: 65 },
                    '부산': { temp: 25, condition: '구름 조금', humidity: 70 },
                    '제주': { temp: 27, condition: '흐림', humidity: 80 },
                    '뉴욕': { temp: 19, condition: '비', humidity: 75 },
                    '런던': { temp: 16, condition: '안개', humidity: 85 },
                    '도쿄': { temp: 24, condition: '맑음', humidity: 68 },
                };

                // 도시 이름 매칭 시도
                const cityMatch = Object.keys(weatherData).find(
                    city => location.toLowerCase().includes(city.toLowerCase())
                );

                if (!cityMatch) {
                    return {
                        error: '해당 위치의 날씨 정보를 찾을 수 없습니다',
                        available_cities: Object.keys(weatherData).join(', ')
                    };
                }

                const data = weatherData[cityMatch];
                const temp = unit === 'fahrenheit'
                    ? Math.round(data.temp * 9 / 5 + 32)
                    : data.temp;

                return {
                    location: cityMatch,
                    temperature: temp,
                    unit: unit === 'celsius' ? 'C' : 'F',
                    condition: data.condition,
                    humidity: data.humidity
                };
            }
        };

        // 번역 도구 정의
        const translateTool = {
            name: 'translateText',
            description: '텍스트를 다른 언어로 번역합니다',
            parameters: z.object({
                text: z.string().describe('번역할 텍스트'),
                target_language: z.string().describe('대상 언어 (예: 영어, 한국어, 일본어, 중국어, 프랑스어)')
            }),
            handler: async (params: { [key: string]: any }) => {
                const text = params.text;
                const target_language = params.target_language;
                console.log(`translateText 함수 호출: "${text}" -> ${target_language}`);

                // 실제 번역 API 호출 대신 모의 응답
                // 실제 구현에서는 번역 API를 사용해야 합니다
                return {
                    original_text: text,
                    translated_text: `[${target_language}로 번역된 텍스트: ${text}]`,
                    target_language
                };
            }
        };

        // 도구 제공자 생성
        const toolProvider = createZodFunctionToolProvider({
            tools: {
                getWeather: weatherTool,
                translateText: translateTool
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
            systemPrompt: '당신은 날씨 정보와 번역 기능을 제공하는 유능한 어시스턴트입니다. 사용자의 질문에 적절한 도구를 사용하여 답변하세요.'
        });

        // 테스트 질문들
        const questions = [
            '오늘 서울의 날씨가 어때?',
            '도쿄의 기온이 어떤가요? 화씨로 알려주세요.',
            '"안녕하세요. 반갑습니다"를 영어로 번역해주세요.',
            '런던 날씨와 "좋은 하루 되세요"를 일본어로 번역해줘요.'
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

        // 스트리밍 응답 예제
        console.log("\n----- 스트리밍 응답 예제 -----");
        console.log("사용자: 서울과 뉴욕의 날씨를 비교해서 알려줘");
        console.log("어시스턴트: ");

        try {
            const stream = await robota.runStream("서울과 뉴욕의 날씨를 비교해서 알려줘");
            for await (const chunk of stream) {
                process.stdout.write(chunk.content || "");
            }
            console.log("\n");
        } catch (err) {
            console.error("스트리밍 응답 오류:", err);
        }

        console.log("===== OpenAI 함수 호출 통합 예제 완료 =====");
    } catch (error) {
        console.error("오류 발생:", error);
    }
}

// 실행
main().catch(console.error); 