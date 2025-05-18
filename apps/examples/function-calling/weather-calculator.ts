/**
 * 함수 호출 예제: 날씨 및 계산기 기능
 * 
 * 이 예제는 AI가 외부 함수를 호출하여 날씨 정보를 가져오고
 * 계산을 수행하는 방법을 보여줍니다.
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
// 참고: 실제 패키지와 함수명은 다를 수 있습니다. 이 예제는 개념을 보여주기 위한 것입니다.
// OpenAI 함수/도구 제공업체를 사용합니다.
import OpenAI from 'openai';
import dotenv from 'dotenv';
import axios from 'axios';
import { z } from 'zod';

// 환경 변수 로드
dotenv.config();

async function main() {
    // API 키 검증
    const apiKey = process.env.OPENAI_API_KEY;
    const weatherApiKey = process.env.WEATHER_API_KEY; // 예: OpenWeatherMap API 키

    if (!apiKey) {
        throw new Error('OPENAI_API_KEY 환경 변수가 필요합니다');
    }

    // OpenAI 클라이언트 생성
    const openaiClient = new OpenAI({
        apiKey
    });

    // 함수 정의 - zod 스키마 사용
    const getWeatherFunction = {
        name: 'getWeather',
        description: '특정 위치의 날씨 정보를 조회합니다.',
        parameters: z.object({
            location: z.string().describe('날씨를 검색할 위치 (도시명)'),
            unit: z.enum(['celsius', 'fahrenheit']).default('celsius').describe('온도 단위 (celsius 또는 fahrenheit)')
        }),
        execute: async (params: { location: string, unit: 'celsius' | 'fahrenheit' }) => {
            console.log(`${params.location}의 날씨를 ${params.unit} 단위로 검색 중...`);

            // 실제 구현에서는 날씨 API 호출
            // 예시 구현 (실제로는 유효한 API 키가 필요)
            if (weatherApiKey) {
                try {
                    const response = await axios.get(
                        `https://api.openweathermap.org/data/2.5/weather?q=${params.location}&appid=${weatherApiKey}&units=${params.unit === 'celsius' ? 'metric' : 'imperial'}`
                    );

                    return {
                        temperature: response.data.main.temp,
                        condition: response.data.weather[0].description,
                        humidity: response.data.main.humidity,
                        unit: params.unit
                    };
                } catch (error) {
                    console.error('날씨 API 호출 중 오류:', error);
                }
            }

            // 테스트용 가상 데이터 (API 키가 없는 경우)
            return {
                temperature: params.unit === 'celsius' ? 22 : 71.6,
                condition: '맑음',
                humidity: 65,
                unit: params.unit
            };
        }
    };

    const calculateFunction = {
        name: 'calculate',
        description: '수학 계산을 수행합니다.',
        parameters: z.object({
            expression: z.string().describe('계산할 수학 표현식 (예: 2 + 2)')
        }),
        execute: async (params: { expression: string }) => {
            console.log(`계산 중: ${params.expression}`);

            // 주의: eval은 보안상 위험할 수 있습니다. 실제 사용시 안전한 대안을 고려하세요.
            try {
                // 간단한 검증 (숫자와 기본 연산자만 허용)
                if (/^[0-9+\-*/().\s]*$/.test(params.expression)) {
                    return { result: eval(params.expression) };
                } else {
                    return { error: '지원되지 않는 표현식입니다. 숫자와 기본 연산자(+, -, *, /)만 사용하세요.' };
                }
            } catch (error) {
                return { error: '계산 중 오류가 발생했습니다.' };
            }
        }
    };

    const convertTemperatureFunction = {
        name: 'convertTemperature',
        description: '온도를 변환합니다.',
        parameters: z.object({
            temperature: z.number().describe('변환할 온도'),
            from: z.enum(['celsius', 'fahrenheit']).describe('변환 전 단위'),
            to: z.enum(['celsius', 'fahrenheit']).describe('변환 후 단위')
        }),
        execute: async (params: { temperature: number, from: 'celsius' | 'fahrenheit', to: 'celsius' | 'fahrenheit' }) => {
            console.log(`온도 변환 중: ${params.temperature} ${params.from} -> ${params.to}`);

            if (params.from === params.to) {
                return { result: params.temperature, unit: params.to };
            }

            let result: number;
            if (params.from === 'celsius' && params.to === 'fahrenheit') {
                result = (params.temperature * 9 / 5) + 32;
            } else {
                result = (params.temperature - 32) * 5 / 9;
            }

            return {
                result: Math.round(result * 10) / 10, // 소수점 첫째 자리까지 반올림
                unit: params.to
            };
        }
    };

    // 도구 제공자 생성
    // 참고: 실제 구현에서는 createOpenAIToolProvider와 같은 함수를 사용할 수 있습니다.
    const toolProvider = new OpenAIProvider({
        model: 'gpt-4',
        client: openaiClient,
        tools: [getWeatherFunction, calculateFunction, convertTemperatureFunction]
    });

    // Robota 인스턴스 생성
    const robota = new Robota({
        provider: toolProvider,
        systemPrompt: `당신은 도움이 되는 AI 어시스턴트입니다. 
날씨 정보와 계산 기능을 제공할 수 있습니다.
사용자의 요청에 따라 적절한 함수를 호출하여 정확한 정보를 제공하세요.`
    });

    // 자동 함수 호출 모드로 실행
    console.log('===== 자동 함수 호출 모드 =====');

    const response1 = await robota.run('서울의 현재 날씨가 어떤지 알려주고, 온도를 화씨로 변환해줘.');
    console.log('응답:\n', response1);

    const response2 = await robota.run('15 + 27 - 3 * 4의 계산 결과가 얼마인지 알려줘.');
    console.log('응답:\n', response2);

    // 강제 함수 호출 모드로 실행
    console.log('\n===== 강제 함수 호출 모드 =====');

    const response3 = await robota.run('뉴욕의 날씨는 어때?', {
        functionCallMode: 'force',
        forcedFunction: 'getWeather',
        forcedArguments: { location: '뉴욕', unit: 'fahrenheit' }
    });
    console.log('응답:\n', response3);
}

// 실행
main().catch(error => {
    console.error('오류 발생:', error);
}); 