import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteExecutor } from './remote-executor';
import type { ChatExecutionRequest, StreamExecutionRequest } from '../interfaces/executor';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock WebSocket
class MockWebSocket {
    static instances: MockWebSocket[] = [];

    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;

    url: string;
    readyState: number = 0; // CONNECTING

    constructor(url: string) {
        this.url = url;
        MockWebSocket.instances.push(this);
        // Simulate connection opening after a tick
        setTimeout(() => {
            this.readyState = 1; // OPEN
            this.onopen?.(new Event('open'));
        }, 0);
    }

    send(data: string) {
        // Mock implementation - can be overridden in tests
    }

    close() {
        this.readyState = 3; // CLOSED
        this.onclose?.(new CloseEvent('close'));
    }

    static reset() {
        MockWebSocket.instances = [];
    }
}

global.WebSocket = MockWebSocket as any;

describe('RemoteExecutor', () => {
    let executor: RemoteExecutor;

    beforeEach(() => {
        vi.clearAllMocks();
        MockWebSocket.reset();

        executor = new RemoteExecutor({
            serverUrl: 'https://api.robota.io',
            userApiKey: 'test-token-123'
        });
    });

    describe('constructor', () => {
        it('should create executor with valid config', () => {
            expect(executor.name).toBe('remote');
            expect(executor.version).toBe('1.0.0');
        });

        it('should throw error for invalid serverUrl', () => {
            expect(() => {
                new RemoteExecutor({
                    serverUrl: 'invalid-url',
                    userApiKey: 'test-token'
                });
            }).toThrow('Invalid RemoteExecutor configuration');
        });

        it('should throw error for missing userApiKey', () => {
            expect(() => {
                new RemoteExecutor({
                    serverUrl: 'https://api.robota.io',
                    userApiKey: ''
                });
            }).toThrow('Invalid RemoteExecutor configuration');
        });

        it('should apply default configuration', () => {
            const executor = new RemoteExecutor({
                serverUrl: 'https://api.robota.io',
                userApiKey: 'test-token'
            });

            expect(executor.validateConfig()).toBe(true);
        });
    });

    describe('executeChat', () => {
        const mockRequest: ChatExecutionRequest = {
            messages: [{ role: 'user', content: 'Hello!', timestamp: new Date() }],
            provider: 'openai',
            model: 'gpt-4'
        };

        it('should handle OpenAI-style response format', async () => {
            const mockResponse = {
                choices: [{
                    message: {
                        role: 'assistant',
                        content: 'Hello! How can I help you?'
                    }
                }]
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse)
            });

            const result = await executor.executeChat(mockRequest);

            expect(result).toEqual({
                role: 'assistant',
                content: 'Hello! How can I help you?',
                timestamp: expect.any(Date)
            });

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.robota.io/api/v1/chat',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer test-token-123'
                    }),
                    body: JSON.stringify({
                        ...mockRequest,
                        stream: false
                    })
                })
            );
        });

        it('should handle direct response format', async () => {
            const mockResponse = {
                role: 'assistant',
                content: 'Direct response format',
                toolCalls: [{ id: 'call_1', type: 'function' }]
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockResponse)
            });

            const result = await executor.executeChat(mockRequest);

            expect(result).toEqual({
                role: 'assistant',
                content: 'Direct response format',
                timestamp: expect.any(Date),
                toolCalls: [{ id: 'call_1', type: 'function' }]
            });
        });

        it('should handle HTTP errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                text: () => Promise.resolve('Unauthorized')
            });

            await expect(executor.executeChat(mockRequest))
                .rejects.toThrow('RemoteExecutor chat failed: HTTP 401: Unauthorized');
        });

        it('should handle invalid response format', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({ invalid: 'response' })
            });

            await expect(executor.executeChat(mockRequest))
                .rejects.toThrow('RemoteExecutor chat failed: Invalid response format from remote server');
        });

        it('should handle network errors with retry', async () => {
            const networkError = new Error('Network error');

            // First two attempts fail, third succeeds
            mockFetch
                .mockRejectedValueOnce(networkError)
                .mockRejectedValueOnce(networkError)
                .mockResolvedValueOnce({
                    ok: true,
                    json: () => Promise.resolve({
                        role: 'assistant',
                        content: 'Success after retry'
                    })
                });

            const result = await executor.executeChat(mockRequest);

            expect(result.content).toBe('Success after retry');
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });
    });

    describe('executeChatStream (SSE)', () => {
        const mockStreamRequest: StreamExecutionRequest = {
            messages: [{ role: 'user', content: 'Tell me a story', timestamp: new Date() }],
            provider: 'openai',
            model: 'gpt-4',
            stream: true
        };

        it('should handle Server-Sent Events streaming', async () => {
            const mockSSEData = [
                'data: {"choices":[{"delta":{"content":"Once"}}]}\n\n',
                'data: {"choices":[{"delta":{"content":" upon"}}]}\n\n',
                'data: {"choices":[{"delta":{"content":" a time"}}]}\n\n',
                'data: [DONE]\n\n'
            ].join('');

            const mockReader = {
                read: vi.fn()
                    .mockResolvedValueOnce({
                        done: false,
                        value: new TextEncoder().encode(mockSSEData)
                    })
                    .mockResolvedValueOnce({
                        done: true,
                        value: undefined
                    }),
                releaseLock: vi.fn()
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => mockReader
                }
            });

            const chunks: any[] = [];
            for await (const chunk of executor.executeChatStream(mockStreamRequest)) {
                chunks.push(chunk);
            }

            expect(chunks).toHaveLength(3);
            expect(chunks[0].content).toBe('Once');
            expect(chunks[1].content).toBe(' upon');
            expect(chunks[2].content).toBe(' a time');

            expect(mockReader.releaseLock).toHaveBeenCalled();
        });

        it('should handle SSE HTTP errors', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                text: () => Promise.resolve('Internal Server Error')
            });

            const streamPromise = (async () => {
                const chunks: any[] = [];
                for await (const chunk of executor.executeChatStream(mockStreamRequest)) {
                    chunks.push(chunk);
                }
                return chunks;
            })();

            await expect(streamPromise)
                .rejects.toThrow('RemoteExecutor stream failed: HTTP 500: Internal Server Error');
        });
    });

    describe('executeChatStream (WebSocket)', () => {
        let wsExecutor: RemoteExecutor;

        beforeEach(() => {
            wsExecutor = new RemoteExecutor({
                serverUrl: 'https://api.robota.io',
                userApiKey: 'test-token-123',
                enableWebSocket: true
            });
        });

        const mockStreamRequest: StreamExecutionRequest = {
            messages: [{ role: 'user', content: 'Tell me a story', timestamp: new Date() }],
            provider: 'openai',
            model: 'gpt-4',
            stream: true
        };

        it('should handle WebSocket streaming', async () => {
            const streamPromise = (async () => {
                const chunks: any[] = [];
                for await (const chunk of wsExecutor.executeChatStream(mockStreamRequest)) {
                    chunks.push(chunk);
                }
                return chunks;
            })();

            // Wait for WebSocket to be created
            await new Promise(resolve => setTimeout(resolve, 10));

            const ws = MockWebSocket.instances[0];
            expect(ws).toBeDefined();
            if (ws) {
                expect(ws.url).toBe('wss://api.robota.io/ws/chat');
            }

            // Simulate WebSocket messages
            if (ws) {
                ws.onmessage?.(new MessageEvent('message', {
                    data: JSON.stringify({ type: 'chunk', content: 'Hello' })
                }));

                ws.onmessage?.(new MessageEvent('message', {
                    data: JSON.stringify({ type: 'chunk', content: ' world' })
                }));

                ws.onmessage?.(new MessageEvent('message', {
                    data: JSON.stringify({ type: 'done' })
                }));
            }

            const chunks = await streamPromise;

            expect(chunks).toHaveLength(2);
            expect(chunks[0].content).toBe('Hello');
            expect(chunks[1].content).toBe(' world');
        });

        it('should handle WebSocket errors', async () => {
            const streamPromise = (async () => {
                const chunks: any[] = [];
                for await (const chunk of wsExecutor.executeChatStream(mockStreamRequest)) {
                    chunks.push(chunk);
                }
                return chunks;
            })();

            // Wait for WebSocket to be created
            await new Promise(resolve => setTimeout(resolve, 10));

            const ws = MockWebSocket.instances[0];
            if (ws) {
                ws.onmessage?.(new MessageEvent('message', {
                    data: JSON.stringify({ type: 'error', message: 'WebSocket error' })
                }));
            }

            await expect(streamPromise).rejects.toThrow('WebSocket error');
        });
    });

    describe('utility methods', () => {
        it('should support tools', () => {
            expect(executor.supportsTools()).toBe(true);
        });

        it('should validate configuration correctly', () => {
            expect(executor.validateConfig()).toBe(true);

            // Test creation with invalid config but don't let constructor throw
            expect(() => {
                new RemoteExecutor({
                    serverUrl: 'https://api.robota.io',
                    userApiKey: 'test-token',
                    timeout: -1 // Invalid timeout
                });
            }).toThrow('Invalid RemoteExecutor configuration');
        });

        it('should dispose resources', async () => {
            await expect(executor.dispose()).resolves.not.toThrow();
        });
    });

    describe('configuration options', () => {
        it('should use custom timeout', () => {
            const customExecutor = new RemoteExecutor({
                serverUrl: 'https://api.robota.io',
                userApiKey: 'test-token',
                timeout: 60000
            });

            expect(customExecutor.validateConfig()).toBe(true);
        });

        it('should use custom headers', async () => {
            const customExecutor = new RemoteExecutor({
                serverUrl: 'https://api.robota.io',
                userApiKey: 'test-token',
                headers: {
                    'X-Custom-Header': 'custom-value'
                }
            });

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve({
                    role: 'assistant',
                    content: 'Response with custom headers'
                })
            });

            await customExecutor.executeChat({
                messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
                provider: 'openai',
                model: 'gpt-4'
            });

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.robota.io/api/v1/chat',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'X-Custom-Header': 'custom-value'
                    })
                })
            );
        });

        it('should use custom maxRetries', async () => {
            const customExecutor = new RemoteExecutor({
                serverUrl: 'https://api.robota.io',
                userApiKey: 'test-token',
                maxRetries: 1 // Only 1 retry
            });

            const networkError = new Error('Network error');
            mockFetch
                .mockRejectedValueOnce(networkError)
                .mockRejectedValueOnce(networkError);

            await expect(customExecutor.executeChat({
                messages: [{ role: 'user', content: 'Hello', timestamp: new Date() }],
                provider: 'openai',
                model: 'gpt-4'
            })).rejects.toThrow('RemoteExecutor chat failed: Network error');

            // Should be called 2 times (original + 1 retry)
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });
}); 