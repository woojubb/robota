/**
 * 01-zod-function-tools.ts
 * 
 * 이 예제는 Zod를 사용한 Function Tool Provider를 보여줍니다:
 * - Zod 스키마를 사용하여 함수 파라미터 정의
 * - createZodFunctionToolProvider를 통한 도구 제공자 생성
 * - AI 없이 도구만으로 에이전트 구동
 */

import { z } from "zod";
import { Robota } from "@robota-sdk/core";
import { createZodFunctionToolProvider } from "@robota-sdk/tools";
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

// Zod 스키마를 기반으로 함수 도구 정의
const tools = {
    // 'add' 도구: 두 숫자의 합을 반환
    add: {
        name: "add",
        description: "두 숫자를 더해서 결과를 반환합니다.",
        parameters: z.object({
            a: z.number().describe("첫 번째 숫자"),
            b: z.number().describe("두 번째 숫자")
        }),
        handler: async (params) => {
            const { a, b } = params;
            console.log(`add 함수 호출: ${a} + ${b}`);
            return { result: a + b };
        }
    },

    // 'getWeather' 도구: 도시에 따른 날씨 정보 반환
    getWeather: {
        name: "getWeather",
        description: "도시의 날씨 정보를 반환합니다.",
        parameters: z.object({
            location: z.enum(["서울", "부산", "제주"]).describe("날씨를 확인할 도시 이름"),
            unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius").describe("온도 단위")
        }),
        handler: async (params) => {
            const { location, unit } = params;
            console.log(`getWeather 함수 호출: ${location}, ${unit}`);

            // 간단한 날씨 데이터 (실제로는 API 호출 등으로 구현)
            const weatherData = {
                '서울': { temperature: 22, condition: '맑음', humidity: 65 },
                '부산': { temperature: 24, condition: '구름 조금', humidity: 70 },
                '제주': { temperature: 26, condition: '흐림', humidity: 75 }
            };

            const data = weatherData[location];
            const temp = unit === 'fahrenheit' ? Math.round(data.temperature * 9 / 5 + 32) : data.temperature;

            return {
                temperature: temp,
                unit: unit === 'celsius' ? 'C' : 'F',
                condition: data.condition,
                humidity: data.humidity
            };
        }
    }
};

async function main() {
    try {
        console.log("Zod Function Tool Provider 예제 시작...");

        // Zod 함수 도구 제공자 생성
        const provider = createZodFunctionToolProvider({
            tools
        });

        // Robota 인스턴스 생성 (aiClient 없이 provider만 사용)
        const robota = new Robota({
            provider,
            systemPrompt: "당신은 도구를 사용하여 사용자의 요청을 처리하는 AI 비서입니다."
        });

        // 테스트할 예제 쿼리들
        const queries = [
            "안녕하세요!",
            "5와 7을 더해주세요.",
            "지금 서울의 날씨가 어때?",
            "제주도의 날씨를 화씨로 알려줘"
        ];

        // 순차적으로 질문 처리
        for (const query of queries) {
            console.log(`\n사용자: ${query}`);
            const response = await robota.run(query);
            console.log(`로봇: ${response}`);
        }

        console.log("\nZod Function Tool Provider 예제 완료!");
    } catch (error) {
        console.error("오류 발생:", error);
    }
}

// 실행
main().catch(console.error); 