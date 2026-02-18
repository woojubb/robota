export const REMOTE_OPENAPI_DOCUMENT = {
    openapi: '3.0.3',
    info: {
        title: 'Robota Remote API',
        version: '1.0.0',
        description: 'LLM provider proxy API exposed by the Remote server.'
    },
    servers: [
        { url: '/' }
    ],
    tags: [
        { name: 'Remote' }
    ],
    paths: {
        '/api/v1/remote/health': {
            get: {
                tags: ['Remote'],
                summary: 'Remote server health',
                responses: {
                    '200': { description: 'OK' }
                }
            }
        },
        '/api/v1/remote/chat': {
            post: {
                tags: ['Remote'],
                summary: 'Chat completion proxy',
                responses: {
                    '200': { description: 'Chat response' }
                }
            }
        },
        '/api/v1/remote/stream': {
            post: {
                tags: ['Remote'],
                summary: 'Streaming chat proxy',
                responses: {
                    '200': {
                        description: 'Streaming response',
                        content: {
                            'text/event-stream': {}
                        }
                    }
                }
            }
        },
        '/api/v1/remote/providers/{provider}/capabilities': {
            get: {
                tags: ['Remote'],
                summary: 'Provider capability query',
                parameters: [
                    {
                        name: 'provider',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Capability payload' }
                }
            }
        },
        '/api/v1/remote/ws/status': {
            get: {
                tags: ['Remote'],
                summary: 'Playground websocket status',
                responses: {
                    '200': { description: 'Websocket status' }
                }
            }
        }
    }
} as const;
