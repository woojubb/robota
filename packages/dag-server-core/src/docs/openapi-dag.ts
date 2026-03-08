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
            },
            SuccessEnvelope: {
                type: 'object',
                required: ['ok', 'status', 'data'],
                properties: {
                    ok: { type: 'boolean', enum: [true] },
                    status: { type: 'number' },
                    data: { type: 'object' }
                }
            },
            DagDefinition: {
                type: 'object',
                description: 'A complete DAG definition with nodes, edges, and metadata.',
                required: ['dagId', 'version', 'status', 'nodes', 'edges'],
                properties: {
                    dagId: { type: 'string' },
                    version: { type: 'number' },
                    status: { type: 'string', enum: ['draft', 'validated', 'published'] },
                    nodes: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/DagNode' }
                    },
                    edges: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/DagEdge' }
                    }
                }
            },
            DagNode: {
                type: 'object',
                required: ['nodeId', 'nodeType', 'dependsOn', 'inputs', 'outputs', 'config'],
                properties: {
                    nodeId: { type: 'string' },
                    nodeType: { type: 'string' },
                    dependsOn: { type: 'array', items: { type: 'string' } },
                    inputs: { type: 'array', items: { type: 'object' } },
                    outputs: { type: 'array', items: { type: 'object' } },
                    config: { type: 'object' }
                }
            },
            DagEdge: {
                type: 'object',
                required: ['from', 'to', 'bindings'],
                properties: {
                    from: { type: 'string' },
                    to: { type: 'string' },
                    bindings: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['outputKey', 'inputKey'],
                            properties: {
                                outputKey: { type: 'string' },
                                inputKey: { type: 'string' }
                            }
                        }
                    }
                }
            },
            CreateDefinitionRequest: {
                type: 'object',
                required: ['definition'],
                properties: {
                    definition: { $ref: '#/components/schemas/DagDefinition' }
                }
            },
            UpdateDraftRequest: {
                type: 'object',
                required: ['version', 'definition'],
                properties: {
                    version: { type: 'number' },
                    definition: { $ref: '#/components/schemas/DagDefinition' }
                }
            },
            VersionBody: {
                type: 'object',
                required: ['version'],
                properties: {
                    version: { type: 'number' }
                }
            },
            CreateRunRequest: {
                type: 'object',
                required: ['definition'],
                properties: {
                    definition: { $ref: '#/components/schemas/DagDefinition' },
                    input: {
                        type: 'object',
                        description: 'Optional input payload for the DAG run.',
                        additionalProperties: true
                    }
                }
            },
            CreateAssetRequest: {
                type: 'object',
                required: ['fileName', 'mediaType', 'base64Data'],
                properties: {
                    fileName: { type: 'string' },
                    mediaType: { type: 'string', description: 'MIME type (e.g., image/png).' },
                    base64Data: { type: 'string', description: 'Base64-encoded binary content.' }
                }
            },
            LlmCompleteRequest: {
                type: 'object',
                required: ['prompt'],
                properties: {
                    prompt: { type: 'string' },
                    provider: { type: 'string' },
                    model: { type: 'string' },
                    temperature: { type: 'number' },
                    maxTokens: { type: 'number' }
                }
            },
            AssetReference: {
                type: 'object',
                required: ['referenceType', 'assetId', 'mediaType', 'uri'],
                properties: {
                    referenceType: { type: 'string', enum: ['asset'] },
                    assetId: { type: 'string' },
                    mediaType: { type: 'string' },
                    uri: { type: 'string' },
                    name: { type: 'string' },
                    sizeBytes: { type: 'number' }
                }
            },
            RunProgressEvent: {
                type: 'object',
                description: 'SSE event payload for DAG run progress.',
                required: ['dagRunId', 'eventType', 'occurredAt'],
                properties: {
                    dagRunId: { type: 'string' },
                    eventType: {
                        type: 'string',
                        enum: [
                            'task.started', 'task.completed', 'task.failed',
                            'execution.started', 'execution.completed', 'execution.failed'
                        ]
                    },
                    occurredAt: { type: 'string', format: 'date-time' },
                    taskRunId: { type: 'string' },
                    nodeId: { type: 'string' },
                    dagId: { type: 'string' },
                    version: { type: 'number' },
                    input: { type: 'object' },
                    output: { type: 'object' },
                    error: {
                        type: 'object',
                        properties: {
                            code: { type: 'string' },
                            category: { type: 'string' },
                            message: { type: 'string' },
                            retryable: { type: 'boolean' },
                            context: { type: 'object' }
                        }
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
                    '201': {
                        description: 'Bootstrapped sample definition',
                        content: {
                            'application/json': {
                                schema: {
                                    allOf: [
                                        { $ref: '#/components/schemas/SuccessEnvelope' },
                                        {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        definitionId: { type: 'string' },
                                                        dagId: { type: 'string' },
                                                        version: { type: 'number' }
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
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
                    '200': {
                        description: 'Node list',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    }
                }
            }
        },
        '/v1/dag/definitions': {
            post: {
                tags: ['DAG'],
                summary: 'Create DAG definition',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/CreateDefinitionRequest' }
                        }
                    }
                },
                responses: {
                    '201': {
                        description: 'Definition created',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                parameters: [
                    {
                        name: 'dagId',
                        in: 'query',
                        required: false,
                        schema: { type: 'string' },
                        description: 'Filter by DAG identifier.'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Definition list',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    }
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
                    },
                    {
                        name: 'version',
                        in: 'query',
                        required: false,
                        schema: { type: 'integer', minimum: 1 },
                        description: 'Specific version number. Omit for latest.'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Definition',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/UpdateDraftRequest' }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Draft updated',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/VersionBody' }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Definition validated',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/VersionBody' }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Definition published',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/CreateRunRequest' }
                        }
                    }
                },
                responses: {
                    '201': {
                        description: 'Run started',
                        content: {
                            'application/json': {
                                schema: {
                                    allOf: [
                                        { $ref: '#/components/schemas/SuccessEnvelope' },
                                        {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        dagRunId: { type: 'string' }
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
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
                    '202': {
                        description: 'Run started',
                        content: {
                            'application/json': {
                                schema: {
                                    allOf: [
                                        { $ref: '#/components/schemas/SuccessEnvelope' },
                                        {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        dagRunId: { type: 'string' }
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
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
                    '200': {
                        description: 'Run metadata',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                    '200': {
                        description: 'Deleted',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                    '200': {
                        description: 'Run result',
                        content: {
                            'application/json': {
                                schema: {
                                    allOf: [
                                        { $ref: '#/components/schemas/SuccessEnvelope' },
                                        {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        run: { type: 'object', description: 'Complete run result with task outputs.' }
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
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
                description: 'Opens a Server-Sent Events stream that emits task and execution progress events. On connection, replays current state from the snapshot. Keep-alive comments (`:`) are sent periodically.',
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
                        description: 'SSE stream of RunProgressEvent payloads',
                        content: {
                            'text/event-stream': {
                                schema: {
                                    type: 'string',
                                    description: 'Each SSE frame: `data: {"event": <RunProgressEvent>}\\n\\n`'
                                },
                                example: 'data: {"event":{"dagRunId":"run-1","eventType":"task.started","occurredAt":"2026-01-01T00:00:00Z","taskRunId":"t-1","nodeId":"node-1"}}\n\n'
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
                    '200': {
                        description: 'Processed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/LlmCompleteRequest' }
                        }
                    }
                },
                responses: {
                    '200': {
                        description: 'Completion response',
                        content: {
                            'application/json': {
                                schema: {
                                    allOf: [
                                        { $ref: '#/components/schemas/SuccessEnvelope' },
                                        {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        completion: { type: 'string' },
                                                        modelSelection: {
                                                            type: 'object',
                                                            properties: {
                                                                provider: { type: 'string' },
                                                                model: { type: 'string' }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
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
                    },
                    {
                        name: 'version',
                        in: 'query',
                        required: false,
                        schema: { type: 'integer', minimum: 1 },
                        description: 'Specific version to delete. Omit to delete all versions.'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Artifacts deleted',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                    '200': {
                        description: 'Deleted temporary copies',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: { $ref: '#/components/schemas/CreateAssetRequest' }
                        }
                    }
                },
                responses: {
                    '201': {
                        description: 'Asset created',
                        content: {
                            'application/json': {
                                schema: {
                                    allOf: [
                                        { $ref: '#/components/schemas/SuccessEnvelope' },
                                        {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        asset: { $ref: '#/components/schemas/AssetReference' }
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
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
                    '200': {
                        description: 'Asset metadata',
                        content: {
                            'application/json': {
                                schema: {
                                    allOf: [
                                        { $ref: '#/components/schemas/SuccessEnvelope' },
                                        {
                                            type: 'object',
                                            properties: {
                                                data: {
                                                    type: 'object',
                                                    properties: {
                                                        asset: { $ref: '#/components/schemas/AssetReference' }
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    },
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
                    '200': {
                        description: 'Binary content streamed with Content-Type from asset metadata.',
                        headers: {
                            'Content-Type': {
                                description: 'Media type of the asset (e.g., image/png).',
                                schema: { type: 'string' }
                            },
                            'Content-Disposition': {
                                description: 'Inline disposition with original filename.',
                                schema: { type: 'string' }
                            }
                        },
                        content: {
                            'application/octet-stream': {
                                schema: { type: 'string', format: 'binary' }
                            }
                        }
                    },
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
                    '200': {
                        description: 'Dashboard payload',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SuccessEnvelope' }
                            }
                        }
                    },
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
