export const DAG_OPENAPI_DOCUMENT = {
    openapi: '3.0.3',
    info: {
        title: 'Robota DAG API',
        version: '1.0.0',
        description: 'DAG design, run, asset, and run-progress APIs.'
    },
    servers: [
        { url: '/' }
    ],
    tags: [
        { name: 'DAG' }
    ],
    components: {
        schemas: {
            ProblemDetails: {
                type: 'object',
                required: ['type', 'title', 'status', 'detail', 'instance', 'code', 'retryable'],
                properties: {
                    type: { type: 'string' },
                    title: { type: 'string' },
                    status: { type: 'number' },
                    code: { type: 'string' },
                    detail: { type: 'string' },
                    instance: { type: 'string' },
                    retryable: { type: 'boolean' },
                    correlationId: { type: 'string' }
                }
            },
            ErrorEnvelope: {
                type: 'object',
                required: ['ok', 'status', 'errors'],
                properties: {
                    ok: { type: 'boolean', enum: [false] },
                    status: { type: 'number' },
                    errors: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/ProblemDetails' }
                    }
                }
            }
        }
    },
    paths: {
        '/v1/dag/dev/bootstrap': {
            post: {
                tags: ['DAG'],
                summary: 'Create and publish sample DAG for development',
                responses: {
                    '201': { description: 'Bootstrapped sample definition' },
                    '400': {
                        description: 'Bootstrap failed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/nodes': {
            get: {
                tags: ['DAG'],
                summary: 'List available node manifests',
                responses: {
                    '200': { description: 'Node list' }
                }
            }
        },
        '/v1/dag/definitions': {
            post: {
                tags: ['DAG'],
                summary: 'Create DAG definition',
                responses: {
                    '201': { description: 'Definition created' },
                    '400': {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            },
            get: {
                tags: ['DAG'],
                summary: 'List DAG definitions',
                responses: {
                    '200': { description: 'Definition list' }
                }
            }
        },
        '/v1/dag/definitions/{dagId}': {
            get: {
                tags: ['DAG'],
                summary: 'Get DAG definition by dagId',
                parameters: [
                    {
                        name: 'dagId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Definition' },
                    '404': {
                        description: 'Not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/definitions/{dagId}/draft': {
            put: {
                tags: ['DAG'],
                summary: 'Update draft definition',
                parameters: [
                    {
                        name: 'dagId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Draft updated' },
                    '400': {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/definitions/{dagId}/validate': {
            post: {
                tags: ['DAG'],
                summary: 'Validate definition version',
                parameters: [
                    {
                        name: 'dagId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Definition validated' },
                    '400': {
                        description: 'Validation failed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/definitions/{dagId}/publish': {
            post: {
                tags: ['DAG'],
                summary: 'Publish definition version',
                parameters: [
                    {
                        name: 'dagId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Definition published' },
                    '400': {
                        description: 'Publish failed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/runs': {
            post: {
                tags: ['DAG'],
                summary: 'Create and start DAG run',
                responses: {
                    '201': { description: 'Run started' },
                    '400': {
                        description: 'Validation error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/runs/{dagRunId}/start': {
            post: {
                tags: ['DAG'],
                summary: 'Start queued run',
                parameters: [
                    {
                        name: 'dagRunId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '202': { description: 'Run started' },
                    '400': {
                        description: 'Start failed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/runs/{dagRunId}': {
            get: {
                tags: ['DAG'],
                summary: 'Get DAG run metadata',
                parameters: [
                    {
                        name: 'dagRunId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Run metadata' },
                    '404': {
                        description: 'Not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            },
            delete: {
                tags: ['DAG'],
                summary: 'Delete run artifacts',
                parameters: [
                    {
                        name: 'dagRunId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Deleted' },
                    '404': {
                        description: 'Run not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/runs/{dagRunId}/result': {
            get: {
                tags: ['DAG'],
                summary: 'Get DAG run result',
                parameters: [
                    {
                        name: 'dagRunId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Run result' },
                    '404': {
                        description: 'Not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    },
                    '409': {
                        description: 'Run in progress',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/runs/{dagRunId}/events': {
            get: {
                tags: ['DAG'],
                summary: 'SSE progress stream for DAG run',
                parameters: [
                    {
                        name: 'dagRunId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': {
                        description: 'SSE stream',
                        content: {
                            'text/event-stream': {
                                schema: {
                                    type: 'string',
                                    example: 'data: {"event":{"eventType":"task.started","dagRunId":"..."}}\\n\\n'
                                }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/dev/workers/process-once': {
            post: {
                tags: ['DAG'],
                summary: 'Process one task in worker loop (dev)',
                responses: {
                    '200': { description: 'Processed' },
                    '500': {
                        description: 'Worker error',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/dev/llm-text/complete': {
            post: {
                tags: ['DAG'],
                summary: 'Dev LLM completion endpoint',
                responses: {
                    '200': { description: 'Completion response' },
                    '400': {
                        description: 'Validation/provider failure',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    },
                    '500': {
                        description: 'LLM client not configured',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/dev/definitions/{dagId}': {
            delete: {
                tags: ['DAG'],
                summary: 'Delete definition artifacts (dev)',
                parameters: [
                    {
                        name: 'dagId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Artifacts deleted' },
                    '404': {
                        description: 'Definition not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/runs/temporary-copies': {
            delete: {
                tags: ['DAG'],
                summary: 'Delete temporary copied runs',
                responses: {
                    '200': { description: 'Deleted temporary copies' },
                    '400': {
                        description: 'Deletion failed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/assets': {
            post: {
                tags: ['DAG'],
                summary: 'Upload binary asset',
                responses: {
                    '201': { description: 'Asset created' }
                }
            }
        },
        '/v1/dag/assets/{assetId}': {
            get: {
                tags: ['DAG'],
                summary: 'Get asset metadata',
                parameters: [
                    {
                        name: 'assetId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Asset metadata' },
                    '404': {
                        description: 'Not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/assets/{assetId}/content': {
            get: {
                tags: ['DAG'],
                summary: 'Fetch asset binary content',
                parameters: [
                    {
                        name: 'assetId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Binary content' },
                    '404': {
                        description: 'Not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/dev/observability/{dagRunId}/dashboard': {
            get: {
                tags: ['DAG'],
                summary: 'Run observability dashboard (dev)',
                parameters: [
                    {
                        name: 'dagRunId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    '200': { description: 'Dashboard payload' },
                    '400': {
                        description: 'Run query failed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ErrorEnvelope' }
                            }
                        }
                    }
                }
            }
        }
    }
} as const;
