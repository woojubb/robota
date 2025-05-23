/**
 * 01-mcp-client.ts
 * 
 * MCP 클라이언트를 Robota 에이전트와 통합하는 예제입니다.
 * - MCP(Model Context Protocol) 서버와 통신
 * - Robota 에이전트와 함께 사용
 */

import { Robota } from "@robota-sdk/core";
import { createMcpToolProvider } from "@robota-sdk/tools";
import { OpenAIProvider } from "@robota-sdk/openai";
import { Client } from "@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import OpenAI from "openai";
import path from 'path';
import dotenv from 'dotenv';

// 환경 변수 로드
dotenv.config();

async function main() {
    try {
        console.log('MCP 에이전트 예제 시작...');

        // 1. MCP 서버 경로 설정
        const serverPath = path.resolve(__dirname, '../../services/mcp-server.ts');
        console.log(`MCP 서버 경로: ${serverPath}`);

        // 2. MCP 트랜스포트 생성
        console.log('1. MCP 트랜스포트 생성 중...');
        const transport = new StdioClientTransport({
            command: 'npx',
            args: ['ts-node', serverPath],
        });

        // 3. MCP 클라이언트 인스턴스 생성
        console.log('2. MCP 클라이언트 생성 중...');
        const mcpClient = new Client({
            name: 'simple-client',
            version: '1.0',
        });

        await mcpClient.connect(transport);

        // 4. MCP 툴 제공자 생성 
        console.log('3. MCP 툴 제공자 생성 중...');
        // 타입 단언(as any)을 사용하여 타입 오류 해결
        const mcpProvider = createMcpToolProvider(mcpClient as any);

        // 5. OpenAI API 키 확인
        console.log('4. OpenAI 클라이언트 생성 중...');
        if (!process.env.OPENAI_API_KEY) {
            console.warn('경고: OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.');
            process.exit(1);
        }

        // 6. OpenAI 클라이언트 생성
        const openaiClient = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || ''
        });

        // 7. OpenAI 제공자 생성
        console.log('5. OpenAI 제공자 생성 중...');
        const openaiProvider = new OpenAIProvider({
            model: 'gpt-3.5-turbo',
            temperature: 0.7,
            client: openaiClient
        });

        // 8. Robota 에이전트 인스턴스 생성
        console.log('6. Robota 에이전트 인스턴스 생성 중...');
        const agent = new Robota({
            aiClient: openaiProvider, // OpenAI 제공자 사용
            provider: mcpProvider, // MCP 제공자 사용
            systemPrompt: '당신은 MCP를 통해 연결된 AI 모델을 사용하는 도우미입니다. 정확하고 유용한 정보를 제공하세요.'
        });

        // 9. 계산 도구 호출 예제
        console.log('\n----- 계산 도구 호출 예제 -----');
        try {
            const response1 = await agent.run('5와 7을 더해주세요.');
            console.log(`사용자: 5와 7을 더해주세요.`);
            console.log(`응답: ${response1}`);
        } catch (error) {
            console.error('계산 도구 호출 오류:', error);
        }

        // 10. 날씨 정보 요청 대화 실행
        console.log('\n----- 날씨 정보 요청 예제 -----');
        try {
            const response2 = await agent.run('서울의 현재 날씨를 알려주세요.');
            console.log(`사용자: 서울의 현재 날씨를 알려주세요.`);
            console.log(`응답: ${response2}`);
        } catch (error) {
            console.error('날씨 정보 요청 오류:', error);
        }

        // 11. 추가 날씨 정보 요청 (화씨 단위)
        console.log('\n----- 추가 날씨 정보 요청 예제 (화씨 단위) -----');
        try {
            const response3 = await agent.run('제주도의 날씨를 화씨로 알려주세요.');
            console.log(`사용자: 제주도의 날씨를 화씨로 알려주세요.`);
            console.log(`응답: ${response3}`);
        } catch (error) {
            console.error('추가 날씨 정보 요청 오류:', error);
        }

        // 12. 연결 종료
        console.log('\n연결 종료 중...');
        try {
            // Robota 에이전트 종료
            await agent.close?.();
            console.log('Robota 인스턴스가 종료되었습니다.');
        } catch (error) {
            console.error('연결 종료 오류:', error);
        }

        console.log('\n===== MCP 클라이언트 예제 완료 =====');
    } catch (error) {
        console.error('오류 발생:', error);
        process.exit(1);
    }
}

// 프로그램 실행
main().catch(console.error); 