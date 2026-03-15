/**
 * HttpClient chat and chatStream Tests
 *
 * Tests the chat-specific methods of HttpClient that were not covered
 * by the existing http-client.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient, type IHttpClientConfig } from '../http-client';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('HttpClient chat methods', () => {
    let httpClient: HttpClient;

    beforeEach(() => {
        const config: IHttpClientConfig = {
            baseUrl: 'https://api.test.com',
            timeout: 30000,
            headers: { 'Authorization': 'Bearer test-key' }
        };
        httpClient = new HttpClient(config);
        mockFetch.mockReset();
    });

    describe('chat', () => {
        it('should send chat request and return response message', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                    success: true,
                    data: { role: 'assistant', content: 'Hello!' },
                    provider: 'openai',
                    model: 'gpt-4'
                }),
                headers: new Map()
            });

            const messages = [{ role: 'user' as const, content: 'Hi' }];
            const result = await httpClient.chat(messages, 'openai', 'gpt-4');

            expect(result.role).toBe('assistant');
            expect(result.content).toBe('Hello!');
            expect(result.provider).toBe('openai');
            expect(result.model).toBe('gpt-4');
            expect(result.timestamp).toBeInstanceOf(Date);
        });

        it('should include tools in request body when provided', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                    success: true,
                    data: { role: 'assistant', content: 'ok' }
                }),
                headers: new Map()
            });

            const tools = [{ name: 'get_weather', description: 'Get weather', parameters: { type: 'object' as const, properties: {} } }];
            await httpClient.chat([{ role: 'user' as const, content: 'weather?' }], 'openai', 'gpt-4', tools);

            const [, init] = mockFetch.mock.calls[0];
            const body = JSON.parse(init.body);
            expect(body.tools).toEqual(tools);
        });

        it('should not include tools when array is empty', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                    success: true,
                    data: { role: 'assistant', content: 'ok' }
                }),
                headers: new Map()
            });

            await httpClient.chat([{ role: 'user' as const, content: 'hi' }], 'openai', 'gpt-4', []);

            const [, init] = mockFetch.mock.calls[0];
            const body = JSON.parse(init.body);
            expect(body.tools).toBeUndefined();
        });

        it('should preserve toolCalls from response', async () => {
            const toolCalls = [{
                id: 'call_1',
                type: 'function' as const,
                function: { name: 'get_weather', arguments: '{"city":"Seoul"}' }
            }];

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                    success: true,
                    data: {
                        role: 'assistant',
                        content: '',
                        toolCalls
                    },
                    provider: 'openai',
                    model: 'gpt-4'
                }),
                headers: new Map()
            });

            const result = await httpClient.chat(
                [{ role: 'user' as const, content: 'weather in Seoul?' }],
                'openai',
                'gpt-4'
            );

            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls?.[0].id).toBe('call_1');
        });

        it('should handle assistant messages with toolCalls in request', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                    success: true,
                    data: { role: 'assistant', content: 'done' }
                }),
                headers: new Map()
            });

            const messages = [
                {
                    role: 'assistant' as const,
                    content: '',
                    toolCalls: [{
                        id: 'call_1',
                        type: 'function' as const,
                        function: { name: 'get_weather', arguments: '{}' }
                    }]
                },
                {
                    role: 'tool' as const,
                    content: '{"temp": 20}',
                    toolCallId: 'call_1'
                }
            ];

            await httpClient.chat(messages, 'openai', 'gpt-4');

            const [, init] = mockFetch.mock.calls[0];
            const body = JSON.parse(init.body);
            expect(body.messages[0].toolCalls).toHaveLength(1);
            expect(body.messages[1].toolCallId).toBe('call_1');
        });

        it('should handle missing data in response gracefully', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                    success: true,
                    data: undefined
                }),
                headers: new Map()
            });

            const result = await httpClient.chat(
                [{ role: 'user' as const, content: 'hi' }],
                'openai',
                'gpt-4'
            );

            // Should default to assistant role and empty content
            expect(result.role).toBe('assistant');
            expect(result.content).toBe('');
        });

        it('should handle unknown role in response by defaulting to assistant', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                    success: true,
                    data: { role: 'unknown_role', content: 'test' }
                }),
                headers: new Map()
            });

            const result = await httpClient.chat(
                [{ role: 'user' as const, content: 'hi' }],
                'openai',
                'gpt-4'
            );

            expect(result.role).toBe('assistant');
        });

        it('should handle non-string content in response', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                    success: true,
                    data: { role: 'assistant', content: 123 }
                }),
                headers: new Map()
            });

            const result = await httpClient.chat(
                [{ role: 'user' as const, content: 'hi' }],
                'openai',
                'gpt-4'
            );

            expect(result.content).toBe('');
        });

        it('should throw on HTTP error', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error'
            });

            await expect(
                httpClient.chat([{ role: 'user' as const, content: 'hi' }], 'openai', 'gpt-4')
            ).rejects.toThrow('HTTP 500');
        });

        it('should filter out invalid toolCalls entries', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                json: vi.fn().mockResolvedValue({
                    success: true,
                    data: {
                        role: 'assistant',
                        content: '',
                        toolCalls: [
                            { id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } },
                            { invalid: 'entry' }, // should be filtered
                            null // should be filtered
                        ]
                    }
                }),
                headers: new Map()
            });

            const result = await httpClient.chat(
                [{ role: 'user' as const, content: 'hi' }],
                'openai',
                'gpt-4'
            );

            expect(result.toolCalls).toHaveLength(1);
        });
    });

    describe('chatStream', () => {
        function createReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
            const encoder = new TextEncoder();
            let index = 0;
            return new ReadableStream({
                pull(controller) {
                    if (index < chunks.length) {
                        controller.enqueue(encoder.encode(chunks[index]));
                        index++;
                    } else {
                        controller.close();
                    }
                }
            });
        }

        it('should yield response messages from SSE stream', async () => {
            const body = createReadableStream([
                'data: {"role":"assistant","content":"Hello"}\n\n',
                'data: {"role":"assistant","content":" world"}\n\n',
                'data: [DONE]\n\n'
            ]);

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body
            });

            const chunks = [];
            for await (const chunk of httpClient.chatStream(
                [{ role: 'user' as const, content: 'hi' }],
                'openai',
                'gpt-4'
            )) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(2);
            expect(chunks[0].role).toBe('assistant');
            expect(chunks[0].content).toBe('Hello');
            expect(chunks[1].content).toBe(' world');
        });

        it('should include tools in stream request body', async () => {
            const body = createReadableStream([
                'data: {"role":"assistant","content":"ok"}\n\n',
                'data: [DONE]\n\n'
            ]);

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body
            });

            const tools = [{ name: 'test', description: 'Test tool', parameters: { type: 'object' as const, properties: {} } }];
            const chunks = [];
            for await (const chunk of httpClient.chatStream(
                [{ role: 'user' as const, content: 'test' }],
                'openai',
                'gpt-4',
                tools
            )) {
                chunks.push(chunk);
            }

            const [, init] = mockFetch.mock.calls[0];
            const requestBody = JSON.parse(init.body);
            expect(requestBody.tools).toEqual(tools);
        });

        it('should throw on HTTP error', async () => {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 500,
                statusText: 'Server Error',
                text: vi.fn().mockResolvedValue('error body')
            });

            await expect(async () => {
                for await (const _chunk of httpClient.chatStream(
                    [{ role: 'user' as const, content: 'hi' }],
                    'openai',
                    'gpt-4'
                )) {
                    // Should not reach here
                }
            }).rejects.toThrow('Streaming request failed');
        });

        it('should throw when response body is missing', async () => {
            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body: null
            });

            await expect(async () => {
                for await (const _chunk of httpClient.chatStream(
                    [{ role: 'user' as const, content: 'hi' }],
                    'openai',
                    'gpt-4'
                )) {
                    // Should not reach here
                }
            }).rejects.toThrow('No response body for streaming');
        });

        it('should skip non-assistant role chunks', async () => {
            const body = createReadableStream([
                'data: {"role":"system","content":"system msg"}\n\n',
                'data: {"role":"assistant","content":"valid"}\n\n',
                'data: [DONE]\n\n'
            ]);

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body
            });

            const chunks = [];
            for await (const chunk of httpClient.chatStream(
                [{ role: 'user' as const, content: 'hi' }],
                'openai',
                'gpt-4'
            )) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(1);
            expect(chunks[0].content).toBe('valid');
        });

        it('should skip invalid JSON in SSE', async () => {
            const body = createReadableStream([
                'data: not-json\n\n',
                'data: {"role":"assistant","content":"valid"}\n\n',
                'data: [DONE]\n\n'
            ]);

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body
            });

            const chunks = [];
            for await (const chunk of httpClient.chatStream(
                [{ role: 'user' as const, content: 'hi' }],
                'openai',
                'gpt-4'
            )) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(1);
        });

        it('should preserve toolCalls from stream chunks', async () => {
            const toolCalls = [{
                id: 'call_1',
                type: 'function',
                function: { name: 'test', arguments: '{}' }
            }];

            const body = createReadableStream([
                `data: {"role":"assistant","content":"","toolCalls":${JSON.stringify(toolCalls)}}\n\n`,
                'data: [DONE]\n\n'
            ]);

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body
            });

            const chunks = [];
            for await (const chunk of httpClient.chatStream(
                [{ role: 'user' as const, content: 'hi' }],
                'openai',
                'gpt-4'
            )) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(1);
            expect(chunks[0].toolCalls).toHaveLength(1);
        });

        it('should handle network errors during streaming', async () => {
            mockFetch.mockRejectedValue(new Error('Network failed'));

            await expect(async () => {
                for await (const _chunk of httpClient.chatStream(
                    [{ role: 'user' as const, content: 'hi' }],
                    'openai',
                    'gpt-4'
                )) {
                    // Should not reach here
                }
            }).rejects.toThrow('Streaming request failed');
        });

        it('should handle non-string content in stream chunks', async () => {
            const body = createReadableStream([
                'data: {"role":"assistant","content":null}\n\n',
                'data: [DONE]\n\n'
            ]);

            mockFetch.mockResolvedValue({
                ok: true,
                status: 200,
                body
            });

            const chunks = [];
            for await (const chunk of httpClient.chatStream(
                [{ role: 'user' as const, content: 'hi' }],
                'openai',
                'gpt-4'
            )) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(1);
            expect(chunks[0].content).toBe('');
        });
    });
});
