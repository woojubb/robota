/**
 * Zod를 사용한 Function Tool Provider 예제
 * 
 * 이 예제는 Zod 스키마를 사용하여 함수 파라미터를 정의하고,
 * createZodFunctionToolProvider를 통해 ToolProvider를 생성하는 방법을 보여줍니다.
 */

import { z } from "zod";
import { Robota } from "@robota-sdk/core";
import { createZodFunctionToolProvider, type ZodFunctionTool } from "@robota-sdk/tools";

// Zod 스키마를 기반으로 함수 도구 정의
const toolSchemas: Record<string, ZodFunctionTool<z.ZodObject<any>>> = {
    // 'add' 도구: 두 숫자의 합을 반환
    add: {
        name: "add",
        description: "두 숫자를 더해서 결과를 반환합니다.",
        parameters: z.object({
            a: z.number().describe("첫 번째 숫자"),
            b: z.number().describe("두 번째 숫자")
        }),
        handler: async (params: { [x: string]: any }) => {
            const { a, b } = params as { a: number; b: number };
            console.log(`add 함수 호출: ${a} + ${b}`);
            return { result: a + b };
        }
    },

    // 'getWeather' 도구: 위치에 따른 날씨 정보 반환
    getWeather: {
        name: "getWeather",
        description: "날씨를 확인할 도시 이름과 단위를 받아서 날씨 정보를 반환합니다.",
        parameters: z.object({
            location: z.enum(["서울", "부산", "제주"]).describe("날씨를 확인할 도시 이름"),
            unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius").describe("온도 단위")
        }),
        handler: async (params: { [x: string]: any }) => {
            const { location, unit } = params as { location: string; unit?: string };
            console.log(`getWeather 함수 호출: ${location}, ${unit}`);

            // 간단한 날씨 데이터
            const weatherData: Record<string, { temperature: number; condition: string; humidity: number }> = {
                '서울': { temperature: 22, condition: '맑음', humidity: 65 },
                '부산': { temperature: 24, condition: '구름 조금', humidity: 70 },
                '제주': { temperature: 26, condition: '흐림', humidity: 75 }
            };

            const data = weatherData[location] || { temperature: 20, condition: '정보 없음', humidity: 50 };
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

// Function Provider 생성
async function createProvider() {
    // Zod 함수 도구 제공자 생성
    const provider = createZodFunctionToolProvider({
        model: "function-model",
        tools: toolSchemas
    });

    // ModelContextProtocol 인터페이스와 호환되도록 wrapping
    return {
        options: {
            model: 'function-model'
        },
        chat: async (context, options) => {
            const result = await provider.generateCompletion(context);
            return result;
        },
        chatStream: async function* (context, options) {
            const result = provider.generateCompletionStream(context);
            for await (const chunk of result) {
                yield chunk;
            }
        },
        formatMessages: (messages) => messages,
        formatFunctions: (functions) => functions,
        parseResponse: (response) => response,
        parseStreamingChunk: (chunk) => chunk
    };
}

// 메인 함수
async function main() {
    try {
        console.log("Function Tool Provider 예제 시작...");

        // Provider 생성
        const provider = await createProvider();

        // Robota 인스턴스 생성
        const robota = new Robota({
            provider,
            systemPrompt: "당신은 도구를 사용하여 사용자의 요청을 처리하는 AI 비서입니다. 당신은 다음 도구를 사용할 수 있습니다: 숫자 더하기(add), 날씨 정보 조회(getWeather)."
        });

        // 예제 대화
        const queries = [
            "안녕하세요!",
            "5와 7을 더해주세요.",
            "10과 20을 더해줘",
            "add 100 and 200",
            "지금 서울의 날씨가 어때?",
            "제주도의 날씨를 화씨로 알려줘"
        ];

        // 순차적으로 질문 처리
        for (const query of queries) {
            console.log(`\n사용자: ${query}`);
            const response = await robota.run(query);
            console.log(`로봇: ${response}`);
        }

        console.log("\nFunction Tool Provider 예제 완료!");
    } catch (error) {
        console.error("오류 발생:", error);
    }
}

// 프로그램 실행
main().catch(console.error);

export { createProvider }; 