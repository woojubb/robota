/**
 * RemoteServer Tests
 *
 * Tests the Express-based server that proxies AI provider requests.
 * Uses mocked Express request/response objects instead of real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IAIProvider, ILogger } from '@robota-sdk/agents';

// Store route handlers registered via the mock router
const routeHandlers: Record<string, Record<string, Function>> = {};

function clearRouteHandlers(): void {
    for (const key of Object.keys(routeHandlers)) {
        delete routeHandlers[key];
    }
}

vi.mock('express', () => {
    const mockRouter = {
        get: vi.fn((path: string, handler: Function) => {
            if (!routeHandlers[path]) routeHandlers[path] = {};
            routeHandlers[path]['get'] = handler;
        }),
        post: vi.fn((path: string, handler: Function) => {
            if (!routeHandlers[path]) routeHandlers[path] = {};
            routeHandlers[path]['post'] = handler;
        })
    };

    const mockApp = {
        use: vi.fn()
    };

    const expressFn = Object.assign(vi.fn(() => mockApp), {
        Router: vi.fn(() => mockRouter),
        json: vi.fn(() => 'json-middleware')
    });

    return { default: expressFn };
});

vi.mock('cors', () => ({
    default: vi.fn(() => 'cors-middleware')
}));

vi.mock('helmet', () => ({
    default: vi.fn(() => 'helmet-middleware')
}));

// Import after mocking
import { RemoteServer } from '../remote-server';

function createMockRes() {
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn()
    };
    return res;
}

function createMockProvider(overrides?: Partial<IAIProvider>): IAIProvider {
    return {
        chat: vi.fn().mockResolvedValue({ role: 'assistant', content: 'response' }),
        chatStream: vi.fn(),
        supportsTools: vi.fn().mockReturnValue(true),
        ...overrides
    } as unknown as IAIProvider;
}

describe('RemoteServer', () => {
    let server: RemoteServer;

    beforeEach(() => {
        clearRouteHandlers();
        server = new RemoteServer();
    });

    describe('constructor', () => {
        it('should create server with default config', () => {
            expect(server).toBeInstanceOf(RemoteServer);
        });

        it('should enable cors when configured', () => {
            clearRouteHandlers();
            // Should not throw when cors is enabled
            expect(() => new RemoteServer({ enableCors: true })).not.toThrow();
        });

        it('should enable helmet when configured', () => {
            clearRouteHandlers();
            // Should not throw when helmet is enabled
            expect(() => new RemoteServer({ enableHelmet: true })).not.toThrow();
        });

        it('should accept custom logger', () => {
            const mockLogger: ILogger = {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
                log: vi.fn(),
            };
            clearRouteHandlers();
            const s = new RemoteServer({ logger: mockLogger });
            expect(s).toBeInstanceOf(RemoteServer);
        });
    });

    describe('initialize', () => {
        it('should register providers', async () => {
            await server.initialize({ openai: createMockProvider() });
            const status = server.getStatus();
            expect(status.providers).toContain('openai');
            expect(status.providerCount).toBe(1);
        });

        it('should register multiple providers', async () => {
            await server.initialize({
                openai: createMockProvider(),
                anthropic: createMockProvider()
            });
            const status = server.getStatus();
            expect(status.providerCount).toBe(2);
        });

        it('should log provider registration with custom logger', async () => {
            const mockLogger: ILogger = {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
                log: vi.fn(),
            };
            clearRouteHandlers();
            const s = new RemoteServer({ logger: mockLogger });
            await s.initialize({ openai: createMockProvider() });
            expect(mockLogger.info).toHaveBeenCalled();
        });

        it('should propagate initialization errors', async () => {
            const badProviders = null as unknown as Record<string, IAIProvider>;
            await expect(server.initialize(badProviders)).rejects.toThrow();
        });
    });

    describe('getExpressRouter', () => {
        it('should return the Express router', () => {
            expect(server.getExpressRouter()).toBeDefined();
        });
    });

    describe('getStatus', () => {
        it('should return initialized status', () => {
            const status = server.getStatus();
            expect(status.initialized).toBe(true);
            expect(status.providers).toEqual([]);
            expect(status.providerCount).toBe(0);
            expect(status.timestamp).toBeDefined();
        });

        it('should return ISO timestamp', () => {
            const status = server.getStatus();
            expect(() => new Date(status.timestamp)).not.toThrow();
        });
    });

    describe('Route handlers', () => {
        beforeEach(async () => {
            await server.initialize({
                openai: createMockProvider(),
                anthropic: createMockProvider()
            });
        });

        describe('GET /health', () => {
            it('should return health status', () => {
                const handler = routeHandlers['/health']?.['get'];
                expect(handler).toBeDefined();

                const res = createMockRes();
                handler({}, res);

                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        status: 'ok',
                        service: 'robota-remote-server'
                    })
                );
            });
        });

        describe('GET /providers', () => {
            it('should list registered providers', () => {
                const handler = routeHandlers['/providers']?.['get'];
                const res = createMockRes();
                handler({}, res);

                const response = res.json.mock.calls[0][0];
                expect(response.success).toBe(true);
                expect(response.count).toBe(2);
                expect(response.providers).toHaveLength(2);
            });
        });

        describe('POST /chat', () => {
            it('should execute chat request successfully', async () => {
                const handler = routeHandlers['/chat']?.['post'];
                const req = {
                    body: {
                        provider: 'openai',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'hi' }]
                    }
                };
                const res = createMockRes();

                await handler(req, res);

                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                        provider: 'openai',
                        model: 'gpt-4'
                    })
                );
            });

            it('should include tools in chat options when provided', async () => {
                const mockChat = vi.fn().mockResolvedValue({ role: 'assistant', content: 'ok' });
                clearRouteHandlers();
                const s = new RemoteServer();
                await s.initialize({ openai: createMockProvider({ chat: mockChat }) });

                const handler = routeHandlers['/chat']?.['post'];
                const tools = [{ name: 'get_weather', description: 'Get weather' }];
                const req = {
                    body: {
                        provider: 'openai',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'weather?' }],
                        tools
                    }
                };
                const res = createMockRes();
                await handler(req, res);

                expect(mockChat).toHaveBeenCalledWith(
                    expect.anything(),
                    expect.objectContaining({ model: 'gpt-4', tools })
                );
            });

            it('should return 400 for missing provider', async () => {
                const handler = routeHandlers['/chat']?.['post'];
                const req = { body: { model: 'gpt-4', messages: [] } };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('should return 400 for non-string provider', async () => {
                const handler = routeHandlers['/chat']?.['post'];
                const req = { body: { provider: 123, model: 'gpt-4', messages: [] } };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('should return 400 for missing model', async () => {
                const handler = routeHandlers['/chat']?.['post'];
                const req = { body: { provider: 'openai', messages: [{ role: 'user', content: 'hi' }] } };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('should return 400 for missing messages', async () => {
                const handler = routeHandlers['/chat']?.['post'];
                const req = { body: { provider: 'openai', model: 'gpt-4' } };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('should return 400 for non-array messages', async () => {
                const handler = routeHandlers['/chat']?.['post'];
                const req = { body: { provider: 'openai', model: 'gpt-4', messages: 'not-array' } };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('should return 400 for unknown provider', async () => {
                const handler = routeHandlers['/chat']?.['post'];
                const req = {
                    body: {
                        provider: 'unknown',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'hi' }]
                    }
                };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        error: expect.stringContaining("'unknown' not found"),
                        availableProviders: expect.any(Array)
                    })
                );
            });

            it('should return 500 on provider execution failure', async () => {
                clearRouteHandlers();
                const s = new RemoteServer();
                await s.initialize({
                    openai: createMockProvider({
                        chat: vi.fn().mockRejectedValue(new Error('Provider crashed'))
                    })
                });

                const handler = routeHandlers['/chat']?.['post'];
                const req = {
                    body: {
                        provider: 'openai',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'hi' }]
                    }
                };
                const res = createMockRes();
                await handler(req, res);

                expect(res.status).toHaveBeenCalledWith(500);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        error: 'Chat execution failed',
                        message: 'Provider crashed'
                    })
                );
            });

            it('should handle non-Error exceptions in chat', async () => {
                clearRouteHandlers();
                const s = new RemoteServer();
                await s.initialize({
                    openai: createMockProvider({
                        chat: vi.fn().mockRejectedValue('string error')
                    })
                });

                const handler = routeHandlers['/chat']?.['post'];
                const req = {
                    body: {
                        provider: 'openai',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'hi' }]
                    }
                };
                const res = createMockRes();
                await handler(req, res);

                expect(res.status).toHaveBeenCalledWith(500);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({ message: 'Unknown error' })
                );
            });
        });

        describe('POST /stream', () => {
            it('should stream SSE response', async () => {
                const chunks = [
                    { role: 'assistant', content: 'Hello' },
                    { role: 'assistant', content: ' world' }
                ];

                async function* mockStream() {
                    for (const chunk of chunks) {
                        yield chunk;
                    }
                }

                clearRouteHandlers();
                const s = new RemoteServer();
                await s.initialize({
                    openai: createMockProvider({
                        chatStream: vi.fn().mockReturnValue(mockStream())
                    })
                });

                const handler = routeHandlers['/stream']?.['post'];
                const req = {
                    body: {
                        provider: 'openai',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'hi' }]
                    }
                };
                const res = createMockRes();
                await handler(req, res);

                expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
                    'Content-Type': 'text/event-stream'
                }));
                expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(chunks[0])}\n\n`);
                expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(chunks[1])}\n\n`);
                expect(res.write).toHaveBeenCalledWith('data: [DONE]\n\n');
                expect(res.end).toHaveBeenCalled();
            });

            it('should return 400 for missing provider in stream', async () => {
                const handler = routeHandlers['/stream']?.['post'];
                const req = { body: { model: 'gpt-4', messages: [] } };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('should return 400 for missing model in stream', async () => {
                const handler = routeHandlers['/stream']?.['post'];
                const req = { body: { provider: 'openai', messages: [{ role: 'user', content: 'hi' }] } };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('should return 400 for missing messages in stream', async () => {
                const handler = routeHandlers['/stream']?.['post'];
                const req = { body: { provider: 'openai', model: 'gpt-4' } };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('should return 400 for unknown provider in stream', async () => {
                const handler = routeHandlers['/stream']?.['post'];
                const req = {
                    body: {
                        provider: 'unknown',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'hi' }]
                    }
                };
                const res = createMockRes();
                await handler(req, res);
                expect(res.status).toHaveBeenCalledWith(400);
            });

            it('should handle provider without chatStream support', async () => {
                clearRouteHandlers();
                const s = new RemoteServer();
                await s.initialize({
                    openai: createMockProvider({
                        chatStream: undefined as unknown as IAIProvider['chatStream']
                    })
                });

                const handler = routeHandlers['/stream']?.['post'];
                const req = {
                    body: {
                        provider: 'openai',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'hi' }]
                    }
                };
                const res = createMockRes();
                await handler(req, res);

                expect(res.write).toHaveBeenCalledWith(
                    expect.stringContaining('does not support streaming')
                );
                expect(res.end).toHaveBeenCalled();
            });

            it('should handle streaming error gracefully via SSE', async () => {
                async function* failingStream() {
                    yield { role: 'assistant', content: 'partial' };
                    throw new Error('Stream interrupted');
                }

                clearRouteHandlers();
                const s = new RemoteServer();
                await s.initialize({
                    openai: createMockProvider({
                        chatStream: vi.fn().mockReturnValue(failingStream())
                    })
                });

                const handler = routeHandlers['/stream']?.['post'];
                const req = {
                    body: {
                        provider: 'openai',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'hi' }]
                    }
                };
                const res = createMockRes();
                await handler(req, res);

                expect(res.write).toHaveBeenCalledWith(
                    expect.stringContaining('Stream execution failed')
                );
                expect(res.end).toHaveBeenCalled();
            });

            it('should handle non-Error stream exceptions', async () => {
                async function* failingStream() {
                    yield { role: 'assistant', content: 'partial', timestamp: new Date() };
                    throw 'string error';
                }

                clearRouteHandlers();
                const s = new RemoteServer();
                await s.initialize({
                    openai: createMockProvider({
                        chatStream: vi.fn().mockReturnValue(failingStream())
                    })
                });

                const handler = routeHandlers['/stream']?.['post'];
                const req = {
                    body: {
                        provider: 'openai',
                        model: 'gpt-4',
                        messages: [{ role: 'user', content: 'hi' }]
                    }
                };
                const res = createMockRes();
                await handler(req, res);

                expect(res.write).toHaveBeenCalledWith(
                    expect.stringContaining('Unknown error')
                );
                expect(res.end).toHaveBeenCalled();
            });
        });

        describe('GET /providers/:provider/capabilities', () => {
            it('should return capabilities for a known provider', () => {
                const handler = routeHandlers['/providers/:provider/capabilities']?.['get'];
                expect(handler).toBeDefined();

                const req = { params: { provider: 'openai' } };
                const res = createMockRes();
                handler(req, res);

                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        success: true,
                        provider: 'openai',
                        capabilities: expect.objectContaining({
                            chat: true,
                            tools: true
                        })
                    })
                );
            });

            it('should return 404 for unknown provider', () => {
                const handler = routeHandlers['/providers/:provider/capabilities']?.['get'];
                const req = { params: { provider: 'unknown' } };
                const res = createMockRes();
                handler(req, res);

                expect(res.status).toHaveBeenCalledWith(404);
                expect(res.json).toHaveBeenCalledWith(
                    expect.objectContaining({
                        error: expect.stringContaining("'unknown' not found")
                    })
                );
            });
        });
    });
});
