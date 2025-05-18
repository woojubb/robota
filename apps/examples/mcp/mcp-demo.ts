import { McpServer } from "@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { z } from "zod";

// MCP 서버 인스턴스 생성
const server = new McpServer({
    name: "Demo Server",
    version: "1.0.0"
});

// 'add' 도구 추가: 두 숫자의 합을 반환
server.tool(
    "add",
    "두 숫자를 더해서 결과를 반환합니다.",
    {
        a: z.number().describe("첫 번째 숫자"),
        b: z.number().describe("두 번째 숫자")
    },
    async ({ a, b }) => ({
        content: [{ type: "text", text: `결과: ${a + b}` }]
    })
);

// 'getWeather' 도구 추가: 위치에 따른 날씨 정보 반환
server.tool(
    "getWeather",
    "날씨를 확인할 도시 이름과 단위를 받아서 날씨 정보를 반환합니다.",
    {
        location: z.enum(["서울", "부산", "제주"]).describe("날씨를 확인할 도시 이름"),
        unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius").describe("온도 단위")
    },
    async ({ location, unit }) => {
        // 간단한 날씨 데이터
        const weatherData = {
            '서울': { temperature: 22, condition: '맑음', humidity: 65 },
            '부산': { temperature: 24, condition: '구름 조금', humidity: 70 },
            '제주': { temperature: 26, condition: '흐림', humidity: 75 }
        };

        const data = weatherData[location] || { temperature: 20, condition: '정보 없음', humidity: 50 };
        const temp = unit === 'fahrenheit' ? Math.round(data.temperature * 9 / 5 + 32) : data.temperature;

        return {
            content: [{
                type: "text",
                text: `${location}의 날씨: ${temp}°${unit === 'celsius' ? 'C' : 'F'}, ${data.condition}, 습도 ${data.humidity}%`
            }]
        };
    }
);

// STDIO 트랜스포트를 사용하여 서버 시작
const transport = new StdioServerTransport();

// 메인 함수
async function main() {
    try {
        console.error('MCP 서버 시작 중...');
        await server.connect(transport);
        console.error('STDIO MCP 서버가 시작되었습니다.');
        console.error('프로세스를 종료하려면 Ctrl+C를 누르세요.');
    } catch (error) {
        console.error('서버 시작 중 오류 발생:', error);
        process.exit(1);
    }
}

// 프로세스 종료 처리
process.on('SIGINT', () => {
    console.log('\n서버 종료 중...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n서버 종료 중...');
    process.exit(0);
});

// 프로그램 실행
main().catch(console.error); 