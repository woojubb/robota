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
    paths: {
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
                    '404': { description: 'Not found' }
                }
            }
        },
        '/v1/dag/runs': {
            post: {
                tags: ['DAG'],
                summary: 'Create and start DAG run',
                responses: {
                    '201': { description: 'Run started' },
                    '400': { description: 'Validation error' }
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
                    '404': { description: 'Not found' }
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
                    '404': { description: 'Not found' },
                    '409': { description: 'Run in progress' }
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
                            'text/event-stream': {}
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
                    '404': { description: 'Not found' }
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
                    '404': { description: 'Not found' }
                }
            }
        }
    }
} as const;
