/**
 * OpenAPI 3.0.3 specification for the Prompt API.
 * This is the SSOT (Single Source of Truth) for all API contracts.
 * TypeScript types, controllers, routes, and client ports must conform to this spec.
 */

const PromptNodeDef = {
  type: 'object' as const,
  required: ['class_type', 'inputs'],
  properties: {
    class_type: { type: 'string' as const, description: 'Node type identifier' },
    inputs: {
      type: 'object' as const,
      additionalProperties: true,
      description: 'Config values (scalars) and link references ([nodeId, slotIndex]) mixed',
    },
    _meta: {
      type: 'object' as const,
      properties: { title: { type: 'string' as const } },
    },
  },
};

const Prompt = {
  type: 'object' as const,
  additionalProperties: PromptNodeDef,
  description: 'DAG prompt: nodeId → node definition',
};

const NodeError = {
  type: 'object' as const,
  properties: {
    type: { type: 'string' as const },
    message: { type: 'string' as const },
    details: { type: 'string' as const },
    extra_info: { type: 'object' as const, additionalProperties: true },
  },
};

const NodeObjectInfo = {
  type: 'object' as const,
  required: ['display_name', 'category', 'input', 'output', 'output_is_list', 'output_name', 'output_node', 'description'],
  properties: {
    display_name: { type: 'string' as const },
    category: { type: 'string' as const },
    input: {
      type: 'object' as const,
      properties: {
        required: { type: 'object' as const, additionalProperties: true },
        optional: { type: 'object' as const, additionalProperties: true },
        hidden: { type: 'object' as const, additionalProperties: { type: 'string' as const } },
      },
    },
    output: { type: 'array' as const, items: { type: 'string' as const } },
    output_is_list: { type: 'array' as const, items: { type: 'boolean' as const } },
    output_name: { type: 'array' as const, items: { type: 'string' as const } },
    output_node: { type: 'boolean' as const },
    description: { type: 'string' as const },
  },
};

export const PROMPT_API_OPENAPI_DOCUMENT = {
  openapi: '3.0.3',
  info: {
    title: 'Robota DAG Prompt API',
    version: '1.0.0',
    description: 'Prompt-based DAG execution API with interchangeable backend',
  },
  paths: {
    '/prompt': {
      post: {
        operationId: 'submitPrompt',
        summary: 'Submit a prompt for execution',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                required: ['prompt'],
                properties: {
                  prompt: Prompt,
                  client_id: { type: 'string' as const, format: 'uuid' },
                  prompt_id: { type: 'string' as const, format: 'uuid' },
                  extra_data: {
                    type: 'object' as const,
                    properties: {
                      extra_pnginfo: {
                        type: 'object' as const,
                        properties: {
                          workflow: { type: 'object' as const, additionalProperties: true },
                        },
                      },
                    },
                  },
                  front: { type: 'boolean' as const, default: false },
                  number: { type: 'integer' as const },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Prompt queued successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  required: ['prompt_id', 'number', 'node_errors'],
                  properties: {
                    prompt_id: { type: 'string' as const, format: 'uuid' },
                    number: { type: 'integer' as const },
                    node_errors: { type: 'object' as const, additionalProperties: NodeError },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    error: NodeError,
                    node_errors: { type: 'object' as const, additionalProperties: NodeError },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/queue': {
      get: {
        operationId: 'getQueue',
        summary: 'Get current queue status',
        responses: {
          '200': {
            description: 'Queue status',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  required: ['queue_running', 'queue_pending'],
                  properties: {
                    queue_running: { type: 'array' as const, items: { type: 'array' as const } },
                    queue_pending: { type: 'array' as const, items: { type: 'array' as const } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'manageQueue',
        summary: 'Manage queue (clear or delete items)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                properties: {
                  clear: { type: 'boolean' as const },
                  delete: { type: 'array' as const, items: { type: 'string' as const } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Queue updated' },
        },
      },
    },
    '/history': {
      get: {
        operationId: 'getHistory',
        summary: 'Get execution history',
        responses: {
          '200': {
            description: 'All history entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  additionalProperties: {
                    type: 'object' as const,
                    properties: {
                      prompt: Prompt,
                      outputs: { type: 'object' as const, additionalProperties: true },
                      status: {
                        type: 'object' as const,
                        properties: {
                          status_str: { type: 'string' as const, enum: ['success', 'error'] },
                          completed: { type: 'boolean' as const },
                          messages: { type: 'array' as const, items: {} },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/history/{prompt_id}': {
      get: {
        operationId: 'getHistoryById',
        summary: 'Get execution history for a specific prompt',
        parameters: [
          { name: 'prompt_id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: {
          '200': {
            description: 'History entry',
            content: {
              'application/json': {
                schema: { type: 'object' as const, additionalProperties: true },
              },
            },
          },
        },
      },
    },
    '/object_info': {
      get: {
        operationId: 'getObjectInfo',
        summary: 'Get all registered node types',
        responses: {
          '200': {
            description: 'All node type definitions',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  additionalProperties: NodeObjectInfo,
                },
              },
            },
          },
        },
      },
    },
    '/object_info/{node_type}': {
      get: {
        operationId: 'getObjectInfoByType',
        summary: 'Get a specific node type definition',
        parameters: [
          { name: 'node_type', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: {
          '200': {
            description: 'Node type definition',
            content: {
              'application/json': {
                schema: NodeObjectInfo,
              },
            },
          },
          '404': { description: 'Node type not found' },
        },
      },
    },
    '/system_stats': {
      get: {
        operationId: 'getSystemStats',
        summary: 'Get system statistics',
        responses: {
          '200': {
            description: 'System stats',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    system: {
                      type: 'object' as const,
                      properties: {
                        os: { type: 'string' as const },
                        runtime_version: { type: 'string' as const },
                        embedded_python: { type: 'boolean' as const },
                      },
                    },
                    devices: {
                      type: 'array' as const,
                      items: {
                        type: 'object' as const,
                        properties: {
                          name: { type: 'string' as const },
                          type: { type: 'string' as const },
                          vram_total: { type: 'integer' as const },
                          vram_free: { type: 'integer' as const },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
