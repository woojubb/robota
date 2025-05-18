import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPProvider } from './provider';
import { MCPClient } from './types';

// MCPClient 목(mock) 클래스
class MockMCPClient implements MCPClient {
    public chatResponse: any = { content: '테스트 응답' };
    public streamChunks: any[] = [
        { content: '청크 1' },
        { content: '청크 2' },
        { content: '청크 3', isComplete: true }
    ];

    async chat(options: any): Promise<any> {
        return this.chatResponse;
    }

    async *stream(options: any): AsyncIterable<any> {
        for (const chunk of this.streamChunks) {
            yield chunk;
        }
    }
}

describe('MCPProvider', () => {
    describe('생성자', () => {
        it('클라이언트가 제공되지 않으면 에러를 발생시켜야 함', () => {
            expect(() => {
                new MCPProvider({
                    type: 'client',
                    model: 'test-model'
                } as any);
            }).toThrow('MCP 클라이언트 인스턴스가 주입되지 않았습니다');
        });

        it('OpenAPI 스키마가 제공되지 않으면 에러를 발생시켜야 함', () => {
            expect(() => {
                new MCPProvider({
                    type: 'openapi',
                    model: 'test-model'
                } as any);
            }).toThrow('OpenAPI 스키마가 제공되지 않았습니다');
        });

        it('지원되지 않는 타입이 제공되면 에러를 발생시켜야 함', () => {
            expect(() => {
                new MCPProvider({
                    type: 'invalid-type' as any,
                    model: 'test-model'
                } as any);
            }).toThrow('지원되지 않는 MCP 클라이언트 타입입니다');
        });
    });

    describe('클라이언트 방식', () => {
        let provider: MCPProvider;
        let mockClient: MockMCPClient;

        beforeEach(() => {
            mockClient = new MockMCPClient();
            provider = new MCPProvider({
                type: 'client',
                client: mockClient,
                model: 'test-model',
                temperature: 0.7
            });
        });

        it('chat 메서드가 클라이언트의 응답을 올바르게 파싱해야 함', async () => {
            mockClient.chatResponse = {
                content: '테스트 메시지',
                function_call: {
                    name: 'testFunction',
                    arguments: '{"param1":"value1"}'
                },
                usage: {
                    prompt_tokens: 10,
                    completion_tokens: 20,
                    total_tokens: 30
                }
            };

            const context = {
                messages: [{ role: 'user', content: '테스트 질문' }],
                functions: []
            };

            const response = await provider.chat(context);

            expect(response.content).toBe('테스트 메시지');
            expect(response.functionCall).toBeDefined();
            expect(response.functionCall?.name).toBe('testFunction');
            expect(response.usage).toBeDefined();
            expect(response.usage?.totalTokens).toBe(30);
        });

        it('chatStream 메서드가 클라이언트의 스트림을 올바르게 처리해야 함', async () => {
            const context = {
                messages: [{ role: 'user', content: '테스트 질문' }],
                functions: []
            };

            const stream = provider.chatStream(context);
            const chunks = [];

            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBe(3);
            expect(chunks[0].content).toBe('청크 1');
            expect(chunks[2].isComplete).toBe(true);
        });
    });

    describe('OpenAPI 방식', () => {
        let provider: MCPProvider;

        beforeEach(() => {
            provider = new MCPProvider({
                type: 'openapi',
                schema: { openapi: '3.0.0' },
                baseURL: 'https://api.example.com',
                model: 'test-model',
                temperature: 0.7
            });

            // OpenAPI 엔드포인트 호출 메서드를 모킹
            vi.spyOn(provider as any, 'callOpenAPIEndpoint').mockImplementation(async () => {
                return {
                    data: {
                        content: 'OpenAPI 응답',
                        function_call: {
                            name: 'apiFunction',
                            arguments: '{"param":"value"}'
                        },
                        usage: {
                            prompt_tokens: 15,
                            completion_tokens: 25,
                            total_tokens: 40
                        }
                    }
                };
            });

            vi.spyOn(provider as any, 'callOpenAPIStreamEndpoint').mockImplementation(async function* () {
                yield { data: { content: 'OpenAPI 청크 1' } };
                yield { data: { content: 'OpenAPI 청크 2' } };
                yield { data: { content: 'OpenAPI 청크 3', isComplete: true } };
            });
        });

        it('chat 메서드가 OpenAPI 응답을 올바르게 파싱해야 함', async () => {
            const context = {
                messages: [{ role: 'user', content: 'OpenAPI 테스트' }],
                functions: []
            };

            const response = await provider.chat(context);

            expect(response.content).toBe('OpenAPI 응답');
            expect(response.functionCall).toBeDefined();
            expect(response.functionCall?.name).toBe('apiFunction');
            expect(response.usage).toBeDefined();
            expect(response.usage?.totalTokens).toBe(40);
        });

        it('chatStream 메서드가 OpenAPI 스트림을 올바르게 처리해야 함', async () => {
            const context = {
                messages: [{ role: 'user', content: 'OpenAPI 스트림 테스트' }],
                functions: []
            };

            const stream = provider.chatStream(context);
            const chunks = [];

            for await (const chunk of stream) {
                chunks.push(chunk);
            }

            expect(chunks.length).toBe(3);
            expect(chunks[0].content).toBe('OpenAPI 청크 1');
            expect(chunks[2].isComplete).toBe(true);
        });
    });

    describe('formatMessages', () => {
        let provider: MCPProvider;
        let mockClient: MockMCPClient;

        beforeEach(() => {
            mockClient = new MockMCPClient();
            provider = new MCPProvider({
                type: 'client',
                client: mockClient,
                model: 'test-model'
            });
        });

        it('메시지를 올바른 포맷으로 변환해야 함', () => {
            const messages = [
                { role: 'system', content: '시스템 메시지' },
                { role: 'user', content: '사용자 메시지' },
                { role: 'assistant', content: '어시스턴트 메시지' },
                {
                    role: 'user',
                    content: '함수 호출 테스트',
                    functionCall: {
                        name: 'testFunc',
                        arguments: { param: 'value' }
                    }
                }
            ];

            const formatted = provider.formatMessages(messages);

            expect(formatted.length).toBe(4);
            expect(formatted[0].role).toBe('system');
            expect(formatted[0].content).toBe('시스템 메시지');
            expect(formatted[3].function_call).toBeDefined();
            expect(formatted[3].function_call.name).toBe('testFunc');
        });
    });

    describe('formatFunctions', () => {
        let provider: MCPProvider;
        let mockClient: MockMCPClient;

        beforeEach(() => {
            mockClient = new MockMCPClient();
            provider = new MCPProvider({
                type: 'client',
                client: mockClient,
                model: 'test-model'
            });
        });

        it('함수 정의를 올바른 포맷으로 변환해야 함', () => {
            const functions = [
                {
                    name: 'getWeather',
                    description: '날씨 정보 조회',
                    parameters: {
                        type: 'object',
                        properties: {
                            location: {
                                type: 'string',
                                description: '위치'
                            }
                        }
                    }
                }
            ];

            const formatted = provider.formatFunctions(functions);

            expect(formatted.length).toBe(1);
            expect(formatted[0].name).toBe('getWeather');
            expect(formatted[0].description).toBe('날씨 정보 조회');
            expect(formatted[0].parameters.properties.location.type).toBe('string');
        });
    });
}); 