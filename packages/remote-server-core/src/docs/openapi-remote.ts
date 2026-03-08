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
    components: {
        schemas: {
            ChatMessage: {
                type: 'object',
                required: ['role', 'content'],
                properties: {
                    role: { type: 'string', description: 'Message role (e.g., user, assistant, system).' },
                    content: { type: 'string' },
                    toolCalls: { type: 'array', items: { type: 'object' } },
                    toolCallId: { type: 'string' }
                }
            },
            ChatRequest: {
                type: 'object',
                required: ['provider', 'model', 'messages'],
                properties: {
                    provider: { type: 'string', description: 'LLM provider identifier (e.g., openai, anthropic).' },
                    model: { type: 'string', description: 'Model identifier (e.g., gpt-4, claude-3).' },
                    messages: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/ChatMessage' },
                        description: 'Conversation message history.'
                    },
                    tools: {
                        type: 'array',
                        items: { type: 'object' },
                        description: 'Optional tool schemas for function calling.'
                    },
                    temperature: { type: 'number' },
                    maxTokens: { type: 'number' }
                }
            },
            ChatResponse: {
                type: 'object',
                required: ['success', 'data', 'provider', 'model', 'timestamp'],
                properties: {
                    success: { type: 'boolean', enum: [true] },
                    data: {
                        type: 'object',
                        description: 'Universal message response from the provider.'
                    },
                    provider: { type: 'string' },
                    model: { type: 'string' },
                    timestamp: { type: 'string', format: 'date-time' }
                }
            },
            ChatErrorResponse: {
                type: 'object',
                required: ['error', 'message'],
                properties: {
                    error: { type: 'string' },
                    message: { type: 'string' }
                }
            },
            ProviderCapabilities: {
                type: 'object',
                required: ['success', 'provider', 'capabilities'],
                properties: {
                    success: { type: 'boolean', enum: [true] },
                    provider: { type: 'string' },
                    capabilities: {
                        type: 'object',
                        required: ['chat', 'stream', 'tools'],
                        properties: {
                            chat: { type: 'boolean' },
                            stream: { type: 'boolean' },
                            tools: { type: 'boolean' }
                        }
                    }
                }
            },
            ProviderNotFoundResponse: {
                type: 'object',
                required: ['error', 'availableProviders'],
                properties: {
                    error: { type: 'string' },
                    availableProviders: {
                        type: 'array',
                        items: { type: 'string' }
                    }
                }
            },
            HealthResponse: {
                type: 'object',
                required: ['status', 'service', 'initialized', 'providers', 'providerCount', 'timestamp'],
                properties: {
                    status: { type: 'string', enum: ['ok'] },
                    service: { type: 'string' },
                    initialized: { type: 'boolean' },
                    providers: {
                        type: 'array',
                        items: { type: 'string' }
                    },
                    providerCount: { type: 'number' },
                    timestamp: { type: 'string', format: 'date-time' }
                }
            }
        }
    },
    paths: {
        '/api/v1/remote/health': {
            get: {
                tags: ['Remote'],
                summary: 'Remote server health',
                responses: {
                    '200': {
                        description: 'OK',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/HealthResponse' }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/remote/chat': {
            post: {
                tags: ['Remote'],
                summary: 'Chat completion proxy',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ChatRequest' }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Chat response',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ChatResponse' }
                            }
                        }
                    },
                    '400': {
                        description: 'Invalid request (missing provider, model, or messages)',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ChatErrorResponse' }
                            }
                        }
                    },
                    '500': {
                        description: 'Provider error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ChatErrorResponse' }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/remote/stream': {
            post: {
                tags: ['Remote'],
                summary: 'Streaming chat proxy',
                description: 'Opens a Server-Sent Events stream for incremental chat responses. Each frame contains a provider message chunk. Stream terminates with `data: [DONE]`.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/ChatRequest' }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Streaming response via SSE',
                        content: {
                            'text/event-stream': {
                                schema: {
                                    type: 'string',
                                    description: 'Each SSE frame: `data: <JSON chunk>\\n\\n`, terminated by `data: [DONE]\\n\\n`.'
                                }
                            }
                        }
                    },
                    '400': {
                        description: 'Invalid request',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ChatErrorResponse' }
                            }
                        }
                    },
                    '500': {
                        description: 'Provider/streaming error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ChatErrorResponse' }
                            }
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
                        schema: { type: 'string' },
                        description: 'Provider identifier.'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Capability payload',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ProviderCapabilities' }
                            }
                        }
                    },
                    '404': {
                        description: 'Provider not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ProviderNotFoundResponse' }
                            }
                        }
                    }
                }
            }
        },
        '/api/v1/remote/ws/status': {
            get: {
                tags: ['Remote'],
                summary: 'Playground websocket status',
                responses: {
                    '200': {
                        description: 'Websocket connection status',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    description: 'Runtime status of the websocket subsystem.'
                                }
                            }
                        }
                    }
                }
            }
        }
    }
} as const;
